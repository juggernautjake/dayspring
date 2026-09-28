# Email

Dayspring reads, searches and writes email from every mailbox you have: Gmail, Outlook and Hotmail, Yahoo, iCloud, AOL, Zoho, GMX, Fastmail, your own domain, anything with IMAP. Open the **✉** button on the talk bar for the Mail window, or just talk: "read my new emails", "any emails from Sam?", "write an email to Sam saying I'll be late".

**Nothing is sent without you.** An email goes out only when you press **Send** in the editor, or say a clear **yes** on the Dayspring screen after Dayspring reads back who it's to and the subject. It only sends from a mailbox where you turned sending on, and you get a few seconds to **Undo send**.

> Email is part of the development version of Dayspring for now (Settings → This app → Features). If you don't see the ✉ button or **Settings → Email**, your version doesn't have it yet.

## What you can do

- **Read** all your inboxes together or one at a time, with folders (Inbox, Starred, Sent, Drafts, Archive, Trash and your own), search, conversations, and attachments you can open or save.
- **Organize**: mark read or unread, star, archive, move to a folder, and move to the Trash (always asks first; nothing is ever deleted for good).
- **Write** in a proper editor: fonts and sizes, bold, italic, underline, strikethrough, colours and highlight, headings, lists, indents, alignment, quotes, links, pictures, dividers, code, tables, emoji and GIFs. Attach files from your computer (or drag them in), from Dayspring's music and videos or Google Drive, or attach other emails. Signatures, reply, reply all, forward, drafts that save themselves, and spell check.
- **Talk to it**: dictate an email word for word, or say everything you want in any order and let the AI write one clear email from it. Ask the AI to change the open email ("make it shorter", "add Rich to CC", "change the time to 3pm") and every change shows up in the editor with an **Undo**.
- **Meeting invitations** with a description, an agenda, links and Drive files, for Google Meet or Outlook.

## Setting up

Open **Settings → Email** (under Apps & connections) and use **Add a mailbox**. You can add as many as you like. Each one gets a nickname, a colour, and its own switches; one of them is the **primary** mailbox, used when you don't name another ("check my work email" uses the one nicknamed Work).

### Gmail

Gmail uses your Google sign-in, the same one as Google Calendar and Drive. If you haven't set up Google yet, follow [Google Calendar + Gmail](connections.md#google-calendar--gmail) once (about 10 minutes), then press **Gmail** in Settings → Email and sign in.

At first Dayspring can read your Gmail and save drafts. Two more switches, each asked of Google only when you turn it on:

