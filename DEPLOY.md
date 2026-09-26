# Deploy guide (for Claude Code on the VPS)

You are deploying **Fozilxon Studio** — one Node process that runs a Telegram bot and a
website together, backed by a single SQLite file. Target: Ubuntu/Debian VPS serving
`pro.javohirhm.uz` over HTTPS.

**Success criteria — all four must be true when you finish:**

1. `systemctl is-active fozilxon` → `active`, and it survives `reboot`.
2. `curl -sI https://pro.javohirhm.uz/` → `302` to `/login`; `curl -s https://pro.javohirhm.uz/login` → HTML.
3. Posting the right password to `/api/login` returns `{"ok":true}`; a wrong one returns 401.
4. The bot answers `/start` in Telegram.

## 0. Ask the user for these three things first

| Value | Goes to | Notes |
|---|---|---|
| Telegram bot token | `BOT_TOKEN` | from @BotFather → `/newbot` |
| Website password | `SITE_PASSWORD` | their choice; the site has no username |
| Their Telegram user ID | `BOT_OWNER_ID` | if they don't know it, leave empty — step 5 gets it |

Generate `SESSION_SECRET` yourself (`openssl rand -hex 32`). Never print these values back
in full, never commit them, never put them in a git-tracked file.

Also confirm before you start: **`pro.javohirhm.uz` must already point to this server's
IP** (a single A record; there is no `www` for it) — certbot in step 6 fails otherwise.
Check with `dig +short pro.javohirhm.uz` and compare to `curl -s ifconfig.me`.

## 1. Node 22.5 or newer

The app uses the built-in `node:sqlite` module, so there is nothing to compile — but the
version floor is real.

```bash
node -v   # need >= v22.5
```

If it is missing or older:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

## 2. Get the code

```bash
sudo mkdir -p /var/www
sudo git clone https://github.com/javohirhm/fozilxon-studio.git /var/www/fozilxon-studio
cd /var/www/fozilxon-studio
sudo npm install --omit=dev
```

Verify: `ls src/index.js public/index.html` both exist, and `npm ls --omit=dev --depth=0`
shows `express` and `grammy`.

## 3. Configure

```bash
sudo cp .env.example .env
sudo nano .env
```

Fill in `BOT_TOKEN`, `SITE_PASSWORD`, `SESSION_SECRET`, `BOT_OWNER_ID` (may stay empty for
now), and keep:

```
SITE_URL=https://pro.javohirhm.uz
PORT=3000
NODE_ENV=production
DB_PATH=data/studio.db
```

Lock it down — it holds the password and the cookie secret:

```bash
sudo chown -R www-data:www-data /var/www/fozilxon-studio
sudo chmod 600 /var/www/fozilxon-studio/.env
```

`data/` must stay writable by `www-data`; SQLite also writes `studio.db-wal` and
`studio.db-shm` next to the database.

## 4. Run it as a service

```bash
sudo cp fozilxon.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fozilxon
systemctl status fozilxon --no-pager
```

Verify locally before touching nginx:

```bash
curl -sI localhost:3000/ | head -1                       # 302 -> /login
curl -s localhost:3000/api/overview                      # {"error":"auth"}
journalctl -u fozilxon -n 20 --no-pager                  # "🌐 Sayt" and "🤖 Bot ishga tushdi"
```

`⚠️ BOT_TOKEN yo'q` in the log means the token is missing from `.env` — the site still runs,
the bot does not.

## 5. Owner ID, if it was left empty

Have the user send `/start` to the bot. It replies with their numeric Telegram ID. Put it in
`.env` as `BOT_OWNER_ID` and `sudo systemctl restart fozilxon`. Until this is set, the bot
answers nobody.

## 6. nginx + HTTPS

```bash
sudo apt-get install -y nginx
sudo cp nginx.conf.example /etc/nginx/sites-available/pro.javohirhm.uz
sudo ln -sf /etc/nginx/sites-available/pro.javohirhm.uz /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d pro.javohirhm.uz --redirect
```

If a firewall is on: `sudo ufw allow 'Nginx Full'`. Port 3000 must NOT be open to the world —
nginx proxies to it on localhost.

Verify:

```bash
curl -sI https://pro.javohirhm.uz/ | head -1
curl -s -X POST https://pro.javohirhm.uz/api/login -H 'content-type: application/json' \
  -d '{"password":"WRONG"}'            # {"error":"Parol xato"}
```

Then test the real password once, confirm `{"ok":true}`, and don't leave it in shell history
(`history -d` or prefix the command with a space).

`NODE_ENV=production` makes the login cookie `Secure`, so **logging in only works over
HTTPS** — don't test the real password against plain `http://`.

## 7. Hand back to the user

Tell them:

- the site is live at `https://pro.javohirhm.uz` and takes only the password,
- to open the bot and press `/start`,
- to add the bot to the assistants' group and send `/guruh` there once, so assistants can
  report their work with `/ishladim` (BotFather privacy mode stays ON — the bot only reads
  commands in the group).

## Updating later

```bash
cd /var/www/fozilxon-studio
sudo -u www-data git pull
sudo npm install --omit=dev
sudo systemctl restart fozilxon
```

The schema migrates itself on start (`CREATE TABLE IF NOT EXISTS`, plus an `ALTER TABLE` for
`assistants.tg_id`), so no migration step is needed.

## Backups

Everything lives in `data/studio.db`. A daily copy is enough:

```bash
sudo sqlite3 /var/www/fozilxon-studio/data/studio.db ".backup '/root/fozilxon-$(date +%F).db'"
```

(or stop the service and copy `studio.db`, `-wal`, `-shm` together). Set up a cron job if the
user wants it.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `SQLite is an experimental feature` warning | normal on Node 22–24, ignore |
| `Cannot find module 'node:sqlite'` | Node older than 22.5 — redo step 1 |
| Service restart-loops | `journalctl -u fozilxon -n 50`; usually `.env` unreadable or `data/` not writable by `www-data` |
| `409 Conflict` in the log | the same `BOT_TOKEN` is polling from somewhere else (a local copy still running) |
| Bot silent for everyone | `BOT_OWNER_ID` empty or wrong |
| Bot silent in the group | `/guruh` was never sent in that group, or the bot isn't a member |
| Site loads, login always fails | `SITE_PASSWORD` empty (the API says so), or testing over `http://` with `NODE_ENV=production` |
| 502 from nginx | app not listening — check `systemctl status fozilxon` and that `PORT=3000` matches the proxy |

Do not commit `.env` or `data/` — both are already in `.gitignore`.
