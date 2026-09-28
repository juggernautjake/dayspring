// Privacy scan: fails (exit 1) if a folder contains anything personal: the owner's name, people, places, church,
// photo folders, or anything that looks like a key or phone number. The personal words come from this install's
// own data folder (never printed except as the matching line), plus a fixed list.
//   node scripts/privacy-scan.mjs [folder] [--data <data folder>] [--quiet]
// folder: what to scan (default: the generic export next to this project). Used by export.mjs and release.mjs.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_TARGET = resolve(DESK, "..", "..", "..", "dayspring-app");

// Extra words that are always personal: data/privacy-terms.json { "terms": [...] } (kept in the private data folder,
// so the list itself never ships), plus DAYSPRING_PRIVACY_TERMS (";"-separated). Put in places, workplaces, hobbies,
// device models, folder names and the start of any ID ("abc123*") that are yours and shouldn't reach the export.
const fixed = (dataDir) => [...(read(dataDir, "privacy-terms.json")?.terms ?? []), ...String(process.env.DAYSPRING_PRIVACY_TERMS ?? "").split(";")].map((s) => String(s).trim()).filter(Boolean);
// first names that are also ordinary words: only flagged as part of a full name
const COMMON = new Set(("hope joy grace faith mark will may june april august rich bill art dawn rose lily summer ray jack don sky amber ruby pearl holly ivy gene " +
  "guy pat sue drew chase hunter carter mason cole grant dean wade lane reese miles king bishop page major rusty sunny august autumn winter angel " +
  "christian son sons mom dad brother sister wife husband friend friends family church pastor team mike max rob bob tom tim jim ben sam dan ed al").split(" "));
const SKIP_DIRS = new Set(["node_modules", ".git", "data", "backups", "dist-out"]);
// Money review keeps bank data in data/finance (encrypted) and its browser profile in %LOCALAPPDATA%\DayspringFinance.
// Neither is ever read by the scan, and either one turning up inside an export is a failure on its own.
const FINANCE_DIRS = /^(DayspringFinance|finance-profile)$/i;
const financeFound = [];
// faces and people (lib/vision, lib/people): face fingerprints and thumbnails, saved texts and calls, the face models
const PEOPLE_DATA = /^(faces\.bin|comms\.bin|vision\.json|vision-cache|people)$|\.onnx$/i;
const peopleFound = [];
// the developer's dev token and private key (lib/dev, scripts/dev): they live in %LOCALAPPDATA%, never in an export
const DEV_SECRETS = /^dev-(token|key)(\.|$)/i;
const devFound = [];
// email (lib/mail): the mailbox file (encrypted app passwords, signatures), the people he's emailed, any mail cache
const MAIL_DATA = /^(mail|mail-contacts|microsoft|google)\.json$|^mail-cache$/i;
const mailFound = [];
const TEXT = new Set([".js", ".mjs", ".cjs", ".json", ".md", ".html", ".css", ".txt", ".cmd", ".bat", ".ps1", ".example", ".yml", ".yaml", ".gitignore", ""]);

