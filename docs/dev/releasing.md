# Releasing

The full step-by-step for maintainers is in [Publishing releases](../publishing-releases.md). In short:

1. **Bump the version** in `package.json` (semantic versioning), and add a section to `CHANGELOG.md`.
2. **Regenerate the reference pages:** `node scripts/gen-dev-docs.mjs`.
3. **Export the clean copy:** `node scripts/export.mjs`. This builds the flat repo folder next to the project, copies `dist/` (the launchers, `LICENSE`, `CONTRIBUTING.md`, `.github/` …) to its root, and makes `docs/README.md` the repo's README. It then runs the **privacy scan** and stops if anything personal is found.
4. **Test it like a new user:** `node scripts/qa-fresh-install.mjs` (or install the export by hand in a temp folder and go through `/welcome`).
5. **Build the release zip:** `node scripts/release.mjs` → `dist-out/Dayspring.zip` (always this name: the one-click link `…/releases/latest/download/Dayspring.zip` depends on it), checked to contain the program and no personal files.
6. **Publish:** commit and push the export to the public repo, tag `v<version>`, and create a GitHub release with the zip attached, for example:
   ```
   gh release create v1.0.0 "dist-out/Dayspring.zip" --title "Dayspring 1.0.0" --notes-file CHANGELOG.md
   ```
   Users' copies check `https://api.github.com/repos/<owner>/<repo>/releases/latest` about once a day. `package.json` → `dayspring.updateRepo` says which repo that is.
