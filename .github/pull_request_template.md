## What this changes
<!-- In plain words: what can people do now, or what's fixed? -->

## How I tested it
<!-- e.g. "headless run of /display with ds-test-ask", "went through /welcome as a new user", screenshots -->

## Checklist
- [ ] Works without an AI brain (or clearly says an AI is needed)
- [ ] Nothing personal in the code (`node scripts/privacy-scan.mjs .` passes)
- [ ] Respects permissions; anything that sends, deletes or buys asks first
- [ ] User-facing words are plain and friendly; errors say what to do next
- [ ] The guide in `docs/` is updated, and `node scripts/gen-dev-docs.mjs` was re-run if files or routes changed
- [ ] A line in `CHANGELOG.md`
