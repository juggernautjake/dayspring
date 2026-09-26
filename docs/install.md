# Installing Dayspring

This takes about ten minutes. Most of that is waiting for downloads.

## Step 1: Get Dayspring

You don't need a GitHub account, and you don't need to know anything about GitHub.

1. Click this link: **[⬇️ Download Dayspring](https://github.com/juggernautjake/dayspring/releases/latest/download/Dayspring.zip)**. The download (about 4 MB) starts right away. It's always the newest version.
   - If your browser asks what to do with the file, choose **Save** or **Keep**.
2. Open your **Downloads** folder (press **Windows key + E**, then click **Downloads** on the left).
3. Right-click **Dayspring.zip** and choose **Extract All…**.
4. For the destination, pick a permanent home. Typing `C:\Dayspring` in the box works well. Click **Extract**. A window opens showing the Dayspring files.

> **Tip:** Don't run Dayspring from inside the zip file. Extract it first, somewhere you'll keep it. Updates are installed into that same folder.
>
> **Prefer to look around first?** Every version and its notes are on the [releases page](https://github.com/juggernautjake/dayspring/releases). Under **Assets**, click **Dayspring.zip**. (Ignore the "Source code" files.)

> **Tip:** Don't run Dayspring from inside the zip file or from your Downloads folder. Extract it somewhere you'll keep it. Updates are installed into that same folder.

## Step 2: Run the installer

1. Open the folder you extracted and double-click **Install Dayspring.cmd**.
2. If Windows shows **"Windows protected your PC"**, click **More info**, then **Run anyway**. Windows shows this for any script it hasn't seen before.
3. A black window opens and checks your computer:
   - **Node.js 22 or newer** is the engine Dayspring runs on. If it's missing or too old, the installer asks: *"Install Node.js LTS now with winget? (Y/N)"*. Type **Y** and press **Enter**. Approve the Windows prompt if one appears.
   - Next it downloads Dayspring's parts (`npm install`), which takes a minute or two.
   - It creates your private settings file, `.env`.
   - It adds a **Dayspring** shortcut to your Start menu and desktop.
   - It asks *"Start Dayspring when Windows starts? (Y/N)"*. Choose what you like. You can change it later.
4. When it says **"Dayspring is installed"**, press any key to close the window.

> **If it doesn't work:**
> - **"winget is not recognized"**: install Node.js yourself. Go to [nodejs.org](https://nodejs.org), click the **LTS** download, run it, and accept the defaults. Then run **Install Dayspring.cmd** again.
> - **"npm ERR! network"**: check your internet connection and run the installer again. It picks up where it left off.
> - **The window flashes and closes**: right-click **Install Dayspring.cmd** and choose **Open**, or open the folder, type `cmd` in the address bar, press Enter, and type `"Install Dayspring.cmd"`. The error will stay on screen.

## Step 3: Start Dayspring

1. Double-click the **Dayspring** shortcut, or **Start Dayspring.cmd** in the folder.
2. A small minimized window named **Dayspring server** appears on the taskbar. That's Dayspring running. Leave it open. Closing it stops Dayspring.
3. The Dayspring screen opens full screen. The first time, you'll see the **setup wizard** instead. See [The setup wizard](setup-wizard.md).
4. When the browser asks to use your microphone, click **Allow**.

> **Tip:** To leave the full-screen view for a moment, press **Alt+Tab**. To close it, press **Alt+F4** while it's in front. Starting Dayspring again brings it back.

## Step 4 (optional): Microsoft Edge natural voices

Dayspring opens its screen in Google Chrome if you have it, otherwise in Microsoft Edge. The free **"Natural"** voices (Aria, Jenny, Guy and others) are built into Edge. If you want them, see [Voices](voices.md#free-voices).

## Uninstalling

1. Close the **Dayspring server** window.
2. If you chose "start with Windows", press **Win+R**, type `shell:startup`, press **Enter**, and delete the **Dayspring** shortcut there.
3. Delete the Dayspring shortcuts from the desktop and Start menu.
4. Delete the Dayspring folder.

> **Warning:** The `data` folder inside Dayspring holds your schedule, people, notes and photo catalogue. Copy it somewhere safe first if you might want it again.

## Moving to a new computer

1. Install Dayspring on the new computer (steps 1 and 2).
2. Close Dayspring on both computers.
3. Copy the `data` folder and the `.env` file from the old Dayspring folder into the new one. Replace the files when asked.
4. Start Dayspring on the new computer.
