// What kind of file something is, for the finder and the viewer: which viewer shows it, what it's called out loud,
// and the words people use for it ("picture", "spreadsheet", "PDF").
//   kindOf(name)  → "image" | "video" | "audio" | "pdf" | "text" | "markdown" | "csv" | "code" | "docx" | "doc" | "sheet"
//                   | "slides" | "zip" | "other"
//   typeName(ext) → "PDF", "Word document", "picture"…     MIME[ext] → the content type the file is served with
import { extname } from "node:path";

const SETS = {
  image: ["jpg", "jpeg", "jfif", "png", "gif", "webp", "bmp", "svg", "heic", "heif", "avif", "ico", "tif", "tiff"],
  video: ["mp4", "m4v", "mkv", "webm", "mov", "avi", "wmv", "mpg", "mpeg", "3gp"],
  audio: ["mp3", "m4a", "aac", "flac", "wav", "ogg", "opus", "wma"],
  pdf: ["pdf"],
  markdown: ["md", "markdown"],
  csv: ["csv", "tsv"],
  text: ["txt", "log", "ini", "cfg", "conf", "srt", "vtt", "nfo"],
  code: ["js", "mjs", "cjs", "ts", "tsx", "jsx", "json", "css", "scss", "html", "htm", "xml", "yml", "yaml", "toml", "py", "c", "cpp", "h", "hpp", "cs", "java", "go", "rs", "rb", "php", "lua",
    "sql", "sh", "bash", "ps1", "psm1", "bat", "cmd", "cfm", "cfc", "ino", "scad", "gcode", "kt", "swift", "vb", "r", "pl", "dart"],
  docx: ["docx", "docm", "dotx"],
  doc: ["doc", "rtf", "odt"],
  sheet: ["xlsx", "xlsm", "xls", "ods"],
  slides: ["pptx"],
  zip: ["zip"],
};
const BY_EXT = new Map(Object.entries(SETS).flatMap(([k, xs]) => xs.map((x) => [x, k])));
export const extOf = (name) => extname(String(name ?? "")).slice(1).toLowerCase();
export const kindOf = (name) => BY_EXT.get(extOf(name)) ?? "other";
export const KINDS = Object.keys(SETS);
export const extsOf = (kind) => SETS[kind] ?? [];
// the browser can't show these pictures itself: Windows decodes them (lib/vision/helper.mjs) into a JPEG
export const NEEDS_DECODE = new Set(["heic", "heif", "tif", "tiff"]);

const NAMES = { pdf: "PDF", docx: "Word document", docm: "Word document", dotx: "Word template", doc: "Word document (older format)", rtf: "Rich Text document", odt: "OpenDocument text",
  xlsx: "Excel spreadsheet", xlsm: "Excel spreadsheet", xls: "Excel spreadsheet (older format)", ods: "OpenDocument spreadsheet", csv: "CSV table", tsv: "table",
  pptx: "PowerPoint presentation", zip: "zip archive", md: "Markdown document", markdown: "Markdown document", txt: "text file", log: "log file", json: "JSON file" };
const KIND_NAMES = { image: "picture", video: "video", audio: "audio file", code: "code file", text: "text file", markdown: "Markdown document", csv: "table", other: "file" };
export const typeName = (ext) => NAMES[String(ext).toLowerCase()] ?? KIND_NAMES[BY_EXT.get(String(ext).toLowerCase()) ?? "other"] ?? "file";

export const MIME = {
  jpg: "image/jpeg", jpeg: "image/jpeg", jfif: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml", avif: "image/avif", ico: "image/x-icon",
  heic: "image/heic", heif: "image/heif", tif: "image/tiff", tiff: "image/tiff",
  mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac", wav: "audio/wav", ogg: "audio/ogg", opus: "audio/ogg", wma: "audio/x-ms-wma",
  mp4: "video/mp4", m4v: "video/mp4", mkv: "video/x-matroska", webm: "video/webm", mov: "video/quicktime", avi: "video/x-msvideo", wmv: "video/x-ms-wmv", mpg: "video/mpeg", mpeg: "video/mpeg", "3gp": "video/3gpp",
  pdf: "application/pdf", zip: "application/zip", txt: "text/plain; charset=utf-8", csv: "text/csv; charset=utf-8", json: "application/json",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
// served as they are, the browser would run these (a page, a picture with script in it): they go out as plain text or
// are drawn from a sandboxed <img>, never as a page of Dayspring's own
export const ACTIVE = new Set(["html", "htm", "svg", "xml", "xhtml", "js", "mjs"]);

// Prism's name for a code file's language
const LANG = { js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx", ts: "typescript", tsx: "tsx", json: "json", css: "css", scss: "css", html: "markup", htm: "markup", xml: "markup", svg: "markup",
  yml: "yaml", yaml: "yaml", toml: "toml", py: "python", c: "c", h: "c", cpp: "cpp", hpp: "cpp", ino: "cpp", cs: "csharp", java: "java", go: "go", rs: "rust", rb: "ruby", php: "php", lua: "lua",
  sql: "sql", sh: "bash", bash: "bash", ps1: "powershell", psm1: "powershell", bat: "batch", cmd: "batch", ini: "ini", cfg: "ini", conf: "ini", md: "markdown", markdown: "markdown", kt: "java", swift: "clike", dart: "clike" };
export const langOf = (ext) => LANG[String(ext).toLowerCase()] ?? null;

// ---- the words people say for a kind of file ---------------------------------------------------------------------------
// [pattern, kinds or exts]  (exts: ".pdf" style)
export const TYPE_WORDS = [
  [/\b(pictures?|photos?|photographs?|pics?|images?|snapshots?|selfies?|jpe?gs?|pngs?|heics?|gifs?)\b/, ["image"]],
  [/\b(videos?|movies?|clips?|films?|mp4s?|recordings? of|home movies?|footage)\b/, ["video"]],
  [/\b(songs?|music|audio|mp3s?|tracks?|voice (memos?|notes?|recordings?)|podcasts?|sound files?)\b/, ["audio"]],
  [/\bpdfs?\b/, [".pdf"]],
  [/\b(spreadsheets?|excel( files?| sheets?)?|workbooks?|xlsx?|csvs?|sheets?)\b/, ["sheet", "csv"]],
  [/\b(powerpoints?|presentations?|slides?|slide ?shows?|decks?|pptx?)\b(?! show)/, ["slides"]],
  [/\b(word (docs?|documents?|files?)|docx)\b/, ["docx", "doc"]],
  [/\b(zips?|zip files?|archives?|compressed (files?|folders?))\b/, ["zip"]],
  [/\b(text files?|txt|notes? files?|log files?|logs?)\b/, ["text", "markdown"]],
  [/\b(markdown|md files?)\b/, ["markdown"]],
  [/\b(code|scripts?|source files?|python files?|javascript files?|json files?)\b/, ["code"]],
  [/\b(documents?|docs?)\b/, ["docx", "doc", "pdf", "text", "markdown", "slides", "sheet"]],
];
