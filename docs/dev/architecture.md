# Architecture

Dayspring is one small Node.js program that runs on the user's own Windows computer, plus a few web pages it serves to a browser window. There is no cloud service of our own, no database server and no build step.

```
                 ┌──────────────────────── the user's Windows PC ─────────────────────────┐
                 │                                                                         │
 Chrome / Edge ──┼─► /display  (tv.html + tv.js, layout, sky, library, reader…)            │
  "app" window   │     ▲  voice in (Web Speech), voice out (audio from /api/tts or the     │
                 │     │  browser's own voices), the player, the living sky                │
                 │     │ fetch /api/…          ▲ Server-Sent Events /api/events           │
                 │     ▼                        │                                          │
                 │  server.mjs (Node 22+, 127.0.0.1:4747) ──► lib/*.mjs modules            │
                 │     │   data/*.json (the owner's data)   .env (keys)                    │
                 │     ├─► an AI provider (Claude / OpenAI / xAI / Ollama)   [optional]     │
                 │     ├─► ElevenLabs / OpenAI voices                          [optional]     │
                 │     ├─► Playwright-driven Chrome windows: music, browse, study           │
                 │     ├─► PowerShell helpers: audio devices, windows, keep-awake, programs │
                 │     └─► whisper.cpp (Tune in), Voicemeeter (calls)          [optional]     │
                 └─────────────────────────────────────────────────────────────────────────┘
```

## The pieces

### The server (`server.mjs`)
- Plain `node:http`, no framework. It serves `public/` and the `/api` routes, and only listens on `127.0.0.1`, so nothing is reachable from the network. The one exception is Twilio webhooks through an optional tunnel.
- Route modules each export `handle(req, res, ctx)` returning `true` when they answered. The server tries them in order (the `ROUTES` array), then its own routes. `ctx = { m, p, q, send, readJSON, restart }`, where `p` is the path after `/api`.
- Page routes that aren't under `/api` (sign-in callbacks, the study window's course pages) use `handlePage(req, res, { m, pathname, q })`.
- Startup: `firstrun.ensure()` creates `data/`, then routines are stamped onto today, the announcer and schedulers start, and the display window is opened in display mode.
- Display mode is on when `DAYSPRING_DISPLAY=1`, which the launchers set. In display mode the server keeps the Dayspring screen open, keeps the PC awake while plugged in, and runs Tune in and the phone watcher.

