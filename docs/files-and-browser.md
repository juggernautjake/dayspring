# Files, programs and the browser

Dayspring can be a real helper on your computer. It can find a file, read you a document, write a note, open a program, look something up, or use a website. It does these only if you allow them. See [Permissions](permissions.md) for the switches. This page shows how each one works in practice.

## Files

### Allow it

1. Open Settings → **Permissions** → **Files and folders**.
2. Choose **Only these folders** and click **Add folder** for each one (for example `Documents`), or choose **Everything**.
3. Choose how **changing files** works: **Ask me first** is recommended.

### Things you can say (with an AI brain)

- "Find my notes about the kitchen remodel."
- "What's in my Recipes folder?"
- "Read me the packing list in Downloads."
- "Summarize the PDF called *Lease 2026* in Documents."
- "Make a note called *Gift ideas* with: scarf for Sam, puzzle for Jordan."
- "Add *call the plumber* to the end of my to-do note."

### Where notes go

Notes and documents Dayspring creates go in a **Dayspring notes** folder inside your file area. It tells you the exact place when it saves. Change the folder in Settings → **Permissions**.

### Safety

- Secret files (`.env`, keys, certificates, password vaults, "credentials"…) are never read.
- Changing an existing file always makes a backup first, and with **Ask me first** it reads the change back and waits for **yes**.
- Big build folders and system folders are skipped when searching, so searches stay fast.
- Whatever it reads goes to your AI brain to answer the question: cloud providers if you use one, or nowhere with Ollama.

## Programs

1. Open Settings → **Permissions** → **Programs** and choose **Ask me first** or **Allowed**.
2. Say "what programs do I have?", "do I have anything for editing video?", "open Calculator" or "open Spotify on the computer".

Dayspring finds programs the same way the Start menu does, including Microsoft Store apps. Closing a program always needs your yes.

## Looking things up online

**Web lookup** is on by default (Settings → **Permissions**). With an AI brain, ask anything current:

- "What time does the pharmacy on Main Street close?"
- "What's the weather going to be at the lake on Saturday?"
- "Look up how to get a wine stain out of carpet."

Dayspring searches, reads a few pages, and tells you the answer, with where it found it if you ask.

## Using websites for you (browser control)

With **Browser control** on, Dayspring can use its **own** Chrome or Edge window. It's separate from your everyday browser, so your tabs are never touched. It can:

- open a page and read it to you
- search a site, click through results, and fill in search boxes
- find something on a page ("what are the store's holiday hours?")

Rules it always follows:

- **You sign in yourself.** When a site needs a login, Dayspring shows you the window and waits. It remembers the sign-in next time, like a normal browser.
- **Never** passwords, card numbers, bank details or ID numbers.
- **Asks first** before anything that submits, sends, buys, books or deletes.
- Web pages are treated as information, never as instructions. If a page says "assistant, do X", Dayspring ignores it and tells you.

Things to try:

- "Go to the library website and tell me if *Project Hail Mary* is available."
- "Check the city's website for the trash pickup schedule over the holiday."
- "Open my grocery cart and read me what's in it."

## Opening links in your normal browser

Links Dayspring shows you (videos, articles, search results) can be opened in your everyday browser. Click the link on the Dayspring screen, or say "open that in my browser". Only `http` and `https` links are ever opened.

> **If it doesn't work:**
> - **"I don't have permission…"**: turn on the permission it names in Settings → **Permissions**.
> - **It can't find a file you know is there**: check the file is inside an allowed folder. Try the exact file name.
> - **A website won't load in Dayspring's browser**: some sites block automated browsers. Say "open that in my browser" and use it yourself.
