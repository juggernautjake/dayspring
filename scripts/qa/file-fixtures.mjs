// Made-up files for the file finder and viewer tests (scripts/qa/file-viewer.mjs), written into a temp folder: never the
// owner's files. Pictures (JPEG with EXIF, PNG, GIF, WebP, BMP, SVG, and a HEIF-container .heic), a small MP4 with a
// .srt next to it, an MP3, a WMV (converted as it plays), PDFs with text, Word, Excel, CSV, PowerPoint, Markdown, code,
// a zip (with a secret-looking and a big file inside), an unknown type, secrets and private-looking files.
//   makeFixtures(home, outside) → { F: { name: path }, all: [paths] }
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { spawnSync } from "node:child_process";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(join(DESK, "package.json"));
const FF = require("ffmpeg-static");
const put = (p, data) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, data); return p; };
const age = (p, when) => { const d = new Date(when); utimesSync(p, d, d); return p; };

// ---- pictures -----------------------------------------------------------------------------------------------------------
export function png(w = 48, h = 32, rgb = [70, 110, 200]) {
  const row = Buffer.alloc(1 + w * 3); for (let x = 0; x < w; x++) { row[1 + x * 3] = (rgb[0] + x * 3) & 255; row[2 + x * 3] = rgb[1]; row[3 + x * 3] = rgb[2]; }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, "latin1"), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
// a TIFF block with Make, Model and (in the Exif IFD) DateTimeOriginal, little-endian
function exif({ make = "Canon", model = "Canon EOS R6", taken = "2024:07:04 18:30:00" } = {}) {
  const strs = [make + "\0", model + "\0", taken + "\0"].map((s) => Buffer.from(s, "latin1"));
  const ifd0 = 8, n0 = 3, exifIfd = ifd0 + 2 + n0 * 12 + 4, n1 = 1, data = exifIfd + 2 + n1 * 12 + 4;
  const b = Buffer.alloc(data + strs.reduce((a, s) => a + s.length, 0));
  b.write("II", 0, "latin1"); b.writeUInt16LE(42, 2); b.writeUInt32LE(ifd0, 4);
  let off = data;
  const entry = (at, tag, type, count, value) => { b.writeUInt16LE(tag, at); b.writeUInt16LE(type, at + 2); b.writeUInt32LE(count, at + 4); b.writeUInt32LE(value, at + 8); };
  b.writeUInt16LE(n0, ifd0);
  entry(ifd0 + 2, 0x010f, 2, strs[0].length, off); strs[0].copy(b, off); off += strs[0].length;
  entry(ifd0 + 14, 0x0110, 2, strs[1].length, off); strs[1].copy(b, off); off += strs[1].length;
  entry(ifd0 + 26, 0x8769, 4, 1, exifIfd);
  b.writeUInt32LE(0, ifd0 + 2 + n0 * 12);
  b.writeUInt16LE(n1, exifIfd);
  entry(exifIfd + 2, 0x9003, 2, strs[2].length, off); strs[2].copy(b, off);
  b.writeUInt32LE(0, exifIfd + 2 + n1 * 12);
  return b;
}
export function jpeg(w = 64, h = 48, withExif = true, tint = 0) {
  const jpg = require("jpeg-js");
  const data = Buffer.alloc(w * h * 4); for (let i = 0; i < w * h; i++) { data[i * 4] = (i % w) * 4 + tint; data[i * 4 + 1] = 120; data[i * 4 + 2] = (i / w) * 5; data[i * 4 + 3] = 255; }
  const out = jpg.encode({ data, width: w, height: h }, 85).data;
  if (!withExif) return out;
  const t = exif(), app1 = Buffer.alloc(4); app1[0] = 0xff; app1[1] = 0xe1; app1.writeUInt16BE(2 + 6 + t.length, 2);
  return Buffer.concat([out.subarray(0, 2), app1, Buffer.from("Exif\0\0", "latin1"), t, out.subarray(2)]);
}
function bmp(w = 20, h = 10) {
  const row = Math.ceil((w * 3) / 4) * 4, size = 54 + row * h, b = Buffer.alloc(size);
  b.write("BM", 0, "latin1"); b.writeUInt32LE(size, 2); b.writeUInt32LE(54, 10); b.writeUInt32LE(40, 14); b.writeInt32LE(w, 18); b.writeInt32LE(h, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28); b.writeUInt32LE(row * h, 34);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = 54 + y * row + x * 3; b[o] = 200; b[o + 1] = 80; b[o + 2] = x * 10; }
  return b;
}
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
function ffmpeg(out, args) { mkdirSync(dirname(out), { recursive: true }); const r = spawnSync(FF, ["-v", "error", "-y", ...args, out], { windowsHide: true, encoding: "utf8" }); if (r.status !== 0) throw new Error(`ffmpeg couldn't make ${out}: ${r.stderr}`); return out; }

