# Publishing releases (for the maintainer)

This page is for whoever maintains Dayspring and shares it with others. Regular users don't need it.

Dayspring is developed in a private working copy (with your own `data` and `.env`). Releases are made from a **clean export** that contains no personal information. The export is checked by an automatic privacy scan and published to a public GitHub repository. Users' copies check that repository's releases for updates.

## One-time setup

1. **Create the GitHub repository.**
   1. Sign in at [github.com](https://github.com) and click **+** → **New repository**.
   2. Name it `dayspring`, choose **Public**, and leave "Add a README" **unticked** (the export has one).
   3. Click **Create repository**. Note the name, `your-name/dayspring`.
2. **Set the update source** in the working copy's `package.json`:
   ```json
   "dayspring": { "updateRepo": "your-name/dayspring" }
   ```
   Every export carries this, so users' copies know where to look.
3. Install [Git for Windows](https://git-scm.com/downloads/win). Optionally install the GitHub CLI: `winget install GitHub.cli`, then `gh auth login`.

## Each release

### 1. Bump the version

In `package.json`, raise `"version"` using [semantic versioning](https://semver.org): `1.0.1` for fixes, `1.1.0` for new features, `2.0.0` for changes that need users to redo setup.

### 2. Check everything works

```
node scripts/audit.mjs
```

All checks should pass. The audit backs up and restores your data around its tests.

### 3. Export the clean copy

```
node scripts/export.mjs
```

This builds `..\dayspring-app` (next to your working copy) with:

- the program files (`server.mjs`, `lib`, `public`, `scripts`, `docs`)
- the launchers (**Install / Start / Update Dayspring.cmd**)
- `.env.example`, and `docs/README.md` as the repository's `README.md`
- an empty `data` folder (only `.gitkeep`)
- **no** `.env`, **no** data, **no** backups, **no** `node_modules`

At the end it runs the **privacy scan**, which searches every exported file for your name, nickname, town, email, phone numbers, the names of people in your data, your folder paths, and anything that looks like an API key. **If anything is found, the export fails** and lists each file and line. Fix the source (usually by moving the detail into `data\` or `owner.json`), then export again.

You can run the scan by itself:

```
node scripts/privacy-scan.mjs ..\dayspring-app
```

### 4. Try the export like a new user

1. Copy `..\dayspring-app` somewhere temporary.
2. Run **Install Dayspring.cmd**, then **Start Dayspring.cmd**.
3. Check that the setup wizard appears and that free mode works ("add test tomorrow at 3", "what's on tomorrow").
4. Delete the temporary copy.

### 5. Build the release zip

```
node scripts/release.mjs
```

This runs the export and privacy scan again, then makes `dist-out\Dayspring.zip` (inside your working copy's app folder) and checks that it contains the program and no personal files. It ends by printing the exact publish steps. It never uploads anything by itself. Write a few friendly lines about what's new to paste into the release.

**Two channels.** That is the **production** release (`--channel stable`, the default): stable and beta features, a normal release marked Latest. A **development** release has everything, including features still being built:

```
node scripts/release.mjs --channel dev --tag v1.8.0-dev.1
```

The development tag is numbered **past** the current production version (with production at 1.7.0, the development builds are `v1.8.0-dev.1`, `v1.8.0-dev.2`, …). A `-dev` version sorts before the release of the same number, and the Development channel takes the newest of both, so `v1.7.0-dev.1` next to 1.7.0 would never be offered. The script refuses such a tag and suggests the right one.

It makes `dist-out\Dayspring-dev.zip` from a separate export folder (`dayspring-app-dev`, never the public repo's, because its `package.json` carries the `-dev` version) and prints a `gh release create … --prerelease --latest=false` command. Production copies never see pre-releases; copies on the Development channel (Settings → Updates → Which versions) do. Both channels run the privacy scan and the same checks, and both write `build-info.json` (`{ channel, version, commit }`) into the zip: that is how an install knows which features it has ([feature status](features-status.md)).

**Promotions.** Before a production release, export the owner's results from the Testing page and run `node scripts/promote-features.mjs <results.md>`, then `node scripts/gen-feature-docs.mjs`. Every feature whose tests all passed becomes stable in `lib/features.mjs` ([testing checklist](testing-checklist.md)).

### 6. Publish

With Git:

```
cd ..\dayspring-app
git init -b main    (first time only)
git remote add origin https://github.com/your-name/dayspring.git   (first time only)
git add -A
git commit -m "Dayspring 1.0.1"
git tag v1.0.1
git push -u origin main --tags
```

Then create the release:

- **On the website**: open the repository → **Releases** → **Draft a new release** → choose the tag `v1.0.1` → title "Dayspring 1.0.1" → paste the notes → attach `dayspring-1.0.1.zip` → **Publish release**.
- **Or with the GitHub CLI**:
  ```
  gh release create v1.0.1 "<path printed by release.mjs>\dayspring-1.0.1.zip" --title "Dayspring 1.0.1" --notes "What's new: ..."
  ```

The tag must be `v` + the version in `package.json`. Users' copies compare that number to their own.

## How users receive it

- Their Dayspring checks `https://api.github.com/repos/<updateRepo>/releases/latest` about once a day.
- If the tag is newer than their version, it offers the update. On yes, it backs up their program files, downloads the attached zip, replaces the program files (never `data` or `.env`), runs `npm install` if dependencies changed, and restarts.

## Checklist

- [ ] Version bumped in `package.json`
- [ ] `node scripts/audit.mjs` passes
- [ ] `node scripts/export.mjs` passes its privacy scan
- [ ] Fresh-install test done
- [ ] Docs updated for anything new (the in-app guide reads `docs\*.md`)
- [ ] Tag `vX.Y.Z` pushed, release published with the zip attached
