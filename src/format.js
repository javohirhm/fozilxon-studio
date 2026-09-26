const MONTHS_UZ = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun',
  'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];

export const monthName = (m) => MONTHS_UZ[m];

/** 5000000 -> "5 000 000" (non-breaking thin groups) */
export const num = (n) => Math.round(Number(n) || 0).toLocaleString('ru-RU').replace(/ /g, ' ');
export const money = (n) => `${num(n)} so'm`;

/** "2026-09-26" -> "26-sentabr, 2026" */
export function dateUz(iso, withYear = true) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d}-${MONTHS_UZ[m - 1]}${withYear ? `, ${y}` : ''}`;
}

export const todayISO = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

/** "26.09.2026" | "26/09" | "26.9.26" -> "2026-09-26"; null if unparseable */
export function parseDate(text) {
  const m = text.trim().match(/^(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{2,4}))?$/);
  if (!m) return null;
  const day = +m[1], mon = +m[2];
  let year = m[3] ? +m[3] : new Date().getFullYear();
  if (year < 100) year += 2000;
  if (mon < 1 || mon > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** "5 000 000" | "5mln" | "300ming" -> number; null if no digits */
export function parseMoney(text) {
  const t = text.trim().toLowerCase();
  const digits = t.replace(/[^\d]/g, '');
  if (!digits) return null;
  let n = Number(digits);
  if (/mln|млн|million/.test(t)) n *= 1_000_000;
  else if (/ming|тыс|k$/.test(t)) n *= 1_000;
  return n;
}
