# Google Drive

Dayspring can search, read and play what's in your Google Drive, and you can connect several Google accounts at once (for example a personal one and a work one).

## Setting it up

Google Drive uses the same Google connection as Calendar and Gmail (see [Connecting apps](connections.md#google-calendar--gmail)). If you connected Google before, only steps 1, 2 and 4 are new.

1. **Turn on the Google Drive API** in your Google Cloud project: open the [Drive API page](https://console.cloud.google.com/apis/library/drive.googleapis.com), check that your "Dayspring" project is selected at the top, and click **Enable**.
2. **Add the scopes** to the consent screen: [Google Auth Platform → Data Access](https://console.cloud.google.com/auth/scopes) → **Add or remove scopes**. Tick `drive.readonly`. Tick `drive` too only if you'll let Dayspring add and change files. Click **Update**, then **Save**.
3. **Test users:** on [Audience](https://console.cloud.google.com/auth/audience), add every Google address you'll connect, work and personal. (If you've published the app, you can skip this.)
4. In Dayspring, open **Settings → Apps & connections → Google**. Your account is already there if you connected Google before: tick **Drive** next to it. Google opens a page asking to let Dayspring see your Drive; say yes.
5. **Another account?** Press **Add another Google account**, sign in with it, and choose what it's used for.

## Several accounts

Each account in **Settings → Apps & connections → Google** has:

- **Calendar, Gmail and Drive** switches. Turn on only what you want. Turning one on for the first time opens a Google page asking for just that.
- **A nickname** like "Work" or "Personal", so you can say "search my work drive" or "check my work email".
- **Make primary.** Calendar and Gmail use the primary account unless you name another. Drive searches look in every account that has Drive on.
- **Remove.** Only that account is removed; the others stay. Dayspring also withdraws its sign-in at Google.

Settings only ever shows the email address. The sign-ins are encrypted with your Windows account (Windows' own protection, DPAPI), so a copy of the file is useless on another computer or to another user.

Your first Google account (from before several accounts were possible) became account 1 automatically, with the same Calendar and Gmail access it had.

## What you can say

- "Search my Drive for the budget", "find the Q3 report in my work drive"
- "What changed in my Drive this week?", "show my recent Drive files"
- "Read me the Q3 report", "summarize the budget spreadsheet" (with an AI brain)
- "Play the wedding video from my drive", "play Wedding March from my work drive"
- "Show me the team photo from my Drive"
- "Save this to my Drive", "upload the report to my work drive", "make a folder called Projects" (needs the write switch, below)
- "Download the budget to my Documents folder"

Results show as a numbered list on the Dayspring screen, labelled with the Drive they're in. In "play …" searches, your own files come first, then Drive's, unless you name a Drive.

## Reading and playing

- **Google Docs and Slides** are read as text, and **Sheets** as a table (CSV). **PDFs**, **Word files** and **text files** are read too. The words go to the AI only when you ask about that file, the same as documents on your computer. Nothing is kept.
- **Audio and video** in Drive play on the Dayspring screen. Dayspring streams them through itself: the screen never gets your Google sign-in, and skipping around works. They play on Dayspring's speaker like everything else.
- **Pictures** show on the screen. With an AI that can see, "describe it" works too (people in Drive pictures are described, never identified).
- **Shared drives** (Team Drives) and files **shared with you** are included in searches.

## Letting Dayspring change your Drive

It's off for every account until you tick **Let Dayspring add and change files in this Drive** for that account. Google then asks you to allow it (the `drive` permission).

Even then:

- Dayspring **asks before every change**: uploading, making a folder, moving or renaming. It says exactly what it will do and waits for your "yes".
- **Deleting only moves a file to Drive's trash**, where you can restore it for 30 days. It always asks first.
- Every change is written in the activity log (the file's name and size, never its contents).

**Downloading** a Drive file to your computer doesn't need the write switch. Instead it needs file access to create files in that folder (Settings → Permissions), and it asks first. Google Docs, Sheets and Slides download as Word, Excel and PowerPoint files.

## Limits

- Google allows each app a generous number of Drive requests a day. A normal household never gets near it, but very fast repeated searches may be slowed down for a moment.
- Files over 30 MB aren't read as text (play, show or download them instead). Uploads are limited to 100 MB; use Drive itself for bigger ones.
- Google Forms, Sites and other Google-only types can't be read or downloaded. Dayspring gives you the link instead.
- While your Google Cloud app is in **Testing**, Google signs Dayspring out every 7 days. **Publish** it (Audience → Publish app) to stop that.
