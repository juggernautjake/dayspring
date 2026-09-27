# Money review (read-only)

Dayspring can go through your bank, Venmo or Cash App transactions with you: every transaction for the last three months (or any range), where the money went, which subscriptions keep charging you, and what you might want to cancel. Then you can ask follow-up questions, like "how much did I spend on food?" or "help me make a budget".

It **only reads**. Dayspring can't send, pay, transfer, request, cash out, buy, sell, change settings, dispute, sign out or cancel anything, and it never types, stores or reads your passwords or sign-in codes. These rules are built into Dayspring's code, not just its instructions, so a web page can't talk it out of them.

## Two ways to do it

### 1. Import a statement (recommended)

Most banks, credit cards, Venmo and Cash App let you download your transactions as a file. That's the most reliable way, and no website automation is involved.

1. On your bank's website, find **Download**, **Export** or **Statements**, and download your transactions as **CSV** (a spreadsheet file) or **OFX/QFX** (Quicken). Three months is a good start.
2. Say "Dayspring, import my bank statement". The **Money** page opens.
3. Drop the file on the page, or put it in the import folder the page shows and say "import my bank statement" again.

Dayspring keeps the transactions encrypted and deletes the plain copy from its import folder. The file in your Downloads folder is yours to keep or delete.

### 2. Read it from the website

This needs the **Money review (read-only)** permission. It's off until you turn it on.

1. Open the Money page (say "import my bank statement", or go to Settings, then Permissions, then **the Money page** link).
2. Read the explanation, tick **I understand**, and press **Turn on Money review (read-only)**.
3. Say "open my bank" (the first time, say which one: "open my bank, Chase", or type its address on the Money page), "open Venmo" or "open Cash App". A separate Dayspring money window opens.
4. **Sign in yourself** in that window, including any code the site texts you. Dayspring never sees or types it.
5. Say "review my transactions for the last three months".

Dayspring reads the list, presses **Next**, **Load more** or scrolls until it has gone back far enough, then shows the report on the screen and gives you a short spoken summary.

Some banks' terms of service don't allow automated access to their websites. Where your bank has a download, importing that file is the better way.

## The report

The report opens on the Dayspring screen. It's also saved as a Markdown file and a CSV spreadsheet in Dayspring's `data\finance\reports` folder.

- **Every transaction** in a table you can sort (click a column heading) and filter.
- **Money in, money out and net**, for each month and in total.
- **Spending by category** (groceries, eating out, gas, subscriptions, bills…) and your **top merchants**.
- **Repeating charges and subscriptions**: how much, how often, when the next one is expected, and what it costs a year.
- **Price increases**, **possible duplicate charges**, **unusual or large charges**, and **fees and interest**.
- **Things you might want to cancel**, each with the reason (the price went up, charged twice, you pay for several streaming services, a small charge that's easy to forget) and how to cancel it.

Dayspring never cancels anything itself. It tells you how, and you do it.

## Things you can say

| Say | What happens |
|---|---|
| "Review my transactions for the last three months" | Reads the open money window (if any) and everything you imported, then shows the report |
| "What's my Venmo balance?" | The balance from the last time Dayspring read it (or reads it now if Venmo is open) |
| "What subscriptions do I have?" | The repeating charges and their yearly cost |
| "What should I cancel?" | The "might want to cancel" list, with reasons |
| "How do I cancel Netflix?" | The steps, for you to do |
| "How much did I spend on food last month?" | A total for that category and time |
| "What did I pay Josh last week?" | Payments to that person or place |
| "When did Netflix last charge me?" | The latest charge and its date |
| "Help me make a budget" | A 50/30/20 starting point from your own months |
| "Open my bank" / "Open Venmo" / "Open Cash App" | Opens the money window for you to sign in |
| "Close my money browser" | Closes the money window |
| "Import my bank statement" | Imports files from the import folder and opens the Money page |
| "Delete my money data" | Asks first, then deletes every kept transaction and report |

All of these work without an AI. With an AI connected, you can also ask freer questions ("where could I save $200 a month?"). Budgeting and saving ideas are fine. For investment, tax or legal questions, Dayspring will suggest a qualified professional.

## When the site wants something from you

If the site shows a **sign-in page**, asks for a **verification code**, or shows a **robot check** ("I'm not a robot"), Dayspring stops and tells you. Finish it yourself in the money window, then ask again. Dayspring never tries robot checks.

## Privacy

- **Stays on this computer.** Transactions are kept in Dayspring's `data\finance` folder, encrypted with Windows' own protection for your user account (a copy of the file is unreadable anywhere else). Nothing in `data` is ever included when Dayspring is shared or exported.
- **Account and card numbers are masked** to their last 4 digits everywhere: the report, the screen, and anything sent to an AI.
- **Its own browser.** The money window uses its own profile (`%LOCALAPPDATA%\DayspringFinance`), separate from your own browser and from Dayspring's music and search windows, so their cookies never mix. Your sign-in stays saved there if the site allows it. The window closes by itself after 15 minutes with nothing asked of it (a setting on the Money page).
- **How long it's kept.** Raw transactions are deleted after 90 days (a setting). Reports stay until you delete them on the Money page. **Delete all my money data** removes everything.
- **The AI only with your OK.** The report is made entirely on your computer, with plain rules, unless you agree. The first time, Dayspring asks: "This sends your transaction list (merchant names and amounts, account numbers masked) to your AI provider to analyse it. OK?" Only your own "yes" (or the switch on the Money page) counts; the AI can't agree for you. Sending a *picture* of a page, as a last resort when a page can't be read, has its own separate switch.
- **The logs.** Dayspring writes down what it did on a money site ("clicked Next on venmo.com", "read 212 transactions from venmo.com"), never amounts, names or numbers. You can see this on the Money page.

## What the money window will and won't do

Dayspring may: read the page, scroll, press navigation (next, previous, older, load more, see more, view all, activity, transactions, statements, history, a month, a date range, details, back), set the site's date filter, and type into the site's own transaction search box.

Dayspring won't, even if asked: press anything that sends, pays, transfers, requests, cashes out, withdraws, deposits, buys, sells, invests, confirms, submits, approves, adds money, links a bank, changes card or account settings, locks a card, disputes, cancels, deletes, closes an account or signs out; type into any other field; submit forms; download files; or open pop-ups to other websites. It checks a button's name, its text (even hidden text), its label, its link, what's inside it, what's on top of it, and the form around it, and a single money word anywhere means no.

## Troubleshooting

### "Money review is turned off"
Turn it on on the Money page (see step 2 above). Imports work without it.

### The report stops before three months
Some sites only show so much history. Download a statement for the rest and import it.

### Some transactions look wrong
Sites change their pages. Rows read from plain page text are marked as less exact in the report's notes. A downloaded CSV or OFX statement is always the most accurate.
