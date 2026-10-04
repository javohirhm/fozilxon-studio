# Fozilxon Studio

Telegram bot (**data in**) + website (**data out**) for a videographer's projects,
shootings, money and assistants. One Node process serves both.

- **Bot (private, him)** — just talk to it. Typed or spoken, plain Uzbek: Gemini understands
  and writes it into the database. The old button menus are still there as a fallback: add
  projects, log each shooting (date, note, amount, rent, paid/unpaid, which assistants took
  part), manage assistants, approve assistant reports, mark lateness and gross mistakes,
  browse per-project and overall calendars.
- **Bot (group, assistants)** — each assistant types `/ishladim` in the team group and taps
  project + day to report that they worked. It lands in his **📥 Arizalar** for approval.
- **Site** — password-protected dashboard: totals, monthly income charts, project pages,
  calendars, assistant KPI, monthly discipline (lateness + gross mistakes), pending reports.
  Read-only; everything is entered in the bot.
- **Storage** — one SQLite file (`data/studio.db`), no external services.
- **UI language** — Uzbek. Currency — so'm.

## Setup

```bash
npm install
cp .env.example .env
```

(Deploying on a server? `DEPLOY.md` is a step-by-step guide written for Claude Code on the VPS.)

Fill in `.env`:

| Key | Where it comes from |
|---|---|
| `BOT_TOKEN` | @BotFather → `/newbot` |
| `BOT_OWNER_ID` | leave empty, run the bot, send `/start` — it replies with your ID |
| `SITE_PASSWORD` | the website password you choose |
| `SESSION_SECRET` | already generated; keep secret |

```bash
npm start            # bot + site on http://localhost:3000
npm run seed         # optional: demo projects/shootings for a look around
```

The site works even without `BOT_TOKEN`; the bot simply doesn't start.

## Bot

`/start` shows the menu: **📁 Loyihalar · ➕ Yangi loyiha · 👥 Yordamchilar · 📥 Arizalar ·
⏰ Kechikishlar · ⚠️ Qo'pol xatolar · 📅 Kalendar · 📊 Hisobot**. `/bekor` cancels a
half-finished entry, `/menu` brings the menu back.

Adding a shooting is a 6-step wizard: date (Bugun/Kecha/typed) → note → amount → rent →
paid or not → which assistants. For each one the fee step offers two buttons — **Standart**
(his rate) or **👤 O'zi bordi ×2** (double, for when that assistant covered the shooting
himself) — or any number can be typed instead. Amounts accept `5 000 000`, `5mln`, `300ming`.

**⏰ Kechikishlar** and **⚠️ Qo'pol xatolar** — pick a person, pick a day (7 day buttons or a
typed date), one tap = one mark. Each month view lists everyone with their count and dates; tap
a date to remove it. Both are plain counts, nothing is deducted from pay.

In private chat only `BOT_OWNER_ID` is answered; anyone else is ignored.

## AI chat (the main way he uses the bot)

He writes or sends a voice note, and the model does the work. Anything the buttons can do, the
chat can do — all 25 actions in `src/tools.js` are exposed to it:

```
bugun Aziz to'yida ishladik, 5 mln oldik, Bekzod ham bor edi
yo'q, 6 mln edi            → fixes the shooting it just wrote
yangi loyiha oldik: Korzinka reklama
Bekzod bugun kechikdi · Sardor qo'pol xato qildi
Bekzod o'zi bordi, to'lovini ikkilantir
shu oy qancha ishladik? kim ko'p kechikkan?
arizalarni ko'rsat · Bekzodnikini tasdiqla
```

- **Voice messages** go straight to Gemini as audio (`audio/ogg`) — no separate transcriber,
  and Uzbek/Russian mixed speech is fine.
- **Deletes always ask first.** The model is required to call `delete_*` without `confirm`,
  report the warning, and only delete after he says yes.
