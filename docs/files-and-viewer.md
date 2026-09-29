# Finding files and the file viewer

Ask Dayspring for a file or a picture by its name, and it finds it and opens it right on the Dayspring screen, in one viewer that handles pictures, videos, songs, PDFs, text and code, Word, Excel, PowerPoint and zip files. It only looks in folders you've allowed in **Settings → Permissions**, and it doesn't need an AI to do it.

> **New:** this is a beta feature. You can switch it off in **Settings → This app → Features** ("Finding files and the file viewer").

## What you can say

- "Find my resume"
- "Open the PDF called lease agreement"
- "Show me the picture named IMG_5782" (or "IMG underscore five seven eight two")
- "Find the video from Sarah's wedding"
- "Open last week's budget spreadsheet"
- "Find photos from the lake"
- "Find the invoice in Downloads", "find pictures from June 2024", "open the latest PDF"

Dayspring forgives typos ("resumee", "leese agreement"), numbers said out loud ("fifty seven eighty two", "twenty twenty four"), "underscore", "dash" and "dot pdf", and words for the kind of file ("picture", "PDF", "spreadsheet", "presentation", "video", "zip"). It understands dates ("from yesterday", "last week", "last month", "from 2024", "from June 2024") and folders ("in Downloads", "in my Pictures folder", "in the Finance folder").

For photos, it also looks at what you've told Dayspring about them (the photo catalogue, see [Photos](photos.md)), and at the description and the text in a picture once the viewer has described it (**⋯ → Describe it and read its text**). For songs and videos it uses their tags, the same way as [Your own music and videos](media-library.md).

### What happens next

- **One clear match** opens straight away: "Opening Lease Agreement.pdf from Documents."
- **Several matches** show a numbered list on the screen, with a small picture, the folder, the size, the date and the type. Say "number 2" (or "the first one"), press a number key, or click one.
- **Nothing found:** Dayspring says so, suggests names that are close ("Did you mean Lease Agreement.pdf?"), says which folders it looked in, and how to let it look in more.

Afterwards you can say "show it in the folder" (File Explorer opens with the file selected) or "open it in the default app" (Word, Photos, your PDF reader…). Opening another program needs the **Programs** permission, and asks first when Programs is set to "ask". Something that runs when it's opened (a script, an installer) always asks.

**Google Drive:** when your Drive is connected and nothing on the computer matches (or you say "in my Drive"), Dayspring also searches Google Drive. Those results are marked **☁ Google Drive**. Pictures, videos and songs open in the viewer; other Drive files open in Drive.

**The search box:** the list has a search box at the top. Type part of a name (and pick a kind if you like) to search as you would out loud.

## Which folders it looks in

Only where file access allows reading, right now:

- **Only the places I pick:** the folders (and single files) you added.
- **Everything on this computer:** your own folders (Desktop, Documents, Downloads, Pictures, Music, Videos and OneDrive) and any folders you added. Whole drives aren't searched by name.
- A folder set to **Keep out** is never looked in, even inside an allowed one.
- **Never, in any setting:** files that look like they hold passwords or keys (password lists, `.env` files, SSH keys, wallets), names and folders that look private (taxes, bank statements, medical, insurance, "Private"…), hidden and system folders, and program folders.

Dayspring keeps a small list of file **names** (never their contents) so it can answer quickly. It's updated in the background every few hours, a little at a time, and only folders that changed are looked at again. If you take a permission back, those files stop showing up and stop opening at once, even though they were listed before.

## The viewer

One window for every kind of file. Drag its title bar to move it, drag the corner to resize it, double-click the title bar (or press **F**, or ⛶) to fill the screen. It always stays inside the screen's margins (Settings → Screen). **◀ ▶** go through the other files in the same folder, or the other matches. **ℹ** shows the information panel, and **⋯** has: open in the default app, show in folder, download, save a copy, set as avatar (pictures), describe it (pictures), summarize it with the AI, and delete.

