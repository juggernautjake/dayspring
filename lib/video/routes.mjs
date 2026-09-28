// /api/video/*: the video queue, the grid of videos on the screen, the owner's YouTube playlists and the creator names.
//   GET  /video/queue                         the queue (lib/video/queue.mjs)
//   POST /video/queue { action, … }           add | next (play next) | playNow | ended | skip | previous | jump | remove | move | clear
//                                             | shuffle | repeat | shown (the panel was opened on the screen)
//   GET  /video/browse                        what the grid shows      POST /video/browse { action: pick|queue|more|refine|close, n, ns, filters }
//   POST /video/find { query, creator, kind, action }                  search, browse or queue from the screen's search box
//   GET  /video/playlists[?fresh=1]          his YouTube playlists    POST /video/playlists { action: play|shuffle|queue|show, name|playlistId }
//   GET  /video/creators                      the names → channels list   POST /video/creators { action: set|remove, name, channel }
// All of it is the "videosearch" feature (lib/features.mjs answers 404 while it's off).
import * as video from "./index.mjs";

export async function handle(req, res, { m, p, q, send, readJSON }) {
  if (!p.startsWith("/video/")) return false;
  const body = m === "POST" ? await readJSON(req).catch(() => ({})) : {};
  const Q = video.queue;
  try {
    if (m === "GET" && p === "/video/queue") return send(res, 200, { queue: Q.get() }), true;
    if (m === "POST" && p === "/video/queue") {
      const a = String(body.action ?? "");
      const item = body.item ?? null, items = Array.isArray(body.items) ? body.items : item ? [item] : [];
      let r;
      if (a === "add") r = Q.add(items, { next: Boolean(body.next) });
      else if (a === "next" && items.length) r = Q.add(items, { next: true });
      else if (a === "playNow") { r = { cmd: videoStart(items[0]) }; }
      else if (a === "ended" || a === "skip" || a === "advance") r = video.advance(a === "ended" ? "ended" : "next");
      else if (a === "previous") r = video.advance("previous");
      else if (a === "jump") r = await video.queueCommand({ op: "play", n: Number(body.n) });
      else if (a === "remove") r = Q.remove(Number(body.n));
      else if (a === "move") r = Q.move(Number(body.n), /^\d+$/.test(String(body.to)) ? Number(body.to) : body.to);
      else if (a === "clear") r = Q.clear();
      else if (a === "shuffle") r = await video.queueCommand({ op: body.value === false ? "unshuffle" : "shuffle" });
      else if (a === "repeat") r = await video.queueCommand({ op: "repeat", mode: ["off", "one", "all"].includes(body.mode) ? body.mode : "off" });
      else if (a === "shown") r = video.queueShown(Boolean(body.open ?? true));
      else return send(res, 400, { error: "unknown action" }), true;
      return send(res, 200, { result: r ?? null, queue: Q.get() }), true;
    }
    if (m === "GET" && p === "/video/browse") return send(res, 200, video.gridView()), true;
    if (m === "POST" && p === "/video/browse") return send(res, 200, await video.gridAction(body)), true;
    if (m === "POST" && p === "/video/find") {
      const kind = body.kind ?? (body.creator ? "creator" : "topic");
      const r = { kind, query: String(body.query ?? "").slice(0, 200), creator: body.creator ? String(body.creator).slice(0, 100) : undefined, filters: body.filters ?? {}, count: body.count ?? null, next: Boolean(body.next) };
      const out = body.action === "browse" ? await video.browse(r) : body.action === "queue" ? await video.queueRequest(r) : await video.play(r);
      return send(res, 200, out), true;
    }
    if (m === "GET" && p === "/video/playlists") return send(res, 200, { playlists: await video.account.playlists({ fresh: q.get("fresh") === "1" }) }), true;
    if (m === "POST" && p === "/video/playlists") {
      const a = String(body.action ?? "play"), ref = body.playlistId ? { playlistId: String(body.playlistId), title: String(body.title ?? body.name ?? "your playlist") } : String(body.name ?? "");
      const out = a === "queue" ? await video.playlistQueue(ref, { next: body.next !== false }) : a === "show" ? await video.playlistShow(ref) : a === "list" ? await video.listPlaylists() : await video.playlistPlay(ref, { shuffle: a === "shuffle" });
      return send(res, 200, out), true;
    }
    if (m === "GET" && p === "/video/creators") return send(res, 200, { people: video.creators.people(), file: video.creators.listFile() }), true;
    if (m === "POST" && p === "/video/creators") {
      if (body.action === "remove") return send(res, 200, { removed: video.creators.removeAlias(String(body.name ?? "")) }), true;
      return send(res, 200, { saved: video.creators.setAlias(String(body.name ?? ""), body.channel) }), true;
    }
  } catch (e) {
    return send(res, 400, { error: e.message }), true;
  }
  return false;
}
function videoStart(x) {
  if (!x) throw new Error("There's no video to play.");
  return video.startItem(x);
}
