/**
 * Minimal REST client for the Gemini Interactions API.
 * https://generativelanguage.googleapis.com/v1beta/interactions
 *
 * Conversation history lives on Google's side: each reply carries an id that the
 * next turn passes back as previous_interaction_id.
 */
const ENDPOINT = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/interactions';

export const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
export const hasKey = () => !!process.env.GEMINI_API_KEY;

/** Pull the pieces we care about out of an interaction, tolerating shape drift. */
function parse(data) {
  const steps = Array.isArray(data.steps) ? data.steps : [];
  const calls = [];
  const texts = [];
  for (const step of steps) {
    if (step.type === 'function_call') {
      calls.push({
        id: step.id || step.call_id,
        name: step.name,
        args: typeof step.arguments === 'string' ? safeJson(step.arguments) : (step.arguments || {}),
      });
      continue;
    }
    for (const part of step.content || []) {
      if (part.type === 'function_call') {
        calls.push({ id: part.id || part.call_id, name: part.name, args: typeof part.arguments === 'string' ? safeJson(part.arguments) : (part.arguments || {}) });
      } else if (part.type === 'text' && step.type !== 'user_input') {
        texts.push(part.text);
      }
    }
  }
  return { id: data.id, calls, text: (data.output_text || texts.join('\n')).trim() };
}

const safeJson = (s) => { try { return JSON.parse(s); } catch { return {}; } };

export async function interact({ input, systemInstruction, tools, previousId, timeoutMs = 60_000 }) {
  const send = async (prevId) => {
    const body = { model: MODEL, input };
    if (systemInstruction) body.system_instruction = systemInstruction;
    if (tools?.length) body.tools = tools;
    if (prevId) body.previous_interaction_id = prevId;

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) {
      const e = new Error(`Gemini ${res.status}: ${text.slice(0, 300)}`);
      e.status = res.status;
      throw e;
    }
    return parse(safeJson(text));
  };

  try {
    return await send(previousId);
  } catch (e) {
    // A dropped or expired server-side history must not kill the conversation.
    if (previousId && (e.status === 400 || e.status === 404)) return send(null);
    throw e;
  }
}