| Kind | What you can do |
|---|---|
| **Pictures** (JPG, PNG, GIF, WebP, BMP, SVG, AVIF, and HEIC/TIFF through Windows) | Zoom (wheel, pinch, + −, Fit, 100%), drag to move around, rotate, flip, a slideshow every 3–30 seconds, copy, save a copy, set as avatar. The info panel shows the date taken, the camera, the size in pixels and in bytes, what you told Dayspring about it, and its description and text once described. |
| **Video and audio** (MP4, WebM, MOV, MKV, MP3, M4A, FLAC, WAV, OGG…) | Play/pause, seek, back and forward 10 seconds, speed (0.5–2×), volume, captions (a `.srt` or `.vtt` file with the same name next to the video), loop, picture-in-picture, full screen. WMV, AVI, WMA and other formats the screen can't play are converted as they play (with Dayspring's ffmpeg). |
| **PDF** | Page thumbnails, page by page, zoom, fit width or page, rotate, search in the document, print, download, and **Read aloud** (the page's text in Dayspring's voice, then the next page). |
| **Text and code** (TXT, LOG, JSON, JS, PY, CSS, HTML, SQL, PS1 and many more) | Colour highlighting, word wrap, search, text size, copy. JSON can be pretty-printed. |
| **Markdown** | Shown as a formatted page (headings, lists, tables), or as its source. |
| **CSV and Excel** (CSV, TSV, XLSX, XLS, ODS) | A table: click a column to sort it (numbers sort as numbers), type to show only matching rows, tabs for each sheet. The first 2,000 rows and 60 columns are shown. |
| **Word** (DOCX; DOC, RTF and ODT as text) | The document with its headings, lists, tables and pictures, text size, search, read aloud. |
| **PowerPoint** (PPTX) | Each slide's title, text, pictures and speaker notes, slide by slide. The slide design isn't reproduced: open it in PowerPoint for that. |
| **Zip** | The list of files inside, with sizes and dates. A small file inside (up to 25 MB) opens right in the viewer. |
| **Anything else** | A card with its name, type, size and date, and **Open in the default app**, **Show in folder** and **Download**. |

### Where a picture is saved

Under every picture from your computer the viewer shows **📂** and its folder as clickable parts (**Documents › Trip Photos**), with **📂 Open file location** (File Explorer opens with the picture selected) and **🖼 View in gallery** (the [photo gallery](photos-and-people.md#the-photo-gallery), on this picture, with the rest of its folder). Clicking a folder name opens the gallery on that folder. A **filmstrip** along the bottom shows the other pictures in the folder (or the other matches): scroll it sideways with the wheel or by dragging, and click one to open it. The list of files found has 📂 and 🖼 on each picture too.

### Keyboard and remote

← → previous and next (a page in a PDF, 10 seconds in a video) · + − zoom · 0 fit · 1 actual size · R rotate (Shift+R the other way) · H flip · F full screen · I information · S slideshow · Space play/pause · / search · Delete ask to delete · Esc close. Every button can be reached with Tab and pressed with Enter.

### By voice, while it's open

"Next", "previous", "zoom in", "zoom out", "fit to screen", "rotate", "rotate left", "flip", "start slideshow", "stop slideshow", "page 5", "read this page", "stop reading", "search for rent", "full screen", "show the info", "pause", "play", "delete this" (it asks first), "close".

## Deleting, copying and the avatar

- **Delete** moves the file to the Recycle Bin, never deletes it for good, and a backup copy is kept. It only works when **Can delete files** is on in Settings → Permissions, and it always asks "Are you sure?" first.
- **Save a copy** makes "Name (copy).ext" next to it. It needs **Can create files** there.
- **Set as avatar** makes the picture Dayspring's avatar (Settings → Look & feel).

## Privacy

- Files are only ever asked for by an id Dayspring gave out, never by a path, and every request checks the permissions again (links and junctions are followed to where they really lead, and path tricks are refused).
- Every file opened or viewed is in the activity log (the path, never what's inside).
- Nothing in a file goes to the AI unless you ask something about it ("summarize this PDF"), and only with the AI you chose. With **No AI**, nothing goes anywhere. Describing a picture uses the AI only when "Describe images with AI" is on in Settings → Photos.
- Files in a web page, an SVG or a Markdown file never run their scripts: they're shown, not run.

## If something doesn't work

- **"I couldn't find …"**: check which folders it said it looked in. Add the folder in **Settings → Permissions** with **Can look**. A file whose name or folder looks private (taxes, bank, medical, "Private"…) is never found on purpose.
- **A HEIC photo won't show**: Windows needs Microsoft's free "HEIF Image Extensions" (and "HEVC Video Extensions" for iPhone photos) from the Microsoft Store. "Open in the default app" still works.
- **A video won't play**: formats the screen can't play are converted by ffmpeg; if that isn't installed, use "open it in the default app".
- **A PDF with a password** can't be opened in the viewer. Open it in the default app.
- **Printing**: the 🖨 button prints from the app window when the browser allows it. Otherwise download it, or open it in the default app, and print from there.

See also: [Files, programs and the browser](files-and-browser.md) · [Permissions](permissions.md) · [Documents](documents.md) · [Your own music and videos](media-library.md) · [Photos](photos.md)
