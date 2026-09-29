// Copies the file viewer's front-end libraries from node_modules (devDependencies) into public/vendor, so an installed
// Dayspring (npm install --omit=dev) has them without npm. Run it again after updating either package:
//   node scripts/vendor-viewer.mjs
// pdf.js (pdfjs-dist, Apache-2.0): the "legacy" build, which also runs in older Chromium/Edge windows on Windows 10, with
//   its worker, the standard fonts, the character maps (CJK text) and the WebAssembly image decoders.
// Prism (prismjs, MIT): the core and the languages the viewer highlights, in one file.
import { cpSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..");
const NM = join(DESK, "node_modules"), OUT = join(DESK, "public", "vendor");
const ver = (p) => JSON.parse(readFileSync(join(NM, p, "package.json"), "utf8")).version;

// ---- pdf.js
const P = join(NM, "pdfjs-dist"), PO = join(OUT, "pdfjs");
rmSync(PO, { recursive: true, force: true });
mkdirSync(PO, { recursive: true });
// (the minified files carry a few raw control characters inside string literals; they're written as \xNN escapes, the
// same string to JavaScript, so scripts/qa/source-hygiene.mjs stays able to catch a real lost backslash anywhere else)
const escapeControls = (s) => s.replace(/[\x00-\x08\x0e-\x1a\x1c-\x1f]/g, (c) => "\\x" + c.charCodeAt(0).toString(16).padStart(2, "0"));
for (const f of ["pdf.min.mjs", "pdf.worker.min.mjs"]) {
  const src = readFileSync(join(P, "legacy", "build", f), "utf8");
  if (/[\x0b\x0c]/.test(src)) throw new Error(`${f} has a vertical tab or form feed: check how to escape it before vendoring`);
  writeFileSync(join(PO, f), escapeControls(src));
}
for (const d of ["standard_fonts", "cmaps", "wasm", "iccs"]) cpSync(join(P, d), join(PO, d), { recursive: true });
copyFileSync(join(P, "LICENSE"), join(PO, "LICENSE.txt"));
writeFileSync(join(PO, "VENDORED.txt"), `pdfjs-dist ${ver("pdfjs-dist")} (legacy build), Apache-2.0, https://github.com/mozilla/pdf.js\nCopied by scripts/vendor-viewer.mjs. Do not edit these files by hand.\n`);

// ---- Prism
const R = join(NM, "prismjs"), RO = join(OUT, "prism");
const LANGS = ["markup", "css", "clike", "javascript", "jsx", "typescript", "tsx", "json", "python", "c", "cpp", "csharp", "java", "go", "rust", "ruby", "markup-templating", "php", "lua", "sql", "bash", "powershell", "batch", "yaml", "ini", "toml", "markdown"];
rmSync(RO, { recursive: true, force: true });
mkdirSync(RO, { recursive: true });
// (window.Prism.manual: the viewer highlights on its own, never the whole page)
const body = ["window.Prism = window.Prism || {}; window.Prism.manual = true;", readFileSync(join(R, "components", "prism-core.min.js"), "utf8"),
  ...LANGS.map((l) => readFileSync(join(R, "components", `prism-${l}.min.js`), "utf8"))].join("\n;\n");
writeFileSync(join(RO, "prism.min.js"), `/* Prism ${ver("prismjs")} (MIT, https://prismjs.com): core + ${LANGS.join(", ")}. Built by scripts/vendor-viewer.mjs. */\n${body}\n`);
copyFileSync(join(R, "LICENSE"), join(RO, "LICENSE.txt"));
console.log(`vendored pdf.js ${ver("pdfjs-dist")} and Prism ${ver("prismjs")} into public/vendor`);
