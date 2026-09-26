# Extending Dayspring

Recipes for the most common additions. Keep to the house style:
- plain ES modules, no build step
- one feature per `lib/` file, with a header comment saying what it does (the [code map](code-map.md) is generated from it)
- data in `data/<feature>.json`, nothing personal in code
- friendly words for users

## Add a voice command that works without AI

1. Write a `handle(text)` function in the feature's module (or a new `lib/<feature>skills.mjs`). It returns a reply string (or `{ reply, open, speed }`), or `null` when the text isn't for it. Keep the regex specific. Commands are checked in order, so a loose pattern steals other people's phrases. Don't match "back to normal", "stop" or "yes" on their own unless your feature is clearly the one active.
2. Call it from `chat()` in `lib/assistant.mjs`, next to the other local skills:
   ```js
   { const r = await myskills.handle(userText).catch(() => null); if (r) { history.push({ role: "user", content: userText }, { role: "assistant", content: r }); return { reply: r, history: safeTrim(history), changes: [], usage: null }; } }
   ```
3. Commands that only affect the screen (pause, scroll, open a panel) can be handled in the page instead. Register them on `window.dsLocal` from an add-on script, and they answer instantly.
4. Add the phrases to [Talking to Dayspring](../talking-to-dayspring.md).

## Add an AI tool

1. Export `TOOLS` (Anthropic-style definitions: `name`, `description`, `input_schema`) and `runTool(name, input)` from your module. `runTool` returns a result object, or `undefined` when the name isn't one of yours.
2. Wire it into `lib/assistant.mjs`: add `...(myskills.TOOLS ?? [])` in `toolsFor()`, and at the top of the tool runner add `{ const r = await myskills.runTool(name, input); if (r !== undefined) return r; }`.
3. Write the description for **any** model (Claude, GPT, Grok, Llama): say when to use it, what each field means, and any confirmation rule ("the first call returns a question; call again with confirmed true only after the owner says yes"). Keep schemas flat.
4. If it touches files, programs, the browser or the web, check `permissions.check(kind, target)` first and return `{ denied: true, text }` when it isn't allowed.

## Add a connector (an outside app)

Look at `lib/connectors/notion.mjs` (token-based) and `google.mjs` / `microsoft.mjs` (OAuth with PKCE and a loopback redirect):
1. `lib/connectors/<app>.mjs`: connect, status and disconnect, plus the calls. Store tokens with `lib/connectors/store.mjs` (in `data/connectors/<app>.json`).
2. Add a guide to `lib/connectors/guides.mjs`: `steps[{text, link, linkLabel, copy}]` and `fields[{key, label, secret}]`. The guided setup and Settings render it automatically.
3. Add tools and phrases in `lib/connectors/index.mjs` (`TOOLS`, `runTool`, `handle`, `contextText`).
4. Never request "send" permissions for messages. Drafts are fine, and the owner sends them.
5. Document it in [Connecting apps](../connections.md).

## Add a showcase slide

In `public/tv.js`:
1. Add the slide to `VIEWS` (a title and a container element in `tv.html`).
2. Add it to `ROTATION`, and to `VIEW_FEATURE` if it belongs to an optional feature.
3. Render it in `renderShow()`.
4. Give its words to `textFor()` so the assistant knows what "coming up next" will say.

The screen log picks the slide up automatically when it's shown.

## Add a setting

1. Add it to `DEFAULTS` in `lib/settings.mjs`, with clamping in `set()`, and optional voice phrases in `parse()`.
2. Read it on the screen from `prefs`, which updates live through the `settings` event.
3. Show it in `public/setup.js` (Settings) and, if it's first-run material, in `public/welcome.js`.
4. Document it in the [Settings reference](../settings-reference.md).

## Add or change a page of the guide

1. Write it in `docs/` (for users) or `docs/dev/` (for developers) as plain Markdown. The first `# Heading` is its title. Link to other pages as `other-page.md#a-section`, and put pictures in `docs/images/` (lowercase names) as `images/x.png`. The same links then work on GitHub and in the built-in guide.
2. Add its name to `ORDER` in `lib/help-routes.mjs` and to a group in `GROUPS` in `public/help.js` (otherwise it appears under "Other").
3. Add a line for each task it teaches to `docs/tutorials.md` (a bullet with the task in bold, an arrow, then a link to the page and section, like the lines already there). "How do I …?" (`lib/helpskills.mjs`) searches every section, and the tutorial lines help it pick the right one.
4. Run `node scripts/qa/docs-help.mjs --module`: every link and section must resolve and the sample questions must still find their pages.

## House rules
- **Never change the Windows default speaker or microphone.** Dayspring routes its own sound with `setSinkId`.
- **Anything that sends, buys, posts or deletes asks first.**
- **Local dates:** use `toLocaleDateString("en-CA")`, never `toISOString().slice(0, 10)`, which gives tomorrow's date after 7 p.m. in the US.
- **Edit with tools that keep UTF-8 intact.** Windows PowerShell 5.1's `Set-Content` corrupts non-ASCII characters.
