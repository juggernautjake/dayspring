// The owner's phone, through Phone Link: new texts and app notifications, read from Windows' own notification list
// (read-only). Texts are announced ("Incoming text message from Alex. Do you want me to read it?") and read only on a yes;
// the words are kept in memory for the conversation, never written to disk. App notifications show quietly on the TV.
// node:sqlite comes with Node 22.13+; loaded lazily so an older Node still starts Dayspring (texts are then just off)
let DatabaseSync = null;
import("node:sqlite").then((m) => { DatabaseSync = m.DatabaseSync; }).catch(() => {});
import { join } from "node:path";

const DB = join(process.env.LOCALAPPDATA ?? "", "Microsoft", "Windows", "Notifications", "wpndatabase.db");
let lastId = null;
const recent = [];            // the last few texts: { from, body, at }
let pendingText = null;       // the one waiting for "yes, read it"

const decode = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
function texts(xml) { return [...xml.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((m) => decode(m[1]).trim()); }

// New Phone Link notifications since the last look: [{ kind: "text", from, body } | { kind: "app", title, body }]
export function poll() {
  let db;
  if (!DatabaseSync) return [];
  try { db = new DatabaseSync(DB, { readOnly: true }); } catch { return []; }
  try {
    const st = db.prepare("select n.Id id, h.PrimaryId app, n.Payload p from Notification n join NotificationHandler h on h.RecordId = n.HandlerId where h.PrimaryId like 'Microsoft.YourPhone%' and n.Id > ? order by n.Id");
    st.setReadBigInts(true);
    const rows = st.all(BigInt(lastId ?? 0));
    const out = [];
    for (const r of rows) {
      const id = Number(r.id);
      const first = lastId === null;
      if (id > (lastId ?? 0)) lastId = id;
      if (first) continue;                                   // nothing from before Dayspring started is announced
      const xml = Buffer.from(r.p).toString("utf8"), t = texts(xml), app = String(r.app);
      if (/YourPhoneMessages/i.test(app)) {
        const m = { kind: "text", from: t[0] || "Someone", body: t[1] || "", at: Date.now() };
        if (!m.body) continue;
        if (recent.some((x) => x.from === m.from && x.body === m.body && Date.now() - x.at < 3 * 60_000)) continue;   // the same text again
        recent.push(m); if (recent.length > 10) recent.shift();
        out.push(m);
      } else if (/YourPhoneCall|Calling/i.test(app) || /\b(incoming|missed) call\b/i.test(t.join(" "))) {
        // a call (Phone Link's call notifications): who and when, for the call history on their profile (only if the
        // owner turned "Save call history" on; lib/people/comms.mjs)
        const from = t.find((x) => x && !/\b(incoming|missed) call\b|^phone link$/i.test(x)) || "Someone";
        out.push({ kind: "call", title: `Call from ${from}`, from, missed: /\bmissed call\b/i.test(t.join(" ")), at: Date.now() });
      } else if (/YourPhoneNotifications/i.test(app)) {
        out.push({ kind: "app", title: t[1] || t[0] || "Your phone", body: t[2] || "" });
      }
    }
    if (lastId === null) lastId = 0;
    return out;
  } catch { return []; } finally { try { db.close(); } catch { /* closed */ } }
}
// On start: remember where the list is, so only new ones are announced.
export function prime() { lastId = null; poll(); }

export function announceText(m) { pendingText = m; }
export function pending() { return pendingText && Date.now() - pendingText.at < 15 * 60_000 ? pendingText : null; }
export function clear() { pendingText = null; }
export const last = () => recent[recent.length - 1] ?? null;
export const all = () => [...recent];
export const lastFrom = (name) => [...recent].reverse().find((m) => m.from.toLowerCase().includes(String(name).toLowerCase())) ?? null;
