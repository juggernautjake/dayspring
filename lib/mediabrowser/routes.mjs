// /api/mb/*: the Music & Video browser (lib/mediabrowser/index.mjs), and /api/media/signin|signout: signing in to YouTube
// and Spotify in Dayspring's media window (lib/mediasignin.mjs).
//   GET  /mb/status                                   sources, sections, recent searches, the study rule
//   GET  /mb/section?source=&section=&cursor=&range=&type=&filter=&day=&query=
//   GET  /mb/search?source=&q=&only=&from=&filters=<json>&have=<ids>
//   GET  /mb/page?source=&kind=&id=&…                  an artist, album, playlist, channel, genre (inside the browser)
//   POST /mb/act { action, items, playlistId, … }      play | next | queue | like | unlike | addToPlaylist | removeHistory | webplayer
//   POST /mb/view { open, source, section, items }     what the window shows, numbered (for "play number 3")
//   POST /mb/recent { clear: true }                    forget the recent searches
//   GET  /media/signin                                 { youtube, spotify } signed in or not, as whom (never cookies)
//   POST /media/signin { service, check? }             show the sign-in (or check now)      POST /media/signout { service }
// /mb is the "mediabrowser" feature (lib/features.mjs answers 404 while it's off); signing in is always there.
import * as mb from "./index.mjs";

const pick = (q, keys) => Object.fromEntries(keys.map((k) => [k, q.get(k)]).filter(([, v]) => v !== null && v !== ""));
export async function handle(req, res, { m, p, q, send, readJSON }) {
  if (p === "/media/signin" || p === "/media/signout") {
    const signin = await import("../mediasignin.mjs");
    try {
      if (m === "GET" && p === "/media/signin") return send(res, 200, signin.status()), true;
      const body = await readJSON(req).catch(() => ({}));
      const service = body.service === "spotify" ? "spotify" : body.service === "youtube" ? "youtube" : null;
      if (!service) return send(res, 400, { error: "Which one: youtube or spotify?" }), true;
      if (p === "/media/signout") return send(res, 200, await signin.signOut(service)), true;
      if (body.check) return send(res, 200, await signin.check(service, { force: true })), true;
      return send(res, 200, await signin.start(service)), true;
    } catch (e) { return send(res, 400, { error: e.message }), true; }
  }
  if (!p.startsWith("/mb/")) return false;
  try {
    if (m === "GET" && p === "/mb/status") return send(res, 200, await mb.status()), true;
    if (m === "GET" && p === "/mb/section") return send(res, 200, await mb.section(pick(q, ["source", "section", "cursor", "range", "type", "filter", "day", "query"]))), true;
    if (m === "GET" && p === "/mb/search") {
      let filters = {}; try { filters = JSON.parse(q.get("filters") ?? "{}") ?? {}; } catch { filters = {}; }
      const have = String(q.get("have") ?? "").split(",").filter((x) => /^[\w-]{11}$/.test(x)).slice(0, 300);
      return send(res, 200, await mb.search({ source: q.get("source"), q: q.get("q") ?? "", only: q.get("only") || null, from: Number(q.get("from")) || 0, filters, have, remember: q.get("remember") !== "0" })), true;
    }
    if (m === "GET" && p === "/mb/page") return send(res, 200, await mb.page(pick(q, ["source", "kind", "id", "cursor", "channelId", "handle", "title", "playlistId", "mine", "album", "artist", "genre", "request"]))), true;
    const body = m === "POST" ? await readJSON(req).catch(() => ({})) : {};
    if (m === "POST" && p === "/mb/act") { const r = await mb.act(body); return send(res, r.ok === false ? 400 : 200, r), true; }
    if (m === "POST" && p === "/mb/view") return send(res, 200, mb.setView(body)), true;
    if (m === "POST" && p === "/mb/recent") return send(res, 200, body.clear ? mb.clearRecent() : { recent: mb.recentSearches() }), true;
  } catch (e) { return send(res, 400, { error: e.message }), true; }
  return false;
}
