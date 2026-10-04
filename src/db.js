import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const file = resolve(process.env.DB_PATH || 'data/studio.db');
mkdirSync(dirname(file), { recursive: true });

export const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  created_at TEXT    NOT NULL,
  archived   INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS assistants (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  rate       INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS shootings (
  id         INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date       TEXT    NOT NULL,
  note       TEXT    NOT NULL DEFAULT '',
  amount     INTEGER NOT NULL DEFAULT 0,
  rent       INTEGER NOT NULL DEFAULT 0,
  paid       INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS shooting_assistants (
  shooting_id  INTEGER NOT NULL REFERENCES shootings(id) ON DELETE CASCADE,
  assistant_id INTEGER NOT NULL REFERENCES assistants(id) ON DELETE CASCADE,
  fee          INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (shooting_id, assistant_id)
);
CREATE TABLE IF NOT EXISTS claims (
  id           INTEGER PRIMARY KEY,
  assistant_id INTEGER NOT NULL REFERENCES assistants(id) ON DELETE CASCADE,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date         TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'pending',
  shooting_id  INTEGER REFERENCES shootings(id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS lateness (
  id           INTEGER PRIMARY KEY,
  assistant_id INTEGER NOT NULL REFERENCES assistants(id) ON DELETE CASCADE,
  date         TEXT    NOT NULL,
  created_at   TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS mistakes (
  id           INTEGER PRIMARY KEY,
  assistant_id INTEGER NOT NULL REFERENCES assistants(id) ON DELETE CASCADE,
  date         TEXT    NOT NULL,
  created_at   TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shootings_project ON shootings(project_id);
CREATE INDEX IF NOT EXISTS idx_shootings_date    ON shootings(date);
CREATE INDEX IF NOT EXISTS idx_lateness_date     ON lateness(date);
CREATE INDEX IF NOT EXISTS idx_mistakes_date     ON mistakes(date);
`);

// Added after the first release: link an assistant to the Telegram account that reports for them.
if (!db.prepare('PRAGMA table_info(assistants)').all().some((c) => c.name === 'tg_id')) {
  db.exec('ALTER TABLE assistants ADD COLUMN tg_id INTEGER');
}
// "O'zi bordi": the assistant covered the shooting alone, so his fee for it is doubled.
if (!db.prepare('PRAGMA table_info(shooting_assistants)').all().some((c) => c.name === 'solo')) {
  db.exec('ALTER TABLE shooting_assistants ADD COLUMN solo INTEGER NOT NULL DEFAULT 0');
}

const q = (sql) => db.prepare(sql);
const now = () => new Date().toISOString();

/* --- projects --- */
export const createProject = (name) =>
  q('INSERT INTO projects (name, created_at) VALUES (?, ?)').run(name, now()).lastInsertRowid;

export const getProject = (id) => q('SELECT * FROM projects WHERE id = ?').get(id);

export const renameProject = (id, name) =>
  q('UPDATE projects SET name = ? WHERE id = ?').run(name, id);

export const setProjectArchived = (id, archived) =>
  q('UPDATE projects SET archived = ? WHERE id = ?').run(archived ? 1 : 0, id);

export const deleteProject = (id) => q('DELETE FROM projects WHERE id = ?').run(id);

// One row per project with all money rolled up.
const PROJECT_STATS = `
  SELECT p.id, p.name, p.created_at, p.archived,
         COUNT(s.id)                                        AS shootings,
         COALESCE(SUM(s.amount), 0)                         AS income,
         COALESCE(SUM(s.rent), 0)                           AS rent,
         COALESCE(SUM(f.fees), 0)                           AS fees,
         COALESCE(SUM(CASE WHEN s.paid = 0 THEN s.amount END), 0) AS unpaid,
         MAX(s.date)                                        AS last_date
    FROM projects p
    LEFT JOIN shootings s ON s.project_id = p.id
    LEFT JOIN (SELECT shooting_id, SUM(fee) AS fees FROM shooting_assistants GROUP BY shooting_id) f
           ON f.shooting_id = s.id
`;

export const listProjects = () =>
  q(`${PROJECT_STATS} GROUP BY p.id ORDER BY p.archived, COALESCE(MAX(s.date), p.created_at) DESC`).all();

export const projectStats = (id) => q(`${PROJECT_STATS} WHERE p.id = ? GROUP BY p.id`).get(id);

/* --- assistants --- */
export const createAssistant = (name, rate) =>
  q('INSERT INTO assistants (name, rate, created_at) VALUES (?, ?, ?)').run(name, rate, now()).lastInsertRowid;

export const getAssistant = (id) => q('SELECT * FROM assistants WHERE id = ?').get(id);
export const listAssistants = (activeOnly = false) =>
  q(`SELECT * FROM assistants ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY active DESC, name`).all();
export const setAssistantRate = (id, rate) =>
  q('UPDATE assistants SET rate = ? WHERE id = ?').run(rate, id);
export const setAssistantActive = (id, active) =>
  q('UPDATE assistants SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
export const deleteAssistant = (id) => q('DELETE FROM assistants WHERE id = ?').run(id);

// KPI per assistant: how many shootings, what he owes/paid them, revenue they worked on.
export const assistantStats = () =>
  q(`SELECT a.id, a.name, a.rate, a.active,
            COUNT(sa.shooting_id)              AS shootings,
            COALESCE(SUM(sa.fee), 0)           AS earned,
            COALESCE(SUM(s.amount), 0)         AS revenue,
            MAX(s.date)                        AS last_date
       FROM assistants a
       LEFT JOIN shooting_assistants sa ON sa.assistant_id = a.id
       LEFT JOIN shootings s            ON s.id = sa.shooting_id
      GROUP BY a.id
      ORDER BY shootings DESC, a.name`).all();

/* --- shootings --- */
export function createShooting({ projectId, date, note, amount, rent, paid, assistants = [] }) {
  const id = q(
    'INSERT INTO shootings (project_id, date, note, amount, rent, paid, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(projectId, date, note, amount, rent, paid ? 1 : 0, now()).lastInsertRowid;
  const link = q('INSERT INTO shooting_assistants (shooting_id, assistant_id, fee, solo) VALUES (?, ?, ?, ?)');
  for (const a of assistants) link.run(id, a.id, a.fee, a.solo ? 1 : 0);
  return id;
}

export const deleteShooting = (id) => q('DELETE FROM shootings WHERE id = ?').run(id);
export const setShootingPaid = (id, paid) =>
  q('UPDATE shootings SET paid = ? WHERE id = ?').run(paid ? 1 : 0, id);

const SHOOTING_ROWS = `
  SELECT s.*, p.name AS project_name,
         COALESCE(f.fees, 0) AS fees,
         (SELECT GROUP_CONCAT(a.name || CASE WHEN sa.solo THEN ' ×2' ELSE '' END, ', ')
            FROM shooting_assistants sa
            JOIN assistants a ON a.id = sa.assistant_id WHERE sa.shooting_id = s.id) AS assistant_names
    FROM shootings s
    JOIN projects p ON p.id = s.project_id
    LEFT JOIN (SELECT shooting_id, SUM(fee) AS fees FROM shooting_assistants GROUP BY shooting_id) f
           ON f.shooting_id = s.id
`;

export const listShootings = ({ projectId = null, from = null, to = null, limit = null } = {}) => {
  const where = [];
  const args = [];
  if (projectId) { where.push('s.project_id = ?'); args.push(projectId); }
  if (from) { where.push('s.date >= ?'); args.push(from); }
  if (to) { where.push('s.date <= ?'); args.push(to); }
  let sql = SHOOTING_ROWS + (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY s.date DESC, s.id DESC';
  if (limit) { sql += ' LIMIT ?'; args.push(limit); }
  return q(sql).all(...args);
};

export const getShooting = (id) => q(`${SHOOTING_ROWS} WHERE s.id = ?`).get(id);

export const shootingAssistants = (id) =>
  q(`SELECT a.id, a.name, sa.fee, sa.solo FROM shooting_assistants sa
       JOIN assistants a ON a.id = sa.assistant_id
      WHERE sa.shooting_id = ? ORDER BY a.name`).all(id);

/* --- rollups for the site & bot --- */
export const totals = (projectId = null) =>
  q(`SELECT COUNT(s.id) AS shootings,
            COALESCE(SUM(s.amount), 0) AS income,
            COALESCE(SUM(s.rent), 0)   AS rent,
            COALESCE(SUM(f.fees), 0)   AS fees,
            COALESCE(SUM(CASE WHEN s.paid = 0 THEN s.amount END), 0) AS unpaid
       FROM shootings s
       LEFT JOIN (SELECT shooting_id, SUM(fee) AS fees FROM shooting_assistants GROUP BY shooting_id) f
              ON f.shooting_id = s.id
      ${projectId ? 'WHERE s.project_id = ?' : ''}`).get(...(projectId ? [projectId] : []));

export const monthly = (projectId = null) =>
  q(`SELECT substr(s.date, 1, 7) AS month,
            COUNT(s.id) AS shootings,
            COALESCE(SUM(s.amount), 0) AS income,
            COALESCE(SUM(s.rent), 0) + COALESCE(SUM(f.fees), 0) AS expenses
       FROM shootings s
       LEFT JOIN (SELECT shooting_id, SUM(fee) AS fees FROM shooting_assistants GROUP BY shooting_id) f
              ON f.shooting_id = s.id
      ${projectId ? 'WHERE s.project_id = ?' : ''}
      GROUP BY month ORDER BY month`).all(...(projectId ? [projectId] : []));

// Calendar cells: one row per day that has shootings.
export const byDay = ({ projectId = null, from, to }) => {
  const args = [from, to];
  if (projectId) args.push(projectId);
  return q(`SELECT s.date,
                   COUNT(s.id) AS shootings,
                   COALESCE(SUM(s.amount), 0) AS income
              FROM shootings s
             WHERE s.date BETWEEN ? AND ? ${projectId ? 'AND s.project_id = ?' : ''}
             GROUP BY s.date ORDER BY s.date`).all(...args);
};

/* --- settings (registered group chat) --- */
export const getSetting = (key) => q('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;
export const setSetting = (key, value) =>
  q('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));

/* --- assistant <-> telegram account --- */
export const assistantByTg = (tgId) => q('SELECT * FROM assistants WHERE tg_id = ?').get(tgId);
export const linkAssistantTg = (assistantId, tgId) => {
  q('UPDATE assistants SET tg_id = NULL WHERE tg_id = ?').run(tgId); // one account, one person
  q('UPDATE assistants SET tg_id = ? WHERE id = ?').run(tgId, assistantId);
};

/* --- claims: "men bu съёмкада ishladim" --- */
export const createClaim = (assistantId, projectId, date) =>
  q('INSERT INTO claims (assistant_id, project_id, date, created_at) VALUES (?, ?, ?, ?)')
    .run(assistantId, projectId, date, now()).lastInsertRowid;

const CLAIM_ROWS = `
  SELECT c.*, a.name AS assistant_name, a.rate AS assistant_rate, p.name AS project_name
    FROM claims c
    JOIN assistants a ON a.id = c.assistant_id
    JOIN projects   p ON p.id = c.project_id
`;
export const getClaim = (id) => q(`${CLAIM_ROWS} WHERE c.id = ?`).get(id);
export const pendingClaims = () => q(`${CLAIM_ROWS} WHERE c.status = 'pending' ORDER BY c.date DESC, c.id`).all();
export const claimExists = (assistantId, projectId, date) =>
  !!q("SELECT 1 FROM claims WHERE assistant_id = ? AND project_id = ? AND date = ? AND status <> 'rejected'")
    .get(assistantId, projectId, date);
export const setClaimStatus = (id, status, shootingId = null) =>
  q('UPDATE claims SET status = ?, shooting_id = ? WHERE id = ?').run(status, shootingId, id);

/* --- shootings touched by an approved claim --- */
export const shootingOn = (projectId, date) =>
  q('SELECT * FROM shootings WHERE project_id = ? AND date = ? ORDER BY id LIMIT 1').get(projectId, date);

export const attachAssistant = (shootingId, assistantId, fee, solo = false) =>
  q('INSERT INTO shooting_assistants (shooting_id, assistant_id, fee, solo) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING')
    .run(shootingId, assistantId, fee, solo ? 1 : 0);

export const updateShootingMoney = (id, { amount, rent, paid }) =>
  q('UPDATE shootings SET amount = ?, rent = ?, paid = ? WHERE id = ?').run(amount, rent, paid ? 1 : 0, id);

/** Patch only the fields that were passed. */
export function updateShooting(id, fields) {
  const cols = ['date', 'note', 'amount', 'rent', 'paid'].filter((c) => fields[c] !== undefined);
  if (!cols.length) return;
  const vals = cols.map((c) => (c === 'paid' ? (fields[c] ? 1 : 0) : fields[c]));
  q(`UPDATE shootings SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...vals, id);
}

export const detachAssistant = (shootingId, assistantId) =>
  q('DELETE FROM shooting_assistants WHERE shooting_id = ? AND assistant_id = ?').run(shootingId, assistantId);

export const renameAssistant = (id, name) =>
  q('UPDATE assistants SET name = ? WHERE id = ?').run(name, id);

/* --- discipline marks: kechikish + qo'pol xato --- */
const MARK_TABLES = { late: 'lateness', mistake: 'mistakes' };
const table = (kind) => MARK_TABLES[kind] ?? (() => { throw new Error(`unknown mark: ${kind}`); })();

export const addMark = (kind, assistantId, date) =>
  q(`INSERT INTO ${table(kind)} (assistant_id, date, created_at) VALUES (?, ?, ?)`)
    .run(assistantId, date, now()).lastInsertRowid;

export const deleteMark = (kind, id) => q(`DELETE FROM ${table(kind)} WHERE id = ?`).run(id);

/** Remove one mark for that person on that day (the newest, if several). */
export const deleteMarkOn = (kind, assistantId, date) =>
  q(`DELETE FROM ${table(kind)} WHERE id = (
       SELECT id FROM ${table(kind)} WHERE assistant_id = ? AND date = ? ORDER BY id DESC LIMIT 1)`)
    .run(assistantId, date).changes;

/** One row per assistant for the month, with the dates. */
export const marksByMonth = (kind, month) =>
  q(`SELECT a.id, a.name, a.active,
            COUNT(m.id) AS count,
            GROUP_CONCAT(m.date) AS dates
       FROM assistants a
       LEFT JOIN ${table(kind)} m ON m.assistant_id = a.id AND substr(m.date, 1, 7) = ?
      GROUP BY a.id
      ORDER BY count DESC, a.name`).all(month);

export const marksOf = (kind, assistantId, month) =>
  q(`SELECT * FROM ${table(kind)} WHERE assistant_id = ? AND substr(date, 1, 7) = ? ORDER BY date`)
    .all(assistantId, month);
