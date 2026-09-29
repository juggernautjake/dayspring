// Pictures from the web on the Dayspring screen ("show me pictures of golden retrievers"): a numbered grid of about 12,
// the title and site under each; click one (or say "show number 3") to see it big with a link to its page; "more" for
// the next ones; Save; ✕ / Esc / "close images" to close. The server keeps what's showing (lib/image-routes.mjs) and
// sends it as the "images" event, so voice, clicks and the AI all stay in step. Every picture comes through Dayspring's
// own /api/images/proxy (the screen never loads anything from other sites). Titles are only ever set as text.
(() => {
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const post = (url, body) => fetch("/api" + url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.status); return j; });
  const core = () => window.dsCore;
  const onlyProxy = (u) => (typeof u === "string" && u.startsWith("/api/images/proxy?u=") ? u : "");
  const httpUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : "");

  const css = el("style");
  css.textContent = `
  #dsImages{position:fixed;z-index:57;inset:4vh 3vw;display:flex;flex-direction:column;background:rgba(10,13,28,.97);color:#f4f5ff;border:1px solid rgba(124,140,255,.4);border-radius:22px;padding:14px 18px;font:15px/1.35 system-ui,Segoe UI,sans-serif;box-shadow:0 30px 90px rgba(0,0,0,.6)}
  html.mini #dsImages{inset:0;border-radius:0;padding:8px}
  #dsImages header{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  #dsImages header h2{margin:0;font-size:20px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #dsImages .sub{opacity:.7;font-size:13px}
  #dsImages .ib{background:rgba(255,255,255,.1);color:#eef0ff;border:1px solid rgba(255,255,255,.2);border-radius:9px;padding:6px 11px;font:inherit;font-size:14px;cursor:pointer}
  #dsImages .ib:hover,#dsImages .ib:focus-visible{background:rgba(124,140,255,.3);outline:none}
  #dsImages .ib.main{background:#7c8cff;color:#0b0f22;border-color:#7c8cff;font-weight:600}
  #dsImages .grid{flex:1;min-height:0;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-top:12px;align-content:start}
  html.mini #dsImages .grid{grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px}
  #dsImages .cell{position:relative;display:flex;flex-direction:column;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:12px;overflow:hidden;cursor:pointer;padding:0;color:inherit;font:inherit;text-align:left}
  #dsImages .cell:hover,#dsImages .cell:focus-visible{border-color:#7c8cff;outline:none}
  #dsImages .pic{aspect-ratio:4/3;background:#1b2140;display:grid;place-items:center;font-size:34px;overflow:hidden}
  #dsImages .pic img{width:100%;height:100%;object-fit:cover;display:block}
  #dsImages .num{position:absolute;top:6px;left:6px;min-width:26px;height:26px;padding:0 6px;border-radius:13px;background:#7c8cff;color:#0b0f22;font-weight:700;font-size:14px;display:grid;place-items:center;box-shadow:0 2px 8px rgba(0,0,0,.5)}
  #dsImages .cap{padding:6px 9px 8px;display:grid;gap:2px}
  #dsImages .cap .t{font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #dsImages .cap .d{font-size:12px;opacity:.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #dsImages footer{display:flex;gap:8px;justify-content:center;margin-top:10px;flex-wrap:wrap}
  #dsImages .big{flex:1;min-height:0;display:grid;grid-template-rows:1fr auto;gap:10px;margin-top:10px}
  #dsImages .big .frame{min-height:0;display:grid;place-items:center;background:#070914;border-radius:14px;overflow:hidden}
  #dsImages .big .frame img{max-width:100%;max-height:100%;object-fit:contain;display:block}
  #dsImages .big .info{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
  #dsImages .big .info .t{font-size:18px;font-weight:600;flex:1;min-width:200px}
  #dsImages a.src{color:#9fb0ff;text-decoration:underline}
  #dsImages .empty{opacity:.8;margin:20px 4px}
  `;
  document.head.appendChild(css);

  let root = null, state = { open: false }, lastKey = "";
  const act = (action, n) => post("/images/act", { action, n }).catch((e) => core()?.toast?.("Pictures", e.message, "", "bell"));
  function close(local = false) { root?.remove(); root = null; state = { open: false }; lastKey = ""; if (!local) act("close"); }

  function picture(src, fallback, alt) {
    const box = el("div", "pic");
    const s = onlyProxy(src), f = onlyProxy(fallback);
    if (!s && !f) { box.textContent = "🖼"; return box; }
    const i = new Image(); i.alt = alt || ""; i.loading = "lazy"; i.decoding = "async"; i.referrerPolicy = "no-referrer";
    i.src = s || f;
    i.onerror = () => { if (f && i.src.indexOf(f) < 0 && s) { i.src = f; return; } i.remove(); box.textContent = "🖼"; };
    box.appendChild(i); return box;
  }
  function header(v) {
    const h = el("header");
    const title = el("h2", "", `Pictures of ${v.query}`);
    const bits = [];
    const f = v.filters || {};
    if (f.type) bits.push(f.type === "clipart" ? "clip art" : f.type === "gif" ? "GIFs" : f.type === "line" ? "line drawings" : f.type === "photo" ? "photos" : "transparent");
    if (f.size) bits.push(f.size); if (f.color) bits.push(f.color === "mono" ? "black and white" : f.color); if (f.layout) bits.push(f.layout); if (f.recent) bits.push(`past ${f.recent}`); if (f.site) bits.push(`from ${f.site}`);
    const sub = el("span", "sub", bits.join(" · "));
    const x = el("button", "ib", "✕ Close"); x.type = "button"; x.onclick = () => close();
    h.append(title, sub, x);
    return h;
  }
  function grid(v) {
    const g = el("div", "grid");
    if (!v.items?.length) g.appendChild(el("p", "empty", "No pictures found."));
    for (const it of v.items ?? []) {
      const c = el("button", "cell"); c.type = "button"; c.dataset.n = String(it.n);
      c.setAttribute("aria-label", `Number ${it.n}: ${it.title}`);
      c.append(picture(it.thumb, null, it.title), el("span", "num", String(it.n)));
      const cap = el("div", "cap"); cap.append(el("div", "t", it.title), el("div", "d", it.sourceDomain || "")); c.appendChild(cap);
      c.title = it.width && it.height ? `${it.title} (${it.width}×${it.height})` : it.title;
      c.onclick = () => act("view", it.n);
      g.appendChild(c);
    }
    const foot = el("footer");
    const first = v.items?.[0]?.n ?? 1;
    if (first > 1) { const b = el("button", "ib", "◀ Previous"); b.type = "button"; b.onclick = () => act("prev"); foot.appendChild(b); }
    if (v.more) { const b = el("button", "ib main", "More ▶"); b.type = "button"; b.onclick = () => act("more"); foot.appendChild(b); }
    return [g, foot];
  }
  function big(b) {
    const wrap = el("div", "big");
    const frame = el("div", "frame");
    const s = onlyProxy(b.full) || onlyProxy(b.thumb);
    if (s) { const i = new Image(); i.alt = b.title || ""; i.referrerPolicy = "no-referrer"; i.src = s; i.onerror = () => { const t = onlyProxy(b.thumb); if (t && i.src.indexOf(t) < 0) i.src = t; else { i.remove(); frame.textContent = "Couldn't load this picture."; } }; frame.appendChild(i); }
    const info = el("div", "info");
    info.append(el("span", "num", String(b.n)), el("span", "t", b.title));
    const src = httpUrl(b.sourcePage);
    if (src) { const a = el("a", "src", `${b.sourceDomain || "Source"} ↗`); a.href = src; a.target = "_blank"; a.rel = "noopener noreferrer"; info.appendChild(a); }
    else if (b.sourceDomain) info.appendChild(el("span", "sub", b.sourceDomain));
    if (b.width && b.height) info.appendChild(el("span", "sub", `${b.width}×${b.height}`));
    const back = el("button", "ib", "◀ All pictures"); back.type = "button"; back.onclick = () => act("grid");
    // a picture from the web has no place on this computer until it's saved: "Save to my photos" first, then (when it
    // landed where the photo gallery may show it) 📂 Open file location and 🖼 View in gallery (public/gallery.js)
    const save = el("button", "ib main", "⤓ Save to my photos"); save.type = "button"; save.dataset.save = "1";
    const after = el("span", "saved-acts");
    save.onclick = () => post("/images/act", { action: "save", n: b.n }).then((r) => {
      core()?.toast?.("Saved", r.saved?.where === "pictures" ? "In Pictures › Dayspring" : "In Dayspring's images folder", "", "bell");
      save.textContent = "✓ Saved";
      const html = r.saved?.id ? window.dsGallery?.actionsHtml?.(r.saved.id) ?? "" : "";
      if (html) after.innerHTML = html; else after.textContent = r.saved?.where === "pictures" ? "" : "Saved in Dayspring's own images folder (not one of your folders, so there's no file location to open).";
    }).catch((e) => core()?.toast?.("Couldn't save", e.message, "", "bell"));
    const like = el("button", "ib", "More like this"); like.type = "button"; like.onclick = () => core()?.ask?.(`more like number ${b.n}`, { typed: true, internal: true });
    info.append(back, save, after, like);
    wrap.append(frame, info);
    return wrap;
  }
  function render(v) {
    if (!v || !v.open) { root?.remove(); root = null; state = { open: false }; lastKey = ""; return; }
    const key = JSON.stringify([v.query, v.filters, v.items?.map((x) => x.n), v.selected]);
    state = v;
    if (key === lastKey && root) return;
    lastKey = key;
    if (!root) { root = el("section"); root.id = "dsImages"; root.setAttribute("aria-label", "Pictures"); document.body.appendChild(root); }
    const parts = [header(v)];
    if (v.selected && v.big) parts.push(big(v.big)); else parts.push(...grid(v));
    root.replaceChildren(...parts);
    try { post("/screen/shown", { kind: "images", view: "images", title: `Pictures of ${v.query}`, text: (v.items ?? []).map((x) => `${x.n}. ${x.title}`).join(" ") }).catch(() => {}); } catch { /* fine */ }
  }
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !root || (e.dsTop && e.dsTop !== root)) return;
    if (state.selected) act("grid"); else close();
  });
  const attach = (es) => es.addEventListener("images", (e) => { let v = {}; try { v = JSON.parse(e.data); } catch { return; } render(v); });
  if (window.dsEvents) attach(window.dsEvents); else addEventListener("ds-events", (e) => attach(e.detail), { once: true });
  // a reload (or a new screen) picks up what's showing
  fetch("/api/images/state").then((r) => r.json()).then((v) => { if (v?.open) render(v); }).catch(() => {});
  addEventListener("ds-test-images", (e) => render(e.detail));
  window.dsImages = { _state: () => ({ open: Boolean(root), selected: state.selected ?? null, numbers: root ? [...root.querySelectorAll(".cell")].map((c) => Number(c.dataset.n)) : [], big: Boolean(root?.querySelector(".big")) }), close: () => close(true) };
})();