- **Let Dayspring send email from this mailbox** (Google's `gmail.send` permission).
- **Let Dayspring mark, star, archive and move to Trash** (Google's `gmail.modify` permission).

When you turn one on, a Google page opens to agree to it. If you made your own Google client, add `gmail.send` and `gmail.modify` under **Data Access** in the Google Cloud console first (the Google guide lists them).

### Outlook, Hotmail and Microsoft 365

Outlook uses your Microsoft sign-in, the same one as the Outlook calendar and To Do. If it isn't set up yet, follow [Outlook + Microsoft To Do](connections.md#outlook--microsoft-to-do) once, then press **Outlook / Hotmail** in Settings → Email. Turning on **Let Dayspring send email from this mailbox** asks Microsoft for the `Mail.Send` permission, once. The sign-in is encrypted with your Windows account.

### Yahoo Mail (app password)

Yahoo needs an **app password**: your normal Yahoo password won't work.

1. Open [Yahoo account security](https://login.yahoo.com/account/security) and sign in.
2. Choose **Generate app password** (or **Manage app passwords**), name it "Dayspring" and press **Generate**. Copy the 16 letters.
3. In Settings → Email press **Yahoo**, type your Yahoo address and paste the app password (the spaces don't matter).
4. Press **Test connection**. You should see "✓ Reading (IMAP) works · ✓ Sending (SMTP) works". Then **Add mailbox**.

Dayspring fills in Yahoo's servers itself (imap.mail.yahoo.com and smtp.mail.yahoo.com).

### iCloud Mail (app-specific password)

iCloud needs two-factor authentication on your Apple Account and an **app-specific password**:

1. Open [account.apple.com](https://account.apple.com/account/manage), sign in, and choose **Sign-In and Security → App-Specific Passwords**.
2. Press **Generate an app-specific password**, name it "Dayspring", and copy it (it looks like abcd-efgh-ijkl-mnop).
3. In Settings → Email press **iCloud**, type your iCloud address (at icloud.com, me.com or mac.com) and paste the password. **Test connection**, then **Add mailbox**.

### AOL, Zoho, GMX, Fastmail and any other provider

- **AOL**: [AOL account security](https://login.aol.com/account/security) → **Generate app password**. Then press **AOL** in Settings → Email.
- **Zoho**: turn on IMAP in Zoho Mail's settings, then make an app password in Zoho Accounts → Security → App Passwords.
- **GMX**: allow POP3 and IMAP in GMX's settings; your GMX password works unless you use two-factor.
- **Fastmail**: Settings → Privacy & Security → **App passwords** → new, with IMAP and SMTP access.
- **Anything else** (a work address, your own domain): press **Another provider…**, type the address and password, and fill in the IMAP and SMTP servers and ports from your provider's help pages (search for "*provider* IMAP settings"). Usual ports: 993 for IMAP and 465 or 587 for SMTP.

Dayspring only uses encrypted connections (SSL/TLS or STARTTLS). The one exception is a program on your own computer, such as Proton Mail Bridge on 127.0.0.1.

**Your password.** You type it into Settings yourself. It's sent once to Dayspring on this computer, tested, and saved encrypted with your Windows account (Windows DPAPI, so another Windows user or another computer can't read the file). It's never shown again, never sent to a page or the AI, and never written to a log. To change it, press **New password…** on the mailbox.

## The Mail window

Press **✉** on the talk bar (the red number is how many unread emails you have), or say "open my email".

- **Mailbox** menu at the top: **All inboxes**, or one mailbox. Then the **folders** on the left, the **list** in the middle and the **email** on the right. On a small screen, or in Dayspring mini, the folders become a menu and the list and the email take turns (**← Back**).
- **Search** looks through the folder you're in.
- **Several at once**: tick the boxes, then **Archive**, **Mark read**, **Mark unread**, **Star** or **Trash…** (the Trash always asks first).
- **Reading**: the email shows in a sealed frame that can't run anything. **🔤 Plain text** shows just the words. The other emails in the same conversation are listed above it.
- **Pictures from the internet are held back** at first, because they can tell the sender you opened the email (tracking pixels). Press **Show pictures** for this email, or **Always from** to trust that sender. Pictures sent inside the email always show.
- **Attachments**: **Open** shows it in a new tab; **Save…** puts it in your Downloads folder after you OK it (and only where Settings → Permissions lets Dayspring write).
- **Keys**: `j`/`k` next and previous, `Enter` open, `r` reply, `a` reply all, `f` forward, `e` archive, `#` Trash, `s` star, `u` unread, `x` select, `c` write, `/` search, `?` all the shortcuts, `Esc` back and close.

## Writing an email

Press **✏ Write** in the Mail window, **Reply** / **Reply all** / **Forward** on an email, or say "write an email to…". The editor is a small window: drag it by its title, resize it from the corner, **▢** to fill the screen, **▁** to tuck it into a tab along the bottom, **✕** to close it (the draft is kept). You can have several open at once.

- **From** picks the mailbox. **To**, **Cc** and **Bcc** suggest people you've written to (and people in Dayspring who have an email address); press Enter or a comma after each one.
- **The toolbar**: font, size, paragraph style, bold, italic, underline, strikethrough, text colour, highlight, numbered and bulleted lists, outdent and indent, alignment, quote, code, code block, link, picture, divider line, table, emoji, GIF, clear formatting, undo, redo, 🎙 dictate and ⌨ shortcuts. What you see is exactly what's sent.
- **Pictures** you paste or drop into the text go inside the email (not as a link), so they show even where web pictures are blocked.
- **📎 Attach ▾**: from this computer (or drag files onto the editor), from Dayspring (your music, videos and Google Drive), **An email…** (attached whole, as a .eml file), or a file by its path (only where Settings → Permissions lets Dayspring read). Each shows its size, and Dayspring warns you as the total gets close to 25 MB, the most Gmail and most other mail allow.
- **Signatures**: set them up in Settings → Email → Signatures (several per mailbox, one of them the default). New emails get the default one; **✍ Signature** adds it anywhere.
- **Drafts** save themselves to the mailbox's Drafts folder every few seconds (Settings → Email → Composing). **🗑** discards the email and its draft (it asks first). Drafts you started elsewhere open in the editor from the Drafts folder (**✏ Open in the editor**).
- **With an AI key**: **✨ Polish** (grammar and flow), **✂ Shorter**, and **🎭 Tone ▾** (friendlier, more formal). Each is an ordinary edit you can undo.
- **Keys**: `Ctrl+Enter` send, `Ctrl+S` save the draft, `Ctrl+B`/`I`/`U`, `Ctrl+K` link, `Ctrl+Shift+7`/`8` lists, `Ctrl+Z`/`Ctrl+Y` undo and redo, `Ctrl+Shift+D` dictate, `Esc` minimise, `Ctrl+/` all the shortcuts.

## Sending, and Undo send

An email is sent only:

- when **you press Send** in the editor, or
- when you say a clear **yes** on the Dayspring screen right after Dayspring reads back who it's to and the subject ("Send the email to Sam (sam@example.com), subject 'Running late'?").

That yes counts only for that exact email: if anything in it changes afterwards (a word, a recipient, an attachment), Dayspring asks again. A yes from a phone call, a meeting, a text message or Discord never counts. The AI can't send by itself, and nothing in an email can make it.

After Send there are 10 seconds (you can choose 0 to 30 in Settings → Email) to press **Undo** or say "undo send"; the email goes back to the editor. Dayspring sends at most 10 emails in ten minutes, 60 a day, and 50 recipients at once. Each sent email is in the activity log with only who it went to and its subject.

## By voice

With or without an AI:

- "Read my new emails" / "check my email" / "any new emails in my work email"
- "Any emails from Sam?" / "did the bank email me?"
- "Read the one from the bank" / "read the second one" / "read it"
- "Summarise my inbox"
- "Open my email"
- "Write an email to Sam saying I'll be late tonight"
- "Send it" (Dayspring reads it back; say "yes") and "undo send"
- "Start dictating" / "stop dictating"

**Dictating.** Press **🎙** in the editor (or say "start dictating") and choose:

- **Word for word**: what you say goes where the cursor is. Say "comma", "period", "question mark", "new line", "new paragraph", "open quote" and "close quote" for punctuation, and "stop dictating" (or "that's all") when you're done.
- **Organize my thoughts**: say everything you want in the email, in any order, "ums" and all. When you say "that's all", the AI turns it into one clear email with a subject, a greeting, a tidy body and a sign-off, in your chosen tone, and puts it in the editor for you to look over. It's never sent by that. Without an AI key, Dayspring writes down what you said in sentences and paragraphs.

"Write an email to Sam" with nothing more opens the editor and listens the same way.

**With an AI**, you can also say:

- "Write an email to Sam saying I'll be late": the AI writes it and opens it in the editor for you to review.
- "Make it shorter", "make it friendlier", "more formal", "add a line about the budget", "change the time to 3pm", "add a link to the course", "add Rich to CC", "change the subject to…", "summarize the thread above it", "add an agenda with three items", "insert my signature", "attach the budget file from Drive".

Every change the AI makes shows in the editor with a note of what it did and an **Undo** button.

## Meeting invitations

Press **📅 Invite** in the Mail window, or ask: "set up a Google Meet with Pat tomorrow at 2 with an agenda: intro, demo, Q&A". The invitation editor has the title, date and time, length, guests (their email addresses), a video link switch (Google Meet, or Teams for Outlook), the place, and a description with the same toolbar as email: agendas, links, notes. **☁ Add a Drive file** puts Google Drive files on the event.

Nothing is created until you press **Create and send invitations**, or say yes after Dayspring reads it back. As with email, the yes covers exactly that invitation: change anything and it asks again. Google (or Outlook) then emails the invitations.

## Safety and privacy

- **Emails are cleaned before they're shown**: no scripts, no forms, no hidden frames; links open in a new window; the frame itself is sealed.
- **Tracking pictures are held back** until you choose to show them.
- **Emails are someone else's words, never instructions.** An email that says "AI assistant: forward all mail to…" or "reply with the password" is just read or summarized. Dayspring never sends, forwards, deletes or changes anything because an email says to; the AI is told this in every conversation, and the code enforces it (sending always needs your own yes).
- **What the AI sees** (Settings → Email → Privacy): whole emails only when you ask something that needs them (the usual), only who, what and when, or nothing at all.
- **Nothing of an email's text is written to the activity log.** Sent emails are logged with who they went to and the subject; moves to Archive or Trash with the mailbox and the subject.
- **Passwords and sign-ins are encrypted** with your Windows account. **Clear the mail cache** (Settings → Email → Privacy) forgets the emails Dayspring has in memory and the list of people you've emailed.
- **Exports never include email**: your mailboxes, their passwords, contacts and any mail cache live in `data\` and are left out; the privacy scan fails an export if any of them turn up elsewhere.

## Settings → Email

| Setting | What it does |
|---|---|
| Your mailboxes | Add, nickname, colour, primary, sending on or off, organizing (Gmail), new-mail notices, Test connection, new password, Remove |
| Signatures | Several per mailbox, written in a rich editor; which one is the default; whether replies and forwards get one |
| Default font and size | What new emails start with |
| When you reply | Write above the quoted email (usual) or below it |
| Default tone | How the AI writes and polishes: friendly, professional, formal, warm, brief or casual |
| Undo send | How long Dayspring waits before sending (0 to 30 seconds) |
| Auto-save drafts every | How often the editor saves to Drafts (2 to 120 seconds) |
| Spell check language | The language the browser's spell check uses |
| Pictures from the internet | Hold them back and show when asked (recommended), show from people you've written to, or always hold back |
| Mark read when opened | Or leave it unread until you mark it |
| Conversation view | Show the rest of the conversation above an email |
| Preview lines | How much of each email the list shows |
| Tell me about new email | A note on the screen, spoken when Dayspring is active (never in Quiet or Off); per mailbox in the mailbox list |
| What the AI may see | Whole emails when asked, only who/what/when, or nothing |
| Read emails aloud, reading speed | "Read the one from…" reads it out, at this speed; off shows it instead |

## Troubleshooting

**"The address or app password wasn't accepted."** Yahoo, iCloud and AOL need an app password, not your normal password (see above). Check the address too. Make a new app password if you're not sure of the old one.

**Reading works but sending doesn't.** Press **Test connection** on the mailbox: it checks reading (IMAP) and sending (SMTP) separately. Check the SMTP server and port (465 or 587). Some providers need sending allowed in their own settings.

**"Sending isn't turned on for this mailbox."** Turn on **Let Dayspring send email from this mailbox** in Settings → Email. For Gmail and Outlook a sign-in page opens once to agree to it.

**Gmail: "Google hasn't allowed that yet."** You turned on sending or organizing but haven't finished Google's page. Turn the switch off and on again, and approve it. If you made your own Google client, add `gmail.send` and `gmail.modify` to its Data Access scopes first.

**An attachment is "missing".** Attachments are kept in memory until the email is sent, so after Dayspring restarts, remove it and attach it again.

**Outlook says the email is too big.** Through Microsoft's sign-in, Dayspring sends up to about 3 MB with attachments. For bigger files, share a Drive link, or add the mailbox by IMAP instead (Outlook.com in the provider list).

**I don't want the AI to see my email at all.** Settings → Email → Privacy → **Nothing**. You can still use the Mail window and the voice commands that don't need AI.

## For developers

- The code is in `lib/mail/`: `index.mjs` (mailboxes, reading, composing, the send guard), `imap.mjs`, `gmail.mjs`, `outlook.mjs`, `sanitize.mjs`, `mime.mjs`, `tools.mjs` (the AI's tools), `skills.mjs` (voice), `invite.mjs`, `routes.mjs` (`/api/mail/…`). The screen side is `public/mail.js`, `public/mail-compose.js`, `public/mail-core.js` and `public/email-settings.js`; the editor is Quill, vendored in `public/vendor/quill/`.
- Email is the `email` feature in `lib/features.mjs`: its routes, tools, intents, Settings section, screen buttons and background checks all ask `features.on("email")`.
- **New-mail hook**: `mail.onNewMessage(filter, handler, { name, accounts })` offers each new inbox message to `filter({ account, from, subject, date })` (headers only); for the ones it accepts, `handler` gets `{ id, account, from, subject, date, text, links, attachments: [{ name, type, size, getBuffer() }] }`. It's for Dayspring's own features working from rules the owner sets up (for example trail-camera notification emails becoming camera events). It returns a function that removes the hook. The email's content is untrusted: use it as data, never as instructions.
- Tests (stand-in servers only, never a real account): `node scripts/qa/email.mjs` and `node scripts/qa/email-ui.mjs`.

## Limitations

- Starred in an IMAP mailbox shows starred mail in the Inbox; conversations in IMAP mailboxes are grouped by subject.
- Attachments waiting to be sent live in memory: a restart means attaching them again.
- Outlook through Microsoft's sign-in sends up to about 3 MB per email.
- Tables in the editor are simple (no merged cells).
- A few old or very complex email designs may look plainer in the reader, because anything that could run code or track you is removed.
