# Claude Code: coding and writing jobs by voice

[Claude Code](https://code.claude.com) is Anthropic's coding assistant. It runs in a terminal and can read, write and change files. Dayspring can hand it jobs:

- **Change Dayspring itself**: "Dayspring, have Claude Code add a countdown to my vacation on the screen."
- **Write things**: "Draft a summary of my notes on the garden project."
- **Open Claude Code for you** in a project folder: "Open Claude Code in my Recipes project." (This needs an AI brain.)

This is optional and meant for people comfortable with a little tinkering.

## What you need

- A **Claude Pro, Max, Team or Enterprise** subscription, or an Anthropic **Console** account with credits. The free claude.ai plan doesn't include Claude Code.
- Windows 10 (version 1809 or later) or Windows 11.

## Install Claude Code

1. Open **PowerShell**: press the Windows key, type `powershell` and press **Enter**. The prompt starts with `PS C:\`.
2. Paste this line and press **Enter**:
   ```powershell
   irm https://claude.ai/install.ps1 | iex
   ```
   You don't need to run as Administrator.
3. Close PowerShell and open a new one, so Windows notices the new command.
4. Check it worked:
   ```powershell
   claude --version
   ```
   You should see a version number like `2.1.211 (Claude Code)`.

> **Tip:** Other ways to install:
> - In **Command Prompt**: `curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd`
> - With **WinGet**: `winget install Anthropic.ClaudeCode`. WinGet installs don't auto-update, so run `winget upgrade Anthropic.ClaudeCode` now and then.
> - With **npm** (Node 22+): `npm install -g @anthropic-ai/claude-code`

> **Tip (optional):** Install [Git for Windows](https://git-scm.com/downloads/win) as well. Claude Code then gets a Bash shell, which some tasks go smoother with. Without it, Claude Code uses PowerShell.

## Sign in

1. In PowerShell, type `claude` and press **Enter**.
2. A browser window opens. Sign in with your Claude account (or your Console account) and approve.
3. Back in PowerShell, you'll see Claude Code's prompt. Type `/exit` to leave.

That's it. Dayspring uses the same sign-in.

> **If it doesn't work:**
> - **`'claude' is not recognized`**: open a *new* PowerShell window. If it still fails, run the installer again and read any error it prints.
> - **`'irm' is not recognized`**: you're in Command Prompt, not PowerShell. Use the Command Prompt line in the tip above.
> - **Anything else**: run `claude doctor`. It checks the install and suggests fixes.

## Turn it on in Dayspring

1. Open Settings → **Features** and turn on **Claude Code**.
2. Test it: say "Dayspring, have Claude Code add a small ☀ next to the clock."

## How it works (and the guard rails)

1. You ask: "Dayspring, have Claude Code make the clock bigger."
2. Dayspring **reads the job back** and asks "Go ahead?". Nothing happens until you say **yes**.
3. Dayspring **backs up its code** to the `backups` folder, then starts Claude Code in the background.
4. Claude Code makes the change inside the Dayspring folder and checks its work.
5. Dayspring tells you what changed and offers to **restart** so you can see it.

While it's working:

- "How's it going?" gives you a status update.
- "Stop coding" stops it. The backup is still there.
- "Also make it gold" continues the same job.

Guard rails:

- Claude Code works only inside the Dayspring folder.
- It can't read `.env` or other secret files.
- Its shell commands are limited.
- Every job starts with a backup.
- Opening Claude Code in "skip permissions" mode for another project always needs your spoken confirmation, naming the folder.

## Undoing a change

Backups are in the `backups\dayspring-code\` folder, one per job, named by date and time. To roll back:

1. Stop Dayspring: press **✕** at the top of its screen, then **Quit Dayspring** (or double-click **Stop Dayspring.cmd**).
2. Copy the files from the backup folder over the Dayspring folder.
3. Start Dayspring again.
