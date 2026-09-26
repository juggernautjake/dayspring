// Scripture: look up any passage in several translations, and search the Bible by words.
//   - Public-domain versions come from bible-api.com (KJV, ASV, WEB, Darby, Douay-Rheims, YLT, BBE, OEB). No key needed.
//   - ESV and NLT work once their free keys are in .env (ESV_API_KEY from api.esv.org, NLT_API_KEY from api.nlt.to).
//   - The whole KJV is kept on disk (downloaded once), so lookups still work offline and word search is instant.
// Text is always quoted exactly from the source, with the version named. Nothing is paraphrased as if it were Scripture.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "bibles");
const KJV_FILE = join(DIR, "kjv.json");
const KJV_URL = "https://raw.githubusercontent.com/thiagobodruk/bible/master/json/en_kjv.json";

export const BOOKS = ["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "Ruth", "1 Samuel", "2 Samuel", "1 Kings", "2 Kings",
  "1 Chronicles", "2 Chronicles", "Ezra", "Nehemiah", "Esther", "Job", "Psalms", "Proverbs", "Ecclesiastes", "Song of Solomon", "Isaiah", "Jeremiah",
  "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah",
  "Malachi", "Matthew", "Mark", "Luke", "John", "Acts", "Romans", "1 Corinthians", "2 Corinthians", "Galatians", "Ephesians", "Philippians", "Colossians",
  "1 Thessalonians", "2 Thessalonians", "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews", "James", "1 Peter", "2 Peter", "1 John", "2 John",
  "3 John", "Jude", "Revelation"];
const ALIAS = { psalm: "Psalms", ps: "Psalms", "song of songs": "Song of Solomon", songs: "Song of Solomon", canticles: "Song of Solomon", revelations: "Revelation",
  gen: "Genesis", ex: "Exodus", lev: "Leviticus", deut: "Deuteronomy", matt: "Matthew", rom: "Romans", phil: "Philippians", heb: "Hebrews", prov: "Proverbs", eccl: "Ecclesiastes", isa: "Isaiah", jer: "Jeremiah" };

