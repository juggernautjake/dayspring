# Permissions: what Dayspring may see and do

You decide what Dayspring can reach on your computer. Open Settings → **Permissions**. Each switch explains itself, and you can change them at any time.

If Dayspring needs something you haven't allowed, it says so plainly: *"I don't have permission to open programs yet. You can turn that on in Settings → Permissions."* It never quietly works around a permission.

| Permission | Choices | Starts as |
|---|---|---|
| **Files and folders** | Off · Only these folders · Everything | Off |
| **Changing files** | Off · Ask me first · Allowed | Ask me first |
| **Programs** | Off · Ask me first · Allowed | Off |
| **Browser control** | Off · On | Off |
| **Web lookup** | Off · On | On |

## Files and folders

- **Off**: Dayspring can't look at your files.
- **Only these folders**: pick folders, for example `Documents\Recipes` and `Pictures`. Dayspring can search and read only inside them.
- **Everything**: your whole user folder (Documents, Desktop, Downloads, Pictures…) and other drives you can open. Windows system folders (such as `C:\Windows` and `Program Files`) stay read-only.

With files allowed, you can say things like "find my notes about the garden", "what's in my Recipes folder?" or "read me the packing list in Downloads".

Always protected, whatever you choose:

- **Secret files are never read.** That covers `.env` files, keys, certificates, password vaults, and files named like "credentials" or "secrets".
- Whatever Dayspring reads is sent to your AI brain, if you use a cloud one (Claude, ChatGPT, Grok), to answer your question. With **Ollama** it never leaves your computer.

## Changing files

- **Ask me first** (recommended): Dayspring tells you exactly what it will write or change and waits for **yes**. It makes a backup first.
- **Allowed**: it can write new files without asking. Replacing or editing an existing file still makes a backup first.
- **Off**: read-only.

## Programs

Dayspring can list the programs installed on your computer (from the Start menu, including Store apps) and open them:

- "What programs do I have for photo editing?"
- "Open Spotify on the computer" · "Open Calculator" · "Open Discord"

With **Ask me first**, it asks before each one ("Open Discord?"). Closing a program always needs your yes.

## Browser control

Dayspring can drive **its own** browser window (separate from your everyday browser) to do things on websites for you: open a page, click, fill in a search, and read what's there. For example: "check the library's hours on their website" or "look at my cart on the grocery site".

It will **never** type passwords, card numbers or other sensitive details, and it never signs in for you. When a site needs a sign-in, it shows you the window and you sign in yourself, once. It asks before anything that submits, buys, sends or deletes.

## Web lookup

With this on, Dayspring can search the web and read pages to answer questions: "what time does the hardware store close?", "what's a good substitute for buttermilk?". It works with every AI brain. Claude uses its own built-in search, and the others use Dayspring's web lookup. Only http and https pages are opened.

## Changing your mind

Everything is in Settings → **Permissions**. Turning a permission off takes effect immediately.

> **Tip:** A good starting point is **Files: only these folders** (your Documents), **Changing files: ask me first**, **Programs: ask me first**, **Browser control: on**, and **Web lookup: on**.
