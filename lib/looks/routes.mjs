// /api/looks and /api/expressions: Settings → Look & feel, the screen's theme and avatar, expression mode.
//   GET  /looks                         everything Settings needs: the saved choices, what's in use, the themes, the avatars
//   POST /looks { theme?, custom?, avatar?, expression?, … }           save (the screens update straight away)
//   GET  /looks/theme                   the theme in use (every page asks: public/theme.js)
//   POST /looks/theme { id } | { colors: [..], mode?, name? }           pick a theme, or build one from 2–3 colours
//   POST /looks/theme/preview { id | colors, ms }                      show it on the screens for a moment, then go back
//   POST /looks/surprise                pick one at random
//   GET  /looks/avatar                  the avatar in use (public/avatar.js)
//   POST /looks/avatar/upload?state=idle      the picture's bytes (JPEG/PNG/WebP/GIF, 12 MB)   DELETE the same to remove
//   GET  /looks/avatar/img/:state       the picture
//   POST /looks/avatar/test { ms }      "Test talking": the screens' avatar talks for a few seconds, with no sound
//   POST /looks/persona { preset, avatar?, theme? }                    a personality's own look ("" = none)
//   POST /looks/template { id, remember: true|false }                  a template remembers the look in use now
//   GET  /expressions/pick?text=&event=&speechMs=&persona=             expression mode: a GIF for this moment, or { show: false }
//   GET  /expressions/media/:id         a kept GIF or picture
//   GET  /expressions                   the library: counts, size, the packs, the build's progress
//   GET  /expressions/list?pack=&emotion=     some of them, newest first
//   POST /expressions/build { personas, perCombo }  ·  POST /expressions/build/cancel  ·  GET /expressions/build
//   POST /expressions/upload?emotion=&persona=&title=   the owner's own GIF or picture
//   DELETE /expressions/item/:id  ·  POST /expressions/clear { keepOwn }
import { createReadStream, statSync } from "node:fs";
import * as looks from "./index.mjs";
import * as expr from "./expressions.mjs";
import * as packs from "./packs.mjs";
import { EMOTIONS } from "./emotion.mjs";
import { broadcast } from "../bus.mjs";

looks.setDeps({ broadcast });
looks.wirePersona().catch((e) => console.log(`looks: ${e.message}`));
setTimeout(() => looks.tidyImages(), 5000).unref?.();

async function readRaw(req, max) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > max) throw Object.assign(new Error(`That file is too big (${Math.round(max / 1048576)} MB at most).`), { status: 413 }); chunks.push(c); }
  return Buffer.concat(chunks, n);
}
function sendFile(res, f, { cache = "private, max-age=86400" } = {}) {
  let st; try { st = statSync(f.path); } catch { res.writeHead(404, { "content-type": "application/json" }); res.end('{"error":"not found"}'); return; }
  res.writeHead(200, { "content-type": f.type, "content-length": st.size, "cache-control": cache, "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'" });
  createReadStream(f.path).pipe(res);
}
const themeFrom = (b) => {
  if (Array.isArray(b.colors) && b.colors.length) return looks.Theme.buildCustom({ colors: b.colors, mode: b.mode ?? null, name: b.name ?? "My theme" });
  const t = looks.Theme.byId(String(b.id ?? ""));
  if (!t) throw Object.assign(new Error("There's no theme by that name."), { status: 400 });
  return t;
};

