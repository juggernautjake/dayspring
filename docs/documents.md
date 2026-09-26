# Documents: read, summarize and explain

Dayspring can open your documents, read them aloud, summarize them and explain them in its own words. Ask for a full read-through or just the gist.

> **Note:** Dayspring can only open files you've allowed in **Settings → Permissions** (Files). It never opens files that look like they hold passwords or keys.

## What it can read

| Kind | Files |
|---|---|
| Word | `.docx`, and older `.doc` files (if Microsoft Word is installed, it's used for any `.doc` the built-in reader can't handle) |
| PDF | `.pdf` with a text layer (a scanned PDF has no text; save a page as a picture instead) |
| PowerPoint | `.pptx`, slide by slide, with speaker notes |
| Spreadsheets | `.xlsx`, `.xls`, `.csv`, `.ods`: the first 400 rows of each sheet, row by row with the column names |
| OpenDocument | `.odt`, `.odp`, `.ods` |
| Other text | `.rtf`, `.txt`, `.md`, `.html`, `.xml`, `.json`, saved emails (`.eml`) |
| Pictures of text | `.png`, `.jpg` and similar, using the text recognition built into Windows |

Very long documents are read up to about 400,000 characters (a few hundred pages), and Dayspring tells you if it stopped short.

## How to ask

Describe the document the way you'd describe it to a person. Dayspring looks in Downloads, Documents, Desktop and OneDrive first, then everywhere else you've allowed:

- "Open my resume."
- "Read me the lease agreement."
- "Open the bulletin in Downloads."
- "Read the Word doc I edited yesterday."
- "Summarize the budget spreadsheet."
- "What's in the PDF I downloaded this week?"

If a few files match, Dayspring lists them ("I found a few: first, Resume.doc from Sep 3; second…") and you answer "the first one", "the newest one" or a word from the name.

After it opens a document, it tells you what it is and how long it takes to read, then asks: **read it, or summarize it?**

## Reading aloud

The Dayspring screen opens the document in its reader: the sections down the side, the text in the middle, and the paragraph being read highlighted. Dayspring's voice reads it paragraph by paragraph, at your **Voice** volume.

| Say | What happens |
|---|---|
| "pause" / "hold on" | stops at this paragraph |
| "keep going" / "continue" | carries on |
| "read that again" | repeats the paragraph |
| "go back" | the paragraph before |
| "skip" | the next paragraph |
| "next section" / "previous section" | jumps by heading, page or slide |
| "skip to section 3" / "go to page 2" | jumps there |
| "slower" / "faster" | reading speed |
| "stop reading" / "close it" | stops, or closes the reader |
| "pick up where we left off" | goes back to where you stopped last time, even days later |

The buttons at the top do the same: ⏮ ◀ ▶/⏸ ▶▶ ⏭, − and + for speed, **Summary**, and ✕. Click any paragraph or section to jump there, and press Esc to close.

## Summaries and explanations

These need an AI brain (**Settings → AI brain**):

- "Summarize it." / "Give me the gist." A short spoken summary that points out dates, amounts and anything you need to do.
- "Explain this part." / "What does that mean?" Explains the paragraph being read, in plain words.
- "What's this document about?"
- Any question: "When does the lease end?", "How much did we spend on gas?", "What does slide 3 say?"

Long documents are summarized section by section and then as a whole. Dayspring answers only from what's in the document and says so when something isn't there.

In free mode (no AI brain), Dayspring can still find, open and read any of these aloud word for word.

## Privacy

- Documents are read on this computer.
- When you ask for a summary or an explanation, only the text needed for that answer goes to the AI service you chose in Settings.
- Dayspring remembers where you stopped in each document (just the paragraph number) in its `data` folder, so "pick up where we left off" works.
