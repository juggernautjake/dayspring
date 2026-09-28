# Updating

New versions of Dayspring are published as **releases** on GitHub, and Dayspring looks for them by itself. An update replaces Dayspring's program files only. **Your `data` folder (schedule, settings, people, notes) and your `.env` keys are never replaced**, and both are backed up before anything changes. If a new version doesn't start, the previous one comes back by itself.

## How Dayspring tells you

Dayspring checks for a new version when it starts and every few hours after that. When one is out, a card appears at the bottom of the Dayspring screen:

- **What's new**: the list of changes, in plain words.
- **Update now**: installs it right away. Dayspring restarts and is back in about a minute.
- **Next time I open Dayspring**: downloads it now and installs it the next time Dayspring starts (for example, after you restart the computer).
- **When I'm not using it**: downloads it now and installs it by itself after half an hour of quiet. It never installs during an alarm, a call, Tune in, or the half hour before your morning alarm.
- **Not now**: the card goes away. The update waits in Settings → **Updates** until you want it.

Dayspring also says it out loud once: *"There's a new version of Dayspring…"*

## Choose what happens every time

Settings → **Updates** → **When a new version comes out**:

- **Ask me** (the default): the card above, every time.
- **Install it when I'm not using Dayspring**: no card; it updates itself during a quiet time.
- **Install it the next time Dayspring starts**: no card; it updates the next time it starts.

## Production or development

Settings → **Updates** → **Which versions**:

- **Production (stable)** (the default): finished features, plus new ones marked **New** that you can switch off in Settings → **Features**.
- **Development (newest, may have bugs)**: also the features still being built. It takes whichever is newer, a development build or a production release.

Switching from Development back to Production offers to go back to the newest production version straight away. Your data and keys are backed up first, the same as any update. The [feature status](features-status.md) page lists what's in each.

## Check for updates yourself

A **⬆** in the window bar at the top of the Dayspring screen means a new version is ready: click it for **What's new** and **Update now**.

Any of these:

- Say **"check for updates"**. Say **"update Dayspring"** to install one right away.
- Settings → **Updates** → **Check now**, then **Update now**.
- Double-click **Update Dayspring.cmd** in the Dayspring folder. It shows what's new and asks before installing.

## What changed

Settings → **Updates** → **What changed** lists every update that was installed, newest first, with its notes, and whether it worked. You can also ask: **"what's new in Dayspring?"**

## Updating from version 1.0.0

Dayspring 1.0.0 checks for updates but can't show the update card. Update it once by hand:

1. Open the Dayspring folder and double-click **Update Dayspring.cmd**.
2. When it asks *"Install it now?"*, type **Y** and press **Enter**.
3. Dayspring restarts with the new version. From then on, updates come to you as described above.

Your data, keys and downloaded helpers (such as speech recognition) all carry over.

## Your backups

Every update leaves two backups in the `backups` folder inside the Dayspring folder:

- `data-<version>-<date>`: your data folder and `.env`, as they were just before the update.
- `code-<version>-<date>`: the previous version's program files.

The newest five of each are kept.

### Going back to the previous version by hand

If you ever want the previous version back:

1. Stop Dayspring: move the pointer to the top of its screen, press **✕**, then **Quit Dayspring** (or double-click **Stop Dayspring.cmd**).
2. Open `backups\code-<version>-<date>` (the newest one) and copy everything in it into the Dayspring folder, replacing the files there.
3. Start Dayspring.

> **If it doesn't work:**
> - **"I couldn't reach the internet"**: check the connection and try again later. Dayspring tries again by itself every few hours.
> - **"GitHub is limiting requests"**: wait an hour and try again.
> - **"The update couldn't replace Dayspring's files"**: nothing was changed. Restart the computer, then choose **Update now** again.
> - **An update that didn't work**: Dayspring puts the previous version back by itself, and Settings → Updates → What changed says so. Nothing in your data is lost.
