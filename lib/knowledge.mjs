// A map of the owner's world, built from their folders: every area and project two levels deep, with
// the opening of its README (or what it contains). The assistant carries this map in every
// conversation so it knows what exists before it searches. Rebuilt daily, or on request.
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT } from "./files.mjs";
import * as owner from "./owner.mjs";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "knowledge.md");
const SKIP = new Set(["node_modules", ".git", "AppData", "3D Objects", "Saved Games", "Music", "Videos", "Downloads", "dist", "build", ".next"]);
const MAX = 24_000;

async function readmeSummary(dir) {
  for (const name of ["README.md", "readme.md", "README.txt", "README"]) {
    const f = join(dir, name);
    if (!existsSync(f)) continue;
    try {
      // generated READMEs open with an HTML comment and a heading: neither is a summary
      const text = (await readFile(f, "utf8")).replace(/\r/g, "").replace(/<!--[\s\S]*?-->/g, "")
        .split("\n").filter((l) => !/^\s*#/.test(l) && !/^\s*>/.test(l)).join("\n");
      const para = text.split(/\n\s*\n/).map((p) => p.trim())
        .find((p) => p && !p.startsWith("#") && !p.startsWith("```") && !p.startsWith("|") && !/^[-*]\s*$/.test(p) && p.length > 25);
      if (para) return para.replace(/\s+/g, " ").replace(/[*_`]/g, "").slice(0, 200);
    } catch { /* unreadable */ }
  }
  return null;
}

async function childDirs(dir) {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !SKIP.has(e.name))
      .map((e) => e.name).sort();
  } catch { return []; }
}

export async function build() {
  const root = ROOT();
  const lines = [`Map of ${owner.name()}'s files (under ${root}), built ${new Date().toISOString().slice(0, 16).replace("T", " ")}.`];
  for (const top of await childDirs(root)) {
    const topDir = join(root, top);
    const sum = await readmeSummary(topDir);
    lines.push(`\n## ${top}${sum ? ` — ${sum}` : ""}`);
    const kids = await childDirs(topDir);
    for (const k of kids.slice(0, 40)) {
      const kd = join(topDir, k);
      const s = await readmeSummary(kd);
      const inner = s ? "" : (await childDirs(kd)).slice(0, 6).join(", ");
      lines.push(`- ${top}/${k}${s ? `: ${s}` : inner ? ` (contains: ${inner})` : ""}`);
    }
    if (kids.length > 40) lines.push(`- …and ${kids.length - 40} more folders`);
  }
  let text = lines.join("\n");
  if (text.length > MAX) text = text.slice(0, MAX) + "\n…(map cut off; search for more)";
  await writeFile(FILE, text);
  return { built: true, chars: text.length, file: FILE };
}

// The map for the prompt; rebuilt in the background when it is a day old.
export function map() {
  if (!existsSync(FILE)) { build().catch(() => {}); return ""; }
  if (Date.now() - statSync(FILE).mtimeMs > 86_400_000) build().catch(() => {});
  return readFileSync(FILE, "utf8");
}
