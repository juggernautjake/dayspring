# Install checklist (before you share Dayspring)

Use this before handing a copy of Dayspring to someone else, or before publishing a release. Most of it is automatic. A few things need a real person, a real computer and real accounts.

## 1. Run the automatic check

From the Dayspring folder:

```
node scripts/qa-fresh-install.mjs
```

It exports the generic copy (with the privacy scan), installs it fresh in a temporary folder, starts it on a spare port (4730–4739) with its own empty data and a pretend home folder, then walks through it in a hidden browser. Your own Dayspring, its data, your devices and your accounts are never touched: installs, sign-ins, device changes and key checks are simulated.

| Check | What it proves |
|---|---|
| Node.js 22.13 or newer | The computer can run Dayspring |
| export + privacy scan | Nothing personal is in the copy (names, places, people, keys, phone numbers, folder paths, your own words in `data/privacy-terms.json`) |
| export has no personal data | `data/` holds only `.gitkeep`; no backups, logs, `bin/` or `.env` |
| npm install --omit=dev | A clean install works, with no warnings |
| every dependency loads | Every package (and ffmpeg) is really there |
| server starts | It starts with an empty `.env` made from `.env.example` |
| a new copy opens the guided setup | A first-time user lands on Welcome, not an empty screen |
| guided setup (4 walks) | Claude and no-AI routes, desktop and phone sizes: name and nicknames, AI key walkthrough, voice, week and place, interests and suggested routines, permissions, apps, sound, screen, summary, resume after a reload |
| after setup | The Dayspring screen, every Settings section (in plain words), every Help page, 22 typed commands in free mode, and features that aren't set up yet explaining what to do |
| no server errors | Nothing crashed behind the scenes |
| links | Every web link in Help, the walkthroughs and the installers opens, and every in-app Help link points at a real page and heading |

Options:

- `--quick`: one guided-setup walk instead of four
- `--offline`: skip the web links (the in-app Help links are still checked)
- `--from <folder>`: test an existing export (or a shared copy testing itself: `--from .`) without exporting again
- `--keep`: leave the test copy running afterwards so you can click around in it

When something fails, the folder with screenshots, `server.log` and `qa-report.json` is printed at the end. The parts can also run on their own against a running test copy: `scripts/qa/onboarding.cjs`, `scripts/qa/after-setup.cjs` and `scripts/qa/links.mjs`.

It needs Google Chrome or Microsoft Edge (for the hidden browser) and an internet connection (place search, weather, links).

## 2. Check by hand, on a real computer

These can't be simulated. Do them once per release, ideally on a computer that has never had Dayspring.

- [ ] **Install Dayspring.cmd**: double-click it. It offers Node.js if it's missing, installs, and adds the Start menu and desktop shortcuts. Say yes to "Start now?".
- [ ] **Welcome** opens in the browser by itself and the guide speaks.
- [ ] **A real AI key**: paste one and press Test. Then ask something in your own words.
- [ ] **Voice**: the free voice speaks; if you have an ElevenLabs key, it's accepted and a voice plays.
- [ ] **Microphone**: say the wake word and a question; it hears and answers.
- [ ] **Sound**: the sound choices list your real speakers and headset; picking one plays there.
- [ ] **Screen**: on a TV or second monitor, the Dayspring screen opens there and fits.
- [ ] **One connection end to end** (Notion is the quickest): follow the walkthrough and see "Connected".
- [ ] **Music**: "play some music" plays (YouTube without Spotify; Spotify if connected).
- [ ] **Updates**: Settings → Updates finds the published release. The update address must be a public repository with at least one release.
- [ ] **Restart**: close Dayspring and start it from the Start menu; everything you set is still there.

## 3. Keep the privacy scan sharp

The scan reads the owner's own data folder for names, places, church and people. Anything else that's yours and shouldn't ship goes in `data/privacy-terms.json` (it stays private): workplaces, hobbies, device models, folder names, family nicknames, and the start of any ID followed by `*` (for example `abc123*`), so the whole ID never has to be written down.

```
{ "terms": ["My Workplace", "my-hobby", "Model-123", "abc123*"] }
```

Run it on its own any time: `node scripts/privacy-scan.mjs`.
