# sol — desk

A private, desktop-style planner: calendar, meetings with notes, to-dos, two projects, a twelve-month look-ahead and an AI planning chat. It's for one person, sits behind a password, and saves every change to the server.

`prototype/index.html` is the original single-file prototype. The app matches it, apart from the few changes listed at the end of this file.

---

## Run it locally

You need Node 20.9 or newer.

```bash
npm install
cp .env.example .env.local
```

Edit `.env.local`:

```bash
# No database server needed locally: an embedded Postgres (PGlite) stored in ./.data
DATABASE_URL=pglite:./.data/pglite
SESSION_SECRET=<paste a long random string>     # see "Environment variables"
ANTHROPIC_API_KEY=<your key>                     # optional locally; the planner needs it
```

```bash
npm run dev          # http://localhost:3000
```

The first visit shows **Choose a password**. Type a 4-number code twice (like a phone PIN) and you're in.

## Environment variables

| Variable | Required | What it is |
|---|---|---|
| `DATABASE_URL` | yes | A Postgres connection string from Neon or Supabase. On Vercel, use the **pooled** URL. For local use only, `pglite:./.data/pglite` runs an embedded Postgres in a folder. |
| `DATABASE_URL_UNPOOLED` | no | Neon's direct (unpooled) connection string. If it's set, `npm run db:migrate` uses it for schema changes, as Neon recommends. |
| `SESSION_SECRET` | yes | A random string of at least 32 characters. Session tokens are stored as an HMAC under this key. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Changing it signs out every device. |
| `ANTHROPIC_API_KEY` | for the planner | Read only on the server and never sent to the browser. Without it, planner.chat says the key is missing. |
| `ANTHROPIC_MODEL` | no | Defaults to `claude-sonnet-5-5`. |

## Database and migrations

- The schema is in `lib/server/db/schema.ts` (Drizzle ORM). The SQL migrations are in `drizzle/` and are checked in.
- **Apply migrations:** `npm run db:migrate` runs them against `DATABASE_URL_UNPOOLED` if it's set, otherwise `DATABASE_URL`.
- **After changing the schema:** run `npm run db:generate`, then commit the new file in `drizzle/`.
- An embedded `pglite:` database migrates itself when the app starts.
- **On Vercel**, the `vercel-build` script runs the migrations before `next build`, so every deploy brings the database up to date.

The tables are:

- `items`: to-dos, events and meetings, soft-deleted through `deleted_at`.
- `settings`: project names and notes, theme and sound.
- `chat_messages`: planner history.
- `window_layout`: window positions and sizes, and which windows are open.
- `auth`: the argon2id password hash.
- `sessions`: login sessions.
- `login_attempts`: every login attempt, with its time and IP.

## Deploy to Vercel

