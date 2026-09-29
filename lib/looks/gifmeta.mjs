// How long an animation is, from its own bytes (expression mode shows a GIF for one or two whole loops, or for as long
// as Dayspring is talking): GIF frame delays, animated WebP frame durations, MP4 length.
//
//   gifInfo(buf)  → { frames, loopMs, loops (0 = forever), width, height, animated }     (throws on a file that isn't a GIF)
//   webpInfo(buf) → { frames, loopMs, loops, width, height, animated }
//   mp4Info(buf)  → { loopMs, width: null, height: null, animated: true }                 (mvhd duration / timescale)
//   mediaInfo(buf, type?) → whichever fits, or { animated: false, loopMs: 0 } for a still picture
//   planDuration(loopMs, speechMs, opts) → how long to show it: whole loops, fitted to the speech
//
// Browsers (Chrome, Edge, Firefox) play a GIF frame whose delay is 0 or 1 hundredth of a second as 1/10 s, so that is
// how it's counted here too; the loop then matches what's really on the screen.

export function gifInfo(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const sig = b.toString("latin1", 0, 6);
  if (sig !== "GIF87a" && sig !== "GIF89a") throw new Error("not a GIF");
  const width = b.readUInt16LE(6), height = b.readUInt16LE(8), packed = b[10];
  let p = 13;
  if (packed & 0x80) p += 3 * 2 ** ((packed & 7) + 1);           // the global colour table
  let frames = 0, cs = 0, loops = 1, delay = null;
  const skipBlocks = () => { while (p < b.length) { const n = b[p++]; if (!n) return; p += n; } };
  while (p < b.length) {
    const t = b[p++];
    if (t === 0x3b) break;                                          // trailer
    if (t === 0x21) {                                               // an extension
      const label = b[p++];
      if (label === 0xf9 && b[p] >= 4) { delay = b.readUInt16LE(p + 2); p += b[p] + 1; skipBlocks(); }   // graphic control: this frame's delay
      else if (label === 0xff && b[p] === 11 && b.toString("latin1", p + 1, p + 12) === "NETSCAPE2.0") {
        p += 12;
        if (b[p] >= 3 && b[p + 1] === 1) loops = b.readUInt16LE(p + 2);   // 0 = forever
        skipBlocks();
      } else skipBlocks();
    } else if (t === 0x2c) {                                        // an image (a frame)
      const ipacked = b[p + 8]; p += 9;
      if (ipacked & 0x80) p += 3 * 2 ** ((ipacked & 7) + 1);        // its own colour table
      p++;                                                          // LZW minimum code size
      skipBlocks();
      frames++;
      cs += delay === null || delay <= 1 ? 10 : delay;
      delay = null;
    } else break;                                                   // anything else: the file is damaged here
  }
  if (!frames) throw new Error("a GIF with no frames");
  return { frames, loopMs: frames > 1 ? cs * 10 : 0, loops, width, height, animated: frames > 1 };
}

export function webpInfo(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.toString("latin1", 0, 4) !== "RIFF" || b.toString("latin1", 8, 12) !== "WEBP") throw new Error("not a WebP");
  let p = 12, frames = 0, ms = 0, loops = 0, width = null, height = null, animated = false;
  while (p + 8 <= b.length) {
    const id = b.toString("latin1", p, p + 4), size = b.readUInt32LE(p + 4), d = p + 8;
    if (id === "VP8X") { animated = Boolean(b[d] & 0x02); width = 1 + b.readUIntLE(d + 4, 3); height = 1 + b.readUIntLE(d + 7, 3); }
    else if (id === "ANIM") loops = b.readUInt16LE(d + 4);
    else if (id === "ANMF") { frames++; const dur = b.readUIntLE(d + 12, 3); ms += dur <= 10 ? 100 : dur; }
    p = d + size + (size & 1);
  }
  return { frames: frames || 1, loopMs: frames > 1 ? ms : 0, loops, width, height, animated: animated && frames > 1 };
}

// the movie header (moov → mvhd): its duration over its timescale
export function mp4Info(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.toString("latin1", 4, 8) !== "ftyp") throw new Error("not an MP4");
  const at = b.indexOf("mvhd", 0, "latin1");
  if (at < 4) throw new Error("an MP4 without a movie header");
  const v = b[at + 4];
  let timescale, duration;
  if (v === 1) { timescale = b.readUInt32BE(at + 24); duration = Number(b.readBigUInt64BE(at + 28)); }
  else { timescale = b.readUInt32BE(at + 16); duration = b.readUInt32BE(at + 20); }
  if (!timescale) throw new Error("an MP4 without a timescale");
  return { frames: null, loopMs: Math.round((duration / timescale) * 1000), loops: 0, width: null, height: null, animated: true };
}

export function mediaInfo(buf, type = "") {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const head = b.toString("latin1", 0, 12);
  try {
    if (/^GIF8/.test(head) || type === "image/gif") return { type: "image/gif", ...gifInfo(b) };
    if (head.startsWith("RIFF") && head.endsWith("WEBP")) return { type: "image/webp", ...webpInfo(b) };
    if (head.slice(4, 8) === "ftyp") return { type: "video/mp4", ...mp4Info(b) };
  } catch (e) { return { type: type || null, animated: false, loopMs: 0, frames: 0, error: e.message }; }
  const png = b[0] === 0x89 && head.slice(1, 4) === "PNG", jpg = b[0] === 0xff && b[1] === 0xd8;
  return { type: png ? "image/png" : jpg ? "image/jpeg" : type || null, animated: false, loopMs: 0, frames: 1 };
}

// How long to show an expression: whole loops, fitted to how long Dayspring is talking.
//   - no speech (an event, a typed reply): 1 loop, or 2 short ones (and at least ~2.5 s, at most `max`)
//   - a long loop (≥ the speech): one loop, cut at the speech's end plus a moment if the loop is much longer
//   - a short loop: as many whole loops as fit the speech (1–2 for a medium loop, more for a tiny one), at most `max`
//   - a still picture: the speech's length (or `still`)
export function planDuration(loopMs, speechMs = 0, { min = 2500, max = 12_000, still = 4000 } = {}) {
  const L = Number(loopMs) || 0, S = Math.max(0, Number(speechMs) || 0);
  if (!L) return { ms: Math.round(Math.min(max, Math.max(min, S || still))), loops: 0, why: "still" };
  if (!S) { const n = L >= min ? 1 : Math.min(Math.ceil(min / L), Math.max(2, Math.floor(max / L))); return { ms: Math.min(max, n * L), loops: n, why: "loops" }; }
  if (L >= S) return L <= S * 1.6 || L <= max ? { ms: Math.min(max, L), loops: 1, why: "one loop" } : { ms: Math.min(max, Math.max(min, S + 600)), loops: 1, why: "cut to the speech" };
  let n = Math.max(1, Math.round(S / L));
  if (L >= 1500) n = Math.min(n, 2);                 // a medium loop: one or two times, not a slideshow
  while (n > 1 && n * L > max) n--;
  // a short loop never flashes by: enough whole loops to last at least `min`
  if (L < 1500 && n * L < min) n = Math.min(Math.ceil(min / L), Math.max(1, Math.floor(max / L)));
  return { ms: n * L, loops: n, why: n > 1 ? `${n} loops` : "one loop" };
}
