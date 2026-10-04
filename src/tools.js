/**
 * Every action a user can take in the bot, exposed to Gemini as callable tools.
 * Each tool returns a small plain object — it goes straight back into the model's
 * context, so results stay terse. Errors are returned, not thrown: the model reads
 * them and corrects itself.
 */
import * as db from './db.js';
import { parseDate, parseMoney, todayISO } from './format.js';

const err = (message, extra = {}) => ({ error: message, ...extra });

/* ---------- resolvers: the model may pass an id or a name ---------- */
function resolveProject(ref) {
  if (ref === undefined || ref === null || ref === '') return err('Loyiha ko\'rsatilmagan');
  const all = db.listProjects();
  if (typeof ref === 'number' || /^\d+$/.test(String(ref))) {
    const p = all.find((x) => x.id === Number(ref));
    return p || err(`${ref} raqamli loyiha yo'q`, { projects: all.map((x) => ({ id: x.id, name: x.name })) });
  }
  const q = String(ref).toLowerCase().trim();
  const exact = all.filter((p) => p.name.toLowerCase() === q);
  const matches = exact.length ? exact : all.filter((p) => p.name.toLowerCase().includes(q));
  if (matches.length === 1) return matches[0];
  if (!matches.length) return err(`"${ref}" nomli loyiha topilmadi`, { projects: all.map((x) => ({ id: x.id, name: x.name })) });
  return err(`"${ref}" bir nechta loyihaga to'g'ri keldi — qaysi biri?`, { matches: matches.map((x) => ({ id: x.id, name: x.name })) });
}

function resolveAssistant(ref) {
  if (ref === undefined || ref === null || ref === '') return err('Yordamchi ko\'rsatilmagan');
  const all = db.listAssistants();
  if (typeof ref === 'number' || /^\d+$/.test(String(ref))) {
    const a = all.find((x) => x.id === Number(ref));
    return a || err(`${ref} raqamli yordamchi yo'q`, { assistants: all.map((x) => ({ id: x.id, name: x.name })) });
  }
  const q = String(ref).toLowerCase().trim();
  const exact = all.filter((a) => a.name.toLowerCase() === q);
  const matches = exact.length ? exact : all.filter((a) => a.name.toLowerCase().includes(q));
  if (matches.length === 1) return matches[0];
  if (!matches.length) return err(`"${ref}" ismli yordamchi yo'q`, { assistants: all.map((x) => ({ id: x.id, name: x.name })) });
  return err(`"${ref}" bir nechta kishiga to'g'ri keldi`, { matches: matches.map((x) => ({ id: x.id, name: x.name })) });
}

const isErr = (x) => x && x.error !== undefined;

