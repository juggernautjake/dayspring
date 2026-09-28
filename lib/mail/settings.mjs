// Mail settings (Settings → Email) and each mailbox's own choices, in data/connectors/mail.json with the IMAP accounts
// (lib/mail/imap.mjs keeps those). Nothing secret here: passwords are sealed by lib/mail/secret.mjs.
//   prefs      the owner's choices for composing, reading, privacy and voice (defaults below)
//   boxes      per mailbox (by key: "g:g1" Gmail, "ms" Outlook, "i:m1" IMAP): nickname, colour, signatures, notify
//   imagesFrom senders whose pictures load without asking ("always show images from …")
//   primary    the mailbox used when none is named
import * as store from "../connectors/store.mjs";

export const DEFAULT_PREFS = {
  // composing
  font: "Arial, Helvetica, sans-serif", size: "14px", replyStyle: "above",   // above = write above the quoted original
  undoSeconds: 10, autosaveSeconds: 5, spellLang: "en-US", tone: "friendly",
  // reading
  remoteImages: "ask",            // never | ask | known (senders you've written to or allowed)
  markReadOnOpen: true, conversationView: true, previewLines: 1, notifyNew: true,
  // privacy: what may go to the AI: none (no email tools) | headers (from, subject, date only) | full (bodies when asked)
  aiAccess: "full",
  // voice
  readAloud: true, readRate: 1,
};
const TONES = ["friendly", "professional", "formal", "warm", "brief", "casual"];
const FONTS = ["Arial, Helvetica, sans-serif", "Georgia, serif", "'Times New Roman', Times, serif", "Verdana, Geneva, sans-serif", "'Trebuchet MS', sans-serif", "'Courier New', Courier, monospace", "Tahoma, sans-serif", "'Segoe UI', sans-serif"];
const SIZES = ["10px", "12px", "13px", "14px", "16px", "18px", "20px", "24px"];
export const CHOICES = { tones: TONES, fonts: FONTS, sizes: SIZES, remoteImages: ["never", "ask", "known"], aiAccess: ["none", "headers", "full"], replyStyle: ["above", "below"] };

const load = () => store.load("mail");
const save = (d) => store.save("mail", d);
export function data() { const d = load(); d.v ??= 1; d.accounts ??= []; d.next ??= 1; d.boxes ??= {}; d.imagesFrom ??= []; d.prefs ??= {}; return d; }
export function write(fn) { const d = data(); const r = fn(d); save(d); return r; }

const clamp = (n, a, b, dflt) => { const x = Number(n); return Number.isFinite(x) ? Math.max(a, Math.min(b, x)) : dflt; };
export function prefs() { return { ...DEFAULT_PREFS, ...cleanPrefs(data().prefs) }; }
function cleanPrefs(p = {}) {
  const o = {};
  if (FONTS.includes(p.font)) o.font = p.font;
  if (SIZES.includes(p.size)) o.size = p.size;
  if (["above", "below"].includes(p.replyStyle)) o.replyStyle = p.replyStyle;
  if (p.undoSeconds !== undefined) o.undoSeconds = clamp(p.undoSeconds, 0, 30, 10);
  if (p.autosaveSeconds !== undefined) o.autosaveSeconds = clamp(p.autosaveSeconds, 2, 120, 5);
  if (typeof p.spellLang === "string" && /^[a-z]{2,3}(-[A-Z]{2})?$/.test(p.spellLang)) o.spellLang = p.spellLang;
  if (TONES.includes(p.tone)) o.tone = p.tone;
  if (["never", "ask", "known"].includes(p.remoteImages)) o.remoteImages = p.remoteImages;
  for (const k of ["markReadOnOpen", "conversationView", "notifyNew", "readAloud"]) if (typeof p[k] === "boolean") o[k] = p[k];
  if (p.previewLines !== undefined) o.previewLines = clamp(p.previewLines, 0, 3, 1);
  if (["none", "headers", "full"].includes(p.aiAccess)) o.aiAccess = p.aiAccess;
  if (p.readRate !== undefined) o.readRate = clamp(p.readRate, 0.6, 1.6, 1);
  return o;
}
export function setPrefs(patch = {}) { return write((d) => { d.prefs = { ...cleanPrefs(d.prefs), ...cleanPrefs(patch) }; return { ...DEFAULT_PREFS, ...d.prefs }; }); }

// ---- per mailbox ----
const COLORS = ["#7c8cff", "#34a853", "#ea4335", "#fbbc04", "#a142f4", "#12b5cb", "#f06292", "#ff8a00"];
export const COLOR_LIST = COLORS;
const cleanSig = (s, i) => ({ id: String(s?.id || "s" + (i + 1)).slice(0, 20), name: String(s?.name || "Signature " + (i + 1)).slice(0, 40), html: String(s?.html ?? "").slice(0, 20_000) });
export function box(key) {
  const b = data().boxes[key] ?? {};
  const sigs = Array.isArray(b.signatures) ? b.signatures.map(cleanSig) : [];
  return { nickname: String(b.nickname ?? "").slice(0, 40), color: COLORS.includes(b.color) || /^#[0-9a-f]{6}$/i.test(b.color ?? "") ? b.color : null, signatures: sigs,
    defaultSig: sigs.some((s) => s.id === b.defaultSig) ? b.defaultSig : sigs[0]?.id ?? null, replySig: typeof b.replySig === "boolean" ? b.replySig : true,
    notify: typeof b.notify === "boolean" ? b.notify : true };
}
export function setBox(key, patch = {}) {
  return write((d) => {
    const cur = d.boxes[key] ?? {};
    if (patch.nickname !== undefined) cur.nickname = String(patch.nickname ?? "").trim().slice(0, 40);
    if (patch.color !== undefined) cur.color = /^#[0-9a-f]{6}$/i.test(String(patch.color)) ? String(patch.color).toLowerCase() : null;
    if (Array.isArray(patch.signatures)) cur.signatures = patch.signatures.slice(0, 10).map(cleanSig);
    if (patch.defaultSig !== undefined) cur.defaultSig = patch.defaultSig ? String(patch.defaultSig) : null;
    if (typeof patch.replySig === "boolean") cur.replySig = patch.replySig;
    if (typeof patch.notify === "boolean") cur.notify = patch.notify;
    d.boxes[key] = cur;
    return box(key);
  });
}
export function dropBox(key) { write((d) => { delete d.boxes[key]; if (d.primary === key) d.primary = null; }); }
export const primary = () => data().primary ?? null;
export function setPrimary(key) { write((d) => { d.primary = key; }); }
// the default signature's HTML for a mailbox (replies only when "use on replies" is on)
export function signatureFor(key, { reply = false, id = null } = {}) {
  const b = box(key);
  if (reply && !b.replySig) return "";
  const s = b.signatures.find((x) => x.id === (id ?? b.defaultSig)) ?? null;
  return s?.html ?? "";
}

// ---- "always show images from" ----
export const imagesAllowed = (addr) => data().imagesFrom.includes(String(addr ?? "").toLowerCase());
export function allowImagesFrom(addr, on = true) {
  const a = String(addr ?? "").toLowerCase().trim(); if (!a) return;
  write((d) => { d.imagesFrom = d.imagesFrom.filter((x) => x !== a); if (on) d.imagesFrom.push(a); d.imagesFrom = d.imagesFrom.slice(-2000); });
}
