// Confirmations the AI can't give itself. When a change needs the owner's OK (a risky or important file, a delete, a bulk
// change, "ask me before every change"), the tool hands back a one-time token bound to that exact operation. The token only
// works after the owner's next message is a clear yes (voice or typed), within a short window, and only for the same
// operation (same tool, same paths, same content). A "no" cancels it. The model can't approve anything: approval comes
// from what the owner said (assistant.chat calls userSaid() with every message before the AI sees it).
//   issue(op, { text })        → token      (op: any JSON-able description of the exact operation)
//   userSaid(text, { surface }) → { approved: n } | { refused: n } | null
//   consume(token, op)         → { ok: true } | { ok: false, why }
//   isYes(text) / isNo(text)
import { createHash, randomBytes } from "node:crypto";
import * as activity from "./activity.mjs";

export const WINDOW_MS = 2 * 60_000;      // from the question to the change: two minutes
const pending = new Map();                 // token → { key, issued, approved, used, text }
let now = () => Date.now();
export function _setNow(fn) { now = fn ?? (() => Date.now()); }
export function _reset() { pending.clear(); }

// the exact operation, as a fingerprint (paths compared without regard to case or slash direction)
const canon = (x) => (typeof x === "string" ? x.replace(/\//g, "\\") : Array.isArray(x) ? x.map(canon) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canon(x[k])])) : x);
export const opKey = (op) => createHash("sha256").update(JSON.stringify(canon(op))).digest("hex");

function sweep() { const t = now(); for (const [k, v] of pending) if (t - v.issued > WINDOW_MS * 2) pending.delete(k); }

export function issue(op, { text = "", what = "" } = {}) {
  sweep();
  const token = randomBytes(9).toString("base64url");
  const key = opKey(op);
  // asking again about the same thing replaces the older question
  for (const [k, v] of pending) if (v.key === key && !v.approved) pending.delete(k);
  pending.set(token, { key, issued: now(), approved: 0, used: false, text, what });
  activity.log("confirm.asked", { what: what || op?.tool, confirmId: token.slice(0, 6), text });
  return token;
}

const norm = (t) => String(t ?? "").toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
const YES = /^(?:(?:hey |ok |okay )?dayspring |so )?(yes|yeah|yep|yup|ya|sure|i'?m sure|i am sure|yes i'?m sure|do it|go ahead|go for it|please do|confirm(ed)?|correct|that'?s right|affirmative|absolutely|of course|ok|okay|alright|all right|proceed|let'?s do it)\b/;
const NO = /\b(no|nope|nah|cancel|never ?mind|don'?t|do not|stop|wait|hold on|not now|abort|keep it|leave it)\b/;
export const isYes = (text) => { const q = norm(text); return YES.test(q) && !NO.test(q.replace(/^(yes|yeah|ok|okay|sure)\b/, "")) && q.split(" ").length <= 12; };
export const isNo = (text) => { const q = norm(text); return /^(no|nope|nah|cancel|never ?mind|don'?t|do not|stop|wait|hold on|not now|abort|keep it|leave it)\b/.test(q); };

// Every message from the owner comes through here first. A clear yes approves what Dayspring just asked about; a no
// cancels it. Anything else leaves questions open until they expire.
export function userSaid(text, { surface = "" } = {}) {
  if (surface === "call") return null;            // someone on a call can't approve anything
  sweep();
  const t = now();
  const open = [...pending.entries()].filter(([, v]) => !v.used && !v.approved && t - v.issued <= WINDOW_MS);
  if (!open.length) return null;
  if (isYes(text)) {
    for (const [tok, v] of open) { v.approved = t; activity.log("confirm.given", { what: v.what, confirmId: tok.slice(0, 6), said: String(text).slice(0, 200), surface }); }
    return { approved: open.length };
  }
  if (isNo(text)) {
    for (const [tok, v] of open) { pending.delete(tok); activity.log("confirm.refused", { what: v.what, confirmId: tok.slice(0, 6), said: String(text).slice(0, 200), surface }); }
    return { refused: open.length };
  }
  return null;
}

// consume(token, op): the token is spent whether or not it works for this op (one try each)
export function consume(token, op) {
  const v = pending.get(String(token ?? ""));
  if (!v) return { ok: false, why: "unknown" };
  const t = now();
  if (v.used) return { ok: false, why: "used" };
  if (t - v.issued > WINDOW_MS) { pending.delete(token); activity.log("confirm.expired", { what: v.what, confirmId: String(token).slice(0, 6) }); return { ok: false, why: "expired" }; }
  if (!v.approved) return { ok: false, why: "not-approved" };    // kept: the owner may still say yes
  if (v.key !== opKey(op)) { pending.delete(token); activity.log("blocked", { reason: "confirm-mismatch", what: v.what, confirmId: String(token).slice(0, 6), text: "A confirmation was used for a different change than the one the owner agreed to." }); return { ok: false, why: "different" }; }
  v.used = true; pending.delete(token);
  return { ok: true };
}
export const pendingCount = () => [...pending.values()].filter((v) => !v.used && now() - v.issued <= WINDOW_MS).length;
