# Testing

Dayspring has no test framework dependency. Tests are small Node scripts that drive the real server and a headless browser (Playwright, which is already a dependency).

## Before every release

| Check | Command | What it proves |
|---|---|---|
| Syntax | `node --check` on every `.mjs`/`.js` | Nothing fails to load |
| Fresh-install QA | `node scripts/qa-fresh-install.mjs` (when present) | The exported copy installs, the guided setup completes as a new user, links work, no page errors |
| Updates | `node scripts/qa/update-e2e.mjs [--old <a 1.0.0 folder>] [--keep]` | Against a fake GitHub on this computer: install now (data, `.env` and `bin/` kept, backups made, the new version confirms it started); a failed download changes nothing; a version that won't start is rolled back; "next time I open Dayspring"; "when I'm not using it"; and 1.0.0's own updater installing this version. Servers run hidden on ports 4793+, browser launches only logged |
| One voice, no freezing | `node scripts/qa/one-voice.mjs` | Two Dayspring screens at once: exactly one is the speaker (and listener); an alarm on both is heard once; when it closes the other takes over; "stop" ends the whole reply and what was queued; a dismissed wake-up stops; a missing photo is a 404, not a crash; 50 chats at once are all answered with the server responsive throughout (port 4797, speech mocked) |
| Works with Lantern (1.1.0) | `node scripts/qa/lantern-bridge.mjs [--no-real]` | The Dayspring ↔ Lantern link on a throwaway copy (port 4793) with its own ecosystem folder: the presence file and token; hello; 401 without the token, 421 for a foreign Host, 403 for a foreign Origin, 400 with a list for a bad event; mic.owner, speaking.start/stop (once), dnd, handing the mic over; Lantern speaking makes the screen wait; a mock Lantern's status, study cards on the screen (measure, next lesson, click opens the lesson), voice (next lesson, how far, open, remind me to study, send a course with confirm, two people with one name, unknown person); offers and friend requests (cards, spoken, yes/no/later, no duplicates), unit.completed, reminder.due, schedule.block.request; Lantern gone; installing from a fake release (asks first, exit 10 → Node.js question → `--install-node`, exit 11 → nodejs.org, a failed download), the sign-in handoff; "Connect to Lantern" against Lantern's fake hub (the emailed sign-in link and its callback page, email + password sign-up and sign-in, a wrong password, "I already have Lantern" with none) (invitation and friend request arrive, accept, decline, hub down); and the real `Lantern.zip` installed, started hidden, found, mic and open reaching it |
| Nothing pops up (1.1.1) | `node scripts/qa/no-window.mjs [--quick]` | With Discover on, interests set and no YouTube key, background searching runs for 3 minutes (1 with --quick) and never launches the visible media browser or creates its profile, and still finds videos; a video plays in the Dayspring player; ↗ Pop out pauses it and asks for the browser at the right second; "pop it out" does the same; a video that can't be embedded shows a card and opens nothing until Pop out is pressed; the pop-out route builds the watch address with &t= and refuses non-ids (port 4798, speech and YouTube player faked) |
| Open modes, mini, quiet, notifications (1.2.0) | `node scripts/qa/open-modes.mjs` | openAs choices and launch arguments per browser, Automatic per screen, the launcher's `--open-as`, voice ("open Dayspring in my browser", "make Dayspring small", "use Brave for Dayspring"); one page choosing its layout by window size (3 sizes), ⤡/⤢ resizing the same window; Active/Quiet/Off (mic released, alarms still ring); the hard 🎤 stop (no restarts, survives a reload); notification kinds and the quick switch; Brave/Firefox using the local recognizer (/api/stt); a closed screen staying closed (fast watchdog) and the pagehide beacon; the overlay helper; update detection against the real GitHub releases (port 4793, headless, --mute-audio, no real mic) |
| Alarms with the screen closed (1.2.1) | `node scripts/qa/alarm-closed.mjs` | The real desktop helper in test mode (silent file, volume 0): an alarm with no screen open shows the card and rings; answered on a screen, Snooze (9 min, through the snooze list) and Dismiss stop it; Chime chimes, Silent doesn't, Speak chimes unless "speak when closed" is on; Off with alarms muted only shows; with a screen open the helper stays silent; no window opens (port 4795) |
| Windows 10 (1.2.0) | `node scripts/qa/win10-compat.mjs` | Static checks: no PowerShell 7 syntax, C# 5 only, csc in Framework64 or Framework, tar with an Expand-Archive fallback, the winget fallback, no Windows 11-only APIs, the installer's message |
| Task Manager and uninstall (1.2.0) | `node scripts/qa/processes-uninstall.mjs` | On throwaway copies: the server runs as `bin\Dayspring.exe` (FileDescription Dayspring, Dayspring's version) over `Dayspring Server.exe`; Settings → About lists the parts; Stop ends all of them and no other node.exe; uninstall keeping or removing data (stand-in Start menu, desktop, Startup, LocalAppData and Recycle Bin), the typed-name check, Lantern's files kept; refused on the source copy (ports 4788-4791) |
| Tool names are unique (1.1.2) | `node scripts/qa/tool-names.mjs` | Every tool offered to the AI has a different name (a clash makes the provider refuse every request) |
| UI fixes (1.0.2) | `node scripts/qa/ui-regress.mjs` | The Schedule never slides sideways (laptop and phone widths) and a closed drawer can’t be tabbed into; a double-clicked Save adds one item; fast view switching never draws an old view; an overnight item is saved as two linked halves, shown with its real times and deleted as one; a faded toast lets clicks through; Fit to screen by keyboard never saves by surprise; Esc closes only the top overlay; a skipped setup step never speaks over the next; Settings saves a section when you leave it; Help clears one-letter searches and names unknown pages; the year view and device list are fast (port 4796, speech mocked, device calls intercepted) |
| Default voices | `node scripts/qa/voice-defaults.mjs` | With no keys, the free-voice list picks Ava → Jenny → Aria → … → Zira for Dayspring and Andrew → Brian → Guy → David for the guide (mocked `getVoices()`); Matilda, Will and coral on the server |
| Privacy scan | `node scripts/privacy-scan.mjs <export folder>` | No owner words, paths, keys, emails or phone numbers in what ships |
| Docs | `node scripts/gen-dev-docs.mjs` | The code map and API reference match the code |
| The guide and the helper | `node scripts/qa/docs-help.mjs` (`--module` for the quick part, `--shots` to retake the README screenshots) | Every guide page loads and renders in /help; every link, section and picture resolves (GitHub and /help); "how do I …" finds the right page for 20 questions; the screen opens the guide and says the steps; Settings and the setup link to their guide pages. Runs on a throwaway copy with demo data (port 4720-4729) |

The maintainer's own install also has `scripts/audit.mjs`, 80+ behaviour checks against a real schedule on a test port. It backs `data/` up and restores it byte-for-byte. It isn't in the public repo, because it tests against the maintainer's personal data.

## Writing a UI test

- Start a server on a spare port with its own data: `PORT=4790` and `DAYSPRING_DEVICES_DRYRUN=1`, plus a copied or empty `data/` folder.
- Drive `/display` with `playwright-core` (`chromium.launch({ channel: "chrome", headless: true, args: ["--mute-audio"] })`).
- An automated page never turns on the microphone (`navigator.webdriver`), so it can't hear the room.
- **Test hooks on the screen** (dispatch these as `CustomEvent`s on `window`):
  - `ds-test-say` runs a screen command (for example "show me the weather")
  - `ds-test-ask` sends a message as if spoken
  - `ds-test-final` injects a recognised phrase
  - `ds-test-alarm` shows the alarm
  - `ds-test-alert` shows a snoozable pop-up
- **Intercept anything that would change the owner's world** with `page.route()`: settings, devices, `/api/snooze`, `/api/window`, `/api/media/stop`. Never play real sound, never change devices, never send messages.

## Checking layouts

`public/layout.js` guarantees nothing spills. To check it, load `/display?os=<margin>` at several viewport sizes and flag any element whose content box overflows its card or the safe area. The screen-fit work used 8 sizes × 4 margins × 5 states.
