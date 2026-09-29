// Test pictures for scripts/qa/themes-avatar.mjs (made here, byte by byte; nothing downloaded):
// GIFs with known frame delays, an animated WebP and an MP4 header with known lengths, and small PNGs for the avatar.
//   node scripts/qa/fixtures/avatar/make-fixtures.mjs      (writes the files next to it, and manifest.json)
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const u16 = (n) => [n & 255, (n >> 8) & 255];
// a GIF of 1×1 frames: each frame its own colour (a local colour table) and delay (hundredths of a second)
export function gif({ delays, colors = null, loops = 0, netscape = true, extras = false }) {
  const b = [...Buffer.from("GIF89a"), ...u16(1), ...u16(1), 0x80, 0, 0, 0x10, 0x10, 0x30, 0xff, 0xff, 0xff];
  if (netscape) b.push(0x21, 0xff, 0x0b, ...Buffer.from("NETSCAPE2.0"), 0x03, 0x01, ...u16(loops), 0x00);
  if (extras) b.push(0x21, 0xfe, 0x05, ...Buffer.from("hello"), 0x00);          // a comment, to be skipped
  delays.forEach((d, i) => {
    b.push(0x21, 0xf9, 0x04, 0x00, ...u16(d), 0x00, 0x00);
    const c = colors?.[i % colors.length];
    b.push(0x2c, ...u16(0), ...u16(0), ...u16(1), ...u16(1), c ? 0x80 : 0x00);
    if (c) b.push(...c, 0, 0, 0);                                                   // a 2-colour local table
    b.push(0x02, 0x02, 0x44, 0x01, 0x00);                                           // clear, pixel 0, end
  });
  b.push(0x3b);
  return Buffer.from(b);
}
// an animated WebP's chunk structure (VP8X + ANIM + ANMF frames with durations in ms)
export function webp(durations) {
  const chunk = (id, data) => { const pad = data.length & 1 ? [0] : []; const h = Buffer.alloc(8); h.write(id, 0, "latin1"); h.writeUInt32LE(data.length, 4); return Buffer.concat([h, data, Buffer.from(pad)]); };
  const vp8x = Buffer.alloc(10); vp8x[0] = 0x02; vp8x.writeUIntLE(0, 4, 3); vp8x.writeUIntLE(0, 7, 3);
  const anim = Buffer.alloc(6); anim.writeUInt16LE(0, 4);
  const frames = durations.map((d) => { const f = Buffer.alloc(16); f.writeUIntLE(0, 6, 3); f.writeUIntLE(0, 9, 3); f.writeUIntLE(d, 12, 3); return chunk("ANMF", f); });
  const body = Buffer.concat([Buffer.from("WEBP", "latin1"), chunk("VP8X", vp8x), chunk("ANIM", anim), ...frames]);
  const head = Buffer.alloc(8); head.write("RIFF", 0, "latin1"); head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}
// an MP4's boxes: ftyp and moov → mvhd (version 0) with a timescale and a duration
export function mp4(timescale, duration) {
  const box = (type, data) => { const h = Buffer.alloc(8); h.writeUInt32BE(8 + data.length, 0); h.write(type, 4, "latin1"); return Buffer.concat([h, data]); };
  const ftyp = box("ftyp", Buffer.concat([Buffer.from("isom", "latin1"), Buffer.alloc(4), Buffer.from("isomiso2mp41", "latin1")]));
  const mvhd = Buffer.alloc(100); mvhd[0] = 0; mvhd.writeUInt32BE(timescale, 12); mvhd.writeUInt32BE(duration, 16);
  return Buffer.concat([ftyp, box("moov", box("mvhd", mvhd))]);
}
// a small solid PNG (for the avatar's picture slots)
export function png(w, h, [r, g, b]) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type, "latin1"), len = Buffer.alloc(4), c = Buffer.alloc(4); len.writeUInt32BE(data.length); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

export const FIXTURES = {
  "three-frames.gif": { make: () => gif({ delays: [10, 20, 20], colors: [[255, 80, 120], [80, 200, 255], [255, 210, 80]] }), expect: { frames: 3, loopMs: 500, loops: 0, animated: true } },
  "zero-delay.gif": { make: () => gif({ delays: [0, 1, 0, 1], colors: [[255, 0, 0], [0, 255, 0]] }), expect: { frames: 4, loopMs: 400, loops: 0, animated: true } },
  "still.gif": { make: () => gif({ delays: [0], netscape: false }), expect: { frames: 1, loopMs: 0, loops: 1, animated: false } },
  "loop-once.gif": { make: () => gif({ delays: [5, 5], loops: 1 }), expect: { frames: 2, loopMs: 100, loops: 1, animated: true } },
  "local-tables.gif": { make: () => gif({ delays: [25, 75], colors: [[10, 20, 30], [200, 100, 50]], extras: true }), expect: { frames: 2, loopMs: 1000, loops: 0, animated: true } },
  "long-loop.gif": { make: () => gif({ delays: [150, 150, 150, 150], colors: [[120, 140, 255], [167, 139, 250]] }), expect: { frames: 4, loopMs: 6000, loops: 0, animated: true } },
  "anim.webp": { make: () => webp([100, 200, 300]), expect: { frames: 3, loopMs: 600, animated: true } },
  "clip.mp4": { make: () => mp4(1000, 2500), expect: { loopMs: 2500, animated: true } },
  "avatar-idle.png": { make: () => png(64, 64, [255, 143, 163]), expect: { type: "image/png" } },
  "avatar-listen.png": { make: () => png(64, 64, [126, 227, 176]), expect: { type: "image/png" } },
};
if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase()) {
  const manifest = {};
  for (const [name, f] of Object.entries(FIXTURES)) { writeFileSync(join(HERE, name), f.make()); manifest[name] = f.expect; }
  writeFileSync(join(HERE, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`wrote ${Object.keys(FIXTURES).length} fixtures to ${HERE}`);
}
