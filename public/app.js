/* Fozilxon Studio — sayt (faqat ko'rish uchun; ma'lumot bot orqali kiritiladi) */

const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun',
  'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const MONTHS_SHORT = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek'];
const monthShort = (ym) => MONTHS_SHORT[Number(ym.split('-')[1]) - 1];
const DOW = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'];

const num = (n) => Math.round(Number(n) || 0).toLocaleString('ru-RU').replace(/ /g, ' ');
const money = (n) => `${num(n)} so'm`;
const mln = (n) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)} mln` : num(n));
const esc = (s = '') => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dateUz = (iso, withYear = true) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d}-${MONTHS[m - 1]}${withYear ? `, ${y}` : ''}`;
};
const monthLabel = (ym) => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
const thisMonth = () => new Date().toISOString().slice(0, 10).slice(0, 7);
const shiftMonth = (ym, d) => {
  const [y, m] = ym.split('-').map(Number);
  const x = new Date(y, m - 1 + d, 1);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
};

async function api(path) {
  const r = await fetch(path);
  if (r.status === 401) { location.href = '/login'; throw new Error('auth'); }
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

/* ---------- tooltip ---------- */
const tip = document.getElementById('tip');
function bindTips(root) {
  for (const n of root.querySelectorAll('[data-tip]')) {
    n.addEventListener('mouseenter', () => { tip.innerHTML = n.dataset.tip; tip.style.opacity = 1; });
    n.addEventListener('mousemove', (e) => {
      const pad = 14;
      let x = e.clientX + pad, y = e.clientY + pad;
      const r = tip.getBoundingClientRect();
      if (x + r.width > innerWidth - 8) x = e.clientX - r.width - pad;
      if (y + r.height > innerHeight - 8) y = e.clientY - r.height - pad;
      tip.style.left = `${x}px`; tip.style.top = `${y}px`;
    });
    n.addEventListener('mouseleave', () => { tip.style.opacity = 0; });
  }
}

/* ---------- charts ---------- */
/** Vertical bars: one series (magnitude over time) — no legend, the title names it. */
function barChart(rows, { label, value, tipHtml, height = 230, width = 760 }) {
  if (!rows.length) return '<div class="empty-note">Ma\'lumot yo\'q.</div>';
  // Keep the SVG close to 1:1 with its container so labels stay legible on phones.
  const W = Math.min(width, Math.max(320, innerWidth - 100)), H = height,
    padL = 52, padR = 8, padT = 22, padB = 28;
  const max = Math.max(...rows.map(value)) || 1;
  const step = Math.ceil(max / 3);
  const ticks = [0, step, step * 2, step * 3];
  const top = ticks[3];
  const plotH = H - padT - padB, plotW = W - padL - padR;
  const band = plotW / rows.length;
  const bw = Math.max(6, Math.min(54, band - Math.max(2, band * 0.28)));
  const y = (v) => padT + plotH - (v / top) * plotH;

  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">`;
  for (const t of ticks) {
    svg += `<line class="${t === 0 ? 'baseline' : 'gridline'}" x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}"/>` +
      `<text x="${padL - 10}" y="${y(t) + 4}" text-anchor="end">${t === 0 ? '0' : mln(t)}</text>`;
  }
  rows.forEach((r, i) => {
    const v = value(r), h = Math.max(v > 0 ? 3 : 0, (v / top) * plotH);
    const x = padL + band * i + (band - bw) / 2;
    const yy = padT + plotH - h, rr = Math.min(4, bw / 2, h);
    const d = `M${x},${padT + plotH} V${yy + rr} Q${x},${yy} ${x + rr},${yy} H${x + bw - rr} Q${x + bw},${yy} ${x + bw},${yy + rr} V${padT + plotH} Z`;
    svg += `<g class="b" data-tip="${esc(tipHtml(r))}">` +
      `<rect class="bar-hit" x="${padL + band * i}" y="${padT}" width="${band}" height="${plotH}"/>` +
      `<path class="bar-mark" d="${d}"/>` +
      (rows.length <= 9 && v > 0 ? `<text class="val" x="${x + bw / 2}" y="${yy - 7}" text-anchor="middle">${mln(v)}</text>` : '') +
      `<text x="${padL + band * i + band / 2}" y="${H - 9}" text-anchor="middle">${esc(label(r))}</text>` +
      `</g>`;
  });
  return `${svg}</svg>`;
}

/** Horizontal bars: magnitude by identity (people). */
function barsH(rows) {
  const max = Math.max(...rows.map((r) => r.v), 1);
  return `<div class="bars-h">${rows.map((r) => `
    <div class="r" data-tip="${esc(r.tip || '')}">
      <span>${esc(r.name)}</span>
      <span class="track"><i style="width:${Math.max(2, (r.v / max) * 100)}%"></i></span>
      <span class="v">${num(r.v)}</span>
    </div>`).join('')}</div>`;
}

/** Month grid; day fill is a one-hue (blue) ramp by daily income. */
function calendarGrid(ym, days, todayIso) {
  const [y, m] = ym.split('-').map(Number);
  const byDay = new Map(days.map((d) => [Number(d.date.slice(8)), d]));
  const max = Math.max(...days.map((d) => d.income), 1);
  const last = new Date(y, m, 0).getDate();
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const ramp = [0.14, 0.28, 0.45, 0.66];

  let html = `<div class="cal">${DOW.map((d) => `<div class="dow">${d}</div>`).join('')}`;
  for (let i = 0; i < lead; i++) html += '<div class="day empty"></div>';
  for (let d = 1; d <= last; d++) {
    const iso = `${ym}-${String(d).padStart(2, '0')}`;
    const cell = byDay.get(d);
    const cls = ['day', cell ? 'has' : '', iso === todayIso ? 'today' : ''].filter(Boolean).join(' ');
    if (!cell) { html += `<div class="${cls}"><span>${d}</span></div>`; continue; }
    const a = ramp[Math.min(3, Math.max(0, Math.ceil((cell.income / max) * 4) - 1))];
    html += `<div class="${cls}" style="background:rgba(57,135,229,${a})"
      data-tip="<div class='t'>${dateUz(iso)}</div><b>${money(cell.income)}</b> · ${cell.shootings} съёмка">
      <span>${d}</span>
      <span><span class="amt">${mln(cell.income)}</span><br><span class="cnt">${cell.shootings} съёмка</span></span>
    </div>`;
  }
  return `${html}</div>`;
}

/* ---------- shared blocks ---------- */
const tile = (k, v, cls = '', suffix = '') =>
  `<div class="tile ${cls}"><div class="k">${k}</div><div class="v">${v}${suffix ? `<small>${suffix}</small>` : ''}</div></div>`;

const moneyTiles = (t) => `<div class="tiles">
  ${tile('Daromad', num(t.income), 'accent', 'so\'m')}
  ${tile('Sof foyda', num(t.income - t.rent - t.fees), '', 'so\'m')}
  ${tile('Съёмкалар', t.shootings)}
  ${tile('Xarajat (arenda + yordamchi)', num(t.rent + t.fees), '', 'so\'m')}
  ${t.unpaid ? tile('To\'lanmagan', num(t.unpaid), 'warn', 'so\'m') : ''}
</div>`;

const shootingsTable = (rows, { showProject = false } = {}) => rows.length ? `<div class="tbl"><table>
  <thead><tr>
    <th>Sana</th>${showProject ? '<th>Loyiha</th>' : ''}<th>Съёмка</th>
    <th class="num">Summa</th><th class="num">Arenda</th><th class="num">Yordamchi</th><th class="num">Sof</th><th>Holat</th>
  </tr></thead>
  <tbody>${rows.map((s) => `<tr>
    <td><b>${dateUz(s.date, false)}</b><div class="people">${s.date.slice(0, 4)}</div></td>
    ${showProject ? `<td>${esc(s.project_name)}</td>` : ''}
    <td>${esc(s.note || '—')}${s.assistant_names ? `<div class="people">👥&nbsp;${esc(s.assistant_names)}</div>` : ''}</td>
    <td class="num"><b>${num(s.amount)}</b></td>
    <td class="num">${s.rent ? num(s.rent) : '—'}</td>
    <td class="num">${s.fees ? num(s.fees) : '—'}</td>
    <td class="num"><b>${num(s.amount - s.rent - s.fees)}</b></td>
    <td><span class="chip ${s.paid ? 'paid' : 'due'}"><span>${s.paid ? '✅' : '⏳'}</span>${s.paid ? 'to\'landi' : 'kutilmoqda'}</span></td>
  </tr>`).join('')}</tbody></table></div>` : '<div class="empty-note">Hozircha съёмка yo\'q. Botdan qo\'shing.</div>';

const projectCards = (projects, maxIncome) => projects.length ? `<div class="projects">${projects.map((p) => `
  <a class="proj" href="#/loyiha/${p.id}">
    <div class="name">${p.archived ? '🗄 ' : ''}${esc(p.name)}</div>
    <div class="meta">${p.shootings} съёмка${p.last_date ? ` · oxirgisi ${dateUz(p.last_date, false)}` : ''}</div>
    <div class="money">${money(p.income)}</div>
    <div class="bar"><i style="width:${Math.max(2, (p.income / (maxIncome || 1)) * 100)}%"></i></div>
    <div class="foot">
      <span>Sof: ${num(p.income - p.rent - p.fees)}</span>
      ${p.unpaid ? `<span class="chip due">⏳ ${num(p.unpaid)}</span>` : '<span></span>'}
    </div>
  </a>`).join('')}</div>` : '<div class="empty-note">Loyiha yo\'q. Botda «➕ Yangi loyiha» tugmasini bosing.</div>';

/** One month of discipline marks: lateness and gross mistakes, side by side. */
function marksBlock(icon, label, rows, tone) {
  const marked = rows.filter((r) => r.count);
  const total = marked.reduce((s, r) => s + r.count, 0);
  const max = Math.max(...marked.map((r) => r.count), 1);
  return `
    <div class="mark-block">
      <div class="mark-title"><span><span class="ic">${icon}</span>${label}</span><span class="legendless">jami ${total} marta</span></div>
      ${marked.length ? `<div class="bars-h">${marked.map((r) => `
        <div class="r">
          <span>${esc(r.name)}</span>
          <span class="track"><i class="${tone}" style="width:${(r.count / max) * 100}%"></i></span>
          <span class="v">${r.count}</span>
        </div>
        <div class="late-days">${r.dates.split(',').sort().map((d) => `<span class="chip">${dateUz(d, false)}</span>`).join('')}</div>
      `).join('')}</div>` : '<div class="empty-note">Bu oyda yo\'q.</div>'}
    </div>`;
}

function marksCard(month, data) {
  return `
    <div class="cal-head">
      <button class="navbtn" data-late="prev">‹</button>
      <span class="mname">${monthLabel(month)}</span>
      <button class="navbtn" data-late="next">›</button>
    </div>
    <div class="marks">
      ${marksBlock('⏰', 'Kechikish', data.late, 'warn')}
      ${marksBlock('⚠️', 'Qo\'pol xato', data.mistakes, 'bad')}
    </div>`;
}

/* ---------- views ---------- */
async function viewDashboard() {
  const d = await api('/api/overview');
  const maxIncome = Math.max(...d.projects.map((p) => p.income), 0);
  const top = d.assistants.filter((a) => a.shootings > 0).slice(0, 6);
  return `
    <div class="page-head">
      <div><h1 class="title">Umumiy ko'rinish</h1>
        <div class="sub">${d.projects.length} loyiha · ${d.totals.shootings} съёмка · ma'lumot Telegram bot orqali kiritiladi</div></div>
    </div>
    ${moneyTiles(d.totals)}
    <div class="stack">
      <div class="card">
        <h2>Oylik daromad</h2><div class="hint">Har oyda olingan pul, so'm</div>
        ${barChart(d.monthly, {
          label: (r) => monthShort(r.month),
          value: (r) => r.income,
          tipHtml: (r) => `<div class='t'>${monthLabel(r.month)}</div><b>${money(r.income)}</b><br>${r.shootings} съёмка · xarajat ${num(r.expenses)}`,
        })}
      </div>
    </div>
    <div class="row2">
      <div class="card"><h2>Loyihalar</h2><div class="hint">Daromad bo'yicha</div>${projectCards(d.projects.slice(0, 4), maxIncome)}</div>
      <div class="card"><h2>Yordamchilar KPI</h2><div class="hint">Ishtirok etgan съёмка soni</div>
        ${top.length ? barsH(top.map((a) => ({
          name: a.name, v: a.shootings,
          tip: `<div class='t'>${esc(a.name)}</div><b>${a.shootings} съёмка</b><br>Ishlagan puli: ${money(a.earned)}`,
        }))) : '<div class="empty-note">Yordamchi yo\'q.</div>'}
      </div>
    </div>
    ${d.claims.length ? `<div class="card" style="margin-bottom:22px">
      <h2><span class="ic">📥</span>Tasdiqlanmagan arizalar</h2><div class="hint">Yordamchilar guruhda yuborgan — botda tasdiqlang</div>
      <div class="bars-h">${d.claims.map((c) => `<div class="r claim">
        <span><b>${esc(c.assistant_name)}</b></span>
        <span>${esc(c.project_name)} · ${dateUz(c.date)}</span>
        <span class="v">${num(c.assistant_rate)}</span>
      </div>`).join('')}</div></div>` : ''}
    <div class="card"><h2>Oxirgi съёмкалар</h2><div class="hint">Eng yangi 12 ta yozuv</div>
      ${shootingsTable(d.recent, { showProject: true })}</div>`;
}

async function viewProjects() {
  const d = await api('/api/overview');
  const maxIncome = Math.max(...d.projects.map((p) => p.income), 0);
  return `
    <div class="page-head"><div><h1 class="title">Loyihalar</h1>
      <div class="sub">${d.projects.length} ta loyiha</div></div></div>
    ${projectCards(d.projects, maxIncome)}`;
}

async function viewProject(id) {
  const d = await api(`/api/project/${id}`);
  const p = d.project;
  const month = d.shootings.length ? d.shootings[0].date.slice(0, 7) : thisMonth();
  const cal = await api(`/api/calendar?month=${month}&project=${id}`);
  return `
    <div class="page-head">
      <div><a class="back" href="#/loyihalar">← Loyihalar</a>
        <h1 class="title" style="margin-top:8px">${p.archived ? '🗄 ' : ''}${esc(p.name)}</h1>
        <div class="sub">${p.shootings} съёмка${p.last_date ? ` · oxirgisi ${dateUz(p.last_date)}` : ''}</div></div>
    </div>
    ${moneyTiles(p)}
    <div class="row2">
      <div class="card"><h2>Oylik daromad</h2><div class="hint">Shu loyiha bo'yicha</div>
        ${barChart(d.monthly, {
          label: (r) => monthShort(r.month),
          value: (r) => r.income,
          tipHtml: (r) => `<div class='t'>${monthLabel(r.month)}</div><b>${money(r.income)}</b><br>${r.shootings} съёмка`,
          height: 260, width: 520,
        })}
      </div>
      <div class="card" id="pcal" data-project="${id}" data-month="${month}">
        <h2>Loyiha kalendari</h2><div class="hint">Съёмка bo'lgan kunlar</div>
        <div class="cal-head">
          <button class="navbtn" data-cal="prev">‹</button>
          <span class="mname">${monthLabel(month)}</span>
          <button class="navbtn" data-cal="next">›</button>
        </div>
        <div id="pcal-grid">${calendarGrid(month, cal.days, new Date().toISOString().slice(0, 10))}</div>
      </div>
    </div>
    <div class="card"><h2>Barcha съёмкалар</h2><div class="hint">${d.shootings.length} yozuv</div>
      ${shootingsTable(d.shootings)}</div>`;
}

async function viewCalendar(ym = thisMonth(), project = 'all') {
  const [cal, over] = await Promise.all([
    api(`/api/calendar?month=${ym}&project=${project}`),
    api('/api/overview'),
  ]);
  const sum = cal.days.reduce((s, d) => s + d.income, 0);
  const cnt = cal.days.reduce((s, d) => s + d.shootings, 0);
  return `
    <div class="page-head"><div><h1 class="title">Kalendar</h1>
      <div class="sub">${monthLabel(ym)} · ${cnt} съёмка · ${money(sum)}</div></div></div>
    <div class="card" id="cal" data-month="${ym}" data-project="${project}">
      <div class="cal-head">
        <button class="navbtn" data-cal="prev">‹</button>
        <span class="mname">${monthLabel(ym)}</span>
        <button class="navbtn" data-cal="next">›</button>
        <select id="calproj">
          <option value="all"${project === 'all' ? ' selected' : ''}>Barcha loyihalar</option>
          ${over.projects.map((p) => `<option value="${p.id}"${String(p.id) === String(project) ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select>
      </div>
      ${calendarGrid(ym, cal.days, new Date().toISOString().slice(0, 10))}
    </div>
    <div class="card"><h2>${monthLabel(ym)} съёмкалари</h2><div class="hint">${cal.shootings.length} yozuv</div>
      ${shootingsTable(cal.shootings, { showProject: project === 'all' })}</div>`;
}

async function viewAssistants() {
  const month = thisMonth();
  const [d, marks] = await Promise.all([api('/api/overview'), api(`/api/marks?month=${month}`)]);
  const a = d.assistants;
  const lateBy = new Map(marks.late.map((r) => [r.id, r.count]));
  const missBy = new Map(marks.mistakes.map((r) => [r.id, r.count]));
  const worked = a.filter((x) => x.shootings > 0);
  const totalPaid = a.reduce((s, x) => s + x.earned, 0);
  return `
    <div class="page-head"><div><h1 class="title">Yordamchilar</h1>
      <div class="sub">${a.length} kishi · jami to'lov ${money(totalPaid)}</div></div></div>
    <div class="tiles">
      ${tile('Yordamchilar', a.length)}
      ${tile('Jami to\'lov', num(totalPaid), 'accent', 'so\'m')}
      ${tile('Ishtiroklar', a.reduce((s, x) => s + x.shootings, 0), '', 'съёмка')}
    </div>
    <div class="card" id="late" data-month="${month}" style="margin-bottom:22px">
      <h2><span class="ic">📋</span>Intizom</h2><div class="hint">Oy bo'yicha, botda belgilanadi</div>
      <div id="late-body">${marksCard(month, marks)}</div>
    </div>
    <div class="card" style="margin-bottom:22px"><h2>Ishlagan puli</h2><div class="hint">Jami to'lov, so'm</div>
      ${worked.length ? barsH(worked.map((x) => ({
        name: x.name, v: x.earned,
        tip: `<div class='t'>${esc(x.name)}</div><b>${money(x.earned)}</b><br>${x.shootings} съёмка · stavka ${num(x.rate)}`,
      }))) : '<div class="empty-note">Ma\'lumot yo\'q.</div>'}
    </div>
    <div class="card"><h2>KPI jadvali</h2><div class="hint">Botda «👥&nbsp;Yordamchilar» orqali boshqariladi</div>
      ${a.length ? `<div class="tbl"><table>
        <thead><tr><th>Ism</th><th class="num">Stavka</th><th class="num">Съёмка</th>
          <th class="num">Ishlagan puli</th><th class="num">O'rtacha</th><th class="num">Kechikish</th>
          <th class="num">Qo'pol xato</th><th>Oxirgi ish</th><th>Holat</th></tr></thead>
        <tbody>${a.map((x) => `<tr>
          <td><b>${esc(x.name)}</b></td>
          <td class="num">${num(x.rate)}</td>
          <td class="num"><b>${x.shootings}</b></td>
          <td class="num"><b>${num(x.earned)}</b></td>
          <td class="num">${num(x.shootings ? x.earned / x.shootings : 0)}</td>
          <td class="num">${lateBy.get(x.id) ? `<b class="late-n">${lateBy.get(x.id)}</b>` : '—'}</td>
          <td class="num">${missBy.get(x.id) ? `<b class="miss-n">${missBy.get(x.id)}</b>` : '—'}</td>
          <td>${x.last_date ? dateUz(x.last_date, false) : '—'}</td>
          <td><span class="chip ${x.active ? 'paid' : ''}">${x.active ? 'faol' : 'faol emas'}</span></td>
        </tr>`).join('')}</tbody></table></div>` : '<div class="empty-note">Yordamchi yo\'q.</div>'}
    </div>`;
}

/* ---------- router ---------- */
const view = document.getElementById('view');

async function render() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const [, head, arg] = hash.split('/');
  const nav = `/${head || ''}`;
  for (const a of document.querySelectorAll('[data-nav]')) {
    a.classList.toggle('on', a.dataset.nav === (head === 'loyiha' ? '/loyihalar' : nav));
  }
  view.innerHTML = '<div class="empty-note">Yuklanmoqda…</div>';
  try {
    if (head === 'loyiha' && arg) view.innerHTML = await viewProject(arg);
    else if (head === 'loyihalar') view.innerHTML = await viewProjects();
    else if (head === 'kalendar') view.innerHTML = await viewCalendar(arg || thisMonth(), hash.split('/')[3] || 'all');
    else if (head === 'yordamchilar') view.innerHTML = await viewAssistants();
    else view.innerHTML = await viewDashboard();
  } catch (e) {
    if (e.message !== 'auth') view.innerHTML = `<div class="empty-note">Xatolik: ${esc(e.message)}</div>`;
    return;
  }
  bindTips(view);
  wireCalendars();
  wireLateness();
  scrollTo(0, 0);
}

function wireCalendars() {
  // Overall calendar: month lives in the URL so it survives reloads.
  const cal = document.getElementById('cal');
  if (cal) {
    for (const b of cal.querySelectorAll('[data-cal]')) {
      b.onclick = () => {
        const ym = shiftMonth(cal.dataset.month, b.dataset.cal === 'next' ? 1 : -1);
        location.hash = `/kalendar/${ym}/${cal.dataset.project}`;
      };
    }
    const sel = document.getElementById('calproj');
    if (sel) sel.onchange = () => { location.hash = `/kalendar/${cal.dataset.month}/${sel.value}`; };
  }
  // Project calendar: swap the grid in place.
  const p = document.getElementById('pcal');
  if (p) {
    for (const b of p.querySelectorAll('[data-cal]')) {
      b.onclick = async () => {
        const ym = shiftMonth(p.dataset.month, b.dataset.cal === 'next' ? 1 : -1);
        const d = await api(`/api/calendar?month=${ym}&project=${p.dataset.project}`);
        p.dataset.month = ym;
        p.querySelector('.mname').textContent = monthLabel(ym);
        document.getElementById('pcal-grid').innerHTML =
          calendarGrid(ym, d.days, new Date().toISOString().slice(0, 10));
        bindTips(p);
      };
    }
  }
}

function wireLateness() {
  const box = document.getElementById('late');
  if (!box) return;
  for (const b of box.querySelectorAll('[data-late]')) {
    b.onclick = async () => {
      const ym = shiftMonth(box.dataset.month, b.dataset.late === 'next' ? 1 : -1);
      const d = await api(`/api/marks?month=${ym}`);
      box.dataset.month = ym;
      document.getElementById('late-body').innerHTML = marksCard(ym, d);
      wireLateness();
    };
  }
}

document.getElementById('logout').onclick = async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.href = '/login';
};

addEventListener('hashchange', render);
render();
