# Testing

Dayspring has no test framework dependency. Tests are small Node scripts that drive the real server and a headless browser (Playwright, which is already a dependency).

## Before every release

| Check | Command | What it proves |
|---|---|---|
| Syntax | `node --check` on every `.mjs`/`.js` | Nothing fails to load |
| Fresh-install QA | `node scripts/qa-fresh-install.mjs` (when present) | The exported copy installs, the guided setup completes as a new user, links work, no page errors |
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