1. Create a Postgres database on [Neon](https://neon.tech) or [Supabase](https://supabase.com) and copy its **pooled** connection string.
2. Push this repo to GitHub and import it into Vercel. The framework preset is Next.js, and the defaults are fine.
3. In **Project → Settings → Environment Variables**, add `DATABASE_URL`, `SESSION_SECRET`, `ANTHROPIC_API_KEY` and, if you like, `DATABASE_URL_UNPOOLED` and `ANTHROPIC_MODEL`. Under **Settings → Functions**, set the region to match the database, for example Frankfurt (`fra1`) for a Neon project in `aws-eu-central-1`.
4. Deploy. The build applies the migrations.
5. **Open the site straight away and choose your password.** Until a password exists, whoever opens the site first gets to set it.

## Neon tooling in this repo

This folder is linked to the Neon project `super-hat-06317854` (branch `production`, Frankfurt). The link is stored in a git-ignored `.neon` file.

- `neon env pull --file <file>` fetches the connection strings again. Without `--file`, it writes into `.env.local`, so pass a separate file and copy over only the lines you need.
- **Claude Code skills:** `.claude/skills/neon` and `.claude/skills/neon-postgres`, recorded in `skills-lock.json`. Check them with `neon skills status` and update them with `neon skills update`. These commands need Node.js 22.20 or newer.
- **Neon MCP server:** `.mcp.json` registers `https://mcp.neon.tech/mcp` with OAuth, so the file holds no keys. Claude Code asks you to approve it and sign in to Neon the first time it's used.

## Forgot the password? Reset it

```bash
npm run reset-password
```

This deletes the stored hash and signs out every device. The next visit asks you to choose a new password. Your plans aren't touched.

The script uses `DATABASE_URL` from `.env` or `.env.local`. To reset the password on the live site, point it at the production database:

```bash
vercel env pull .env.production.local     # or copy DATABASE_URL from the Vercel dashboard
DATABASE_URL="postgres://…" npm run reset-password
```

With a local `pglite:` database, stop `npm run dev` first, because the embedded database allows only one process at a time.

You can also change the password while you're logged in: **Tools → Change password** asks for the current one first.

---

## How it works

### Login and privacy

- **One 4-number password, stored only as an argon2id hash.** There is no sign-up and no usernames. A 4-number code has 10,000 possibilities; the rate limits below allow at most about 20 guesses an hour, so the lockouts are what keep it safe.
- **The page itself is gated.** Without a valid, unlocked session, the server renders only the lock screen. No items, names or notes are in the HTML.
- **Every API route checks the session.** Without one, it returns `401`.
- **Session cookie:** `__Host-sol`, which is `HttpOnly`, `Secure`, `SameSite=Strict` and lasts 30 days. The cookie holds a random token. The database stores only an HMAC of it (keyed by `SESSION_SECRET`).
- **Auto-lock after 30 minutes idle.** The screen locks and the password is needed again. The server enforces the same limit, so refreshing the page doesn't get around it.
- **Lock now** with ⌃L, the lock icon in the tray, or **File → Lock screen**.
- **Rate limits** apply to all attempts together, not per IP, because there's only one user:
  - Every 5th wrong password in a row starts a 30-second cooldown.
  - 20 wrong passwords within an hour start a 15-minute lockout.
- **Failed attempts** are logged with their time and IP.
- **Extra headers:** pages can't be framed (`frame-ancestors 'none'`), search engines are asked not to index the site, and cross-site writes are refused.

### Saving

- **Optimistic.** The screen updates instantly, then the change is saved.
- **Retry, then "Not saved".** If a save fails, it's retried once after 0.5–1 s. If that also fails, the today.md footer shows **Not saved** in red.
- **Never dropped.** Unsaved changes are queued in IndexedDB, so they survive a refresh or a closed tab. They're sent again when the connection comes back, when the window regains focus, and every 30 s.
- **Footer status:** **Saving…**, **All changes saved** or **Not saved**.
- **Notes autosave** (meeting notes and project notes) 700 ms after you stop typing, when you leave the box, and before the page unloads.
- **Delete is a soft delete** with a 4.5 s **Undo** toast. **Edit → Clear finished to-dos** can be undone the same way.
- **Backup:**
  - **File → Download backup** saves everything as JSON.
  - **File → Import backup** restores a backup. Each item in the file replaces the copy with the same id, and deleted ones come back. Nothing else is removed.
  - The prototype's **Copy all my data** JSON imports too.
- **Sync between devices.** Each device fetches what changed when the window regains focus and every 30 s. If two devices edit the same item, the newer edit wins. Window positions are saved too, so the desk looks the same everywhere.

### Planner

`POST /api/planner` streams the reply as server-sent events. Every message includes:

- the current date and time in Dubai
- both project names and notes
- every open item from 14 days ago to 60 days ahead, plus undated ones
- anything finished in the last 7 days

The model can call an `add_items` tool. It's told to add items only when you ask. The items appear on the calendar straight away, and the reply shows "✓ Added n to your calendar". If the main model declines a request, Anthropic's server-side fallback retries it on another model.

### Sounds

Every sound is a short mechanical click made with the Web Audio API, with no audio files. Each click is a low sine "thump" plus band-passed noise. There is one AudioContext and a master gain of 0.8, at most one sound per 30 ms, and mute is remembered. The recipes are in `lib/client/sound.ts`:

| Action | Click(s): body Hz, snap Hz, length s, volume |
|---|---|
| Button, icon, menu | 180, 4600, 0.040, 0.35 |
| Hover (mouse only), tabs, drag start/end | 150, 2600, 0.014, 0.18 |
| Window open | 230, 5400, 0.045, 0.32 |
| Window close | 130, 3600, 0.050, 0.32 |
| To-do done | 110, 3000, 0.035, 0.42, then 210, 5600, 0.030, 0.25 (+70 ms) |
| To-do undone | 160, 4200, 0.030, 0.30 |
| Delete | 120, 2400, 0.060, 0.35, then 90, 1800, 0.050, 0.25 (+60 ms) |
| Planner replied | 200, 5000, 0.030, 0.22, then 240, 5600, 0.030, 0.20 (+85 ms) |
| Wrong password | 120, 2000, 0.050, 0.30, then 100, 1800, 0.050, 0.25 (+90 ms) |
| Unlock | 180, 230 and 280 Hz rising, 70 ms apart |

### Keyboard

| Key | Does |
|---|---|
| **N** | New to-do |
| **Esc** | Close the top window, menu or start menu |
| **⌃L** | Lock the screen |
| **Tab** | Every control can be reached by Tab and shows a visible focus ring |

## Tests

```bash
npm test
```

The tests run against an in-memory Postgres (PGlite) and cover:

- **Save:** newest edit wins, and future-dated client clocks are capped.
- **Delete, undo, and undoing "clear finished to-dos".**
- **Sync deltas,** including deletes.
- **Export / import:** round trip, restoring deleted items, and the prototype's format.
- **Every API route returns 401** without a session.
- **Password and sessions:** argon2id storage, cookie flags, locking, the 30-minute idle lock, expiry and changing the password.
- **Rate limiting:** the 5-attempt cooldown and the 20-per-hour lockout.
- **Planner:** the tool loop, a scripted stand-in for the SDK, and refusals.
- **Sync engine:** retry once, then "Not saved", queueing, recovery and coalescing.
- **The today.md footer:** a failed save shows **Not saved** in red and stays queued in IndexedDB.
- **The quick-add parser.**

## Project layout

```
app/                 page (the auth gate), layout, globals.css, API routes
components/          Desk, windows, window frame, chrome (menus, taskbar), lock screen, ASCII backdrop
lib/shared/          types, dates, quick-add parser
lib/client/          store (zustand), actions, sync engine + IndexedDB outbox, sounds, planner client
lib/server/          db (schema, connection), repo, auth, validation, planner prompt/tool
drizzle/             SQL migrations
scripts/             migrate, reset-password
tests/               vitest
prototype/           the original prototype
```

## Where the app differs from the prototype

- **Data:** it lives in Postgres instead of the browser. File → "Copy all my data" became **Download backup** / **Import backup**.
- **Password:** exactly 4 numbers, like a phone PIN (the prototype took any 4+ characters). Phones show the number keypad. It's hashed with argon2id on the server.
- **Sounds:** mechanical clicks instead of the prototype's soft taps.
- **Accessibility:** each change below gets Lighthouse accessibility to 100.
  - The window buttons are 24 px targets drawing the same 13 px dots. The maximise dot sits 5 px further from the close dot.
  - Out-of-month day numbers in the calendar use the muted colour instead of 35% opacity.
  - In the light theme, red and green text uses a slightly darker shade.
- **Quick add:**
  - It needs `#1` / `#2` for projects, so "buy 1 milk" stays a plain to-do.
  - It only matches real weekday names, so "fix monitor" isn't dated Monday.
- **Window stacking** stays below the menus however long the desk is open.
- **Change password:** the lock screen in this mode has a **Cancel** link.