### Starting, one instance, no console windows (`scripts/launch.mjs`, `lib/display.mjs`, `lib/browsers.mjs`)
- The shortcuts run `Start Dayspring.vbs` (wscript, no window), which runs `node scripts/launch.mjs`. The launcher starts `server.mjs` **detached and hidden**, logging to `data/logs/server.log`, then `POST /api/app/open`: the guided setup once (in the owner's own browser) until setup is done, then the Dayspring screen.
- **One server**: a second server exits on `EADDRINUSE`; `data/server.pid` names the running one. **One window**: `display.open()` first asks `scripts/window.ps1` to bring back an existing Dayspring window (matched by title *and* browser profile), and never starts a second one within 20 s. The screen watchdog is off until setup is done.
- **No consoles**: every child process is started with `windowsHide: true` and never `detached` (a detached console process has no console, so *its* children would each open a visible one). Browsers are launched directly, not through `cmd`. Restarts go through `launch.mjs --restart --wait-pid`, never `start … cmd /k`.
- **Browsers**: `browsers.list()` reads the registry (StartMenuInternet, the default-browser ProgId) plus known paths. Chromium-family browsers get `--app`/`--kiosk` and a Dayspring profile; Firefox gets its own profile with `user.js` (mic and autoplay allowed) and `--kiosk`; others a normal window. The Playwright media and study windows use Chrome, else Edge.
- **Stopping**: `POST /api/app/quit` (the window bar's ✕ → Quit Dayspring, or `Stop Dayspring.cmd` / `launch.mjs --stop`).

### Updates (`lib/updater.mjs`, `lib/update-routes.mjs`, `public/updates.js`)
- Checks GitHub (`package.json` `dayspring.updateRepo`, asset `Dayspring.zip`) on start and every 6 h. `data/updates.json` holds the standing choice (`ask` / `launch` / `idle`), the per-version plan, what's downloaded (`updates/<version>`), and the history shown in Settings → Updates.
- `install()`: back up `data/` + `.env` → move the program files into `backups/code-<old>-<date>` and the new ones in (renames, so it can be undone) → `npm install` only if dependencies changed → `pendingVerify` → restart with `--verify`. The new server calls `confirmStarted()`; if it doesn't answer within a minute, the launcher calls `rollback()`. `data/`, `.env`, `bin/`, `node_modules/`, `backups/`, `updates/` and `logs/` are never replaced.
- Tests: `scripts/qa/update-e2e.mjs` runs every path against a fake GitHub.

### The assistant (`lib/assistant.mjs`)
`chat(history, text, opts)` handles each message in this order:
1. **Local skills first**, with no AI needed and in a deliberate order: photos, church, the voice skills, Discord, study, documents, connectors, screen questions, snooze, keep-awake, the sky, devices and mic, settings phrases, media, and the offline scheduler (`lib/offline.mjs`).
2. **If none answers and an AI is set up**, it runs a tool loop:
   - Claude goes through `@anthropic-ai/sdk`, with prompt caching and native web search when permitted.
   - OpenAI, xAI and Ollama go through `llm.chatWithToolsOpenAI` using the same tools.
3. **Tools come from several places:** the built-in schedule tools, `abilities.tools()` (files, programs, browser, web, documents, all limited by permissions), and the skill modules' `TOOLS` (study, sky, connectors…).
4. **The system prompt is built fresh each time.** It includes the next three days' plan, special days, what's on the screen (`screenlog.contextText()`), connected apps, permissions and the owner profile.

`opts.surface` is `tv` (the screen), `desk`, `call` (Tune in: read-only, short answers), or `discord`.

### The screen (`public/tv.html` + `tv.js` and add-ons)
- `tv.js` is the core. It holds the clock, now/next, the showcase carousel, the talk panel, speech recognition (Web Speech API, wake word, echo guard), speech output (a queue; audio from `/api/tts`, or the browser's own voices), sound effects through Web Audio buses with per-device routing (`setSinkId`), the player (YouTube IFrame API and the Spotify Web Playback SDK), alarms and the detail viewer.
- **Add-ons are separate scripts** loaded after it: `layout.js` (safe area, fitters, the ⋯ menus, window bar, Fit to screen, Sound panel), `sky.js` (the living sky canvas), `callbridge.js` (🎧 Tune in), `study.js`, `library.js` (music and video library, Discover), `reader.js` (documents), `results.js` (lists and research), `discover.js`.
- **Add-ons talk to `tv.js` through small hooks:** `window.dsEvents` (the shared SSE connection), `window.dsSpeak`, `window.dsLocal` (local voice commands) and `window.dsOpenPage`.

### Live updates (Server-Sent Events)
The screen opens `GET /api/events`, and the server pushes events with `announcer.broadcast(type, data)`:

| Event | Meaning |
|---|---|
| `announce` | A schedule moment, reminder, alarm, text or check-in to say and show |
| `refresh` | The schedule changed (`reason: "ai-edit"` includes the `date` so the screen jumps there) |
| `calendar` | Open the Schedule app at a view and date |
| `settings` | Settings changed (volume, outputs, screen fit…) |
| `media`, `player`, `nowplaying`, `spotify-auth`, `library` | The player |
| `sky`, `ambient`, `ambient-preview` | The living sky |
| `tunein`, `mic`, `sound` | Tune in, the mic, sound effects |
| `results`, `doc`, `discover` | Lists and research, the document reader, Discover |
| `help` | Open a section of the guide over the screen (`{ url: "/help?embed=1#voices/free-voices" }`, from `help_guide` or "how do I …") |
| `snooze`, `window`, `connections`, `discord`, `coder`, `claude`, `phonenote` | Other features |

### Data (`data/`)
- **Each feature owns one JSON file**, loaded on first use and written in full when it changes (small files, one process):
  - `store.json`: blocks, routines (repeat rules), tasks, memories
  - `settings.json`, `owner.json` (the profile), `permissions.json`, `sky.json`
  - `learning.json` / `study.json`, `devotion.json` (faith), `people.json`
  - `discover.json`, `screenlog.json` (the last 24 hours on screen), `snoozes.json`
  - `spotify-token.json`, `connectors/*.json`, and so on
- **Missing files mean "defaults".** `firstrun.ensure()` only creates the folder. Exports ship `data/` empty.
- **Keys live in `.env`**, written only through `lib/envfile.mjs`, which is allow-listed and atomic. The browser never receives a key value.

### Speech
- **Listening** uses the browser's Web Speech API on the screen, with a wake word, a command window, gathering long sentences and an echo guard.
- **Speaking** uses `lib/voice.mjs`: ElevenLabs, OpenAI, or `browser`, where the page speaks with `speechSynthesis`.
- **Tune in** listens to what the headset plays, through WASAPI loopback (`scripts/loopcap.cs`), and transcribes it with local whisper.cpp (`lib/stt.mjs`): `tiny.en` to catch the wake word, `base.en` for the request.

### Permissions and safety
- `lib/permissions.mjs` decides every file, program, browser and web action. The most specific entry wins, and secrets and system folders are always blocked.
- `lib/abilities.mjs` checks permissions on every tool call. Writes are backed up first. Deletes go to the Recycle Bin, after a question.
- Email connectors never request a send scope; they can only write drafts.
- Nothing personal is in the code. `scripts/privacy-scan.mjs` blocks an export that contains the owner's words.

## Folder layout (the repo)

```
server.mjs            the server
lib/                  one module per feature (see the code map)
lib/connectors/       Notion, Google, Microsoft (+ guides)
lib/discord/          the Discord bot
public/               the pages and their scripts
scripts/              launch helpers (PowerShell), export / release / privacy scan, doc generator
docs/                 this guide (user pages) and docs/dev (developer pages)
data/                 created on first run; everything personal lives here
.env                  keys (from .env.example)
```

See the [Code map](code-map.md) for every file, and the [API reference](api-reference.md) for every route.