- **Context carries over** between messages (server-side, ~2h idle timeout). `/yangi` clears it.
- Model: `gemini-3.8-flash` (override with `GEMINI_MODEL`). At this volume it costs pennies a
  month and fits inside the free tier most days.
- No `GEMINI_API_KEY` → the bot says so once and keeps working through its buttons.

Assistants in the group still use `/ishladim` with buttons — Telegram's privacy mode means the
bot never sees ordinary group chatter, which also keeps the AI bill to his messages only.

## Group (assistants report their own work)

1. Add the bot to the team group (an ordinary member is enough — keep BotFather's default
   privacy mode ON, the bot then only sees commands, not the group's chatter).
2. He sends `/guruh` **in that group** once. Only that one group is accepted afterwards.
3. An assistant sends `/ishladim` → first time, they tap their own name from the list of
   people he already added (only names not yet linked are offered), which links their Telegram
   account for good → then they tap the project and the day.
4. The report arrives in his bot with **✅ Tasdiqlash / ❌ Rad etish**, and also sits under
   **📥 Arizalar**.
5. Approval has two buttons: **✅ Tasdiqlash** (default rate) and **👤 O'zi bordi ×2** (double,
   if he went alone). If a shooting already exists for that project and day, the assistant is
   attached to it; if none exists, one is created with **amount 0** and the bot offers
   **💰 Summani kiritish** to fill in money, rent and paid/unpaid right away.

Duplicate reports (same person, project and day) are refused. Typing doesn't work in groups
because of Telegram's privacy mode — that is why dates are buttons there.

## Site

`/login` → password → dashboard. Pages: Umumiy (totals, monthly chart, projects, pending
reports, recent shootings), Loyihalar, Loyiha (own calendar + all shootings), Kalendar (month
grid, filter by project), Yordamchilar (earnings, monthly discipline — lateness and gross
mistakes side by side with day chips — and the KPI table). Assistants who went alone show as
`Bekzod ×2` next to their shooting.

## Deploy (one VPS)

```bash
git clone <repo> /var/www/fozilxon-studio && cd /var/www/fozilxon-studio
npm install --omit=dev
cp .env.example .env && nano .env        # NODE_ENV=production
sudo cp fozilxon.service /etc/systemd/system/
sudo systemctl enable --now fozilxon
sudo cp nginx.conf.example /etc/nginx/sites-available/pro.javohirhm.uz
sudo ln -s /etc/nginx/sites-available/pro.javohirhm.uz /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d pro.javohirhm.uz
```

Node **22.5+** is required (`node:sqlite` is built in — no native modules to compile).
Updates: `git pull && npm install --omit=dev && sudo systemctl restart fozilxon`.

Backup = copy `data/studio.db` (plus `-wal`/`-shm` if present).

## Files

```
src/db.js       schema + every query
src/tools.js    the 25 actions the AI can take, name→id resolution, confirm gates
src/gemini.js   Gemini Interactions API client (text + audio, session recovery)
src/ai.js       agent loop + system prompt with a live snapshot of the data
src/bot.js      Telegram bot: AI chat, voice, menus, wizards, calendars
src/server.js   Express: login, JSON API, static site
src/index.js    starts both
public/         index.html · login.html · app.js (router, charts, calendar) · styles.css
```

## Notes

- A shooting's `Sof` (net) = amount − rent − assistant fees.
- Assistant rate is a default, stored per shooting, so changing a rate later does not
  rewrite past shootings.
- A wizard in progress is held in memory: restarting the app during one loses that entry,
  nothing else.
- One Telegram account = one assistant. Linking a second name to the same account moves the
  link instead of duplicating it.
- Lateness and gross mistakes are plain counts per person per day (several marks on one day
  are allowed, e.g. morning and after lunch).
- **O'zi bordi ×2** stores the already-doubled fee on that shooting, so project net profit and
  expense totals include it automatically. A fee typed by hand is used exactly as typed — the
  ×2 applies to the default-rate button, not to a manual amount.