export async function handle(req, res, { m, p, q, send, readJSON }) {
  if (!p.startsWith("/looks") && !p.startsWith("/expressions")) return false;
  try {
    // ---- the look ----
    if (p === "/looks" && m === "GET") {
      const eff = await looks.effective();
      return send(res, 200, { settings: looks.settings(), effective: eff, themes: looks.Theme.THEMES.map((t) => ({ id: t.id, name: t.name, blurb: t.blurb, swatch: t.swatch, params: t.params })),
        styles: looks.STYLES, states: looks.STATES, emotions: Object.entries(EMOTIONS).map(([id, e]) => ({ id, label: e.label })), packs: packs.ids().map((id) => ({ id, genre: packs.packFor(id).genre })) }), true;
    }
    if (p === "/looks" && m === "POST") {
      const b = await readJSON(req).catch(() => ({}));
      const patch = {};
      for (const k of ["theme", "avatar", "expression"]) if (b[k] !== undefined) patch[k] = b[k];
      if (b.custom !== undefined) patch.custom = b.custom;
      const s = looks.set(patch, "settings");
      return send(res, 200, { settings: s, effective: await looks.effective() }), true;
    }
    if (p === "/looks/theme" && m === "GET") { const e = await looks.effective(); return send(res, 200, { theme: e.theme, from: e.themeFrom }), true; }
    if (p === "/looks/theme" && m === "POST") {
      const b = await readJSON(req).catch(() => ({}));
      const t = themeFrom(b);
      const s = t.custom ? looks.set({ theme: "custom", custom: t }, "theme") : looks.set({ theme: t.id }, "theme");
      return send(res, 200, { settings: s, theme: looks.themeWire(s.theme, s.custom), tokens: looks.Theme.tokensFor(t), contrast: looks.Theme.contrastReport(looks.Theme.tokensFor(t)) }), true;
    }
    if (p === "/looks/theme/preview" && m === "POST") {
      const b = await readJSON(req).catch(() => ({}));
      const t = themeFrom(b), ms = Math.max(2000, Math.min(60_000, Number(b.ms) || 15_000));
      broadcast("looks", { preview: { theme: t.params ? { id: t.id, name: t.name, params: t.params } : { id: "default" }, ms } });
      return send(res, 200, { ok: true, theme: t.id, ms, tokens: looks.Theme.tokensFor(t) }), true;
    }
    if (p === "/looks/surprise" && m === "POST") {
      const cur = looks.settings().theme, t = looks.Theme.surprise(cur);
      const s = t.custom ? looks.set({ theme: "custom", custom: t }, "theme") : looks.set({ theme: t.id }, "theme");
      return send(res, 200, { settings: s, theme: looks.themeWire(s.theme, s.custom) }), true;
    }
    if (p === "/looks/avatar" && m === "GET") { const e = await looks.effective(); return send(res, 200, { avatar: e.avatar, expression: e.expression, persona: e.persona, theme: e.theme }), true; }
    if (p === "/looks/avatar/upload") {
      const state = String(q.get("state") ?? "idle");
      if (m === "DELETE") return send(res, 200, looks.removeImage(state)), true;
      if (m !== "POST") return false;
      const buf = await readRaw(req, looks.MAX_IMAGE + 1024);
      const r = looks.saveImage(state, buf);
      // the first picture: the avatar becomes "your picture" unless another style was chosen on purpose
      if (q.get("use") === "1") looks.set({ avatar: { style: "image" } }, "avatar");
      return send(res, 200, { ...r, settings: looks.settings() }), true;
    }
    if (p.startsWith("/looks/avatar/img/") && m === "GET") {
      const f = looks.imageFile(p.split("/").pop());
      if (!f) return send(res, 404, { error: "No picture for that state." }), true;
      return sendFile(res, f), true;
    }
    if (p === "/looks/avatar/test" && m === "POST") {
      const b = await readJSON(req).catch(() => ({}));
      broadcast("looks-test", { ms: Math.max(1000, Math.min(15_000, Number(b.ms) || 4000)), state: ["speak", "listen", "think", "muted", "stopped", "error", "sleep", "idle"].includes(b.state) ? b.state : "speak", emotion: EMOTIONS[b.emotion] ? b.emotion : null });
      return send(res, 200, { ok: true }), true;
    }
    if (p === "/looks/persona" && m === "POST") {
      const b = await readJSON(req).catch(() => ({}));
      if (!/^[\w-]{1,40}$/.test(String(b.preset ?? ""))) return send(res, 400, { error: "Which personality?" }), true;
      const s = looks.setForPersona(b.preset, { ...(b.avatar !== undefined ? { avatar: b.avatar || null } : {}), ...(b.theme !== undefined ? { theme: b.theme || null } : {}) });
      return send(res, 200, { settings: s, effective: await looks.effective() }), true;
    }
    if (p === "/looks/template" && m === "POST") {
      const b = await readJSON(req).catch(() => ({}));
      if (!/^[\w-]{1,40}$/.test(String(b.id ?? ""))) return send(res, 400, { error: "Which template?" }), true;
      const s = b.remember === false ? looks.forgetTemplate(b.id) : await looks.rememberForTemplate(b.id, { name: b.name ?? "" });
      return send(res, 200, { settings: s }), true;
    }
    // ---- expression mode ----
    if (p === "/expressions/pick" && m === "GET") {
      const r = await expr.pick({ text: q.get("text") ?? "", event: q.get("event") || null, persona: q.get("persona") || null, speechMs: Number(q.get("speechMs")) || 0, force: q.get("force") === "1", emotion: q.get("emotion") || null });
      return send(res, 200, r), true;
    }
    if (p.startsWith("/expressions/media/") && m === "GET") {
      const f = expr.mediaFile(decodeURIComponent(p.slice("/expressions/media/".length)));
      if (!f) return send(res, 404, { error: "That one isn't kept any more." }), true;
      return sendFile(res, f), true;
    }
    if (p === "/expressions" && m === "GET") return send(res, 200, { library: expr.library(), build: expr.buildStatus(), settings: looks.settings().expression }), true;
    if (p === "/expressions/list" && m === "GET") return send(res, 200, { items: expr.list({ pack: q.get("pack") || null, emotion: q.get("emotion") || null, limit: Math.min(200, Number(q.get("limit")) || 60) }) }), true;
    if (p === "/expressions/build" && m === "GET") return send(res, 200, expr.buildStatus()), true;
    if (p === "/expressions/build" && m === "POST") {
      const b = await readJSON(req).catch(() => ({}));
      let personas = Array.isArray(b.personas) ? b.personas.map(String) : null;
      if (!personas?.length || b.personas === "current") personas = [(await looks.personaNow()).preset, "default"];
      if (b.all) personas = packs.ids();
      return send(res, 200, expr.build({ personas, perCombo: b.perCombo, emotions: Array.isArray(b.emotions) ? b.emotions : null })), true;
    }
    if (p === "/expressions/build/cancel" && m === "POST") return send(res, 200, expr.cancelBuild()), true;
    if (p === "/expressions/upload" && m === "POST") {
      const buf = await readRaw(req, 15 * 1024 * 1024 + 1024);
      const it = expr.addOwn(buf, { emotion: q.get("emotion") ?? "", persona: q.get("persona") || "any", title: q.get("title") ?? "" });
      return send(res, 200, { item: it, library: expr.library() }), true;
    }
    if (p.startsWith("/expressions/item/") && m === "DELETE") return send(res, 200, expr.remove(decodeURIComponent(p.slice("/expressions/item/".length)))), true;
    if (p === "/expressions/clear" && m === "POST") { const b = await readJSON(req).catch(() => ({})); return send(res, 200, expr.clear({ keepOwn: b.keepOwn !== false })), true; }
    return false;
  } catch (e) {
    return send(res, e.status ?? 400, { error: e.message }), true;
  }
}
