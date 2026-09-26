# Updating

New versions of Dayspring are published as **releases** on GitHub. Updating replaces Dayspring's program files. It **never touches your `data` folder or your `.env` keys**, and it makes a backup first.

## Check for updates

Any of these:

- Say **"check for updates"**.
- Open Settings → **Updates** and click **Check now**.
- Double-click **Update Dayspring.cmd** in the Dayspring folder.

Dayspring also checks by itself about once a day, and shows a small note on the screen when a new version is out.

## Install an update

1. In Settings → **Updates**, you'll see the new version number and what changed. Click **Update now**. Or say "yes, update" when Dayspring offers.
2. Dayspring backs up the current version, downloads the new one, and installs it. This takes a minute or two.
3. It restarts by itself. The screen reloads with the new version.

To use **Update Dayspring.cmd** instead:

1. Double-click it. A window shows the current and latest versions.
2. Type **Y** and press **Enter** to update.
3. When it says **Done**, start Dayspring again if it isn't already running.

## "Updates are off"

The first time, you may see *"Updates are off: no update source is set."* The person who shared Dayspring with you publishes the updates, so ask them for the repository name. It looks like `their-name/dayspring`. Enter it in Settings → **Updates** → **Update source** and click **Save**.

## Going back to the previous version

Every update leaves a backup in `backups\` (named by date, with the version number).

1. Close the **Dayspring server** window.
2. Copy the contents of the backup folder over the Dayspring folder.
3. Start Dayspring.

> **If it doesn't work:**
> - **"Couldn't reach GitHub"**: check your internet connection and try again later.
> - **The update stopped partway**: nothing is lost. Run **Update Dayspring.cmd** again, or restore the backup as above.
> - **After updating, it won't start**: open a Command Prompt in the Dayspring folder and run `npm install`, then start it again. If that doesn't help, restore the backup.
