# Permissions: what Dayspring may see and do

You decide what Dayspring can reach on your computer. You choose file access during setup (it can't be skipped), and you can change everything later in Settings → **Permissions**.

If Dayspring needs something you haven't allowed, it says so plainly: *"I don't have permission to open programs yet. You can turn that on in Settings → Permissions."* It never quietly works around a permission. These rules are enforced by Dayspring itself, not just by asking the AI nicely.

| Permission | Choices | Starts as |
|---|---|---|
| **Files and folders** | No file access · Only the folders and files I choose · Everything on this computer | No file access (you confirm it during setup) |
| **Ask me before every change** | On · Off | On |
| **Can delete files** | On · Off | Off |
| **Create / edit / rename and move** | On · Off, each on its own | On (only where it may write) |
| **Programs** (apps, terminals, commands) | Off · Ask me first · Allowed | Off |
| **Browser control** | Off · On | Off |
| **Web lookup** | Off · On | On |

## Choosing file access

During setup, the **Permissions** step asks what Dayspring may do with the files on this computer. Nothing is picked for you: **Next** stays grey until you choose one of the three options. **No file access** is marked as recommended if you're not sure, but even that needs a click.

Under the options, a summary shows in plain words what Dayspring **will** be able to do and what it **won't**, and it updates as you change things.

**Updated from an older Dayspring?** Your setting was kept exactly as it was (nothing was widened, and deleting stays off). The Dayspring screen asks you once to confirm it: press **Keep it**, or **Review in Settings** to change it. Settings → Permissions shows the same question until you answer.

## Files and folders

- **No file access**: Dayspring can't look at, open or search your files.
- **Only the folders and files I choose**: add places one at a time. Type or paste a path (like `C:\Users\you\Documents`), use a quick pick (Documents, Desktop, Downloads…), or press **Browse…** to click through your folders. For each place choose:
  - **Read only**: it can find and read what's there, but not change it.
  - **Read & write**: it can also change things there (see below).
  - **Blocked**: keep it out, even when a folder around it is allowed. For example, allow `Documents` but block `Documents\Taxes`.
  - **Include subfolders**: on by default. Turn it off to allow a folder's own files but not the folders inside it.
- **Everything on this computer**: choose **Read only** or **Read & write**. Places you add still refine it, so you can block a folder or make one read only.

The most specific choice wins: a file beats its folder, and a folder beats the folder around it.

With files allowed, you can say things like "find my notes about the garden", "what's in my Recipes folder?" or "read me the packing list in Downloads".

Whatever Dayspring reads is sent to your AI brain, if you use a cloud one (Claude, ChatGPT, Grok), to answer your question. With **Ollama** it never leaves your computer.

## Changing files

These show up once Dayspring may write somewhere:

- **Ask me before every change** (on by default): Dayspring says what it's about to change and waits for your **yes**. Turn it off and it changes ordinary files without asking. Either way it makes a **backup** first.
- **Create new files and folders**, **edit existing files**, **rename and move things**: each can be turned off on its own.
- **Can delete files** (off by default): deleting is its own permission. It's never switched on by "Read & write", and an older Dayspring's settings never turn it on. When it's on, deleted things always go to the **Recycle Bin**, a backup copy of a deleted file is kept too, and Dayspring always asks first.

## Always protected

Whatever you choose, even "Everything, Read & write", Dayspring will **never** change or delete:

- **Windows** itself (including `System32`), **Program Files** and **Program Files (x86)**, and Windows' parts of **ProgramData**
- **Boot and recovery files**, the **registry** (files like `NTUSER.DAT`), and `pagefile.sys` / `hiberfil.sys`
- **Files at the top of a drive** (like `C:\`), and the main folders of the Windows drive
- **Other people's profiles** on this computer (their folders under `C:\Users`)
- **Dayspring's own code and data**, including **its permissions and its activity log**, so it can't change its own safety rules or erase what it did
- The inside of a project's **`.git`** folder
- **Secret files**: `.env` files, keys, certificates, password vaults, SSH keys, and files named like "credentials", "secrets" or "passwords". These aren't even read.

Dayspring checks where a path **really** leads (shortcuts, links and junctions are followed), so a link can't be used to reach a protected place. It also refuses path tricks, such as `..`, network (`\\server\share`) paths, `\\?\` paths, short names like `PROGRA~1`, names ending in a dot or a space, and hidden streams (`file.txt:stream`).

If you ask for one of these anyway, Dayspring explains why it would be a bad idea instead of doing it.

## Important files

Some changes are allowed but risky. Before Dayspring changes, moves or deletes one of these, it tells you **why it might be a bad idea** (what could break), says that **a backup will be made**, and asks **"Are you sure?"**, even when "Ask me before every change" is off:

- Start-up scripts (your **Startup** folder) and **hosts** files
- Shell profiles (`.bashrc`, PowerShell profiles), **Git settings** (`.gitconfig`, `.gitignore`)
- Project files: `package.json` and lockfiles, `.sln` and `.csproj`, `Dockerfile`, build and CI setups
- **Databases** (`.db`, `.sqlite`, `.accdb`…), program files (`.exe`, `.dll`), registry files (`.reg`)
- **Large** files (over 100 MB), files **untouched for over a year**, and **whole project folders**
- Anything in **AppData**, **ProgramData** or the **Public** folder, and anything **outside your usual folders**
- Anything **you marked as important**: Settings → Permissions → **More file safety**, one path per line

Only a clear **yes** from you counts, by voice or typed, and only for that exact change, within two minutes. The AI can't say yes for you: if it tries to change something different from what you agreed to, it's stopped. A **no** cancels it.

## Many files at once

A change that touches more than **25 files** (for example moving a big folder) always asks first and says how many. **Deleting a folder** always asks and tells you how many files are inside. You can change the number in Settings → Permissions → **More file safety**.

## The activity log

Dayspring keeps a log of **everything it's asked and everything it does**: what you said or typed, what understood it, every tool the AI used, every file it read or listed (just the name), and every file it created, changed, moved, copied or deleted (with its size and fingerprint before and after, and where the backup is). Programs it opened, permission changes, your yeses and nos, and anything it refused (with the reason) are in there too.

- **Where:** on this computer only, in Dayspring's `data\logs\activity` folder, one file per day. It's never uploaded.
- **How long:** at least **120 days**, 180 by default. Change it in Settings → **Activity log** (it can't go below 120). File backups are kept just as long.
- **Private:** keys and passwords are blanked out, and file contents are never written to the log.
- **Tamper-evident:** each line carries a fingerprint of the one before it. Press **Check the log** to make sure nothing was changed or removed. Dayspring itself can't change or erase the log.

Open Settings → **Activity log** to see it: pick the dates, filter (only changes, commands, blocked attempts…), search, and **Export CSV** for Excel. Next to a change that has a backup, **Restore this version** puts back the file as it was before that change (the current version is backed up first, so that can be undone too).

You can also ask:

- "What did you change today?" (or "yesterday")
- "Undo that last change": Dayspring says what it will put back and asks "Are you sure?"
- "Show the activity log"

With an AI brain, Dayspring can also look back through the log itself, for example to check what it changed last week or to recall something you did together.

## Programs

Dayspring can list the programs installed on your computer (from the Start menu, including Store apps) and open them:

- "What programs do I have for photo editing?"
- "Open Spotify on the computer" · "Open Calculator" · "Open Discord"

With **Ask me first**, it asks before each one ("Open Discord?"). Closing a program always needs your yes. The same permission covers opening a **terminal** or **Claude Code**, and opening a file that would *run* something (a script, an installer, a `.reg` file), which always asks first. Starting Claude Code in dangerous mode always asks, and only your own yes counts.

## Browser control

Dayspring can drive **its own** browser window (separate from your everyday browser) to do things on websites for you: open a page, click, fill in a search, and read what's there. For example: "check the library's hours on their website" or "look at my cart on the grocery site".

It will **never** type passwords, card numbers or other sensitive details, and it never signs in for you. When a site needs a sign-in, it shows you the window and you sign in yourself, once. It asks before anything that submits, buys, sends or deletes. It never opens Dayspring's own pages (like Settings) in that window.

## Web lookup

With this on, Dayspring can search the web and read pages to answer questions: "what time does the hardware store close?", "what's a good substitute for buttermilk?". It works with every AI brain. Claude uses its own built-in search, and the others use Dayspring's web lookup. Only http and https pages are opened.

## Changing your mind

Everything is in Settings → **Permissions**. Turning a permission off takes effect immediately, and every change is recorded in the activity log.

> **Tip:** A good starting point is **Only the folders and files I choose** (your Documents, Read & write), **Ask me before every change: on**, **Can delete files: off**, **Programs: ask me first**, **Browser control: on**, and **Web lookup: on**.
