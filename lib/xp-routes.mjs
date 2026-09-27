// XP (paths are after /api):
//   GET  /xp                    balance, level, streak, the 14-day chart, recent check-ins, unlockables, rules, settings
//   POST /xp/checkin {category, text?, source?}   start a check-in (or answer the one in progress with {text})
//   POST /xp/answer {text}       answer the check-in in progress
//   POST /xp/undo                undo the last check-in (within 10 minutes)
//   POST /xp/unlock {id}         unlock a found secret character with XP
//   POST /xp/settings {enabled, reminders, checkinTimes}
import * as xp from "./xp/index.mjs";
import * as llm from "./llm.mjs";

// Whether the Dayspring screen has "stop listening" on (only the screen knows; xp.js reports it). No check-in
// questions are asked while it's on, or while Dayspring is Off or Quiet.
let screenStopped = false;

// Called once at startup by server.mjs. d = { announce(item), broadcast(type, data), blocksToday(), canAsk() }
export function wire(d) {
  xp.setDeps({
    llm: { ready: () => llm.ready(), complete: (o) => llm.complete(o) },
    addPrayer: (text) => import("./prayerskills.mjs").then((m) => m.add({ title: String(text).slice(0, 120) })),
  });
  import("./persona/index.mjs").then((persona) => xp.setDeps({ persona })).catch(() => { /* no personality module */ });
  xp.onEvent((kind, data) => {
    if (!["award", "levelup", "spend", "undo", "settings"].includes(kind)) return;
    try { d.broadcast("xp", { kind, ...data, view: view() }); } catch { /* no screens */ }
  });
  xp.startScheduler({
    blocksToday: d.blocksToday,
    canAsk: () => !screenStopped && d.canAsk(),
    ask: ({ text, category }) => d.announce({ kind: "xpcheckin", title: "Check-in", text, ask: true, category }),
  });
}

export function view() {
  const lv = xp.level(), st = xp.streak();
  return {
    enabled: xp.enabled(), balance: xp.balance(), lifetime: xp.lifetime(), level: lv, streak: st, daily: xp.daily(14),
    recent: xp.history({ limit: 25 }).filter((e) => e.type !== "saver").map((e) => ({ at: e.at, day: e.day, type: e.type, amount: e.amount, category: e.category ?? null, title: e.title ?? "", evidence: e.evidence ? String(e.evidence).slice(0, 140) : "", reason: e.reason ?? "", reversed: Boolean(e.reversed) })),
    unlockables: xp.unlockables(), rules: xp.rules(), settings: xp.settings(), active: Boolean(xp.checkin.active("tv")),
  };
}

export async function handle(req, res, { m, p, send, readJSON }) {
  if (p !== "/xp" && !p.startsWith("/xp/")) return false;
  try {
    if (m === "GET" && p === "/xp") return send(res, 200, view()), true;
    if (m !== "POST") return false;
    const b = await readJSON(req).catch(() => ({}));
    const surface = String(b.surface ?? "tv");
    if (p === "/xp/checkin") {
      if (b.text && !b.category) { const r = await xp.handle(String(b.text), { surface }); return send(res, 200, { reply: r?.reply ?? null, awaiting: Boolean(r?.awaiting), xp: r?.xp ?? null }), true; }
      const r = xp.checkin.start(String(b.category), { source: ["block", "timer"].includes(b.source) ? b.source : "self", title: b.title, done: b.done === true }, surface);
      return send(res, 200, { reply: r.prompt ?? r.message ?? null, awaiting: Boolean(r.prompt), xp: r.result ?? null }), true;
    }
    if (p === "/xp/answer") { const r = await xp.checkin.answer(String(b.text ?? ""), surface); return send(res, 200, r ? { reply: r.prompt ? (r.message ? `${r.message} ${r.prompt}` : r.prompt) : r.message, awaiting: Boolean(r.prompt), xp: r.result ?? null } : { reply: null, awaiting: false }), true; }
    if (p === "/xp/presence") { screenStopped = Boolean(b.stopped); return send(res, 200, { ok: true }), true; }
    if (p === "/xp/undo") return send(res, 200, xp.undoLast()), true;
    if (p === "/xp/unlock") return send(res, 200, await xp.unlockCharacter(b.id ? String(b.id) : null)), true;
    if (p === "/xp/settings") return send(res, 200, xp.setSettings({ ...(b.enabled !== undefined ? { enabled: Boolean(b.enabled) } : {}), ...(b.reminders ? { reminders: b.reminders } : {}), ...(Array.isArray(b.checkinTimes) ? { checkinTimes: b.checkinTimes } : {}) })), true;
  } catch (e) { return send(res, 400, { error: e.message }), true; }
  return false;
}
