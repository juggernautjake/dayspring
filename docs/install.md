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

1. Double-click the **Dayspring** shortcut on your desktop or in the Start menu. (Or **Start Dayspring.cmd** in the folder: its small window closes by itself.)
2. Dayspring runs quietly in the background. There's no command window to keep open.
3. The first time, the **guided setup** opens in your browser. See [The guided setup](setup-wizard.md). After that, the Dayspring screen opens in its own window: full screen on a TV or second monitor, or an app window on this screen.
4. When the browser asks to use your microphone, click **Allow**.

Starting Dayspring again while it's running never opens a second copy: its window just comes back to the front.

> **Tip:** To leave the full-screen view for a moment, press **Alt+Tab**. Move the pointer to the top edge of the Dayspring screen for its window buttons: sound, full screen, minimize, maximize, hide and **✕**.

## Stopping Dayspring

Move the pointer to the top edge of the Dayspring screen, press **✕**, then choose:

- **Close the screen**: the window closes, and Dayspring keeps running in the background. Alarms and reminders don't sound until you open it again with the Dayspring icon.
- **Quit Dayspring**: stops it completely.

You can also double-click **Stop Dayspring.cmd** in the folder, or **Stop Dayspring** in the Start menu.

## Step 4 (optional): choose the browser

Dayspring uses your **default browser** unless you pick another one in the guided setup or in Settings → **Screen** → **Which browser shows Dayspring?** The list shows the browsers on your computer: Microsoft Edge, Google Chrome, Brave, Firefox, Opera, Vivaldi and others.

- **Edge, Chrome, Brave, Vivaldi**: Dayspring gets its own window (full screen on a second screen), and the microphone works without asking.
- **Firefox**: its own full-screen window too. Allow the microphone once if it asks.
- **Opera and others**: a normal browser window.

The free **"Natural"** voices (Aria, Jenny, Guy and others) come with Microsoft Edge, so Edge gives the nicest free voices. See [Voices](voices.md#free-voices).

## Uninstalling

1. Stop Dayspring (**✕** at the top of its screen → **Quit Dayspring**, or **Stop Dayspring.cmd**).
2. If you chose "start with Windows", press **Win+R**, type `shell:startup`, press **Enter**, and delete the **Dayspring** shortcut there.
3. Delete the Dayspring shortcuts from the desktop and Start menu.
4. Delete the Dayspring folder.

> **Warning:** The `data` folder inside Dayspring holds your schedule, people, notes and photo catalogue. Copy it somewhere safe first if you might want it again.

## Moving to a new computer

1. Install Dayspring on the new computer (steps 1 and 2).
2. Close Dayspring on both computers.
3. Copy the `data` folder and the `.env` file from the old Dayspring folder into the new one. Replace the files when asked.
4. Start Dayspring on the new computer.
