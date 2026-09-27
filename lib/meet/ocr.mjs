// The last way to know who's in a meeting: read the name labels off a picture of the meeting window with Windows' own
// text recognition (built in and offline: the picture never leaves the computer and is deleted straight away). Only used
// when the page itself shows no tiles or People list that can be read (lib/meet/host.mjs).
//
//   await namesFromPicture(pngBuffer) → { ok, names: ["Rich Alvarez", "You", …], ms } (names as written; "You" is kept
//                                         so the roster can tell the owner apart)
//   pickNames(lines, { width, height }) → the lines that look like a name label (pure; tested)
import { execFile } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Meet's own words on the page (buttons, headings), never a person
const UI = /^(?:turn (?:on|off) .+|present(?: now)?|leave call|more options|chat with everyone|people|activities|host controls|meeting details|captions|in-call messages|send a message|join now|ask to join|everyone|raise hand|reactions|you'?re presenting|stop presenting|pin|unpin|mute|remove|contributors|in the meeting|waiting to join|add people|search for people|meeting host|hand raised|others might still see your full video|close|done|got it|ok|cancel|settings|help|report a problem|meet|google meet|rehearsal meeting|ready to join\??)$/i;

export function pickNames(lines = [], { width = 0, height = 0 } = {}) {
  const out = [];
  for (const l of Array.isArray(lines) ? lines : []) {
    const t = String(l?.text ?? "").replace(/\s+/g, " ").trim();
    if (t.length < 2 || t.length > 40) continue;
    const words = t.split(" ");
    if (words.length > 4) continue;                                  // a caption or a sentence, not a name
    if (/[0-9,;:!?@#/\\|<>{}[\]=+*_"“”…]/.test(t) || /\.$/.test(t) && !/\b[A-Z]\.$/.test(t)) continue;
    if (!words.every((w) => /^[\p{L}][\p{L}'’.-]*$/u.test(w))) continue;
    if (UI.test(t)) continue;
    if (height && l.y + (l.h ?? 0) > height * 0.92) continue;        // the control bar at the bottom
    if (l.h && (l.h < 8 || l.h > 80)) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

let runner = (file) => new Promise((resolve) => {
  execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(ROOT, "scripts", "meet-ocr.ps1"), "-Path", file],
    { windowsHide: true, timeout: 20_000, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
      // (Windows PowerShell's JSON can carry raw control characters from what was read: they're blanked first)
      try { resolve(JSON.parse(String(out ?? "").trim().split(/\r?\n/).pop().replace(/[\u0000-\u001f]/g, " "))); } catch { resolve({ ok: false, error: err?.message ?? "no answer" }); }
    });
});
export function _setRunner(fn) { runner = fn; }
export const available = () => process.platform === "win32";

export async function namesFromPicture(png) {
  if (!png?.length || !available()) return { ok: false, names: [] };
  const t0 = Date.now();
  const file = join(tmpdir(), `ds-meet-ocr-${process.pid}-${t0}.png`);
  try {
    writeFileSync(file, png);
    const r = await runner(file);
    if (!r?.ok) return { ok: false, names: [], error: r?.error ?? "unreadable" };
    return { ok: true, names: pickNames(r.lines, { width: r.width, height: r.height }), ms: Date.now() - t0, lang: r.lang ?? null };
  } finally { try { rmSync(file, { force: true }); } catch { /* already gone */ } }
}
