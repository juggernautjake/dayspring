// Who was spoken to, and what they asked: "Dayspring, what's a struct?" · "Hey Lantern what is…" · "@Lantern …" ·
// "…what time is it, Dayspring?". Captions and speech-to-text mishear names, so each assistant has a list of the
// usual mishearings. The first assistant named wins.
//
//   parseAddress("Hey Lantern, what does cfqueryparam do?") → { assistant: "lantern", question: "what does cfqueryparam do?", wake: "Hey Lantern," }
//   parseAddress("nothing for anyone here") → null
//
// The host app passes its assistant's own name and wake words: an assistant renamed by its owner still answers to
// them, and to its built-in name too ("Dayspring, …" keeps working after it becomes "Nova"):
//   createAddressParser({ names: { dayspring: ["Nova", "Hey Nova", "Computa"] } })
//   createAddressParser({ names: () => ({ dayspring: currentWakeWords() }) })   read on every parse: a rename or a new
//                                                                                wake word counts mid-meeting
//   parser.setNames({ dayspring: ["Aurora"] })                                  or replace them by hand
// "Hey"/"OK"/"Hi" at the front of a wake word is dropped (the parser already allows one before any name).

export const WAKE_NAMES = {
  dayspring: ["dayspring", "day spring", "day-spring", "days spring", "dace spring", "date spring", "dave spring", "daisy spring",
    "day springs", "dayspring's", "stay spring", "day springer", "des spring", "dare spring", "darespring"],
  lantern: ["lantern", "lanterns", "lantern's", "latern", "laterns", "lanturn", "lanton", "lantern's", "lan tern", "land tern", "lanterne"],
};

const norm = (t) => String(t ?? "").toLowerCase();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// words before the name only count as a request when they are one ("what time is it, Dayspring?"), not "I really like Lantern"
const QWORD = /^(?:(?:so|and|hey|ok(?:ay)?)\s+)?(?:what|what's|whats|who|who's|where|when|why|how|which|can|could|would|will|is|are|do|does|did|should|tell|give|show|explain|help|please)\b/i;
const asks = (all, before) => /\?\s*$/.test(all) || QWORD.test(before.split(/(?<=[.!?])\s+/).pop() ?? "");
const words = (t) => (String(t ?? "").match(/\S+/g) ?? []).length;

function patternFor(list) {
  const alt = [...new Set(list.map(norm).filter(Boolean))].sort((a, b) => b.length - a.length)
    .map((n) => esc(n).replace(/'/g, "['’]?").replace(/[-\s]+/g, "[\\s'-]?")).join("|");
  return `(?:${alt})`;
}

// "Hey Nova" → "nova"; "@Computa," → "computa"; nothing usable → ""
const cleanName = (n) => norm(n).replace(/^@/, "").replace(/^(?:hey|hi|ok(?:ay)?)[\s,]+/, "").replace(/[,.!?:;"“”]+/g, " ").replace(/\s+/g, " ").trim();

export function createAddressParser({ names = {} } = {}) {
  let source = names, key = null, all = {}, rx = {};
  function build(extra) {
    const k = JSON.stringify(extra ?? {});
    if (k === key) return;
    key = k; all = {};
    const add = (a, list) => { all[a] = [...new Set([...(all[a] ?? []), ...list.map(cleanName).filter((n) => n.length >= 2)])]; };
    for (const [a, list] of Object.entries(WAKE_NAMES)) add(a, list);
    for (const [a, list] of Object.entries(extra ?? {})) add(a, Array.isArray(list) ? list : [list]);
    rx = Object.fromEntries(Object.entries(all).map(([a, list]) =>
      [a, new RegExp(`(?:^|[\\s,.!?;:"“(])(@?(?:(?:hey|hi|ok(?:ay)?|so|and|um|uh)[\\s,]+)?@?${patternFor(list)})(?=$|[\\s,.!?;:"”)])[,.!?:;]*`, "i")]));
  }
  const current = () => { let n = {}; try { n = typeof source === "function" ? source() ?? {} : source ?? {}; } catch { n = {}; } build(n); };
  current();

  // → { assistant, question, wake, index } | null
  function parse(text) {
    const t = String(text ?? "").replace(/\s+/g, " ").trim();
    if (!t) return null;
    current();
    let best = null;
    for (const [a, r] of Object.entries(rx)) {
      const m = r.exec(t);
      if (m && (best === null || m.index < best.index)) best = { assistant: a, index: m.index, m };
    }
    if (!best) return null;
    const { m } = best;
    const start = m.index + m[0].indexOf(m[1]);
    const after = t.slice(m.index + m[0].length).trim().replace(/^[,.!?:;\s]+/, "");
    const before = t.slice(0, start).trim().replace(/[,.!?:;\s]+$/, "");
    let question = "";
    if (words(after) >= 2) question = after;
    else if (!after && words(before) >= 3 && asks(t, before)) question = before;
    else question = after;
    return { assistant: best.assistant, question: question.trim(), wake: m[0].trim(), index: start };
  }

  // Every place an assistant is named (for captions that grew: the LAST one is the newest request)
  function parseLast(text) {
    const t = String(text ?? "").replace(/\s+/g, " ").trim();
    let from = 0, last = null;
    for (let guard = 0; guard < 20; guard++) {
      const r = parse(t.slice(from));
      if (!r) break;
      last = { ...r, index: r.index + from };
      from = last.index + Math.max(1, r.wake.length);
    }
    return last ? { ...last, question: questionFromIndex(t, last) } : null;
  }
  const questionFromIndex = (t, r) => {
    const sub = parse(t.slice(r.index));
    if (sub && sub.question) return sub.question;
    // "…what's a struct, Lantern?" at the very end: the words before it (from the previous sentence break)
    const before = t.slice(0, r.index).replace(/[,.!?:;\s]+$/, "");
    const tail = before.split(/(?<=[.!?])\s+/).pop() ?? "";
    return words(tail) >= 3 && asks(t, tail) ? tail.trim() : "";
  };

  return {
    parse, parseLast,
    get names() { current(); return all; },
    setNames(n) { source = n ?? {}; current(); },
  };
}

const shared = createAddressParser();
export const parseAddress = (text) => shared.parse(text);
export const parseLastAddress = (text) => shared.parseLast(text);