export const VERSIONS = {
  kjv: { name: "King James Version", words: /\b(kjv|king james|authori[sz]ed)\b/ },
  web: { name: "World English Bible", words: /\b(web|world english)\b/ },
  asv: { name: "American Standard Version", words: /\b(asv|american standard)\b/ },
  darby: { name: "Darby Bible", words: /\bdarby\b/ },
  dra: { name: "Douay-Rheims", words: /\b(douay|rheims|dra)\b/ },
  ylt: { name: "Young's Literal Translation", words: /\b(ylt|young'?s( literal)?)\b/ },
  bbe: { name: "Bible in Basic English", words: /\b(bbe|basic english)\b/ },
  "oeb-us": { name: "Open English Bible", words: /\b(oeb|open english)\b/ },
  esv: { name: "English Standard Version", words: /\b(esv|english standard)\b/, key: "ESV_API_KEY" },
  nlt: { name: "New Living Translation", words: /\b(nlt|new living)\b/, key: "NLT_API_KEY" },
  niv: { name: "New International Version", words: /\b(niv|new international)\b/, unavailable: true },
  nasb: { name: "New American Standard Bible", words: /\b(nasb|new american standard)\b/, unavailable: true },
  nkjv: { name: "New King James Version", words: /\b(nkjv|new king james)\b/, unavailable: true },
  csb: { name: "Christian Standard Bible", words: /\b(csb|christian standard)\b/, unavailable: true },
};
export function versionFrom(text) {
  const t = String(text).toLowerCase();
  // "new king james" before "king james", "new american standard" before "american standard"
  for (const k of ["nkjv", "nasb", "niv", "csb", "nlt", "esv", "kjv", "web", "asv", "darby", "dra", "ylt", "bbe", "oeb-us"]) if (VERSIONS[k].words.test(t)) return k;
  return null;
}

// "romans chapter 8 verse 28", "first john 4:8", "psalm 23", "john 3 16 through 18" → { book, chapter, from, to, ref }
export function parseRef(text) {
  let t = ` ${String(text).toLowerCase()} `.replace(/\bfirst\b|\b1st\b/g, "1").replace(/\bsecond\b|\b2nd\b/g, "2").replace(/\bthird\b|\b3rd\b/g, "3")
    .replace(/\bchapter\b/g, " ").replace(/\bverses?\b/g, ":").replace(/\b(through|thru|to)\b/g, "-").replace(/\s*:\s*/g, ":").replace(/\s*-\s*/g, "-");
  const names = [...BOOKS.map((b) => [b.toLowerCase(), b]), ...Object.entries(ALIAS)].sort((a, b) => b[0].length - a[0].length);
  for (const [n, book] of names) {
    const re = new RegExp(`(?:^|\\s)${n.replace(/ /g, "\\s+")}\\.?\\s+(\\d+)(?:[:\\s]+(\\d+)(?:-(\\d+))?)?`);
    const m = re.exec(t);
    if (m) {
      const chapter = Number(m[1]), from = m[2] ? Number(m[2]) : null, to = m[3] ? Number(m[3]) : from;
      const ref = `${book} ${chapter}${from ? `:${from}${to && to !== from ? `-${to}` : ""}` : ""}`;
      return { book, chapter, from, to, ref };
    }
  }
  return null;
}

let kjv = null;
async function loadKJV() {
  if (kjv) return kjv;
  if (!existsSync(KJV_FILE)) {
    mkdirSync(DIR, { recursive: true });
    const r = await fetch(KJV_URL, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error("couldn't download the KJV text");
    writeFileSync(KJV_FILE, (await r.text()).replace(/^﻿/, ""));
  }
  const raw = JSON.parse(readFileSync(KJV_FILE, "utf8").replace(/^﻿/, ""));
  kjv = raw.map((b, i) => ({ book: BOOKS[i], chapters: b.chapters.map((c) => c.map((v) => v.replace(/\{[^}]*\}/g, "").replace(/\s+/g, " ").trim())) }));
  return kjv;
}
function fromKJV(p) {
  const b = kjv.find((x) => x.book === p.book);
  const ch = b?.chapters[p.chapter - 1];
  if (!ch) throw new Error(`${p.ref} isn't in the Bible`);
  const from = p.from ?? 1, to = p.from ? (p.to ?? p.from) : ch.length;
  const verses = ch.slice(from - 1, to).map((text, i) => ({ n: from + i, text }));
  if (!verses.length) throw new Error(`${p.ref} doesn't exist (${p.book} ${p.chapter} has ${ch.length} verses)`);
  return verses;
}

const cache = new Map();
// Every passage fetched is kept on disk too, so reading it again never needs the internet.
const CACHE_FILE = join(DIR, "passages.json");
let disk = null;
function diskCache() { if (!disk) { try { disk = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, "utf8")) : {}; } catch { disk = {}; } } return disk; }
function saveToDisk(key, verses) { try { mkdirSync(DIR, { recursive: true }); diskCache()[key] = verses; writeFileSync(CACHE_FILE, JSON.stringify(disk)); } catch { /* not fatal */ } }
export async function passage(refText, version = "kjv") {
  const p = typeof refText === "string" ? parseRef(refText) : refText;
  if (!p) throw new Error(`I couldn't tell which passage "${refText}" is.`);
  const v = VERSIONS[version] ? version : "kjv";
  const V = VERSIONS[v];
  if (V.unavailable) throw Object.assign(new Error(`${V.name} isn't available: it's copyrighted and has no free API. I can read it in the ESV or NLT (with a free key), or the KJV, WEB or ASV now.`), { unavailable: true });
  if (V.key && !process.env[V.key]) throw Object.assign(new Error(`The ${V.name} needs a free key (${V.key} in .env). I can read it in the KJV, WEB or ASV now.`), { unavailable: true });
  const key = `${v}|${p.ref}`;
  if (cache.has(key)) return cache.get(key);
  let verses;
  if (v === "esv") {
    const r = await fetch(`https://api.esv.org/v3/passage/text/?q=${encodeURIComponent(p.ref)}&include-headings=false&include-footnotes=false&include-verse-numbers=true&include-short-copyright=false&include-passage-references=false`, { headers: { Authorization: `Token ${process.env.ESV_API_KEY}` } });
    const j = await r.json();
    const text = (j.passages ?? [""]).join(" ");
    verses = text.split(/\[(\d+)\]/).slice(1).reduce((a, x, i, arr) => (i % 2 === 0 ? [...a, { n: Number(x), text: arr[i + 1].replace(/\s+/g, " ").trim() }] : a), []);
  } else if (v === "nlt") {
    const r = await fetch(`https://api.nlt.to/api/passages?ref=${encodeURIComponent(p.ref.replace(/ (\d+):/, ".$1."))}&version=NLT&key=${process.env.NLT_API_KEY}`);
    const html = await r.text();
    verses = [...html.matchAll(/<span class="vn">(\d+)<\/span>([\s\S]*?)(?=<span class="vn">|<\/verse_export>)/g)].map((m) => ({ n: Number(m[1]), text: m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() }));
  } else {
    const saved = diskCache()[key];
    try {
      if (saved) verses = saved;
      else {
        // one retry: the free service limits how fast it can be asked
        let r = await fetch(`https://bible-api.com/${encodeURIComponent(p.ref)}?translation=${v}`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
        if (!r || !r.ok) { await new Promise((z) => setTimeout(z, 1500)); r = await fetch(`https://bible-api.com/${encodeURIComponent(p.ref)}?translation=${v}`, { signal: AbortSignal.timeout(8000) }); }
        if (!r.ok) throw new Error(`bible-api ${r.status}`);
        const j = await r.json();
        verses = j.verses.map((x) => ({ n: x.verse, text: x.text.replace(/\s+/g, " ").trim() }));
        saveToDisk(key, verses);
      }
    } catch (e) {
      if (v !== "kjv") throw new Error(`I can't reach the ${V.name} right now. I can read it from the King James, which I keep offline.`);
      await loadKJV(); verses = fromKJV(p);               // offline: the KJV on disk
    }
  }
  if (!verses?.length) throw new Error(`I couldn't find ${p.ref} in the ${V.name}.`);
  const out = { reference: p.ref, version: v, versionName: V.name, verses, text: verses.map((x) => x.text).join(" ") };
  cache.set(key, out);
  return out;
}

// How it's read aloud: "John 3:16, from the King James Version. For God so loved…"
export function spoken(p) {
  const multi = p.verses.length > 1;
  const ref = p.reference.replace(/^Psalms (\d+)(?=:|$)/, "Psalm $1").replace(/^1 /, "First ").replace(/^2 /, "Second ").replace(/^3 /, "Third ");
  return `${ref.replace(/:/, " verse" + (multi ? "s " : " ")).replace(/-/, " through ")}, from the ${p.versionName}. ${p.text}`;
}

// Word search over the KJV: every word must appear. Returns the best matches.
export async function search(query, limit = 6) {
  await loadKJV();
  const words = String(query).toLowerCase().replace(/[^a-z\s']/g, " ").split(/\s+/).filter((w) => w.length > 2 && !/^(the|and|about|what|does|say|bible|verses?|scripture|for|with|that|this|from)$/.test(w));
  if (!words.length) throw new Error("what should I search for?");
  const hits = [];
  for (const b of kjv) b.chapters.forEach((ch, ci) => ch.forEach((v, vi) => {
    const low = v.toLowerCase();
    const score = words.filter((w) => new RegExp(`\\b${w.replace(/s$/, "")}`).test(low)).length;
    if (score === words.length) hits.push({ reference: `${b.book} ${ci + 1}:${vi + 1}`, text: v, score });
  }));
  return { query, words, total: hits.length, results: hits.slice(0, limit) };
}
export async function ensureOffline() { await loadKJV(); return { offlineKJV: true }; }
