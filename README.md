# Fozilxon Studio

Telegram bot (**data in**) + website (**data out**) for a videographer's projects,
shootings, money and assistants. One Node process serves both.

- **Bot (private, him)** — add projects, log each shooting (date, note, amount, rent,
  paid/unpaid, which assistants took part), manage assistants, approve assistant reports,
  mark lateness, browse per-project and overall calendars.
- **Bot (group, assistants)** — each assistant types `/ishladim` in the team group and taps
  project + day to report that they worked. It lands in his **📥 Arizalar** for approval.
- **Site** — password-protected dashboard: totals, monthly income charts, project pages,
  calendars, assistant KPI, monthly lateness, pending reports. Read-only; everything is
  entered in the bot.
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

`/start` shows the menu: **📁 Loyihalar · ➕ Yangi loyiha · 👥 Yordamchilar · ⏰ Kechikishlar ·
📅 Kalendar · 📊 Hisobot · 📥 Arizalar**. `/bekor` cancels a half-finished entry, `/menu` brings
the menu back.

Adding a shooting is a 6-step wizard: date (Bugun/Kecha/typed) → note → amount → rent →
paid or not → which assistants (their default rate is offered, any number can be typed instead).
Amounts accept `5 000 000`, `5mln`, `300ming`.

**⏰ Kechikishlar** — pick a person, pick a day (7 day buttons or a typed date), one tap = one
lateness mark. The month view lists everyone with their count and dates; tap a date to remove it.

In private chat only `BOT_OWNER_ID` is answered; anyone else is ignored.

## Group (assistants report their own work)

1. Add the bot to the team group (an ordinary member is enough — keep BotFather's default
   privacy mode ON, the bot then only sees commands, not the group's chatter).
2. He sends `/guruh` **in that group** once. Only that one group is accepted afterwards.
3. An assistant sends `/ishladim` → first time, they tap their own name from the list of
   people he already added (only names not yet linked are offered), which links their Telegram
   account for good → then they tap the project and the day.
4. The report arrives in his bot with **✅ Tasdiqlash / ❌ Rad etish**, and also sits under
   **📥 Arizalar**.
5. On approval: if a shooting already exists for that project and day, the assistant is
   attached to it at their default rate. If none exists, one is created with **amount 0** and
   the bot offers **💰 Summani kiritish** to fill in money, rent and paid/unpaid right away.

Duplicate reports (same person, project and day) are refused. Typing doesn't work in groups
because of Telegram's privacy mode — that is why dates are buttons there.

## Site

`/login` → password → dashboard. Pages: Umumiy (totals, monthly chart, projects, pending
reports, recent shootings), Loyihalar, Loyiha (own calendar + all shootings), Kalendar (month
grid, filter by project), Yordamchilar (earnings, monthly lateness with day chips, KPI table).

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
src/bot.js      Telegram bot: menus, wizards, calendars
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
- Lateness is a plain count per person per day (several marks on one day are allowed, e.g.
  morning and after lunch).
