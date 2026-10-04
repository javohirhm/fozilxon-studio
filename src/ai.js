/**
 * The chat brain: turns what Fozilxon says (typed or spoken) into real actions.
 * Gemini picks the tools, src/tools.js executes them against SQLite.
 */
import * as db from './db.js';
import { interact, MODEL, hasKey } from './gemini.js';
import { toolDeclarations, runTool } from './tools.js';
import { todayISO, money, num } from './format.js';

const MAX_STEPS = 8;              // tool round-trips per message
const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;

const sessions = new Map();       // userId -> { previousId, at }

export const resetSession = (userId) => sessions.delete(userId);
export const aiReady = hasKey;

function sessionId(userId) {
  const s = sessions.get(userId);
  if (!s || Date.now() - s.at > SESSION_IDLE_MS) return null;
  return s.previousId;
}

/** Everything the model should know before it starts calling tools. */
function systemInstruction() {
  const today = todayISO();
  const projects = db.listProjects().filter((p) => !p.archived)
    .map((p) => `#${p.id} ${p.name} (${p.shootings} съёмка, ${num(p.income)})`).join('; ') || 'hali yo\'q';
  const assistants = db.listAssistants().filter((a) => a.active)
    .map((a) => `#${a.id} ${a.name} (stavka ${num(a.rate)})`).join('; ') || 'hali yo\'q';
  const claims = db.pendingClaims().length;

  return `Sen — Fozilxon ismli videografning shaxsiy yordamchisisan. U O'zbekistonda ishlaydi: to'y, reklama, klip суёmkalari qiladi.
Sening vazifang — u gapirgan yoki yozgan narsani tushunib, bazaga yozib qo'yish va savollariga aniq javob berish.

BUGUN: ${today}
Valyuta: so'm. "5 mln" = 5000000, "300 ming" = 300000.
Til: FAQAT o'zbek tilida javob ber, qisqa va aniq. Markdown ishlatma (** yoki # belgilarsiz), oddiy matn va emoji.

HOZIRGI HOLAT:
Loyihalar: ${projects}
Yordamchilar: ${assistants}
Tasdiqlanmagan arizalar: ${claims} ta

QOIDALAR:
1. Har qanday ma'lumotni faqat tool orqali ol — hech narsani o'zingdan to'qima.
2. Foydalanuvchi ish haqida gapirsa (masalan "bugun to'yda ishladik, 5 mln oldik") — darhol add_shooting bilan yozib qo'y. Ortiqcha savol berma: loyiha va summa aniq bo'lsa yetarli. Sana aytilmasa — bugun.
3. Agar loyiha nomi ro'yxatda yo'q bo'lsa, foydalanuvchidan so'ra: yangi loyiha ochaymi?
4. O'chirish (delete_*) amallarini avval confirm'siz chaqir, natijadagi ogohlantirishni foydalanuvchiga ayt va "ha" degandan keyingina confirm=true bilan bajar.
5. Ish bajarilgandan keyin nima yozganingni raqamlari bilan qisqa tasdiqla. Masalan: "✅ Yozildi: Aziz to'yi, 4-oktabr, 5 000 000 so'm, Bekzod (300 000)."
6. Yordamchi o'zi yolg'iz borgan bo'lsa (solo) — to'lovi ikkilanadi, buni aytib qo'y.
7. Bir nechta amal kerak bo'lsa, ketma-ket bajar. Noaniqlik bo'lsa — faqat shunda savol ber.`;
}

/**
 * Run one user message (text and/or a voice note) to completion.
 * `audio` = { data: base64, mimeType }
 * Returns { text, actions } — actions is what actually ran, for logging.
 */
export async function ask(userId, { text, audio }) {
  if (!hasKey()) throw new Error('GEMINI_API_KEY yo\'q');

  const parts = [];
  if (audio) {
    parts.push({ type: 'text', text: text || 'Bu ovozli xabarni tingla va aytilganini bajar.' });
    parts.push({ type: 'audio', data: audio.data, mime_type: audio.mimeType });
  } else {
    parts.push({ type: 'text', text });
  }

  let input = parts;
  let previousId = sessionId(userId);
  const actions = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const reply = await interact({
      input,
      systemInstruction: systemInstruction(),
      tools: toolDeclarations(),
      previousId,
    });
    previousId = reply.id;
    sessions.set(userId, { previousId, at: Date.now() });

    if (!reply.calls.length) return { text: reply.text, actions };

    input = reply.calls.map((call) => {
      const result = runTool(call.name, call.args);
      actions.push({ name: call.name, args: call.args, ok: !result.error });
      return {
        type: 'function_result',
        name: call.name,
        call_id: call.id,
        result: [{ type: 'text', text: JSON.stringify(result) }],
      };
    });
  }
  return { text: 'Juda ko\'p amal ketdi — qayta, soddaroq ayting.', actions };
}

export { MODEL, money };
