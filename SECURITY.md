# Security

## How Dayspring is built to be safe
- **It runs on your computer only.** The server listens on `127.0.0.1` (this PC), so other devices on your network or the internet can't reach it.
- **Your data stays in one folder:** `data/`. Keys stay in `.env`. Neither is ever uploaded or included in releases; the release is built by a script that fails if anything personal is found.
- **Keys never go to the browser.** Settings only ever shows "set / not set" and the last four characters.
- **Permissions you choose:**
  - Dayspring only looks at the files, programs, browser and web that you allow in Settings → Permissions.
  - Files that look like passwords, keys, crypto wallets or password vaults are always refused.
  - Windows system folders are never changed.
- **It asks before anything risky.** Deleting (to the Recycle Bin), sending, posting and buying all ask first. Email connections can only write drafts: Dayspring never asks for permission to send mail.
- **Only official downloads:** Voicemeeter's installer is checked for its publisher signature before it runs.

## Reporting a vulnerability
Please **don't** open a public issue for security problems. Use GitHub's private **"Report a vulnerability"** button on the repository's Security tab, or contact the maintainers through the repository's profile. Include:
- what you found, and how to reproduce it
- which version (Settings shows it next to the Dayspring logo)
- what someone could do with it

We'll acknowledge the report within a week, and credit you in the changelog if you'd like.

## Supported versions
Only the latest release gets security fixes. Dayspring checks for updates and asks before installing them.
