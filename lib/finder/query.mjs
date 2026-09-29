// How someone asks for a file, in their own words, taken apart: "open last week's budget spreadsheet", "show me the
// picture named IMG underscore five seven eight two", "find the video from Sarah's wedding in Downloads", "the PDF called
// lease agreement", "photos from 2024".
//   parse(text, { now }) → { action, explicit, words, phrase, named, kinds, exts, after, before, year, month, latest,
//                            folder, source, plural, said } | null (not about finding or opening a file)
//   spokenToDigits("img five seven eight two") → "img 5782"      normWords(s) → the words of a file name, for matching
import { TYPE_WORDS } from "./kinds.mjs";

const UNITS = { zero: 0, oh: 0, o: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const TEENS = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const isNumWord = (w) => w in UNITS || w in TEENS || w in TENS || w === "hundred" || w === "thousand" || w === "double";
// A run of spoken number words → digits. People read file numbers digit by digit ("five seven eight two"), in pairs
// ("fifty seven eighty two"), or as years ("twenty twenty four", "two thousand nineteen", "nineteen ninety nine").
function runToDigits(ws) {
  // "two thousand (and) nineteen" → 2019
  const th = ws.indexOf("thousand");
  if (th > 0 && ws[th - 1] in UNITS) {
    const rest = ws.slice(th + 1).filter((w) => w !== "and");
    let n = UNITS[ws[th - 1]] * 1000;
    const r = rest.length ? Number(runToDigits(rest)) : 0;
    if (r < 1000) n += r;
    return String(n);
  }
  let out = "";
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    if (w === "double" && ws[i + 1] in UNITS) { out += String(UNITS[ws[i + 1]]).repeat(2); i++; continue; }
    if (w in TENS) { if (ws[i + 1] in UNITS && UNITS[ws[i + 1]] > 0 && ws[i + 1] !== "o" && ws[i + 1] !== "oh") { out += String(TENS[w] + UNITS[ws[i + 1]]); i++; } else out += String(TENS[w]); continue; }
    if (w in TEENS) { if (ws[i + 1] === "hundred") { out += String(TEENS[w]) + (ws[i + 2] ? "" : "00"); i++; continue; } out += String(TEENS[w]); continue; }
    if (w in UNITS) { if (ws[i + 1] === "hundred") { const next = ws.slice(i + 2).filter((x) => x !== "and"); out += next.length ? String(UNITS[w]) + runToDigits(next).padStart(2, "0") : String(UNITS[w] * 100); return out; } out += String(UNITS[w]); continue; }
  }
  return out;
}
export function spokenToDigits(s) {
  const ws = String(s).split(/\s+/);
  const out = [];
  for (let i = 0; i < ws.length; i++) {
    if (!isNumWord(ws[i]) || ((ws[i] === "o" || ws[i] === "oh") && !(isNumWord(ws[i + 1] ?? "") || isNumWord(ws[i - 1] ?? ""))) || ((ws[i] === "one") && !isNumWord(ws[i + 1] ?? "") && !isNumWord(ws[i - 1] ?? "") && /^(the|that|this|which|last|first|other|new|old|latest|newest)$/.test(ws[i - 1] ?? ""))) { out.push(ws[i]); continue; }
    let j = i; while (j < ws.length && (isNumWord(ws[j]) || (ws[j] === "and" && isNumWord(ws[j + 1] ?? "") && ws.slice(i, j).includes("thousand")))) j++;
    const run = ws.slice(i, j);
    const digits = runToDigits(run);
    // glue to a name part just before it that was spoken apart: "img 5782" stays two words (matched both ways)
    out.push(digits || run.join(" "));
    i = j - 1;
  }
  return out.join(" ");
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MON_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const monthIndex = (m) => MONTHS.findIndex((x) => x.startsWith(m.slice(0, 3)));
const OWN = new Set(("schedule calendar agenda day week month today tomorrow tonight date time clock weather forecast temperature alarm alarms timer timers reminder reminders settings setting "
  + "volume sound notifications sky news music song songs playlist queue number results list lists help menu screen avatar theme mail email inbox").split(" "));
const FOLDERS = ["downloads", "documents", "desktop", "pictures", "music", "videos", "onedrive", "camera roll", "screenshots", "saved pictures"];
// the words around a request that aren't part of the name
const STOP = new Set(("a an the my me i to for please can you could would will find search look locate where is was are were did do does have has had put saved save open show display view pull bring get give "
  + "let see want need that this these those it its some any all one ones of with about which what file files folder thing things called named titled labeled labelled "
  + "and or on in at from up out there here just really kind sort type again also").split(" "));
const VERBS_OPEN = /^(?:(?:hey |ok |okay )?(?:dayspring |computer )?,? ?)?(?:please |can you |could you |would you |will you |i (?:want|need|would like|'d like) to |let'?s |go ahead and )*(open|show|display|view|pull up|bring up|put up|let me see|get me|give me|i want to see)\b/;
const VERBS_FIND = /^(?:(?:hey |ok |okay )?(?:dayspring |computer )?,? ?)?(?:please |can you |could you |would you |will you |help me |i (?:want|need) to |i'?m trying to )*(find|search(?: for)?|look for|look up|locate|where(?:'s| is| are| did i (?:put|save|leave))|do i have|have i got|is there|are there|hunt down|track down|dig up|get|list|what(?= (?:\w+ )?(?:files?|documents?|docs|pdfs|pictures|photos|images|videos|spreadsheets|presentations|songs|recordings|screenshots)\b.*\b(?:do i have|have i got|are (?:there|in)|did i (?:save|download|take|make)|are on)\b))\b/;
// "this picture", "that file": the one on the screen, not one to find
const DEICTIC = /\b(this|that|the current) (picture|photo|image|pic|file|document|pdf|page|video|song|one on the screen)\b/;
// "show me another photo", "a different picture", "the next photo": the photo on the screen moves on (lib/photos), not a file to find
const ANOTHER = /^(?:(?:hey |ok |okay )?(?:dayspring |computer )?,? ?)?(?:please |can you |could you )?(?:show|give|get|pull up|put up|display)(?: me| us)? (?:another|a different|a new|a random|the next|the previous|one more|some other|a another) (?:picture|photo|image|pic|one)s?(?: please)?$/;

// → the words of a file name: lower case, separators and camelCase and letter/number boundaries split
export function normWords(name) {
  return String(name ?? "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Za-z])(\d)|(\d)([A-Za-z])/g, (m, a, b, c, d) => (a ? `${a} ${b}` : `${c} ${d}`)).toLowerCase()
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/['\u2019]s\b/g, "s").replace(/['\u2019]/g, "").split(/[^a-z0-9]+/).filter(Boolean);
}
export const compact = (s) => normWords(s).join("");

// parse(text) → what was asked, or null when it isn't about a file on this computer
export function parse(text, { now = new Date() } = {}) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  if (DEICTIC.test(raw.toLowerCase()) && !/\b(called|named|titled)\b/i.test(raw)) return null;
  if (ANOTHER.test(raw.toLowerCase()) && !/\b(called|named|titled)\b/i.test(raw)) return null;
  let t = " " + raw.toLowerCase().replace(/[\u201c\u201d"]/g, " ").replace(/[\u2019\u2018]/g, "'").replace(/[?!,;]+/g, " ").replace(/\.\s*$/, "").replace(/\s+/g, " ").trim() + " ";
  // spoken symbols in a file name: "img underscore 5782", "lease dash final", "resume dot pdf"
  t = " " + spokenToDigits(t.trim()) + " ";
  t = t.replace(/\s(?:under ?score)\s/g, "_").replace(/\s(?:dash|hyphen)\s/g, "-").replace(/\s(?:dot|period)\s(pdf|jpe?g|png|gif|heic|docx?|xlsx?|pptx?|csv|txt|md|mp4|mov|mp3|zip|json|html?|webp|log)\b/g, ".$1");
  const q = { raw, action: null, explicit: false, words: [], phrase: "", named: null, kinds: [], exts: [], after: null, before: null, year: null, month: null, latest: false, folder: null, source: null, plural: false, said: "" };
  const cut = (re, fn) => { const m = re.exec(t); if (!m) return null; t = t.slice(0, m.index) + " " + t.slice(m.index + m[0].length) + " "; t = t.replace(/\s+/g, " "); fn?.(m); return m; };
  // the verb
  let m = VERBS_OPEN.exec(t.trim());
  if (m) { q.action = "open"; t = " " + t.trim().slice(m[0].length) + " "; }
  else if ((m = VERBS_FIND.exec(t.trim()))) { q.action = /^(list|what)$/.test(m[1]) ? "list" : "find"; t = " " + t.trim().slice(m[0].length) + " "; }
  cut(/\s(?:me|for me|please)\s/);
  // where: Google Drive, or this computer
  cut(/\s(?:in|on|from) (?:my |the )?(?:(?:work|personal|school) )?google drive\s|\s(?:in|on|from) my (?:(?:work|personal|school) )?drive\s/, () => { q.source = "drive"; });
  cut(/\s(?:on|from|in) (?:my |this |the )?(?:computer|pc|laptop|hard drive|machine)\s/, () => { q.source = "local"; });
  // a folder: "in Downloads", "in my Pictures folder", "in the Taxes 2023 folder"
  cut(new RegExp(`\\s(?:in|inside|from|under|on|within) (?:my |the )?(${FOLDERS.join("|")})(?: folder)?\\s`), (x) => { q.folder = x[1]; });
  if (!q.folder) cut(/\s(?:in|inside|from|under|within) (?:my |the |a )?([\w' &-]{2,40}?) (?:folder|directory)\s/, (x) => { q.folder = x[1].trim(); });
  // a name said outright: "called lease agreement", "named IMG_5782", "titled 'The Plan'"
  const nm = /\s(?:called|named|titled|labell?ed|with the (?:file ?)?name|with (?:the )?name|whose name is|that'?s called|that is called)\s(.+?)\s*$/.exec(t);
  if (nm) { q.named = nm[1].trim(); }
  // when
  const DAY = 86_400_000, start = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = start(now);
  const setRange = (a, b, said) => { q.after = a; q.before = b; q.said = said; };
  cut(/\s(?:from |made |taken |saved |modified |edited |downloaded |created )?(?:earlier )?today(?:'s)?\s|\sthis morning(?:'s)?\s/, () => setRange(today, null, "today"));
  cut(/\s(?:from |made |taken |saved |edited |downloaded )?yesterday(?:'s)?\s/, () => setRange(new Date(today - DAY), today, "yesterday"));
  cut(/\s(?:from |made |taken |saved |edited |downloaded )?(?:the )?last (\d+) days\s|\s(?:from |in )?the past (\d+) days\s/, (x) => setRange(new Date(today - (Number(x[1] ?? x[2]) + 1) * DAY), null, `the last ${x[1] ?? x[2]} days`));
  cut(/\s(?:from )?(\d+|a few|a couple of) days ago(?:'s)?\s/, (x) => { const n = /\d/.test(x[1]) ? Number(x[1]) : 3; setRange(new Date(today - (n + 2) * DAY), new Date(today - Math.max(0, n - 2) * DAY + DAY), `${x[1]} days ago`); });
  cut(/\s(?:from |made |taken |saved |edited |downloaded )?(?:this|the past) week(?:'s)?\s|\s(?:from )?earlier this week\s/, () => setRange(new Date(today - 7 * DAY), null, "this week"));
  cut(/\s(?:from |made |taken |saved |edited |downloaded )?(?:last|past) week(?:'s)?\s|\s(?:from )?(?:a|one) week ago\s/, () => setRange(new Date(today - 14 * DAY), null, "last week"));
  cut(/\s(?:from |made |taken |saved |edited |downloaded )?this month(?:'s)?\s/, () => setRange(new Date(now.getFullYear(), now.getMonth(), 1), null, "this month"));
  cut(/\s(?:from |made |taken |saved |edited |downloaded )?last month(?:'s)?\s|\s(?:from )?a month ago\s/, () => setRange(new Date(now.getFullYear(), now.getMonth() - 1, 1), null, "last month"));
  cut(/\s(?:from |made |taken |saved |edited |downloaded )?this year(?:'s)?\s/, () => { q.year = now.getFullYear(); q.said = "this year"; });
  cut(/\s(?:from |made |taken |saved |edited |downloaded )?last year(?:'s)?\s|\s(?:from )?a year ago\s/, () => { q.year = now.getFullYear() - 1; q.said = "last year"; });
  cut(new RegExp(`\\s(?:from|in|during|taken in|made in|back in|of)? ?${MON_RE} (?:of )?((?:19|20)\\d\\d)(?:'s)?\\s`), (x) => { q.month = monthIndex(x[1]); q.year = Number(x[2]); q.said = `${MONTHS[q.month]} ${q.year}`; });
  cut(new RegExp(`\\s(?:from|in|during|taken in|made in|back in)(?: last)? ${MON_RE}(?:'s)?\\s`), (x) => { q.month = monthIndex(x[1]); q.said = MONTHS[q.month]; });
  cut(/\s(?:from|in|during|taken in|made in|back in|of) ((?:19|20)\d\d)(?:'s)?\s|\s((?:19|20)\d\d)'s\s/, (x) => { q.year = Number(x[1] ?? x[2]); q.said = String(q.year); });
  if (q.month != null && q.year == null) { const y = now.getFullYear(); q.year = q.month > now.getMonth() ? y - 1 : y; }
  cut(/\s(?:the )?(?:most recent|latest|newest|last|recent|recently (?:saved|downloaded|edited|added|taken)|new(?:est)? ?ly (?:added|saved)|just (?:saved|downloaded|took|taken))\s/, () => { q.latest = true; });
  cut(/\s(?:i (?:just )?(?:took|saved|downloaded|made|edited|got|received|scanned))\s/);
  // what kind
  const tw = t;
  for (const [re, what] of TYPE_WORDS) {
    const hit = re.exec(t);
    if (!hit) continue;
    const all = new RegExp(re.source, "g");
    if (/^(documents?|docs?)$/.test(hit[1]) && (q.kinds.length || q.exts.length)) { t = t.replace(all, " "); continue; }
    for (const x of what) (x.startsWith(".") ? q.exts : q.kinds).push(x.replace(/^\./, ""));
    if (/s\b/.test(hit[1]) && !/^(music|audio|slides|docs|clips|ss)$/.test(hit[1]) && /(s|es)$/.test(hit[1].split(" ")[0])) q.plural = true;
    t = t.replace(all, " ");
  }
  // "resume.pdf", ".jpg files"
  for (const x of t.matchAll(/(?:^|\s)[\w-]*\.(pdf|jpe?g|png|gif|heic|docx?|xlsx?|pptx?|csv|txt|md|mp4|mov|mp3|zip|json|html?|webp|log|wav|m4a)\b/g)) q.exts.push(x[1] === "jpg" ? "jpg" : x[1]);
  if (q.exts.includes("jpg") || q.exts.includes("jpeg")) q.exts.push("jpg", "jpeg", "jfif");
  q.kinds = [...new Set(q.kinds)]; q.exts = [...new Set(q.exts)];
  void tw;
  // what's left: the name
  const nameSrc = q.named ?? t;
  const words = nameSrc.replace(/'s\b/g, "s").split(/\s+/).map((w) => w.replace(/^[^\w.-]+|[^\w-]+$/g, "")).filter(Boolean)
    .filter((w) => q.named ? !/^(the|a|an|file|document|folder)$/.test(w) : !STOP.has(w));
  q.words = words.filter((w) => !/^\.(\w+)$/.test(w));
  q.phrase = q.words.join(" ");
  if (/\b(all|every|each)\b/.test(raw.toLowerCase()) || /\b(files|photos|pictures|videos|documents|pdfs|songs|images|spreadsheets)\b/.test(raw.toLowerCase())) q.plural = true;
  // clearly about a file: a kind of file, a name said outright, a folder, a date, or the word file
  const fileWord = /\b(files?|documents?|docs?|folders?|pdfs?|attachments?|downloads?)\b/.test(raw.toLowerCase());
  // (a date alone isn't enough: "what's today's date" isn't about a file)
  q.explicit = Boolean(q.action && (q.kinds.length || q.exts.length || q.named || q.folder || q.source === "local" || fileWord));
  // "what …" is only a list of files when it names a kind of file ("what pdfs do I have")
  if (q.action === "list" && !q.explicit) return null;
  // only a kind of thing, and nothing else ("open my music", "show me my photos"): that's the music or photos, not a file
  if (!q.words.length && !q.named && !q.latest && !q.after && q.year == null && !q.folder && !fileWord && q.source !== "local" && !q.exts.length) return null;
  // Dayspring's own things, asked for by name: never a file (unless a kind of file is named: "open my schedule pdf")
  if (!q.explicit && q.words.length && q.words.every((w) => OWN.has(w.toLowerCase()))) return null;
  if (!q.action && !(q.named && (q.kinds.length || q.exts.length))) return null;
  return q;
}