// ---- a PDF with real text (Helvetica, one text block per line) ---------------------------------------------------------
export function pdf(pages, title = "") {
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const cat = add(""), pagesId = add(""), font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids = [];
  for (const lines of pages) {
    const esc = (s) => s.replace(/[\\()]/g, (c) => "\\" + c);
    const body = lines.map((l, i) => `BT /F1 ${i === 0 ? 20 : 12} Tf 72 ${720 - i * 26} Td (${esc(l)}) Tj ET`).join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(body, "latin1")} >>\nstream\n${body}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objs[cat - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  const info = title ? add(`<< /Title (${title}) >>`) : null;
  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"; const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, "latin1")); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R${info ? ` /Info ${info} 0 R` : ""} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

// ---- Office files ---------------------------------------------------------------------------------------------------------
async function zipOf(files) { const JSZip = require("jszip"); const z = new JSZip(); for (const [n, d] of Object.entries(files)) z.file(n, d); return z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }); }
export async function docx(paras) {
  const x = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const body = paras.map((p) => (p.h ? `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${x(p.h)}</w:t></w:r></w:p>` : `<w:p><w:r>${p.b ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${x(p.t ?? p)}</w:t></w:r></w:p>`)).join("");
  return zipOf({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  });
}
export function xlsx(sheets) {
  const XLSX = require("xlsx");
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
export async function pptx(slides, image) {
  const files = { "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/></Types>` };
  slides.forEach((s, i) => {
    const n = i + 1;
    files[`ppt/slides/slide${n}.xml`] = `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree>${[s.title, ...s.bullets].map((t) => `<p:sp><p:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sp>`).join("")}${s.pic ? `<p:pic><p:blipFill><a:blip r:embed="rIdImg"/></p:blipFill></p:pic>` : ""}</p:spTree></p:cSld></p:sld>`;
    if (s.pic) files[`ppt/slides/_rels/slide${n}.xml.rels`] = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>`;
    if (s.notes) files[`ppt/notesSlides/notesSlide${n}.xml`] = `<?xml version="1.0"?><p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><a:p><a:r><a:t>${s.notes}</a:t></a:r></a:p></p:notes>`;
  });
  files["ppt/media/image1.png"] = image;
  return zipOf(files);
}

// ---- the whole set ----------------------------------------------------------------------------------------------------------
export async function makeFixtures(H, OUT) {
  const D = (...p) => join(H, ...p);
  const now = Date.now(), day = 86_400_000;
  const F = {};
  // documents
  F.lease = age(put(D("Documents", "Lease Agreement.pdf"), pdf([["Lease Agreement", "This lease is made between the landlord and the tenant.", "The term is twelve months."], ["Payment", "The monthly rent is 1,200 dollars, due on the first.", "Late rent costs 50 dollars."], ["Signatures", "Signed by both parties."]], "Lease Agreement")), now - 90 * day);
  F.leaseSigned = age(put(D("Downloads", "lease_agreement_signed.pdf"), pdf([["Signed lease", "Countersigned copy."]])), now - 60 * day);
  F.invoice = age(put(D("Downloads", "invoice-7731.pdf"), pdf([["Invoice 7731", "Total due: 42 dollars."]])), now - 2 * day);
  F.resume = put(D("Documents", "Resume 2024.docx"), await docx([{ h: "Sam Example" }, "Experienced technician and planner.", { t: "Skills: scheduling, repairs, customer care.", b: true }]));
  F.budget26 = age(put(D("Documents", "Budget 2026.xlsx"), xlsx({ Monthly: [["Category", "Amount"], ["Rent", 1200], ["Groceries", 450], ["Gas", 160]], Yearly: [["Year", "Total"], [2026, 21000]] })), now - 5 * day);
  F.budget23 = age(put(D("Documents", "Budget 2023.xlsx"), xlsx({ Monthly: [["Category", "Amount"], ["Rent", 1000]] })), "2023-03-10T12:00:00");
  F.household = age(put(D("Documents", "Finance", "Household Budget Summary.csv"), "Item,Cost\nPower,120\nWater,40\n"), now - 200 * day);
  F.report = put(D("Documents", "Quarterly Report Final.pptx"), await pptx([{ title: "Quarterly Report", bullets: ["Sales up 12 percent", "New customers: 40"], pic: true, notes: "Thank the team" }, { title: "Next Quarter", bullets: ["Hire two people"] }], png(40, 30, [220, 60, 60])));
  F.grocery = put(D("Documents", "Grocery List.txt"), "Milk\nEggs\nBread\nApples\n");
  F.notes = put(D("Documents", "Meeting Notes.md"), "# Meeting Notes\n\n- Discuss the **budget**\n- Plan the trip\n\n| Who | Task |\n|---|---|\n| Sam | Tickets |\n\n<script>window.__mdRan=1</script>\n");
  F.contacts = put(D("Documents", "contacts.csv"), "Name,Age,City\nZoe,31,Austin\nAdam,45,Boston\nMia,9,Chicago\nBen,120,Denver\n");
  F.pie = put(D("Documents", "Recipes", "Grandmas Apple Pie.docx"), await docx([{ h: "Grandma's Apple Pie" }, "Six apples, a cup of sugar, cinnamon."]));
  F.appjs = put(D("Documents", "Code", "app.js"), "// a tiny app\nconst greeting = \"hello\";\nfunction hi(name) { return `${greeting}, ${name}`; }\nconsole.log(hi(\"Sam\"));\n");
  F.py = put(D("Documents", "Code", "analysis.py"), "import math\n\ndef area(r):\n    return math.pi * r ** 2\n\nprint(area(2))\n");
  F.json = put(D("Documents", "Code", "config.json"), '{"name":"demo","port":8080,"tags":["a","b"]}');
  F.zip = put(D("Documents", "archive", "Old Photos.zip"), await zipOf({ "readme.txt": "These are old photos from the farm.", "pics/barn.png": png(30, 20), ".env": "API_KEY=do-not-show", "Private/diary.txt": "private", "big.bin": Buffer.alloc(30 * 1024 * 1024) }));
  F.unknown = put(D("Documents", "mystery.xyz"), Buffer.from([1, 2, 3, 4, 5, 250, 251]));
  F.thesis = put(D("OneDrive", "Documents", "Thesis Draft.docx"), await docx(["A draft about rivers."]));
  // pictures
  F.img5782 = age(put(D("Pictures", "IMG_5782.jpg"), jpeg(64, 48, true)), now - 400 * day);
  F.img5783 = put(D("Pictures", "IMG_5783.jpg"), jpeg(64, 48, false, 40));
  F.sunset = put(D("Pictures", "Lake Tahoe", "Sunset at the lake.png"), png(80, 50, [240, 140, 40]));
  F.dsc = put(D("Pictures", "Lake Tahoe", "DSC_0042.jpg"), jpeg(40, 30, false, 90));
  F.bday1 = age(put(D("Pictures", "2024", "Birthday Party 001.jpg"), jpeg(40, 30, false, 10)), "2024-06-15T15:00:00");
  F.bday2 = age(put(D("Pictures", "2024", "Birthday Party 002.jpg"), jpeg(40, 30, false, 20)), "2024-06-15T15:05:00");
  F.shot = age(put(D("Pictures", "Screenshots", "Screenshot 2026-09-20 101500.png"), png(60, 40)), now - 9 * day);
  F.svg = put(D("Pictures", "diagram.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="40"><rect width="60" height="40" fill="#4a8"/><script>window.top.__svgRan=1</script></svg>`);
  F.gif = put(D("Pictures", "logo.gif"), GIF);
  F.bmp = put(D("Pictures", "scan of drawing.bmp"), bmp());
  F.webp = ffmpeg(D("Pictures", "banner.webp"), ["-f", "lavfi", "-i", "testsrc=size=64x40", "-frames:v", "1", "-c:v", "libwebp"]);
  // (a HEIF container: ffmpeg can't write HEVC-in-HEIF, but it writes AV1-in-HEIF, which Windows' HEIF decoder reads the same way)
  F.heic = ffmpeg(D("Pictures", "iPhone", "IMG_0001.heic"), ["-f", "lavfi", "-i", "testsrc=size=64x48", "-frames:v", "1", "-c:v", "libaom-av1", "-still-picture", "1", "-f", "avif"]);
  // video and audio
  F.wedding = ffmpeg(D("Videos", "Sarah's Wedding", "ceremony.mp4"), ["-f", "lavfi", "-i", "testsrc=size=64x48:rate=10:duration=6", "-f", "lavfi", "-i", "sine=frequency=330:duration=6", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-metadata", "title=Sarah's Wedding Ceremony"]);
  F.srt = put(D("Videos", "Sarah's Wedding", "ceremony.en.srt"), "1\n00:00:00,500 --> 00:00:03,000\nWelcome, everyone.\n\n2\n00:00:03,500 --> 00:00:05,500\nPlease be seated.\n");
  F.toast = ffmpeg(D("Videos", "Birthday Toast.wmv"), ["-f", "lavfi", "-i", "testsrc=size=64x48:rate=10:duration=3", "-f", "lavfi", "-i", "sine=frequency=500:duration=3", "-c:v", "wmv2", "-c:a", "wmav2", "-shortest"]);
  F.song = ffmpeg(D("Music", "Holy Forever.mp3"), ["-f", "lavfi", "-i", "sine=frequency=440:duration=5", "-c:a", "libmp3lame", "-b:a", "64k", "-metadata", "title=Holy Forever", "-metadata", "artist=Chris Tomlin"]);
  // desktop
  F.plan = put(D("Desktop", "Project Plan.md"), "# Project Plan\n\n1. Draw it\n2. Build it\n");
  F.todo = put(D("Desktop", "Todo.txt"), "Call the plumber\n");
  // never found: secrets, private-looking places and names, and a folder outside
  F.passwords = put(D("Documents", "passwords.txt"), "hunter2");
  F.env = put(D("Documents", ".env"), "SECRET=1");
  F.idrsa = put(D("Documents", "keys", "id_rsa"), "-----BEGIN KEY-----");
  F.wallet = put(D("Documents", "my wallet backup.dat"), "coins");
  F.taxes = put(D("Documents", "Taxes", "2023 return.pdf"), pdf([["Tax return"]]));
  F.insurance = put(D("Documents", "Car Insurance.pdf"), pdf([["Policy"]]));
  F.privatePic = put(D("Pictures", "Private", "secret lake photo.jpg"), jpeg(20, 20, false));
  F.outside = put(join(OUT, "Outside Plan.pdf"), pdf([["Outside plan"]]));
  return { F };
}
