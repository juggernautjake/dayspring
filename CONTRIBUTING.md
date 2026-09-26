# Contributing to Dayspring

Thanks for helping! Dayspring is a friendly home assistant for regular people, so the bar for everything is: **would a non-technical person understand it and feel safe using it?**

## Ways to help
- **Report a bug or ask for help:** open an issue with the "Bug report" or "Help" template. Screenshots and the exact words you said or typed help a lot.
- **Suggest a feature:** use the "Feature request" template. Say what you want to do, not just how.
- **Improve the guide:** the guide is plain Markdown in `docs/`, and the same pages show inside the app at `/help`. Fixes for unclear steps are very welcome.
- **Code:** see below.

## Getting set up
1. Install Node.js 22 or newer and Google Chrome or Microsoft Edge on Windows 10/11.
2. `git clone` this repo, then `npm install`.
3. `copy .env.example .env` (add keys only if you're working on AI or voice features).
4. `npm run dev` restarts on changes. Open http://localhost:4747/welcome for the guided setup, or http://localhost:4747/display for the screen.

Read [docs/dev/architecture.md](docs/dev/architecture.md) first, then [docs/dev/extending.md](docs/dev/extending.md) for recipes (a voice command, an AI tool, a connector, a showcase slide, a setting). Every file and every API route is listed in the [code map](docs/dev/code-map.md) and the [API reference](docs/dev/api-reference.md).

## Rules of the house
- **Nothing personal in code.** Names, places, schedules and preferences belong in `data/` (which is never committed). `node scripts/privacy-scan.mjs .` must pass.
- **Privacy and safety first:**
  - Anything that sends, posts, buys or deletes asks first.
  - Never change the Windows default speaker or microphone.
  - Respect `lib/permissions.mjs` for every file, program, browser and web action.
- **Works without AI.** Core features (schedule, reminders, music, documents read aloud…) must keep working in free mode.
- **Plain words for users.** No jargon, stack traces or file paths in anything a user sees, and every error says what to do next.
- **No build step, few dependencies.** Plain ES modules. Add a dependency only when it clearly earns its place.
- **Every file starts with a comment** saying what it does. The code map is generated from it (`node scripts/gen-dev-docs.mjs`).
- **Test UI changes** headless with the screen's test hooks, and never play real sound or touch real devices in tests (see [docs/dev/testing.md](docs/dev/testing.md)).

## Pull requests
- Keep them focused. Describe what changed and how you tested it (the PR template asks).
- Update the guide in `docs/` when behaviour changes, and add a line to `CHANGELOG.md`.
- By contributing you agree your work is released under the MIT License (see `LICENSE`).

Be kind; see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
