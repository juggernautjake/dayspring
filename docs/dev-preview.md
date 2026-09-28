# Developer preview (for the app's developer only)

Everyone else earns badges and secret characters by using Dayspring. The app's developer can also **look at every badge and hear every character before earning them**, so he can check the art, the animation and the voices. He still earns them for real like anyone else; the preview only lets him look.

Nobody else sees any of it: no switch, no extra section, no names, no art. On anyone else's computer the preview's routes answer "not found", and the voice commands below do nothing special.

## What the developer sees

**Progress → Badges → Preview all** (off until he turns it on). Every tier of every category appears with its full art, its motion, the coin flip, its name and description. Badges he hasn't earned are marked **Preview · not earned** on the card (never on the art itself), and each one has:

- **▶ Play reveal animation**: the award reveal exactly as it plays when a badge is earned.
- A **sample** citation with his own name ("… achieved this milestone by … on …"), marked *Sample*. The real one describes the check-in that actually earns it.

Previewing never records, awards or changes XP, and never marks a badge as seen.

**Settings → Personality → Personality lab** (marked *Dev preview*). Every character: the built-in ones, every secret character (found or not) and the easter egg. For each one:

- **▶ Hear**: sample lines in that character's style, in its own voice. Nothing is switched.
- **Lines & sliders**: its sample lines, plus a slider sandbox that changes only the preview.
- **Try 10 min**: switches to it now and changes back to exactly what was on after 10 minutes (or **End now**). Picking a character for real during a try ends the try.
- **Dev: unlock all (testing)** and **Dev: reset unlocks**: unlocks every secret character for free, for testing, and takes back exactly those. Both are written in the activity log. What was found or bought with XP for real is never touched.

Unlocks, XP costs and discovery announcements are otherwise untouched.

**By voice** (on his own screens): "show me all the badges", "preview the running badges" (any category), "let me hear the cowboy voice" (any character), "preview the secret characters".

## How Dayspring knows it's the developer

Every install is its own "owner", and the code is public, so neither "the owner" nor anything hidden in the code can tell who the developer is. Instead:

- **A developer key.** An Ed25519 key pair made once on the developer's computer. The **private** key never leaves it: it's kept in `%LOCALAPPDATA%\Ecosystem\dev-key.bin`, encrypted with his Windows account (DPAPI), never in the repository, `data/` or an export. Only the **public** key is in the code (`lib/dev/public-key.mjs`).
- **A dev token.** `%LOCALAPPDATA%\Dayspring\dev-token.json` holds a signature, made with the private key, over `{ purpose: "dayspring-dev", machine, issued, id }`, where `machine` is a hash of this computer's Windows machine id. Dayspring checks the signature with the public key and checks that the machine matches. A token copied to another computer doesn't work there, and a revoked one (`lib/dev/revoked.mjs`) doesn't work anywhere.

A signed-in Lantern hub account isn't used for this: every hub has its own owner, so "hub owner" says nothing about who the app's developer is.

**Honest limits.** Because the code is open source, someone can change their own copy to call themselves a developer (or to show the badges some other way). The point is that nobody can just flip a setting, edit a data file or copy a file to see what they haven't earned.

## Setting it up, and revoking it

From `apps/desk`:

```
node scripts/dev/make-dev-token.mjs              # first run: makes the key, puts the public key in the code, signs this computer's token
node scripts/dev/make-dev-token.mjs --status     # is this a developer computer, and if not, why not
node scripts/dev/make-dev-token.mjs --remove     # deletes this computer's token (the preview goes away)
node scripts/dev/make-dev-token.mjs --revoke     # deletes it and lists it in lib/dev/revoked.mjs, so a copy never counts again
node scripts/dev/make-dev-token.mjs --revoke-id <id>
node scripts/dev/make-dev-token.mjs --new-key    # a new key: every older token stops counting
```

Restart Dayspring after the first run. Only the computer that holds the private key can sign tokens.

## Trying an in-progress feature on a production build

The token is also the one way to switch on a feature that is still being built (stage "dev"; the guide's Feature status page lists them) on a production build: with it, Settings → **Features** shows a switch for each in-progress feature, one at a time (saved in `data/feature-switches.json` as `devOn`). Without the token those switches aren't offered, and editing `data/feature-switches.json` or `data/feature-stages.json` by hand can't turn one on. On the development version every feature is already on.

The export and the privacy scan refuse any `dev-token` or `dev-key` file and anything that looks like a private key. `scripts/qa/dev-preview.mjs` tests all of this: tokens (valid, forged, copied, missing, revoked), that nothing shows or leaks without a token, that previewing changes nothing, the 10-minute try, unlock-all and reset, and the screens in a headless browser.
