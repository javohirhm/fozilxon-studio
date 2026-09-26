import express from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as db from './db.js';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PASSWORD = process.env.SITE_PASSWORD || '';
const SECRET = process.env.SESSION_SECRET || 'change-me';
const DAY = 86_400_000;

/* ---------- tiny signed-cookie session ---------- */
const sign = (v) => createHmac('sha256', SECRET).update(v).digest('base64url');

function makeToken() {
  const exp = String(Date.now() + 30 * DAY);
  return `${exp}.${sign(exp)}`;
}

function validToken(token) {
  if (!token || !token.includes('.')) return false;
  const [exp, mac] = token.split('.');
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const a = Buffer.from(mac), b = Buffer.from(sign(exp));
  return a.length === b.length && timingSafeEqual(a, b);
}

const cookies = (req) =>
  Object.fromEntries((req.headers.cookie || '').split(';').map((c) => {
    const i = c.indexOf('=');
    return i < 0 ? [c.trim(), ''] : [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1))];
  }));

const authed = (req) => validToken(cookies(req).sid);

export function createServer() {
  const app = express();
  app.use(express.json());
  app.disable('x-powered-by');

  app.post('/api/login', (req, res) => {
    const given = String(req.body?.password ?? '');
    if (!PASSWORD) return res.status(500).json({ error: 'Saytga parol sozlanmagan (.env → SITE_PASSWORD)' });
    const a = Buffer.from(given), b = Buffer.from(PASSWORD);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return res.status(401).json({ error: 'Parol xato' });
    }
    res.cookie('sid', makeToken(), {
      httpOnly: true, sameSite: 'lax', maxAge: 30 * DAY,
      secure: process.env.NODE_ENV === 'production',
    });
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    res.clearCookie('sid');
    res.json({ ok: true });
  });

  app.get('/login', (req, res) => res.sendFile(join(PUBLIC, 'login.html')));

  // Everything past here needs the password.
  app.use('/api', (req, res, next) => (authed(req) ? next() : res.status(401).json({ error: 'auth' })));

  app.get('/api/overview', (req, res) => {
    res.json({
      totals: db.totals(),
      projects: db.listProjects(),
      monthly: db.monthly(),
      assistants: db.assistantStats(),
      recent: db.listShootings({ limit: 12 }),
      claims: db.pendingClaims(),
    });
  });

  app.get('/api/marks', (req, res) => {
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : new Date().toISOString().slice(0, 7);
    res.json({ month, late: db.marksByMonth('late', month), mistakes: db.marksByMonth('mistake', month) });
  });

  app.get('/api/project/:id', (req, res) => {
    const id = Number(req.params.id);
    const project = db.projectStats(id);
    if (!project) return res.status(404).json({ error: 'not found' });
    const shootings = db.listShootings({ projectId: id });
    res.json({
      project,
      monthly: db.monthly(id),
      shootings: shootings.map((s) => ({ ...s, assistants: db.shootingAssistants(s.id) })),
    });
  });

  app.get('/api/calendar', (req, res) => {
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : new Date().toISOString().slice(0, 7);
    const projectId = req.query.project && req.query.project !== 'all' ? Number(req.query.project) : null;
    const [y, m] = month.split('-').map(Number);
    const to = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
    res.json({
      month,
      days: db.byDay({ projectId, from: `${month}-01`, to }),
      shootings: db.listShootings({ projectId, from: `${month}-01`, to }),
    });
  });

  app.get('/', (req, res) =>
    authed(req) ? res.sendFile(join(PUBLIC, 'index.html')) : res.redirect('/login'));

  app.use(express.static(PUBLIC, {
    index: false,
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'), // always revalidate: deploys land instantly
  }));
  app.use((req, res) => (authed(req) ? res.redirect('/') : res.redirect('/login')));

  return app;
}