/** ISO date, 24.09.2026, or the words bugun/kecha. Defaults to today. */
function resolveDate(value) {
  if (!value) return todayISO();
  const v = String(value).trim().toLowerCase();
  if (['bugun', 'today', 'сегодня'].includes(v)) return todayISO();
  if (['kecha', 'yesterday', 'вчера'].includes(v)) return todayISO(-1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return parseDate(v) || null;
}

const money = (v) => (typeof v === 'number' ? Math.round(v) : parseMoney(String(v ?? '')) ?? 0);
const month = (v) => (/^\d{4}-\d{2}$/.test(String(v || '')) ? String(v) : todayISO().slice(0, 7));

/* ---------- shapes sent back to the model ---------- */
const projectRow = (p) => ({
  id: p.id, name: p.name, shootings: p.shootings, income: p.income,
  expenses: p.rent + p.fees, net: p.income - p.rent - p.fees, unpaid: p.unpaid,
  last_date: p.last_date, archived: !!p.archived,
});
const shootingRow = (s) => ({
  id: s.id, date: s.date, project: s.project_name, note: s.note, amount: s.amount,
  rent: s.rent, assistant_fees: s.fees, net: s.amount - s.rent - s.fees,
  paid: !!s.paid, assistants: s.assistant_names || '',
});
const assistantRow = (a) => ({
  id: a.id, name: a.name, rate: a.rate, active: !!a.active,
  shootings: a.shootings, earned: a.earned, last_date: a.last_date,
});

/* ---------- tools ---------- */
const S = { str: { type: 'string' }, int: { type: 'integer' }, bool: { type: 'boolean' } };
const ref = (what) => ({ type: 'string', description: `${what} nomi yoki id raqami` });
const dateArg = { type: 'string', description: 'Sana: YYYY-MM-DD, yoki "bugun" / "kecha". Berilmasa — bugun.' };
const monthArg = { type: 'string', description: 'Oy: YYYY-MM. Berilmasa — joriy oy.' };

export const TOOLS = [
  /* --- projects --- */
  {
    name: 'list_projects',
    description: 'Barcha loyihalar ro\'yxati: daromad, xarajat, sof foyda, to\'lanmagan summa.',
    parameters: { type: 'object', properties: { include_archived: S.bool }, required: [] },
    run: ({ include_archived }) => ({
      projects: db.listProjects().filter((p) => include_archived || !p.archived).map(projectRow),
    }),
  },
  {
    name: 'create_project',
    description: 'Yangi loyiha ochish. Yangi mijoz yoki yangi ish kelganda.',
    parameters: { type: 'object', properties: { name: S.str }, required: ['name'] },
    run: ({ name }) => {
      if (!name?.trim()) return err('Loyiha nomi bo\'sh');
      const exists = db.listProjects().find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
      if (exists) return err(`"${name}" loyihasi allaqachon bor`, { project: projectRow(exists) });
      return { created: projectRow(db.projectStats(db.createProject(name.trim()))) };
    },
  },
  {
    name: 'rename_project',
    description: 'Loyiha nomini o\'zgartirish.',
    parameters: { type: 'object', properties: { project: ref('Loyiha'), new_name: S.str }, required: ['project', 'new_name'] },
    run: ({ project, new_name }) => {
      const p = resolveProject(project);
      if (isErr(p)) return p;
      db.renameProject(p.id, new_name.trim());
      return { renamed: { id: p.id, from: p.name, to: new_name.trim() } };
    },
  },
  {
    name: 'archive_project',
    description: 'Loyihani arxivlash yoki arxivdan qaytarish (tugagan loyihalar uchun).',
    parameters: { type: 'object', properties: { project: ref('Loyiha'), archived: S.bool }, required: ['project', 'archived'] },
    run: ({ project, archived }) => {
      const p = resolveProject(project);
      if (isErr(p)) return p;
      db.setProjectArchived(p.id, archived);
      return { project: p.name, archived: !!archived };
    },
  },
  {
    name: 'delete_project',
    description: 'Loyihani butunlay o\'chirish (barcha съёмкалари bilan). Avval confirm=false bilan chaqirib, foydalanuvchidan tasdiq so\'rang.',
    parameters: { type: 'object', properties: { project: ref('Loyiha'), confirm: S.bool }, required: ['project'] },
    run: ({ project, confirm }) => {
      const p = resolveProject(project);
      if (isErr(p)) return p;
      if (!confirm) return { needs_confirmation: true, warning: `"${p.name}" va uning ${p.shootings} ta съёмкаси o'chadi. Foydalanuvchidan tasdiq so'rang, keyin confirm=true bilan qayta chaqiring.` };
      db.deleteProject(p.id);
      return { deleted: p.name };
    },
  },
  {
    name: 'project_details',
    description: 'Bitta loyiha haqida to\'liq ma\'lumot va oxirgi съёмкалари.',
    parameters: { type: 'object', properties: { project: ref('Loyiha'), limit: S.int }, required: ['project'] },
    run: ({ project, limit }) => {
      const p = resolveProject(project);
      if (isErr(p)) return p;
      return {
        project: projectRow(db.projectStats(p.id)),
        monthly: db.monthly(p.id),
        shootings: db.listShootings({ projectId: p.id, limit: limit || 10 }).map(shootingRow),
      };
    },
  },

  /* --- shootings --- */
  {
    name: 'add_shooting',
    description: 'Съёмка (ish kuni) yozish: qaysi loyiha, qaysi kun, qancha pul olindi, arenda xarajati, kim ishtirok etdi.',
    parameters: {
      type: 'object',
      properties: {
        project: ref('Loyiha'),
        date: dateArg,
        amount: { type: 'number', description: 'Olingan pul, so\'mda (5 mln = 5000000)' },
        note: { type: 'string', description: 'Qisqa izoh' },
        rent: { type: 'number', description: 'Arenda xarajati, so\'mda' },
        paid: { type: 'boolean', description: 'Pul qo\'lga tegdimi (default: ha)' },
        assistants: {
          type: 'array',
          description: 'Ishtirok etgan yordamchilar',
          items: {
            type: 'object',
            properties: {
              name: ref('Yordamchi'),
              fee: { type: 'number', description: 'To\'lov. Berilmasa — standart stavkasi' },
              solo: { type: 'boolean', description: 'O\'zi yolg\'iz borgan bo\'lsa true — to\'lovi ikkilanadi' },
            },
            required: ['name'],
          },
        },
      },
      required: ['project', 'amount'],
    },
    run: ({ project, date, amount, note, rent, paid, assistants }) => {
      const p = resolveProject(project);
      if (isErr(p)) return p;
      const d = resolveDate(date);
      if (!d) return err(`Sanani tushunmadim: "${date}"`);
      const people = [];
      for (const a of assistants || []) {
        const found = resolveAssistant(a.name);
        if (isErr(found)) return found;
        const base = a.fee !== undefined ? money(a.fee) : found.rate;
        people.push({ id: found.id, fee: a.solo && a.fee === undefined ? base * 2 : base, solo: !!a.solo, name: found.name });
      }
      const id = db.createShooting({
        projectId: p.id, date: d, note: note || '', amount: money(amount),
        rent: money(rent || 0), paid: paid === undefined ? true : !!paid,
        assistants: people,
      });
      return { created: shootingRow(db.getShooting(id)) };
    },
  },
  {
    name: 'list_shootings',
    description: 'Съёмкаларni ko\'rish. Loyiha va/yoki sana oralig\'i bo\'yicha filtrlash mumkin.',
    parameters: {
      type: 'object',
      properties: { project: ref('Loyiha'), from: S.str, to: S.str, limit: S.int },
      required: [],
    },
    run: ({ project, from, to, limit }) => {
      let projectId = null;
      if (project) {
        const p = resolveProject(project);
        if (isErr(p)) return p;
        projectId = p.id;
      }
      return { shootings: db.listShootings({ projectId, from: from || null, to: to || null, limit: limit || 20 }).map(shootingRow) };
    },
  },
  {
    name: 'update_shooting',
    description: 'Yozilgan съёмкани tuzatish: summa, arenda, to\'lov holati, izoh yoki sana.',
    parameters: {
      type: 'object',
      properties: {
        shooting_id: S.int, amount: { type: 'number' }, rent: { type: 'number' },
        paid: S.bool, note: S.str, date: dateArg,
      },
      required: ['shooting_id'],
    },
    run: ({ shooting_id, amount, rent, paid, note, date }) => {
      const s = db.getShooting(shooting_id);
      if (!s) return err(`${shooting_id} raqamli съёмка yo'q`);
      const fields = {};
      if (amount !== undefined) fields.amount = money(amount);
      if (rent !== undefined) fields.rent = money(rent);
      if (paid !== undefined) fields.paid = !!paid;
      if (note !== undefined) fields.note = note;
      if (date !== undefined) {
        const d = resolveDate(date);
        if (!d) return err(`Sanani tushunmadim: "${date}"`);
        fields.date = d;
      }
      db.updateShooting(shooting_id, fields);
      return { updated: shootingRow(db.getShooting(shooting_id)) };
    },
  },
  {
    name: 'delete_shooting',
    description: 'Съёмкани o\'chirish. Avval confirm=false bilan tasdiq so\'rang.',
    parameters: { type: 'object', properties: { shooting_id: S.int, confirm: S.bool }, required: ['shooting_id'] },
    run: ({ shooting_id, confirm }) => {
      const s = db.getShooting(shooting_id);
      if (!s) return err(`${shooting_id} raqamli съёмка yo'q`);
      if (!confirm) return { needs_confirmation: true, shooting: shootingRow(s), warning: 'Tasdiq so\'rang, keyin confirm=true bilan qayta chaqiring.' };
      db.deleteShooting(shooting_id);
      return { deleted: shootingRow(s) };
    },
  },
  {
    name: 'add_assistant_to_shooting',
    description: 'Mavjud съёмкага yordamchi qo\'shish.',
    parameters: {
      type: 'object',
      properties: { shooting_id: S.int, assistant: ref('Yordamchi'), fee: { type: 'number' }, solo: S.bool },
      required: ['shooting_id', 'assistant'],
    },
    run: ({ shooting_id, assistant, fee, solo }) => {
      const s = db.getShooting(shooting_id);
      if (!s) return err(`${shooting_id} raqamli съёмка yo'q`);
      const a = resolveAssistant(assistant);
      if (isErr(a)) return a;
      const base = fee !== undefined ? money(fee) : a.rate;
      db.attachAssistant(shooting_id, a.id, solo && fee === undefined ? base * 2 : base, !!solo);
      return { shooting: shootingRow(db.getShooting(shooting_id)) };
    },
  },
  {
    name: 'remove_assistant_from_shooting',
    description: 'Съёмкадан yordamchini olib tashlash (xato yozilgan bo\'lsa).',
    parameters: { type: 'object', properties: { shooting_id: S.int, assistant: ref('Yordamchi') }, required: ['shooting_id', 'assistant'] },
    run: ({ shooting_id, assistant }) => {
      const a = resolveAssistant(assistant);
      if (isErr(a)) return a;
      db.detachAssistant(shooting_id, a.id);
      return { shooting: shootingRow(db.getShooting(shooting_id)) };
    },
  },

  /* --- assistants --- */
  {
    name: 'list_assistants',
    description: 'Yordamchilar va ularning KPI ko\'rsatkichlari.',
    parameters: { type: 'object', properties: {}, required: [] },
    run: () => ({ assistants: db.assistantStats().map(assistantRow) }),
  },
  {
    name: 'create_assistant',
    description: 'Yangi yordamchi qo\'shish va 1 съёмка uchun standart stavkasini belgilash.',
    parameters: { type: 'object', properties: { name: S.str, rate: { type: 'number' } }, required: ['name'] },
    run: ({ name, rate }) => {
      if (!name?.trim()) return err('Ism bo\'sh');
      const exists = db.listAssistants().find((a) => a.name.toLowerCase() === name.trim().toLowerCase());
      if (exists) return err(`${name} allaqachon ro'yxatda`, { assistant: exists });
      const id = db.createAssistant(name.trim(), money(rate || 0));
      return { created: db.getAssistant(id) };
    },
  },
  {
    name: 'update_assistant',
    description: 'Yordamchining ismini, stavkasini yoki faolligini o\'zgartirish.',
    parameters: {
      type: 'object',
      properties: { assistant: ref('Yordamchi'), name: S.str, rate: { type: 'number' }, active: S.bool },
      required: ['assistant'],
    },
    run: ({ assistant, name, rate, active }) => {
      const a = resolveAssistant(assistant);
      if (isErr(a)) return a;
      if (name) db.renameAssistant(a.id, name.trim());
      if (rate !== undefined) db.setAssistantRate(a.id, money(rate));
      if (active !== undefined) db.setAssistantActive(a.id, active);
      return { updated: db.getAssistant(a.id) };
    },
  },
  {
    name: 'delete_assistant',
    description: 'Yordamchini o\'chirish (barcha yozuvlari bilan). Avval confirm=false bilan tasdiq so\'rang.',
    parameters: { type: 'object', properties: { assistant: ref('Yordamchi'), confirm: S.bool }, required: ['assistant'] },
    run: ({ assistant, confirm }) => {
      const a = resolveAssistant(assistant);
      if (isErr(a)) return a;
      if (!confirm) return { needs_confirmation: true, warning: `${a.name} va uning barcha съёмка yozuvlari o'chadi. Tasdiq so'rang.` };
      db.deleteAssistant(a.id);
      return { deleted: a.name };
    },
  },
  {
    name: 'assistant_report',
    description: 'Bitta yordamchi bo\'yicha hisobot: nechta съёмка, qancha ishlagan, kechikish va qo\'pol xatolari.',
    parameters: { type: 'object', properties: { assistant: ref('Yordamchi'), month: monthArg }, required: ['assistant'] },
    run: ({ assistant, month: mo }) => {
      const a = resolveAssistant(assistant);
      if (isErr(a)) return a;
      const m = month(mo);
      const stats = db.assistantStats().find((x) => x.id === a.id);
      return {
        assistant: assistantRow(stats),
        month: m,
        late: db.marksOf('late', a.id, m).map((r) => r.date),
        mistakes: db.marksOf('mistake', a.id, m).map((r) => r.date),
      };
    },
  },

  /* --- discipline --- */
  {
    name: 'add_mark',
    description: 'Kechikish ("late") yoki qo\'pol xato ("mistake") belgilash.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['late', 'mistake'] },
        assistant: ref('Yordamchi'),
        date: dateArg,
        count: { type: 'integer', description: 'Nechta marta (default 1)' },
      },
      required: ['kind', 'assistant'],
    },
    run: ({ kind, assistant, date, count }) => {
      if (!['late', 'mistake'].includes(kind)) return err('kind faqat "late" yoki "mistake"');
      const a = resolveAssistant(assistant);
      if (isErr(a)) return a;
      const d = resolveDate(date);
      if (!d) return err(`Sanani tushunmadim: "${date}"`);
      const n = Math.max(1, Math.min(10, count || 1));
      for (let i = 0; i < n; i++) db.addMark(kind, a.id, d);
      const m = d.slice(0, 7);
      return { added: n, kind, assistant: a.name, date: d, month_total: db.marksOf(kind, a.id, m).length };
    },
  },
  {
    name: 'remove_mark',
    description: 'Noto\'g\'ri qo\'yilgan kechikish yoki qo\'pol xatoni o\'chirish.',
    parameters: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['late', 'mistake'] }, assistant: ref('Yordamchi'), date: dateArg },
      required: ['kind', 'assistant'],
    },
    run: ({ kind, assistant, date }) => {
      const a = resolveAssistant(assistant);
      if (isErr(a)) return a;
      const d = resolveDate(date);
      if (!d) return err(`Sanani tushunmadim: "${date}"`);
      const removed = db.deleteMarkOn(kind, a.id, d);
      return removed ? { removed: 1, kind, assistant: a.name, date: d } : err(`${a.name} uchun ${d} kuni bunday belgi yo'q`);
    },
  },
  {
    name: 'list_marks',
    description: 'Oylik intizom: kim necha marta kechikkan / qo\'pol xato qilgan.',
    parameters: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['late', 'mistake', 'both'] }, month: monthArg },
      required: [],
    },
    run: ({ kind, month: mo }) => {
      const m = month(mo);
      const pick = (k) => db.marksByMonth(k, m).filter((r) => r.count)
        .map((r) => ({ name: r.name, count: r.count, dates: r.dates }));
      const out = { month: m };
      if (!kind || kind === 'both' || kind === 'late') out.late = pick('late');
      if (!kind || kind === 'both' || kind === 'mistake') out.mistakes = pick('mistake');
      return out;
    },
  },

  /* --- assistant reports from the group --- */
  {
    name: 'list_claims',
    description: 'Yordamchilar guruhda yuborgan, hali tasdiqlanmagan arizalar.',
    parameters: { type: 'object', properties: {}, required: [] },
    run: () => ({
      claims: db.pendingClaims().map((c) => ({
        id: c.id, assistant: c.assistant_name, project: c.project_name, date: c.date, rate: c.assistant_rate,
      })),
    }),
  },
  {
    name: 'approve_claim',
    description: 'Arizani tasdiqlash. solo=true bo\'lsa — yordamchi o\'zi borgan, to\'lovi ikkilanadi.',
    parameters: { type: 'object', properties: { claim_id: S.int, solo: S.bool }, required: ['claim_id'] },
    run: ({ claim_id, solo }) => {
      const c = db.getClaim(claim_id);
      if (!c) return err(`${claim_id} raqamli ariza yo'q`);
      if (c.status !== 'pending') return err(`Bu ariza allaqachon "${c.status}"`);
      let shooting = db.shootingOn(c.project_id, c.date);
      let created = false;
      if (!shooting) {
        const id = db.createShooting({ projectId: c.project_id, date: c.date, note: '', amount: 0, rent: 0, paid: false, assistants: [] });
        shooting = db.getShooting(id);
        created = true;
      }
      const fee = c.assistant_rate * (solo ? 2 : 1);
      db.attachAssistant(shooting.id, c.assistant_id, fee, !!solo);
      db.setClaimStatus(c.id, 'approved', shooting.id);
      return { approved: { assistant: c.assistant_name, project: c.project_name, date: c.date, fee, solo: !!solo },
        shooting: shootingRow(db.getShooting(shooting.id)),
        new_shooting_without_amount: created };
    },
  },
  {
    name: 'reject_claim',
    description: 'Arizani rad etish.',
    parameters: { type: 'object', properties: { claim_id: S.int }, required: ['claim_id'] },
    run: ({ claim_id }) => {
      const c = db.getClaim(claim_id);
      if (!c) return err(`${claim_id} raqamli ariza yo'q`);
      db.setClaimStatus(claim_id, 'rejected');
      return { rejected: { assistant: c.assistant_name, project: c.project_name, date: c.date } };
    },
  },

  /* --- reports --- */
  {
    name: 'summary',
    description: 'Umumiy hisobot: jami daromad, xarajat, sof foyda, to\'lanmagan pul va oylar kesimi.',
    parameters: { type: 'object', properties: { project: ref('Loyiha') }, required: [] },
    run: ({ project }) => {
      let projectId = null, name = null;
      if (project) {
        const p = resolveProject(project);
        if (isErr(p)) return p;
        projectId = p.id; name = p.name;
      }
      const t = db.totals(projectId);
      return {
        scope: name || 'hammasi',
        totals: { shootings: t.shootings, income: t.income, rent: t.rent, assistant_fees: t.fees,
          net: t.income - t.rent - t.fees, unpaid: t.unpaid },
        monthly: db.monthly(projectId),
        pending_claims: db.pendingClaims().length,
      };
    },
  },
  {
    name: 'calendar',
    description: 'Oy kalendari: qaysi kunlari съёмка bo\'lgan va qancha pul tushgan.',
    parameters: { type: 'object', properties: { month: monthArg, project: ref('Loyiha') }, required: [] },
    run: ({ month: mo, project }) => {
      let projectId = null;
      if (project) {
        const p = resolveProject(project);
        if (isErr(p)) return p;
        projectId = p.id;
      }
      const m = month(mo);
      const [y, mm] = m.split('-').map(Number);
      const to = `${m}-${String(new Date(y, mm, 0).getDate()).padStart(2, '0')}`;
      return { month: m, days: db.byDay({ projectId, from: `${m}-01`, to }) };
    },
  },
];

const BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

/** Gemini tool declarations (no executors). */
export const toolDeclarations = () =>
  TOOLS.map(({ name, description, parameters }) => ({ type: 'function', name, description, parameters }));

export function runTool(name, args = {}) {
  const tool = BY_NAME[name];
  if (!tool) return err(`"${name}" degan amal yo'q`);
  try {
    return tool.run(args || {});
  } catch (e) {
    return err(`Xatolik: ${e.message}`);
  }
}
