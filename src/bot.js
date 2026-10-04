import { Bot, InlineKeyboard, Keyboard } from 'grammy';
import * as db from './db.js';
import { ask, resetSession, aiReady } from './ai.js';
import { money, num, dateUz, monthName, todayISO, parseDate, parseMoney } from './format.js';

const OWNER_ID = process.env.BOT_OWNER_ID ? Number(process.env.BOT_OWNER_ID) : null;
const SITE_URL = process.env.SITE_URL || 'https://pro.javohirhm.uz';

export function createBot(token) {
  const bot = new Bot(token);

  /* ---------- access: only the owner ---------- */
  const groupId = () => Number(db.getSetting('group_chat_id') || 0) || null;
  const inGroup = (ctx) => ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';

  bot.use(async (ctx, next) => {
    const id = ctx.from?.id;
    if (!id) return;
    if (inGroup(ctx)) {
      // Assistants report from the one group Fozilxon registered with /guruh.
      if (ctx.chat.id === groupId() || id === OWNER_ID) return next();
      return;
    }
    if (!OWNER_ID) {
      await ctx.reply(
        `Bot hali sozlanmagan.\nSizning Telegram ID: <code>${id}</code>\n\n` +
        `Uni <code>.env</code> faylidagi <code>BOT_OWNER_ID</code> ga yozib, botni qayta ishga tushiring.`,
        { parse_mode: 'HTML' }
      );
      return;
    }
    if (id !== OWNER_ID) return;
    await next();
  });

  /* ---------- wizard state (one user, in memory) ---------- */
  let wiz = null;
  const clearWiz = () => { wiz = null; };

  /* ---------- main menu ---------- */
  const mainMenu = new Keyboard()
    .text('📁 Loyihalar').text('➕ Yangi loyiha').row()
    .text('👥 Yordamchilar').text('📥 Arizalar').row()
    .text('⏰ Kechikishlar').text('⚠️ Qo\'pol xatolar').row()
    .text('📅 Kalendar').text('📊 Hisobot').row()
    .resized();

  /** Day buttons — the group has no typing (Telegram privacy mode), so dates are taps. */
  function dayButtons(prefix, cols = 4) {
    const kb = new InlineKeyboard();
    for (let d = 0; d < 7; d++) {
      const iso = todayISO(-d);
      const label = d === 0 ? '📆 Bugun' : d === 1 ? 'Kecha' : iso.slice(8) + '.' + iso.slice(5, 7);
      kb.text(label, `${prefix}:${d}`);
      if ((d + 1) % cols === 0) kb.row();
    }
    return kb.row();
  }

  const cancelKb = () => new InlineKeyboard().text('❌ Bekor qilish', 'cancel');

  /* ---------- views ---------- */
  function projectsView() {
    const rows = db.listProjects();
    const kb = new InlineKeyboard();
    for (const p of rows) {
      kb.text(`${p.archived ? '🗄 ' : '🎬 '}${p.name} · ${num(p.income)}`, `p:${p.id}`).row();
    }
    kb.text('➕ Yangi loyiha', 'pnew').row().text('📅 Umumiy kalendar', `cal:all:${todayISO().slice(0, 7)}`);
    const t = db.totals();
    const text = rows.length
      ? `<b>📁 Loyihalar (${rows.length})</b>\n\n` +
        `Umumiy daromad: <b>${money(t.income)}</b>\n` +
        `Съёмкалар: <b>${t.shootings}</b>` +
        (t.unpaid ? `\n⏳ To'lanmagan: <b>${money(t.unpaid)}</b>` : '')
      : '<b>📁 Loyihalar</b>\n\nHozircha loyiha yo\'q. Birinchisini qo\'shing 👇';
    return { text, kb };
  }

  function projectView(id) {
    const p = db.projectStats(id);
    if (!p) return null;
    const net = p.income - p.rent - p.fees;
    const shoots = db.listShootings({ projectId: id, limit: 5 });
    let text =
      `<b>${p.archived ? '🗄 ' : '🎬 '}${esc(p.name)}</b>\n\n` +
      `Съёмкалар: <b>${p.shootings}</b>\n` +
      `Daromad: <b>${money(p.income)}</b>\n` +
      `Arenda: ${money(p.rent)}\n` +
      `Yordamchilar: ${money(p.fees)}\n` +
      `Sof foyda: <b>${money(net)}</b>` +
      (p.unpaid ? `\n⏳ To'lanmagan: <b>${money(p.unpaid)}</b>` : '');
    if (shoots.length) {
      text += '\n\n<b>Oxirgi съёмкалар:</b>';
      for (const s of shoots) {
        text += `\n${s.paid ? '✅' : '⏳'} ${dateUz(s.date, false)} — ${money(s.amount)}` +
          (s.note ? ` · ${esc(s.note)}` : '');
      }
    }
    const kb = new InlineKeyboard()
      .text('➕ Съёмка qo\'shish', `padd:${id}`).row()
      .text('🎬 Barcha съёмкалар', `plist:${id}`).text('📅 Kalendar', `cal:${id}:${todayISO().slice(0, 7)}`).row()
      .text('✏️ Nomi', `pren:${id}`).text(p.archived ? '↩️ Arxivdan' : '🗄 Arxivlash', `parch:${id}`).row()
      .text('⬅️ Loyihalar', 'projects');
    return { text, kb };
  }

  function shootingsListView(projectId) {
    const p = db.getProject(projectId);
    const rows = db.listShootings({ projectId, limit: 30 });
    let text = `<b>🎬 ${esc(p.name)} — съёмкалар (${rows.length})</b>\n`;
    const kb = new InlineKeyboard();
    for (const s of rows) {
      text += `\n${s.paid ? '✅' : '⏳'} <b>${dateUz(s.date)}</b> — ${money(s.amount)}` +
        (s.rent ? ` · arenda ${num(s.rent)}` : '') +
        (s.assistant_names ? `\n   👥 ${esc(s.assistant_names)} (${num(s.fees)})` : '') +
        (s.note ? `\n   📝 ${esc(s.note)}` : '');
      kb.text(`${s.paid ? '✅' : '⏳'} ${dateUz(s.date, false)} · ${num(s.amount)}`, `sh:${s.id}`).row();
    }
    if (!rows.length) text += '\nHozircha съёмка yo\'q.';
    kb.text('⬅️ Loyiha', `p:${projectId}`);
    return { text, kb };
  }

  function shootingView(id) {
    const s = db.getShooting(id);
    if (!s) return null;
    const as = db.shootingAssistants(id);
    let text =
      `<b>🎬 ${dateUz(s.date)}</b>\n` +
      `Loyiha: ${esc(s.project_name)}\n` +
      (s.note ? `Izoh: ${esc(s.note)}\n` : '') +
      `Summa: <b>${money(s.amount)}</b> ${s.paid ? '✅ to\'landi' : '⏳ to\'lanmadi'}\n` +
      `Arenda: ${money(s.rent)}\n`;
    if (as.length) {
      text += `\n<b>Yordamchilar:</b>`;
      for (const a of as) text += `\n• ${esc(a.name)} — ${money(a.fee)}${a.solo ? ' 👤×2' : ''}`;
    }
    text += `\n\nSof: <b>${money(s.amount - s.rent - s.fees)}</b>`;
    const kb = new InlineKeyboard()
      .text('💰 Summani o\'zgartirish', `shmoney:${id}`).row()
      .text(s.paid ? '⏳ To\'lanmagan deb belgilash' : '✅ To\'landi deb belgilash', `shpaid:${id}`).row()
      .text('🗑 O\'chirish', `shdel:${id}`).row()
      .text('⬅️ Orqaga', `plist:${s.project_id}`);
    return { text, kb };
  }

  function assistantsView() {
    const rows = db.assistantStats();
    const kb = new InlineKeyboard();
    for (const a of rows) {
      kb.text(`${a.active ? '👤' : '🚫'} ${a.name} · ${a.shootings} съёмка`, `a:${a.id}`).row();
    }
    kb.text('➕ Yordamchi qo\'shish', 'anew');
    let text = `<b>👥 Yordamchilar (${rows.length})</b>\n`;
    if (!rows.length) text += '\nHozircha yordamchi yo\'q. Qo\'shing 👇';
    for (const a of rows) {
      text += `\n\n${a.active ? '👤' : '🚫'} <b>${esc(a.name)}</b>` +
        `\n   Stavka: ${money(a.rate)}` +
        `\n   Съёмка: <b>${a.shootings}</b> · Ishlagan puli: <b>${money(a.earned)}</b>`;
    }
    return { text, kb };
  }

  function assistantView(id) {
    const a = db.assistantStats().find((x) => x.id === id);
    if (!a) return null;
    const text =
      `<b>${a.active ? '👤' : '🚫'} ${esc(a.name)}</b>\n\n` +
      `Standart stavka: <b>${money(a.rate)}</b>\n` +
      `Ishtirok etgan съёмкалар: <b>${a.shootings}</b>\n` +
      `Jami ishlagan puli: <b>${money(a.earned)}</b>\n` +
      `Ishtirokidagi loyihalar daromadi: ${money(a.revenue)}\n` +
      `O'rtacha 1 съёмка: ${money(a.shootings ? a.earned / a.shootings : 0)}` +
      (a.last_date ? `\nOxirgi ish: ${dateUz(a.last_date)}` : '');
    const kb = new InlineKeyboard()
      .text('✏️ Stavkani o\'zgartirish', `arate:${id}`).row()
      .text(a.active ? '🚫 Faolsizlantirish' : '✅ Faollashtirish', `atog:${id}`).row()
      .text('🗑 O\'chirish', `adel:${id}`).row()
      .text('⬅️ Yordamchilar', 'assistants');
    return { text, kb };
  }

  /** Monospace month grid + the days that have shootings. scope = 'all' | projectId */
  function calendarView(scope, ym) {
    const [y, m] = ym.split('-').map(Number);
    const projectId = scope === 'all' ? null : Number(scope);
    const from = `${ym}-01`;
    const last = new Date(y, m, 0).getDate();
    const to = `${ym}-${String(last).padStart(2, '0')}`;
    const days = db.byDay({ projectId, from, to });
    const marked = new Map(days.map((d) => [Number(d.date.slice(8)), d]));

    let grid = 'Du Se Ch Pa Ju Sh Ya\n';
    const firstDow = (new Date(y, m - 1, 1).getDay() + 6) % 7; // Monday = 0
    let cells = '   '.repeat(firstDow);
    for (let d = 1; d <= last; d++) {
      cells += `${String(d).padStart(2, ' ')}${marked.has(d) ? '•' : ' '}`;
      if ((firstDow + d) % 7 === 0) { grid += `${cells.trimEnd()}\n`; cells = ''; }
    }
    if (cells.trim()) grid += cells.trimEnd();

    const title = projectId ? esc(db.getProject(projectId).name) : 'Umumiy';
    const sum = days.reduce((s, d) => s + d.income, 0);
    const cnt = days.reduce((s, d) => s + d.shootings, 0);
    let text = `<b>📅 ${title} — ${monthName(m - 1)} ${y}</b>\n<pre>${grid}</pre>\n` +
      `Съёмкалар: <b>${cnt}</b> · Daromad: <b>${money(sum)}</b>`;
    if (days.length) {
      text += '\n';
      for (const d of days) {
        text += `\n• <b>${dateUz(d.date, false)}</b> — ${d.shootings} съёмка · ${money(d.income)}`;
      }
    } else {
      text += '\n\nBu oyda съёмка bo\'lmagan.';
    }
    const prev = shiftMonth(ym, -1), next = shiftMonth(ym, +1);
    const kb = new InlineKeyboard()
      .text('◀️', `cal:${scope}:${prev}`).text(`${monthName(m - 1)} ${y}`, 'noop').text('▶️', `cal:${scope}:${next}`).row()
      .text(projectId ? '⬅️ Loyiha' : '⬅️ Loyihalar', projectId ? `p:${projectId}` : 'projects');
    return { text, kb };
  }

  function reportView() {
    const t = db.totals();
    const months = db.monthly().slice(-6).reverse();
    const assistants = db.assistantStats().filter((a) => a.shootings > 0).slice(0, 5);
    let text =
      `<b>📊 Umumiy hisobot</b>\n\n` +
      `Съёмкалар: <b>${t.shootings}</b>\n` +
      `Daromad: <b>${money(t.income)}</b>\n` +
      `Arenda xarajati: ${money(t.rent)}\n` +
      `Yordamchilar to'lovi: ${money(t.fees)}\n` +
      `<b>Sof foyda: ${money(t.income - t.rent - t.fees)}</b>\n` +
      (t.unpaid ? `⏳ To'lanmagan: <b>${money(t.unpaid)}</b>\n` : '');
    if (months.length) {
      text += '\n<b>Oylar kesimida:</b>';
      for (const mo of months) {
        const [y, m] = mo.month.split('-').map(Number);
        text += `\n• ${monthName(m - 1)} ${y}: <b>${money(mo.income)}</b> (${mo.shootings} съёмка)`;
      }
    }
    const ym = todayISO().slice(0, 7);
    const lateN = db.marksByMonth('late', ym).reduce((n, r) => n + r.count, 0);
    const missN = db.marksByMonth('mistake', ym).reduce((n, r) => n + r.count, 0);
    text += `\n\n<b>Shu oy intizomi:</b>\n⏰ Kechikish: <b>${lateN}</b> · ⚠️ Qo'pol xato: <b>${missN}</b>`;
    if (assistants.length) {
      text += '\n\n<b>Yordamchilar KPI:</b>';
      for (const a of assistants) {
        text += `\n• ${esc(a.name)}: ${a.shootings} съёмка · ${money(a.earned)}`;
      }
    }
    const kb = new InlineKeyboard()
      .text('📅 Umumiy kalendar', `cal:all:${todayISO().slice(0, 7)}`).row()
      .url('🌐 Saytda ko\'rish', SITE_URL);
    return { text, kb };
  }

  /* ---------- claims (yordamchi arizalari) ---------- */
  function claimsView() {
    const rows = db.pendingClaims();
    const kb = new InlineKeyboard();
    let text = `<b>📥 Yordamchi arizalari</b>\n`;
    if (!rows.length) {
      text += `\nYangi ariza yo'q.\n\nYordamchilar guruhda <code>/ishladim</code> yozsa, arizasi shu yerda chiqadi.`;
    }
    for (const c of rows) {
      text += `\n\n👤 <b>${esc(c.assistant_name)}</b>\n🎬 ${esc(c.project_name)}\n📅 ${dateUz(c.date)}` +
        `\n💵 Stavkasi: ${money(c.assistant_rate)}`;
      kb.text(`✅ ${c.assistant_name} · ${dateUz(c.date, false)}`, `cok:${c.id}`)
        .text('👤 ×2', `cok2:${c.id}`).text('❌', `cno:${c.id}`).row();
    }
    return { text, kb };
  }

  async function approveClaim(ctx, claimId, solo = false) {
    const c = db.getClaim(claimId);
    if (!c || c.status !== 'pending') return edit(ctx, claimsView());
    let shooting = db.shootingOn(c.project_id, c.date);
    let created = false;
    if (!shooting) {
      const id = db.createShooting({
        projectId: c.project_id, date: c.date, note: '', amount: 0, rent: 0, paid: false, assistants: [],
      });
      shooting = db.getShooting(id);
      created = true;
    }
    const fee = c.assistant_rate * (solo ? 2 : 1);
    db.attachAssistant(shooting.id, c.assistant_id, fee, solo);
    db.setClaimStatus(c.id, 'approved', shooting.id);

    const kb = new InlineKeyboard();
    if (created) kb.text('💰 Summani kiritish', `shmoney:${shooting.id}`).row();
    kb.text('📥 Arizalar', 'claims').text('🎬 Съёмка', `sh:${shooting.id}`);
    await edit(ctx, {
      text: `✅ <b>Tasdiqlandi</b>\n\n${esc(c.assistant_name)} — ${esc(c.project_name)}, ${dateUz(c.date)}\n` +
        `To'lovi: ${money(fee)}${solo ? ' (👤 o\'zi bordi ×2)' : ''}\n` +
        (created ? `\n⚠️ Bu kuni съёмка yozilmagan edi — yangisi ochildi, <b>summasi 0</b>. Kiriting 👇` : ''),
      kb,
    });
    notifyGroup(`✅ <b>${esc(c.assistant_name)}</b> — ${esc(c.project_name)}, ${dateUz(c.date)}: arizasi tasdiqlandi.`);
  }

  function notifyGroup(text) {
    const id = groupId();
    if (id) bot.api.sendMessage(id, text, { parse_mode: 'HTML' }).catch(() => {});
  }

  /* ---------- discipline marks: kechikish + qo'pol xato ---------- */
  const MARK = {
    late: { icon: '⏰', title: '⏰ Kechikishlar', one: 'Kechikkan', ask: 'kechikdi', word: 'kechikish' },
    mistake: { icon: '⚠️', title: '⚠️ Qo\'pol xatolar', one: 'Qo\'pol xato', ask: 'xato qildi', word: 'qo\'pol xato' },
  };

  function marksView(kind, ym) {
    const m = MARK[kind];
    const rows = db.marksByMonth(kind, ym);
    const total = rows.reduce((n, r) => n + r.count, 0);
    let text = `<b>${m.title} — ${monthName(Number(ym.slice(5, 7)) - 1)} ${ym.slice(0, 4)}</b>\n\n` +
      `Jami: <b>${total}</b> marta`;
    for (const r of rows.filter((x) => x.count)) {
      text += `\n\n👤 <b>${esc(r.name)}</b> — <b>${r.count}</b> marta` +
        `\n   ${r.dates.split(',').map((d) => dateUz(d, false)).join(', ')}`;
    }
    if (!total) text += `\n\nBu oyda ${m.word} yo'q.`;
    const kb = new InlineKeyboard()
      .text(`➕ ${m.word[0].toUpperCase()}${m.word.slice(1)} qo'shish`, `mnew:${kind}:${ym}`).row()
      .text('◀️', `mmon:${kind}:${shiftMonth(ym, -1)}`)
      .text(`${monthName(Number(ym.slice(5, 7)) - 1)}`, 'noop')
      .text('▶️', `mmon:${kind}:${shiftMonth(ym, 1)}`).row();
    for (const r of rows.filter((x) => x.count)) kb.text(`👤 ${r.name} (${r.count})`, `mp:${kind}:${r.id}:${ym}`).row();
    return { text, kb };
  }

  function markPersonView(kind, assistantId, ym) {
    const m = MARK[kind];
    const a = db.getAssistant(assistantId);
    const rows = db.marksOf(kind, assistantId, ym);
    let text = `<b>${m.icon} ${esc(a.name)} — ${monthName(Number(ym.slice(5, 7)) - 1)} ${ym.slice(0, 4)}</b>\n\n` +
      `${m.one}: <b>${rows.length}</b> marta`;
    if (rows.length) text += `\n\nO'chirish uchun sanani bosing:`;
    const kb = new InlineKeyboard().text(`➕ Yana ${m.word}`, `mpick:${kind}:${assistantId}:${ym}`).row();
    for (const r of rows) kb.text(`❌ ${dateUz(r.date, false)}`, `mdel:${kind}:${r.id}:${assistantId}:${ym}`).row();
    kb.text(`⬅️ ${m.title}`, `mmon:${kind}:${ym}`);
    return { text, kb };
  }

  function markPickPersonView(kind, ym) {
    const kb = new InlineKeyboard();
    for (const a of db.listAssistants(true)) kb.text(`👤 ${a.name}`, `mpick:${kind}:${a.id}:${ym}`).row();
    kb.text('⬅️ Orqaga', `mmon:${kind}:${ym}`);
    return { text: `<b>${MARK[kind].title}</b>\n\nKim ${MARK[kind].ask}?`, kb };
  }

  function markPickDateView(kind, assistantId, ym) {
    const a = db.getAssistant(assistantId);
    const kb = dayButtons(`madd:${kind}:${assistantId}`);
    kb.text('📅 Boshqa sana', `mdate:${kind}:${assistantId}`).row().text('⬅️ Orqaga', `mmon:${kind}:${ym}`);
    return { text: `<b>${esc(a.name)}</b> qaysi kuni ${MARK[kind].ask}?`, kb };
  }

  /* ---------- wizard: add shooting ---------- */
  async function askDate(ctx, projectId) {
    wiz = { flow: 'shooting', step: 'date', projectId, data: {}, selected: [], feeIdx: 0 };
    const kb = new InlineKeyboard()
      .text('📆 Bugun', 'wd:0').text('📆 Kecha', 'wd:1').row()
      .text('❌ Bekor qilish', 'cancel');
    await ctx.reply(
      `<b>➕ Yangi съёмка</b>\n${esc(db.getProject(projectId).name)}\n\n` +
      `1/6 · Qaysi kuni bo'ldi?\nSanani tanlang yoki yozing (masalan <code>24.09.2026</code>)`,
      { parse_mode: 'HTML', reply_markup: kb }
    );
  }

  const askNote = (ctx) => {
    wiz.step = 'note';
    return ctx.reply('2/6 · Съёмка haqida qisqa izoh yozing (masalan: <i>to\'y, ertalabki blok</i>).\nIzoh kerak bo\'lmasa <code>-</code> yuboring.',
      { parse_mode: 'HTML', reply_markup: cancelKb() });
  };

  const askAmount = (ctx) => {
    wiz.step = 'amount';
    return ctx.reply('3/6 · Bu съёмка uchun qancha pul olindi?\nMasalan: <code>5 000 000</code> yoki <code>5mln</code>',
      { parse_mode: 'HTML', reply_markup: cancelKb() });
  };

  const askRent = (ctx) => {
    wiz.step = 'rent';
    return ctx.reply('4/6 · Arenda (texnika/studiya) xarajati qancha bo\'ldi?',
      { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('Arenda yo\'q', 'wrent:0').row().text('❌ Bekor qilish', 'cancel') });
  };

  const askPaid = (ctx) => {
    wiz.step = 'paid';
    return ctx.reply('5/6 · Pul qo\'lga tegdimi?', {
      reply_markup: new InlineKeyboard().text('✅ To\'landi', 'wpaid:1').text('⏳ To\'lanmadi', 'wpaid:0').row().text('❌ Bekor qilish', 'cancel'),
    });
  };

  function assistantPickKb() {
    const kb = new InlineKeyboard();
    for (const a of db.listAssistants(true)) {
      const on = wiz.selected.some((s) => s.id === a.id);
      kb.text(`${on ? '✅' : '➕'} ${a.name} (${num(a.rate)})`, `wa:${a.id}`).row();
    }
    kb.text(wiz.selected.length ? `✔️ Tayyor (${wiz.selected.length})` : '🚫 Yordamchisiz', 'wadone').row()
      .text('❌ Bekor qilish', 'cancel');
    return kb;
  }

  async function askAssistants(ctx) {
    wiz.step = 'assistants';
    const list = db.listAssistants(true);
    if (!list.length) return finishShooting(ctx);
    await ctx.reply('6/6 · Kim ishtirok etdi? Tanlang, keyin <b>Tayyor</b> ni bosing.',
      { parse_mode: 'HTML', reply_markup: assistantPickKb() });
  }

  async function askFee(ctx) {
    wiz.step = 'fee';
    const a = wiz.selected[wiz.feeIdx];
    if (!a) return finishShooting(ctx);
    const kb = new InlineKeyboard()
      .text(`Standart: ${num(a.rate)}`, 'wfee:def').row()
      .text(`👤 O'zi bordi ×2: ${num(a.rate * 2)}`, 'wfee:solo').row()
      .text('❌ Bekor qilish', 'cancel');
    await ctx.reply(
      `<b>${esc(a.name)}</b> uchun to'lov qancha? (${wiz.feeIdx + 1}/${wiz.selected.length})\n` +
      `<i>O'zi borgan bo'lsa — ikkilangan stavka.</i>`,
      { parse_mode: 'HTML', reply_markup: kb });
  }

  async function setFee(ctx, fee, solo = false) {
    wiz.selected[wiz.feeIdx].fee = fee;
    wiz.selected[wiz.feeIdx].solo = solo;
    wiz.feeIdx += 1;
    if (wiz.feeIdx < wiz.selected.length) return askFee(ctx);
    return finishShooting(ctx);
  }

  async function finishShooting(ctx) {
    const { projectId, data, selected } = wiz;
    const id = db.createShooting({
      projectId,
      date: data.date,
      note: data.note || '',
      amount: data.amount || 0,
      rent: data.rent || 0,
      paid: data.paid,
      assistants: selected.map((a) => ({ id: a.id, fee: a.fee ?? a.rate, solo: a.solo })),
    });
    clearWiz();
    const s = db.getShooting(id);
    const kb = new InlineKeyboard()
      .text('➕ Yana съёмка', `padd:${projectId}`).row()
      .text('🎬 Loyihaga qaytish', `p:${projectId}`);
    await ctx.reply(
      `✅ <b>Saqlandi!</b>\n\n` +
      `${dateUz(s.date)} · ${esc(s.project_name)}\n` +
      (s.note ? `📝 ${esc(s.note)}\n` : '') +
      `💰 ${money(s.amount)} ${s.paid ? '(to\'landi)' : '(to\'lanmadi)'}\n` +
      (s.rent ? `🎥 Arenda: ${money(s.rent)}\n` : '') +
      (s.assistant_names ? `👥 ${esc(s.assistant_names)} — ${money(s.fees)}\n` : '') +
      `\nSof: <b>${money(s.amount - s.rent - s.fees)}</b>`,
      { parse_mode: 'HTML', reply_markup: kb }
    );
  }

  const askMoneyPaid = (ctx) => {
    wiz.step = 'paid';
    return ctx.reply('Pul qo\'lga tegdimi?', {
      reply_markup: new InlineKeyboard().text('✅ To\'landi', 'mpaid:1').text('⏳ To\'lanmadi', 'mpaid:0').row()
        .text('❌ Bekor qilish', 'cancel'),
    });
  };

  function saveMoney(ctx, paid) {
    const { shootingId, data } = wiz;
    db.updateShootingMoney(shootingId, { amount: data.amount, rent: data.rent, paid });
    clearWiz();
    return send(ctx, shootingView(shootingId));
  }

  /* ---------- AI chat: plain words and voice notes ---------- */
  async function handleAI(ctx, { text, voice }) {
    if (!aiReady()) {
      return ctx.reply('AI hali ulanmagan (.env → GEMINI_API_KEY). Hozircha menyudan foydalaning 👇',
        { reply_markup: mainMenu });
    }
    await ctx.replyWithChatAction('typing').catch(() => {});
    const typing = setInterval(() => ctx.replyWithChatAction('typing').catch(() => {}), 5000);
    try {
      let audio = null;
      if (voice) {
        const file = await ctx.api.getFile(voice.file_id);
        const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
        if (!res.ok) throw new Error(`ovozli xabarni yuklab bo'lmadi (${res.status})`);
        audio = {
          data: Buffer.from(await res.arrayBuffer()).toString('base64'),
          mimeType: voice.mime_type || 'audio/ogg',
        };
      }
      const { text: answer, actions } = await ask(ctx.from.id, { text, audio });
      if (actions.length) console.log('[ai]', actions.map((a) => `${a.name}${a.ok ? '' : '!'}`).join(', '));
      await ctx.reply(answer || '…', { reply_markup: mainMenu });
    } catch (e) {
      console.error('[ai]', e.message);
      await ctx.reply('AI javob bermadi 😕 Birozdan keyin qayta urinib ko\'ring yoki menyudan foydalaning.',
        { reply_markup: mainMenu });
    } finally {
      clearInterval(typing);
    }
  }

  /* ---------- commands & menu buttons ---------- */
  bot.command('start', async (ctx) => {
    clearWiz();
    await ctx.reply(
      `Salom, <b>Fozilxon</b>! 🎬\n\n` +
      `Menga oddiy gapirib yoki yozib bering — o'zim yozib qo'yaman:\n` +
      `<i>«bugun Aziz to'yida ishladik, 5 mln oldik, Bekzod ham bor edi»</i>\n` +
      `<i>«Bekzod bugun kechikdi»</i> · <i>«shu oy qancha ishladik?»</i>\n\n` +
      `🎙 Ovozli xabar ham yuborsangiz bo'ladi.\n` +
      `Natijani saytda ko'rasiz: ${SITE_URL}\n\nTugmalar ham joyida 👇`,
      { parse_mode: 'HTML', reply_markup: mainMenu }
    );
  });

  bot.command('bekor', async (ctx) => { clearWiz(); await ctx.reply('Bekor qilindi.', { reply_markup: mainMenu }); });
  bot.command('yangi', async (ctx) => {
    clearWiz();
    resetSession(ctx.from.id);
    await ctx.reply('Suhbat tozalandi 🧹 Yangi mavzudan boshlang.', { reply_markup: mainMenu });
  });
  bot.command('menu', async (ctx) => { clearWiz(); await ctx.reply('Menyu 👇', { reply_markup: mainMenu }); });
  bot.command('sayt', (ctx) => ctx.reply(SITE_URL));

  /* ---------- group: assistants report their own work ---------- */
  bot.command('guruh', async (ctx) => {
    if (ctx.from.id !== OWNER_ID) return;
    if (!inGroup(ctx)) return ctx.reply('Bu buyruqni yordamchilar guruhida yozing.');
    db.setSetting('group_chat_id', ctx.chat.id);
    await ctx.reply(
      `✅ Guruh ro'yxatga olindi.\n\nEndi yordamchilar shu yerda <code>/ishladim</code> deb yozib, ` +
      `qaysi loyihada va qaysi kuni ishlaganini belgilaydi. Arizalar sizga «📥 Arizalar» bo'limiga tushadi.`,
      { parse_mode: 'HTML' }
    );
  });

  bot.command('ishladim', async (ctx) => {
    if (!inGroup(ctx)) return;
    if (ctx.chat.id !== groupId()) {
      return ctx.reply('Bu guruh ro\'yxatga olinmagan. Fozilxon bu yerda /guruh deb yozishi kerak.');
    }
    const me = db.assistantByTg(ctx.from.id);
    if (me) return ctx.reply(...claimProjectPrompt(me));

    const free = db.listAssistants(true).filter((a) => !a.tg_id);
    if (!free.length) {
      return ctx.reply('Sizning ismingiz ro\'yxatda yo\'q. Fozilxondan qo\'shishini so\'rang.');
    }
    const kb = new InlineKeyboard();
    for (const a of free) kb.text(`👤 ${a.name}`, `link:${a.id}`).row();
    await ctx.reply('Siz kimsiz? Ismingizni bir marta tanlang 👇', { reply_markup: kb });
  });

  const claimProjectPrompt = (me) => {
    const kb = new InlineKeyboard();
    for (const p of db.listProjects().filter((p) => !p.archived)) kb.text(`🎬 ${p.name}`, `cp:${p.id}`).row();
    return [`<b>${esc(me.name)}</b>, qaysi loyihada ishladingiz?`, { parse_mode: 'HTML', reply_markup: kb }];
  };

  bot.hears('📁 Loyihalar', (ctx) => { clearWiz(); return send(ctx, projectsView()); });
  bot.hears('👥 Yordamchilar', (ctx) => { clearWiz(); return send(ctx, assistantsView()); });
  bot.hears('📊 Hisobot', (ctx) => { clearWiz(); return send(ctx, reportView()); });
  bot.hears('⏰ Kechikishlar', (ctx) => { clearWiz(); return send(ctx, marksView('late', todayISO().slice(0, 7))); });
  bot.hears('⚠️ Qo\'pol xatolar', (ctx) => { clearWiz(); return send(ctx, marksView('mistake', todayISO().slice(0, 7))); });
  bot.hears('📥 Arizalar', (ctx) => { clearWiz(); return send(ctx, claimsView()); });
  bot.hears('📅 Kalendar', (ctx) => { clearWiz(); return send(ctx, calendarView('all', todayISO().slice(0, 7))); });
  bot.hears('➕ Yangi loyiha', async (ctx) => {
    wiz = { flow: 'project', step: 'name' };
    await ctx.reply('Yangi loyiha nomini yozing (masalan: <i>Aziz &amp; Nilufar to\'yi</i>).',
      { parse_mode: 'HTML', reply_markup: cancelKb() });
  });

  /* ---------- inline buttons ---------- */
  bot.on('callback_query:data', async (ctx) => {
    const [cmd, ...rest] = ctx.callbackQuery.data.split(':');
    const id = Number(rest[0]);
    await ctx.answerCallbackQuery().catch(() => {});

    switch (cmd) {
      case 'noop': return;

      /* --- group: assistant reports work --- */
      case 'link': {
        const a = db.getAssistant(id);
        if (!a) return;
        if (a.tg_id && a.tg_id !== ctx.from.id) return ctx.reply(`${esc(a.name)} boshqa akkauntga ulangan.`, { parse_mode: 'HTML' });
        db.linkAssistantTg(id, ctx.from.id);
        return edit(ctx, { text: `✅ ${esc(a.name)} sifatida ulandingiz.`, kb: new InlineKeyboard() })
          .then(() => ctx.reply(...claimProjectPrompt(a)));
      }
      case 'cp': {
        const me = db.assistantByTg(ctx.from.id);
        if (!me) return ctx.reply('Avval /ishladim deb yozing.');
        const p = db.getProject(id);
        return edit(ctx, {
          text: `<b>${esc(me.name)}</b> · ${esc(p.name)}\nQaysi kuni ishladingiz?`,
          kb: dayButtons(`cd:${id}`),
        });
      }
      case 'cd': {
        const me = db.assistantByTg(ctx.from.id);
        if (!me) return ctx.reply('Avval /ishladim deb yozing.');
        const date = todayISO(-Number(rest[1]));
        const p = db.getProject(id);
        if (db.claimExists(me.id, id, date)) {
          return edit(ctx, { text: `ℹ️ ${esc(me.name)}: ${esc(p.name)}, ${dateUz(date)} — bu ariza allaqachon yuborilgan.`, kb: new InlineKeyboard() });
        }
        const claimId = db.createClaim(me.id, id, date);
        await edit(ctx, {
          text: `✅ <b>${esc(me.name)}</b>\n🎬 ${esc(p.name)}\n📅 ${dateUz(date)}\n\nAriza Fozilxonga yuborildi.`,
          kb: new InlineKeyboard(),
        });
        return bot.api.sendMessage(OWNER_ID,
          `📥 <b>Yangi ariza</b>\n\n👤 ${esc(me.name)}\n🎬 ${esc(p.name)}\n📅 ${dateUz(date)}\n💵 Stavkasi: ${money(me.rate)}`,
          { parse_mode: 'HTML', reply_markup: new InlineKeyboard()
            .text('✅ Tasdiqlash', `cok:${claimId}`).row()
            .text(`👤 O'zi bordi ×2 (${num(me.rate * 2)})`, `cok2:${claimId}`).row()
            .text('❌ Rad etish', `cno:${claimId}`) }
        ).catch(() => {});
      }
      case 'claims': return edit(ctx, claimsView());
      case 'cok': return approveClaim(ctx, id);
      case 'cok2': return approveClaim(ctx, id, true);
      case 'cno': {
        const c = db.getClaim(id);
        if (c?.status === 'pending') db.setClaimStatus(id, 'rejected');
        return edit(ctx, claimsView());
      }

      /* --- money on a shooting --- */
      case 'shmoney': {
        wiz = { flow: 'money', step: 'amount', shootingId: id, data: {} };
        const sh = db.getShooting(id);
        return ctx.reply(`<b>${dateUz(sh.date)} · ${esc(sh.project_name)}</b>\nSumma qancha? (hozir: ${money(sh.amount)})`,
          { parse_mode: 'HTML', reply_markup: cancelKb() });
      }

      case 'mrent':
        if (!wiz) return;
        wiz.data.rent = 0;
        return askMoneyPaid(ctx);
      case 'mpaid':
        if (!wiz) return;
        return saveMoney(ctx, rest[0] === '1');

      /* --- discipline marks (kind: late | mistake) --- */
      case 'mmon': return edit(ctx, marksView(rest[0], rest[1]));
      case 'mnew': return edit(ctx, markPickPersonView(rest[0], rest[1]));
      case 'mp': return edit(ctx, markPersonView(rest[0], Number(rest[1]), rest[2]));
      case 'mpick': return edit(ctx, markPickDateView(rest[0], Number(rest[1]), rest[2]));
      case 'madd': {
        const date = todayISO(-Number(rest[2]));
        db.addMark(rest[0], Number(rest[1]), date);
        return edit(ctx, markPersonView(rest[0], Number(rest[1]), date.slice(0, 7)));
      }
      case 'mdate':
        wiz = { flow: 'mark', step: 'date', kind: rest[0], assistantId: Number(rest[1]) };
        return ctx.reply(`Sanani yozing, masalan <code>24.09.2026</code>`, { parse_mode: 'HTML', reply_markup: cancelKb() });
      case 'mdel':
        db.deleteMark(rest[0], Number(rest[1]));
        return edit(ctx, markPersonView(rest[0], Number(rest[2]), rest[3]));
      case 'cancel': clearWiz(); return edit(ctx, { text: 'Bekor qilindi.', kb: new InlineKeyboard().text('📁 Loyihalar', 'projects') });
      case 'projects': return edit(ctx, projectsView());
      case 'assistants': return edit(ctx, assistantsView());
      case 'p': return edit(ctx, projectView(id));
      case 'plist': return edit(ctx, shootingsListView(id));
      case 'sh': return edit(ctx, shootingView(id));
      case 'cal': return edit(ctx, calendarView(rest[0], rest[1]));

      case 'pnew':
        wiz = { flow: 'project', step: 'name' };
        return ctx.reply('Yangi loyiha nomini yozing:', { reply_markup: cancelKb() });

      case 'pren':
        wiz = { flow: 'project', step: 'rename', projectId: id };
        return ctx.reply('Loyihaning yangi nomini yozing:', { reply_markup: cancelKb() });

      case 'parch': {
        const p = db.getProject(id);
        db.setProjectArchived(id, !p.archived);
        return edit(ctx, projectView(id));
      }

      case 'padd': return askDate(ctx, id);

      case 'shpaid': {
        const s = db.getShooting(id);
        db.setShootingPaid(id, !s.paid);
        return edit(ctx, shootingView(id));
      }
      case 'shdel': {
        const s = db.getShooting(id);
        db.deleteShooting(id);
        return edit(ctx, shootingsListView(s.project_id));
      }

      case 'anew':
        wiz = { flow: 'assistant', step: 'name' };
        return ctx.reply('Yordamchining ismini yozing:', { reply_markup: cancelKb() });
      case 'a': return edit(ctx, assistantView(id));
      case 'arate':
        wiz = { flow: 'assistant', step: 'rate', assistantId: id };
        return ctx.reply(`<b>${esc(db.getAssistant(id).name)}</b> uchun 1 съёмка standart to'lovi qancha?`,
          { parse_mode: 'HTML', reply_markup: cancelKb() });
      case 'atog': {
        const a = db.getAssistant(id);
        db.setAssistantActive(id, !a.active);
        return edit(ctx, assistantView(id));
      }
      case 'adel':
        return edit(ctx, {
          text: `<b>${esc(db.getAssistant(id).name)}</b> o'chirilsinmi?\nUning barcha съёмка yozuvlari ham o'chadi.`,
          kb: new InlineKeyboard().text('🗑 Ha, o\'chirilsin', `adelok:${id}`).row().text('⬅️ Yo\'q', `a:${id}`),
        });
      case 'adelok':
        db.deleteAssistant(id);
        return edit(ctx, assistantsView());

      /* wizard buttons */
      case 'wd':
        if (!wiz) return;
        wiz.data.date = todayISO(-Number(rest[0]));
        return askNote(ctx);
      case 'wrent':
        if (!wiz) return;
        wiz.data.rent = 0;
        return askPaid(ctx);
      case 'wpaid':
        if (!wiz) return;
        wiz.data.paid = rest[0] === '1';
        return askAssistants(ctx);
      case 'wa': {
        if (!wiz) return;
        const i = wiz.selected.findIndex((s) => s.id === id);
        if (i >= 0) wiz.selected.splice(i, 1);
        else wiz.selected.push({ ...db.getAssistant(id) });
        return ctx.editMessageReplyMarkup({ reply_markup: assistantPickKb() }).catch(() => {});
      }
      case 'wadone':
        if (!wiz) return;
        return wiz.selected.length ? askFee(ctx) : finishShooting(ctx);
      case 'wfee': {
        if (!wiz) return;
        const a = wiz.selected[wiz.feeIdx];
        return rest[0] === 'solo' ? setFee(ctx, a.rate * 2, true) : setFee(ctx, a.rate);
      }
    }
  });

  /* ---------- free text = wizard input ---------- */
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return;
    if (inGroup(ctx)) return; // the group only talks to the bot through commands and buttons
    if (!wiz) return handleAI(ctx, { text });

    if (wiz.flow === 'project') {
      if (!text) return;
      if (wiz.step === 'rename') {
        db.renameProject(wiz.projectId, text);
        const id = wiz.projectId;
        clearWiz();
        return send(ctx, projectView(id));
      }
      const id = db.createProject(text);
      clearWiz();
      await ctx.reply(`✅ <b>${esc(text)}</b> loyihasi qo'shildi.`, { parse_mode: 'HTML' });
      return send(ctx, projectView(id));
    }

    if (wiz.flow === 'assistant') {
      if (wiz.step === 'name') {
        wiz.assistantId = db.createAssistant(text, 0);
        wiz.step = 'rate';
        return ctx.reply(`<b>${esc(text)}</b> qo'shildi.\nUning 1 съёмка uchun standart to'lovi qancha?`,
          { parse_mode: 'HTML', reply_markup: cancelKb() });
      }
      const rate = parseMoney(text);
      if (rate === null) return ctx.reply('Raqam yuboring, masalan: <code>300 000</code>', { parse_mode: 'HTML' });
      db.setAssistantRate(wiz.assistantId, rate);
      const id = wiz.assistantId;
      clearWiz();
      return send(ctx, assistantView(id));
    }

    if (wiz.flow === 'mark') {
      const d = parseDate(text);
      if (!d) return ctx.reply('Sanani shu ko\'rinishda yozing: <code>24.09.2026</code>', { parse_mode: 'HTML' });
      db.addMark(wiz.kind, wiz.assistantId, d);
      const { kind, assistantId } = wiz;
      clearWiz();
      return send(ctx, markPersonView(kind, assistantId, d.slice(0, 7)));
    }

    if (wiz.flow === 'money') {
      const n = parseMoney(text);
      if (n === null) return ctx.reply('Raqam yuboring, masalan: <code>5 000 000</code>', { parse_mode: 'HTML' });
      if (wiz.step === 'amount') {
        wiz.data.amount = n;
        wiz.step = 'rent';
        return ctx.reply('Arenda xarajati qancha?', {
          reply_markup: new InlineKeyboard().text('Arenda yo\'q', 'mrent:0').row().text('❌ Bekor qilish', 'cancel'),
        });
      }
      wiz.data.rent = n;
      return askMoneyPaid(ctx);
    }

    if (wiz.flow === 'shooting') {
      switch (wiz.step) {
        case 'date': {
          const d = parseDate(text);
          if (!d) return ctx.reply('Sanani shu ko\'rinishda yozing: <code>24.09.2026</code>', { parse_mode: 'HTML' });
          wiz.data.date = d;
          return askNote(ctx);
        }
        case 'note':
          wiz.data.note = text === '-' ? '' : text;
          return askAmount(ctx);
        case 'amount': {
          const n = parseMoney(text);
          if (n === null) return ctx.reply('Summani raqam bilan yozing, masalan: <code>5 000 000</code>', { parse_mode: 'HTML' });
          wiz.data.amount = n;
          return askRent(ctx);
        }
        case 'rent': {
          const n = parseMoney(text);
          if (n === null) return ctx.reply('Raqam yuboring yoki «Arenda yo\'q» tugmasini bosing.');
          wiz.data.rent = n;
          return askPaid(ctx);
        }
        case 'fee': {
          const n = parseMoney(text);
          if (n === null) return ctx.reply('Raqam yuboring yoki standart tugmasini bosing.');
          return setFee(ctx, n);
        }
      }
    }
  });

  bot.on(['message:voice', 'message:audio'], async (ctx) => {
    if (inGroup(ctx)) return;
    clearWiz();
    await handleAI(ctx, { voice: ctx.message.voice || ctx.message.audio });
  });

  bot.catch((err) => console.error('[bot]', err.error ?? err));
  return bot;
}

/* ---------- helpers ---------- */
const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const send = (ctx, view) =>
  view ? ctx.reply(view.text, { parse_mode: 'HTML', reply_markup: view.kb }) : ctx.reply('Topilmadi.');

const edit = (ctx, view) =>
  view
    ? ctx.editMessageText(view.text, { parse_mode: 'HTML', reply_markup: view.kb }).catch(() => send(ctx, view))
    : ctx.reply('Topilmadi.');

function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
