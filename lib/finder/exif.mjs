// A picture's facts without any helper: its size in pixels (JPEG, PNG, GIF, WebP, BMP) and, for JPEGs, the EXIF date it
// was taken, the camera, the turn and whether it has a location (never the location itself). Reads the first 512 KB only.
//   facts(path) → { width, height, taken, camera, orientation, gps } (whatever is there)
import { openSync, readSync, closeSync } from "node:fs";

function head(path, n = 512 * 1024) {
  const fd = openSync(path, "r");
  try { const b = Buffer.alloc(n); const got = readSync(fd, b, 0, n, 0); return b.subarray(0, got); } finally { closeSync(fd); }
}
function tiff(b, start) {
  const le = b.toString("latin1", start, start + 2) === "II";
  const u16 = (o) => (le ? b.readUInt16LE(start + o) : b.readUInt16BE(start + o));
  const u32 = (o) => (le ? b.readUInt32LE(start + o) : b.readUInt32BE(start + o));
  const out = {};
  const str = (o, n) => b.toString("latin1", start + o, start + o + n).replace(/\0+$/, "").trim();
  const read = (ifd, depth = 0) => {
    if (depth > 2 || start + ifd + 2 > b.length) return;
    const n = u16(ifd);
    for (let i = 0; i < n && i < 400; i++) {
      const e = ifd + 2 + i * 12; if (start + e + 12 > b.length) return;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4), val = e + 8;
      const at = count * ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 }[type] ?? 1) > 4 ? u32(val) : val;
      if (start + at > b.length) continue;
      if (tag === 0x010f && type === 2) out.make = str(at, count);
      else if (tag === 0x0110 && type === 2) out.model = str(at, count);
      else if (tag === 0x0112) out.orientation = u16(val);
      else if ((tag === 0x9003 || (tag === 0x0132 && !out.taken)) && type === 2) out.taken = str(at, count);
      else if (tag === 0xa002) out.width = type === 3 ? u16(val) : u32(val);
      else if (tag === 0xa003) out.height = type === 3 ? u16(val) : u32(val);
      else if (tag === 0x8769) read(u32(val), depth + 1);
      else if (tag === 0x8825) out.gps = true;
    }
  };
  read(u32(4));
  return out;
}
// (bytes: how much of the file to read; the photo gallery reads less when it dates thousands of photos)
export function facts(path, { bytes = 512 * 1024 } = {}) {
  let b; try { b = head(path, bytes); } catch { return {}; }
  const out = {};
  try {
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const mk = b[i + 1], len = b.readUInt16BE(i + 2);
        if (mk === 0xe1 && b.toString("latin1", i + 4, i + 10) === "Exif\0\0") Object.assign(out, tiff(b, i + 10));
        else if (mk >= 0xc0 && mk <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(mk)) { out.height = b.readUInt16BE(i + 5); out.width = b.readUInt16BE(i + 7); break; }
        i += 2 + len;
      }
    } else if (b.toString("latin1", 1, 4) === "PNG") { out.width = b.readUInt32BE(16); out.height = b.readUInt32BE(20); }
    else if (b.toString("latin1", 0, 3) === "GIF") { out.width = b.readUInt16LE(6); out.height = b.readUInt16LE(8); }
    else if (b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") {
      const c = b.toString("latin1", 12, 16);
      if (c === "VP8X") { out.width = 1 + b.readUIntLE(24, 3); out.height = 1 + b.readUIntLE(27, 3); }
      else if (c === "VP8L") { const v = b.readUInt32LE(21); out.width = (v & 0x3fff) + 1; out.height = ((v >> 14) & 0x3fff) + 1; }
      else if (c === "VP8 ") { out.width = b.readUInt16LE(26) & 0x3fff; out.height = b.readUInt16LE(28) & 0x3fff; }
    } else if (b.toString("latin1", 0, 2) === "BM") { out.width = b.readInt32LE(18); out.height = Math.abs(b.readInt32LE(22)); }
  } catch { /* a damaged file: what was read so far */ }
  const camera = [out.make, out.model].filter(Boolean).join(" ").replace(/^(\w+) \1\b/i, "$1") || null;
  const taken = out.taken && /^\d{4}:\d\d:\d\d \d\d:\d\d/.test(out.taken) ? out.taken.replace(/^(\d{4}):(\d\d):(\d\d) /, "$1-$2-$3T") : null;
  return { width: out.width ?? null, height: out.height ?? null, taken, camera, orientation: out.orientation ?? null, gps: Boolean(out.gps) };
}
