// /api/discover (the For you feed and its settings) and /api/interests (their interests, free text).
import * as discover from "./discover.mjs";
import * as owner from "./owner.mjs";

export async function handle(req, res, { m, p, q, send, readJSON }) {
  if (!p.startsWith("/discover") && p !== "/interests") return false;
  const body = m === "POST" ? await readJSON(req).catch(() => ({})) : {};
  if (p === "/discover" && m === "GET") return send(res, 200, { settings: discover.settings(), feed: discover.feed({ limit: Number(q.get("limit")) || 30 }), today: discover.today().length, interests: discover.topics() }), true;
  if (p === "/discover/settings" && m === "POST") return send(res, 200, { settings: discover.setSettings(body) }), true;
  if (p === "/discover/refresh" && m === "POST") {
    const r = await discover.run({ interest: body.interest || undefined, reason: "asked" });
    return send(res, 200, { ok: r.ok, interest: r.interest ?? null, items: r.items ?? [], why: r.why ?? null }), true;
  }
  if (p === "/discover/item" && m === "POST") {
    if (!["seen", "shown", "opened", "played", "liked", "dismissed"].includes(body.action)) return send(res, 400, { error: "unknown action" }), true;
    return send(res, 200, discover.mark(String(body.id ?? ""), body.action)), true;
  }
  if (p === "/interests" && m === "GET") return send(res, 200, { interests: owner.get().interests ?? [] }), true;
  if (p === "/interests" && m === "POST") {
    const a = body.add ? discover.addInterest(body.add) : null, r = body.remove ? discover.removeInterest(body.remove) : null;
    return send(res, 200, { added: a?.added ?? [], mapped: a?.mapped ?? [], removed: r?.removed ?? [], interests: owner.get().interests ?? [] }), true;
  }
  return false;
}