const KEYS = [
  ["Anthropic key", /sk-ant-[A-Za-z0-9_-]{20,}/],
  ["OpenAI-style key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}/],
  ["ElevenLabs key", /\bsk_[0-9a-f]{40,}/],
  ["xAI key", /\bxai-[A-Za-z0-9]{24,}/],
  ["Google key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["AWS key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Twilio SID", /\bAC[0-9a-f]{32}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ["private key", /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/],
  ["Ed25519 private key", /MC4CAQAwBQYDK2VwBCIEI[A-Za-z0-9+/]{20,}/],
  ["phone number", /(?<![\w.-])\+1\d{10}\b|\(\d{3}\)\s?\d{3}-\d{4}\b|\b\d{3}-\d{3}-\d{4}\b/],
  ["email address", /\b[A-Za-z0-9._%+-]+@(?:gmail|yahoo|outlook|hotmail|icloud|live|aol)\.com\b/i],
  ["user folder path", /[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2}(?!Public|Default|<|\$|%|you|YOU|Name|name|USERNAME|\.\.\.)[A-Za-z][^\\/"'`\s]*/],
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const read = (dir, f) => { try { return JSON.parse(readFileSync(join(dir, f), "utf8").replace(/^﻿/, "")); } catch { return null; } };

// names that are also Bible books and people, voice names, months and days: never flagged on their own
const EXCL = new Set([...COMMON, ...("genesis exodus leviticus numbers deuteronomy joshua judges ruth samuel kings chronicles ezra nehemiah esther job psalm psalms proverbs " +
  "ecclesiastes isaiah jeremiah lamentations ezekiel daniel hosea joel amos obadiah jonah micah nahum habakkuk zephaniah haggai zechariah malachi matthew " +
  "luke john acts romans corinthians galatians ephesians philippians colossians thessalonians timothy titus philemon hebrews james peter jude revelation " +
  "abraham isaac jacob moses david solomon paul mary martha elijah elisha noah adam eve sarah rachel rebekah leah hannah deborah miriam joseph benjamin " +
  "aaron caleb gideon saul stephen andrew thomas philip nathan silas barnabas lydia priscilla aquila apollos nicodemus zacchaeus lazarus " +
  "brian george eric chris sarah jessica matilda liam alice lily roger charlotte callum laura charlie river aria jenny ava emma nova alloy echo fable onyx " +
  "shimmer coral sage ash ballad verse bill adam antoni arnold bella domi elli josh sam " +
  "january february march april may june july august september october november december sunday monday tuesday wednesday thursday friday saturday " +
  "morning evening discord spotify youtube chrome edge windows " +
  "the and our my his her their your for with from about new old big little young older younger mr mrs ms dr miss pastor aunt uncle grandma grandpa " +
  "granny nana papa cousin baby kids children group class study bible prayer people everyone all both other others first second third lord god jesus " +
  "christ holy spirit heavenly father mother").split(" ")]);

const FAMILY = /^(dadd?y|mommy|momm?a|mamm?a\w*|mamaw|grand\w+|gran|pap+aw|paw\w*|maw\w*|mee\w*maw|pop+\w*|bubba|sissy|nann?a\w+)$/i;

// the owner's people: [{ name, aliases }] from people.json, the church's bulletins and study leaders, and the prayer list
function peopleNames(dataDir) {
  const out = new Set();
  const add = (s) => { if (typeof s === "string" && s.trim()) out.add(s.trim()); };
  for (const p of read(dataDir, "people.json")?.people ?? []) { add(p.name); (p.aliases ?? []).forEach(add); }
  const church = read(dataDir, "church.json");
  const walkKeys = (v, key = "") => {
    if (Array.isArray(v)) v.forEach((x) => walkKeys(x, key));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walkKeys(x, k);
    else if (/^(name|who|speaker|people|person|for)$/i.test(key)) add(v);
  };
  if (church) { walkKeys(church.bulletins ?? []); walkKeys(church.studies ?? {}); }
  for (const item of read(dataDir, "devotion.json")?.prayer?.list ?? []) (item.people ?? []).forEach(add);
  return out;
}

// { fail: [...], warn: [...] } — fail: always personal; warn: a first name on its own (could be anyone; worth a look)
export function terms(dataDir = join(DESK, "data")) {
  const fail = new Set(fixed(dataDir)), warn = new Set();
  const owner = read(dataDir, "owner.json");
  if (owner) {
    for (const x of [owner.name, owner.nickname]) if (x && x.length > 2) fail.add(x);
    const city = String(owner.location?.place ?? "").split(",")[0].trim(); if (city.length > 2) fail.add(city);
    // the folder paths, and a folder's own name when it's a proper name ("Firstname Lastname"), not an ordinary word ("family", "art")
    for (const p of [...(owner.photoDirs ?? []), owner.fileRoot]) if (p) {
      fail.add(p);
      const b = basename(p);
      if (b.length > 3 && /^[A-Z]/.test(b) && /\s/.test(b) && !/^(camera roll|saved pictures|my pictures|screenshots \d*)$/i.test(b)) fail.add(b);
    }
  }
  const church = read(dataDir, "church.json");
  if (church) for (const k of ["name", "address", "website", "youtube"]) if (church[k]) fail.add(String(church[k]).replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""));
  const exam = read(dataDir, "learning.json")?.exam;
  if (exam) for (const k of ["name", "place"]) if (exam[k]) fail.add(exam[k]);
  for (const n of peopleNames(dataDir)) {
    const parts = n.replace(/[()"&,]/g, " ").split(/\s+/).filter((w) => /^[A-Z][a-zA-Z'’-]+$/.test(w));
    // a full name ("Jo Smith"), not a group label made of ordinary words ("The Book Club", "Our Group")
    const real = parts.filter((w) => !EXCL.has(w.toLowerCase()));
    if (parts.length >= 2 && real.length && !/^(the|our|my|his|her|their|your)$/i.test(parts[0])) fail.add(parts.join(" "));
    const last = parts.length >= 2 ? parts.at(-1) : null;
    if (last && last.length >= 4 && !EXCL.has(last.toLowerCase())) fail.add(last);
    if (parts[0] && parts[0].length >= 3 && !EXCL.has(parts[0].toLowerCase())) warn.add(parts[0]);
    // a family nickname on its own (the owner's own word for a parent or grandparent): always fails
    // (the plain ones anyone might write, like "Grandma" or "Nana", are in EXCL and stay allowed)
    if (parts.length === 1 && FAMILY.test(parts[0]) && !EXCL.has(parts[0].toLowerCase())) fail.add(parts[0]);
  }
  const ok = (p) => p && p.length >= 3;
  return { fail: [...fail].filter(ok), warn: [...warn].filter((w) => ok(w) && !fail.has(w)) };
}

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && (FINANCE_DIRS.test(e.name) || (e.name === "finance" && /[\\/]data$/i.test(dir)))) { financeFound.push(join(dir, e.name)); continue; }
    if (SKIP_DIRS.has(e.name) || e.isSymbolicLink()) continue;   // junctions/symlinks (e.g. a linked node_modules) aren't ours
    if (DEV_SECRETS.test(e.name)) { devFound.push(join(dir, e.name)); continue; }
    if (MAIL_DATA.test(e.name) && (e.name.toLowerCase() === "mail-cache" || /[\\/]connectors$/i.test(dir))) { mailFound.push(join(dir, e.name)); continue; }
    if (PEOPLE_DATA.test(e.name) && !(e.name === "people" && !/[\\/]data$/i.test(dir))) { peopleFound.push(join(dir, e.name)); continue; }
    if (e.isDirectory()) yield* walk(join(dir, e.name));
    else if (e.isFile()) yield join(dir, e.name);
  }
}

// → [{ level: "fail" | "warn", file, line, what, text }]
export function scan(target, { dataDir } = {}) {
  const { fail, warn } = terms(dataDir);
  // whole words; case-sensitive for single words (so "hope" the word never matches "Hope" the person).
  // A term ending in "*" matches as a prefix (the start of an ID, so the whole ID never has to be written down).
  const mk = (t, level) => { const pre = t.endsWith("*"), w = pre ? t.slice(0, -1) : t; return [w, level, new RegExp(`(?<![A-Za-z0-9])${esc(w)}${pre ? "" : "(?![A-Za-z0-9])"}`, /\s|[\\/]/.test(w) || pre ? "i" : "")]; };
  const rx = [...fail.map((t) => mk(t, "fail")), ...warn.map((t) => mk(t, "warn"))];
  const hits = [];
  for (const f of walk(target)) {
    const rel = relative(target, f);
    for (const [, level, r] of rx) if (r.test(rel)) { hits.push({ level, file: rel, line: 0, what: "personal word in a file name", text: rel }); break; }
    if (!TEXT.has(extname(f).toLowerCase()) || statSync(f).size > 5_000_000) continue;
    readFileSync(f, "utf8").split(/\r?\n/).forEach((l, i) => {
      for (const [what, r] of KEYS) if (r.test(l)) { hits.push({ level: "fail", file: rel, line: i + 1, what, text: l.trim().replace(r, (m) => m.slice(0, 6) + "…").slice(0, 160) }); return; }
      for (const [, level, r] of rx) if (level === "fail" && r.test(l)) { hits.push({ level, file: rel, line: i + 1, what: "personal", text: l.trim().slice(0, 160) }); return; }
      for (const [t, level, r] of rx) if (level === "warn" && r.test(l)) { hits.push({ level, file: rel, line: i + 1, what: `first name "${t}"`, text: l.trim().slice(0, 160) }); return; }
    });
  }
  for (const d of peopleFound.splice(0)) hits.push({ level: "fail", file: relative(target, d), line: 0, what: "Face data, saved messages or face models", text: "people data must never be exported" });
  for (const d of devFound.splice(0)) hits.push({ level: "fail", file: relative(target, d), line: 0, what: "Developer token or key", text: "the dev token and key never leave the developer's computer" });
  for (const d of mailFound.splice(0)) hits.push({ level: "fail", file: relative(target, d), line: 0, what: "Email accounts, sign-ins, contacts or mail cache", text: "mail credentials and caches must never be exported" });
  for (const d of financeFound.splice(0)) hits.push({ level: "fail", file: relative(target, d), line: 0, what: "Money review data or browser profile", text: "financial data must never be exported" });
  return hits;
}

export function report(hits, target) {
  const fails = hits.filter((h) => h.level === "fail"), warns = hits.filter((h) => h.level === "warn");
  const line = (h) => `  ${h.file}${h.line ? ":" + h.line : ""}  [${h.what}]  ${h.text}`;
  if (warns.length) { console.log(`Privacy scan: ${warns.length} first name${warns.length === 1 ? "" : "s"} to look at (not blocking; could be anyone's name):`); warns.forEach((h) => console.log(line(h))); }
  if (fails.length) { console.log(`Privacy scan FAILED: ${fails.length} personal item${fails.length === 1 ? "" : "s"} in ${target}:`); fails.forEach((h) => console.log(line(h))); }
  else console.log(`Privacy scan: clean${warns.length ? " (apart from the first names above)" : ""}.`);
  return fails.length === 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), di = args.indexOf("--data");
  const dataDir = di >= 0 ? resolve(args[di + 1]) : undefined;
  const target = resolve(args.find((a, i) => !a.startsWith("--") && (di < 0 || i !== di + 1)) ?? DEFAULT_TARGET);
  if (!existsSync(target)) { console.error(`Nothing to scan: ${target} doesn't exist.`); process.exit(2); }
  process.exit(report(scan(target, { dataDir }), target) ? 0 : 1);
}
