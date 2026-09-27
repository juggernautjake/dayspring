// Streaming sentence splitter: text arrives from the AI a few characters at a time; each complete sentence is handed
// to the voice as soon as it's done, so Dayspring starts talking while the rest is still being written.
//
//   const s = createSplitter({ onSentence(text), firstMin })
//   s.push(chunk)   s.flush()
//
// A sentence ends at . ! ? (or a line break) followed by a space/end, except in abbreviations ("Dr.", "e.g."), decimals
// ("3.5"), initials ("J. R."), times ("a.m.") and ellipses mid-thought. To get the first words out even sooner, a long
// first sentence may also be cut at a comma or dash once it has `firstMin` characters (spoken naturally as a pause).
const ABBR = /\b(?:mr|mrs|ms|dr|st|jr|sr|vs|etc|e\.g|i\.e|a\.m|p\.m|no|mt|ft|approx|dept|est|inc|ltd|co|u\.s|u\.k)\.$/i;

export function createSplitter({ onSentence = () => {}, firstMin = 40, maxLen = 240 } = {}) {
  let buf = "", sent = 0;
  const emit = (t) => { const s = t.replace(/\s+/g, " ").trim(); if (s) { sent++; onSentence(s); } };
  function scan(final) {
    for (;;) {
      let cut = -1;
      for (let i = 0; i < buf.length; i++) {
        const c = buf[i];
        if (c === "\n") { cut = i + 1; break; }
        if (c !== "." && c !== "!" && c !== "?") continue;
        // run of closing punctuation/quotes
        let j = i + 1; while (j < buf.length && /[.!?"'”’)\]]/.test(buf[j])) j++;
        if (j >= buf.length) { if (final) { cut = j; } break; }
        if (!/\s/.test(buf[j])) continue;                               // "3.5", "e.g.x", "Node.js"
        const head = buf.slice(0, i + 1);
        if (c === "." && ABBR.test(head)) continue;
        if (c === "." && /(?:^|\s)[A-Z]\.$/.test(head)) continue;      // an initial
        if (c === "." && /\.\.$/.test(head) && !/[.!?]\s*$/.test(buf.slice(j).trim().slice(0, 1))) { /* ellipsis: treat as an end */ }
        cut = j; break;
      }
      if (cut < 0 && sent === 0 && buf.length >= firstMin) {
        // the first sentence is long: speak up to a natural pause now
        const m = /^(.{25,}?[,;:—–])\s/.exec(buf.slice(0, maxLen));
        if (m) cut = m[1].length;
      }
      if (cut < 0 && buf.length >= maxLen) { const sp = buf.lastIndexOf(" ", maxLen); cut = sp > 40 ? sp : maxLen; }
      if (cut < 0) break;
      emit(buf.slice(0, cut)); buf = buf.slice(cut);
    }
  }
  return {
    push(chunk) { buf += String(chunk ?? ""); scan(false); },
    flush() { scan(true); emit(buf); buf = ""; },
    get count() { return sent; },
  };
}

export function splitAll(text, opts) { const out = []; const s = createSplitter({ ...opts, onSentence: (t) => out.push(t) }); s.push(text); s.flush(); return out; }
