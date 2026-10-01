// The Shopping panel on the Dayspring screen (lib/shopping): Amazon, looked up in Dayspring's media window, shown here.
//   Search   a big search box ("waterproof work boot size 11"), Amazon's own filters (price range, brand, rating, Prime,
//            sort: changing one asks Amazon again), numbered result cards (picture, title, price, ★ rating and how many
//            ratings, Prime, delivery, Sponsored), Show more, ☐ Compare on each card.
//   Item     every picture (a gallery), title, price and deal, stock, delivery, seller, the customisations (size, colour,
//            style, count: choosing one reads that option's own price and stock), buying options, About this item,
//            details and specs, the rating breakdown and top reviews; Add to cart · Buy now · Save for later · Open on
//            Amazon · Compare.
//   Orders   his orders (date, items, total, status, Track package), a search box, Buy it again.
//   Subscribe & Save   upcoming deliveries with Skip, and his notification switch.
//   Account  Prime, the default address (name and city; the street hidden), email preferences, and Amazon's own settings
//            pages to open for him to change.
//   Saved    "Save for later" items (kept on this computer).
// Anything that would change his Amazon account asks first, here: a card with the question and Yes / No (his tap is his
// yes, for exactly that item), or he answers by voice. Buy now stops at Amazon's checkout page, shown in Dayspring's
// browser window with "Review and press Place order yourself." Dayspring never places an order.
// A window like the others (public/winman.js): big, normal, small, minimised to the dock, closed; inside the screen's
// margins (safe-area); by voice ("open number 2", "show more", "only Prime", "size 11", "minimize shopping").
(() => {
  if (window.dsShop) return;
  if (window.dsFeatures?.on && window.dsFeatures.on("shopping") === false) { window.dsShop = { open: () => false, close: () => {}, isOpen: () => false, off: true }; return; }
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = (u) => (typeof u === "string" && /^https?:\/\/[\w.:-]+\//.test(u) ? u : "");
  const api = async (path, body) => {
    const r = await fetch("/api" + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok && !j.error) j.error = `Dayspring couldn't do that just now (${r.status}).`;
    return j;
  };
  const toast = (t, s = "") => { try { window.dayspring?.toast?.(t, s, "", "bell"); } catch { /* fine */ } };
  const money = (n) => (n == null ? "" : `$${Number(n).toFixed(2)}`);
  const stars = (r) => (r == null ? "" : `<span class="sh-stars" aria-label="${r} out of 5 stars">${"★".repeat(Math.round(r))}${"☆".repeat(5 - Math.round(r))}</span> ${r}`);
  const num = (n) => (n == null ? "" : Number(n).toLocaleString("en-US"));

  // ------------------------------------------------------------------------------------------------ styles
  const css = document.createElement("style");
  css.textContent = `
  #dsShop{box-sizing:border-box;position:fixed;z-index:47;display:flex;flex-direction:column;border-radius:1em;overflow:hidden;color:var(--ink,#eef0ff);font-size:15px;
    background:rgba(10,12,30,.985);border:1px solid var(--edge2,rgba(170,180,255,.28));box-shadow:0 30px 90px rgba(0,0,0,.65);
    top:calc(var(--safe-top,0px) + 2.9em);left:calc(var(--safe-left,0px) + var(--safe-gap,10px));
    width:calc(var(--safe-w,100vw) - 2 * var(--safe-gap,10px));height:calc(var(--safe-h,100vh) - 2.9em - var(--safe-gap,10px))}
  #dsShop[hidden]{display:none}
  html.mini #dsShop{top:2.5em;left:0;width:100vw;height:calc(100vh - 2.5em);border-radius:0}
  #dsShop *{box-sizing:border-box}
  #dsShop button,#dsShop select,#dsShop input{font:inherit;color:inherit}
  #dsShop .sb{background:rgba(255,255,255,.07);border:1px solid var(--edge2,rgba(170,180,255,.28));border-radius:.55em;padding:.25em .65em;cursor:pointer;min-height:2.1em;line-height:1.2;white-space:nowrap}
  #dsShop .sb:hover,#dsShop .sb:focus-visible{background:rgba(124,140,255,.32);outline:2px solid rgba(160,175,255,.7);outline-offset:1px}
  #dsShop .sb.go{background:linear-gradient(135deg,#5b6cff,#8a5bff);border-color:transparent;font-weight:600}
  #dsShop .sb.warn{background:rgba(255,190,80,.18);border-color:rgba(255,200,120,.55)}
  #dsShop .sb[aria-pressed="true"],#dsShop .sb[aria-selected="true"]{background:rgba(124,140,255,.45)}
  #dsShop .sb:disabled{opacity:.45;cursor:default}
  #dsShop input[type=search],#dsShop input[type=number],#dsShop input[type=text],#dsShop select{background:rgba(255,255,255,.08);border:1px solid var(--edge2,rgba(170,180,255,.28));border-radius:.5em;padding:.25em .45em;min-height:2.1em}
  #dsShop .sh-bar{display:flex;align-items:center;gap:.45em;padding:.45em .6em;border-bottom:1px solid rgba(160,170,255,.14);flex-wrap:wrap;flex:0 0 auto}
  #dsShop .sh-title{flex:1 1 8em;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #dsShop .sh-title b{font-weight:600}#dsShop .sh-title small{color:var(--muted,#a4abcc);margin-left:.5em}
  #dsShop .sh-tabs{display:flex;gap:.3em;flex-wrap:wrap}
  #dsShop .sh-note{margin:.5em .7em 0;padding:.6em .8em;border-radius:.7em;background:rgba(124,140,255,.14);border:1px solid rgba(160,175,255,.35);display:flex;gap:.6em;align-items:center;flex-wrap:wrap;flex:0 0 auto}
  #dsShop .sh-note[hidden]{display:none}
  #dsShop .sh-note{max-height:34%;overflow:auto}
  #dsShop.narrow .sh-tabs .sb,#dsShop.narrow .sh-bar .sb{font-size:.86em;padding:.2em .5em}
  #dsShop .sh-note p{margin:0;flex:1 1 16em}
  #dsShop .sh-note.ask{background:rgba(255,200,90,.14);border-color:rgba(255,205,120,.6)}
  #dsShop .sh-note.ban{background:rgba(70,200,140,.14);border-color:rgba(120,230,170,.55)}
  #dsShop .sh-note.bad{background:rgba(255,90,120,.13);border-color:rgba(255,130,150,.5)}
  #dsShop .sh-body{flex:1 1 auto;min-height:0;overflow:auto;padding:.6em .7em;outline:none}
  #dsShop .sh-search{display:flex;gap:.4em;flex-wrap:wrap;align-items:center}
  #dsShop .sh-search input[type=search]{flex:1 1 14em;min-width:8em;font-size:1.05em}
  #dsShop .sh-filters{display:flex;gap:.4em .7em;flex-wrap:wrap;align-items:center;margin:.5em 0;color:var(--muted,#c3c8e8);font-size:.92em}
  #dsShop .sh-filters label{display:inline-flex;gap:.3em;align-items:center;white-space:nowrap}
  #dsShop .sh-filters input[type=number]{width:5.5em}
  #dsShop .sh-filters input[type=text]{width:8em}
  #dsShop .sh-meta{color:var(--muted,#a4abcc);font-size:.9em;margin:.2em 0 .5em}
  #dsShop .sh-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(13.5em,1fr));gap:.6em}
  #dsShop .sh-card{position:relative;display:flex;flex-direction:column;gap:.25em;padding:.5em;border-radius:.8em;background:rgba(255,255,255,.05);border:1px solid rgba(160,170,255,.16);min-width:0}
  #dsShop .sh-card:focus-within,#dsShop .sh-card:hover{border-color:#8b9bff}
  #dsShop .sh-n{position:absolute;top:.35em;left:.35em;z-index:1;background:rgba(10,12,30,.85);border:1px solid rgba(170,180,255,.5);border-radius:.6em;padding:0 .45em;font-weight:700;font-size:.9em}
  #dsShop .sh-img{width:100%;aspect-ratio:1/1;object-fit:contain;background:#fff;border-radius:.5em;cursor:pointer;display:block}
  #dsShop .sh-ph{width:100%;aspect-ratio:1/1;display:grid;place-items:center;background:rgba(255,255,255,.06);border-radius:.5em;font-size:2em;cursor:pointer}
  #dsShop .sh-t{font-size:.92em;line-height:1.3;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;cursor:pointer;background:none;border:0;padding:0;text-align:left;color:inherit}
  #dsShop .sh-t:hover,#dsShop .sh-t:focus-visible{text-decoration:underline;outline:none}
  #dsShop .sh-price{font-size:1.15em;font-weight:700}
  #dsShop .sh-was{color:var(--muted,#a4abcc);text-decoration:line-through;font-size:.85em;margin-left:.35em;font-weight:400}
  #dsShop .sh-stars{color:#ffc84a;letter-spacing:.02em}
  #dsShop .sh-small{font-size:.82em;color:var(--muted,#b8bedf)}
  #dsShop .sh-prime{color:#5cc3ff;font-weight:700;font-style:italic}
  #dsShop .sh-spon{font-size:.75em;color:#ffcf8a;border:1px solid rgba(255,207,138,.5);border-radius:.4em;padding:0 .35em;align-self:flex-start}
  #dsShop .sh-badge{font-size:.75em;color:#111;background:#ffb84a;border-radius:.4em;padding:0 .35em;align-self:flex-start}
  #dsShop .sh-acts{display:flex;gap:.35em;flex-wrap:wrap;margin-top:auto;padding-top:.3em}
  #dsShop .sh-more{display:flex;justify-content:center;margin:.8em 0}
  #dsShop .sh-empty{padding:2em;text-align:center;color:var(--muted,#a4abcc)}
  #dsShop .sh-load{padding:1.4em;text-align:center;color:var(--muted,#c3c8e8)}
  #dsShop .sh-item{display:grid;grid-template-columns:minmax(14em,1fr) minmax(16em,1.2fr);gap:1em;align-items:start}
  #dsShop.narrow .sh-item{grid-template-columns:1fr}
  #dsShop .sh-gal img.big{width:100%;max-height:28em;object-fit:contain;background:#fff;border-radius:.7em;display:block}
  #dsShop .sh-thumbs{display:flex;gap:.35em;overflow-x:auto;padding:.4em 0;scrollbar-width:thin}
  #dsShop .sh-thumbs button{flex:0 0 auto;width:3.6em;height:3.6em;padding:0;border:2px solid transparent;border-radius:.4em;background:#fff;cursor:pointer;overflow:hidden}
  #dsShop .sh-thumbs button[aria-pressed="true"]{border-color:#ffd84a}
  #dsShop .sh-thumbs img{width:100%;height:100%;object-fit:contain}
  #dsShop .sh-info h2{font-size:1.15em;margin:.1em 0 .3em;line-height:1.3}
  #dsShop .sh-row{margin:.35em 0}
  #dsShop .sh-dim{margin:.5em 0}
  #dsShop .sh-dim b{display:block;font-size:.9em;margin-bottom:.25em}
  #dsShop .sh-opts{display:flex;gap:.3em;flex-wrap:wrap}
  #dsShop .sh-opts .sb{font-size:.88em;min-height:2em}
  #dsShop .sh-opts .sb.na{opacity:.45;text-decoration:line-through}
  #dsShop .sh-sec{margin:1em 0 .3em;font-size:1em;color:#ffe7b8}
  #dsShop ul.sh-bul{margin:.2em 0;padding-left:1.2em}#dsShop ul.sh-bul li{margin:.25em 0;line-height:1.35}
  #dsShop table.sh-specs{border-collapse:collapse;width:100%;font-size:.9em}
  #dsShop table.sh-specs th,#dsShop table.sh-specs td{border-bottom:1px solid rgba(160,170,255,.14);padding:.3em .4em;text-align:left;vertical-align:top}
  #dsShop table.sh-specs th{color:var(--muted,#b8bedf);font-weight:500;width:38%}
  #dsShop .sh-hist{display:grid;grid-template-columns:auto 1fr auto;gap:.25em .5em;align-items:center;max-width:24em;font-size:.88em}
  #dsShop .sh-hist i{display:block;height:.7em;border-radius:.35em;background:rgba(255,255,255,.1);overflow:hidden}
  #dsShop .sh-hist i span{display:block;height:100%;background:#ffb84a}
  #dsShop .sh-rev{border-top:1px solid rgba(160,170,255,.14);padding:.5em 0}
  #dsShop .sh-rev p{margin:.25em 0;line-height:1.4;font-size:.92em}
  #dsShop table.sh-cmp{border-collapse:collapse;width:100%;font-size:.9em}
  #dsShop table.sh-cmp td,#dsShop table.sh-cmp th{border:1px solid rgba(160,170,255,.16);padding:.4em;vertical-align:top}
  #dsShop table.sh-cmp img{width:6em;height:6em;object-fit:contain;background:#fff;border-radius:.4em}
  #dsShop .sh-order{border:1px solid rgba(160,170,255,.16);border-radius:.8em;padding:.5em .7em;margin:.5em 0;background:rgba(255,255,255,.04)}
  #dsShop .sh-order header{display:flex;gap:.8em;flex-wrap:wrap;color:var(--muted,#c3c8e8);font-size:.9em;align-items:center}
  #dsShop .sh-oi{display:flex;gap:.6em;align-items:center;margin:.4em 0}
  #dsShop .sh-oi img{width:3.4em;height:3.4em;object-fit:contain;background:#fff;border-radius:.4em;flex:0 0 auto}
  #dsShop .sh-oi .sh-ot{flex:1 1 auto;min-width:0}
  #dsShop .sw{width:2.8em;height:1.6em;border-radius:1em;border:1px solid rgba(170,180,255,.45);background:rgba(255,255,255,.1);position:relative;cursor:pointer;flex:0 0 auto}
  #dsShop .sw::after{content:"";position:absolute;top:.15em;left:.15em;width:1.2em;height:1.2em;border-radius:50%;background:#fff;transition:left .15s}
  #dsShop .sw[aria-checked="true"]{background:#5b6cff}#dsShop .sw[aria-checked="true"]::after{left:1.4em}
  #dsShop .sh-acct-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(15em,1fr));gap:.7em}
  #dsShop .sh-box{border:1px solid rgba(160,170,255,.16);border-radius:.8em;padding:.6em .8em;background:rgba(255,255,255,.04)}
  #dsShop .sh-box h3{margin:.1em 0 .4em;font-size:1em}
  @media (prefers-reduced-motion: reduce){#dsShop .sw::after{transition:none}}`;
  document.head.appendChild(css);

  // ------------------------------------------------------------------------------------------------ state
  const TABS = [["search", "🔎 Search"], ["orders", "📦 Orders"], ["subs", "🔁 Subscribe & Save"], ["account", "👤 Account"], ["saved", "★ Saved"]];
  const st = { open: false, tab: "search", status: null, results: null, item: null, compare: [], orders: null, subs: null, account: null, saved: [], banner: null, ask: null, busy: "", err: null, img: 0, cmp: new Set(), sorts: {} };
  let root, body, noteEl, askEl, banEl;
  const $ = (s, el = root) => el.querySelector(s);

  function build() {
    root = document.createElement("section"); root.id = "dsShop"; root.setAttribute("role", "dialog"); root.setAttribute("aria-label", "Shopping on Amazon"); root.hidden = true; root.tabIndex = -1;
    root.innerHTML = `
      <header class="sh-bar"><span class="sh-title"><b>🛒 Shopping</b><small class="sh-acct"></small></span>
        <div class="sh-tabs" role="tablist" aria-label="Shopping">${TABS.map(([id, n]) => `<button type="button" class="sb" role="tab" data-tab="${id}" aria-selected="false">${n}</button>`).join("")}</div>
        <button type="button" class="sb sh-x" data-a="close" title="Close (Esc)" aria-label="Close Shopping">✕</button></header>
      <div class="sh-note" data-k="status" hidden role="status"></div>
      <div class="sh-note ask" data-k="ask" hidden role="alertdialog" aria-live="assertive"></div>
      <div class="sh-note ban" data-k="banner" hidden role="status"></div>
      <div class="sh-body" tabindex="-1"></div>`;
    document.body.appendChild(root);
    body = $(".sh-body"); noteEl = $('[data-k="status"]'); askEl = $('[data-k="ask"]'); banEl = $('[data-k="banner"]');
    root.addEventListener("click", onClick);
    root.addEventListener("change", onChange);
    root.addEventListener("submit", (e) => { e.preventDefault(); const f = e.target; if (f.matches(".sh-search")) runSearch(); else if (f.matches(".sh-osearch")) loadOrders(f.querySelector("input").value.trim()); });
    new ResizeObserver(() => root.classList.toggle("narrow", root.offsetWidth < 760)).observe(root);
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !st.open || (e.dsTop && e.dsTop !== root)) return;
      if (e.target?.matches?.("input") && e.target.value && e.target.type === "search") return;
      e.stopImmediatePropagation(); e.preventDefault();
      if (st.ask) answer(false); else if (st.tab === "item" || st.tab === "compare") setTab("search"); else close();
    }, true);
    registerWindow();
  }
  let wmDone = false;
  function registerWindow() {
    if (wmDone || !window.winman?.register) return;
    try { wmDone = Boolean(window.winman.register("shopping", root, { title: "Shopping", icon: "🛒", aliases: ["shopping", "amazon", "shopping panel", "amazon shopping", "store"], bar: ".sh-bar", before: ".sh-x", onClose: () => close(), isOpen: () => st.open })); } catch { /* works without it */ }
  }

  // ------------------------------------------------------------------------------------------------ opening
  function open(o = {}) {
    if (!root) build();
    st.open = true; root.hidden = false;
    try { const w = window.winman?.get?.("shopping"); if (w && (w.mode === "min" || w.mode === "closed")) window.winman.setMode("shopping", "restore", { user: false }); } catch { /* fine */ }
    if (o.tab) st.tab = o.tab;
    for (const k of ["results", "item", "compare", "orders", "subs", "account"]) if (o[k] !== undefined) st[k] = o[k];
    paint(); report();
    refreshState();
    if (o.focus !== false && st.tab === "search" && !st.results) setTimeout(() => $(".sh-q")?.focus(), 50);
    return true;
  }
  function close() { if (!root) return; st.open = false; root.hidden = true; st.ask = null; report(); }
  const isOpen = () => st.open;
  function setTab(t) {
    st.tab = t; st.err = null; paint(); report();
    if (t === "orders" && !st.orders) loadOrders("");
    else if (t === "subs" && !st.subs) run("/shopping/subscriptions", {});
    else if (t === "account" && !st.account) run("/shopping/account", {});
  }
  let repT = 0;
  function report() { clearTimeout(repT); repT = setTimeout(() => api("/shopping/view", { open: st.open, tab: st.tab }).catch(() => {}), 150); }
  async function refreshState() {
    const s = await api("/shopping/state").catch(() => null);
    if (!s || s.error) return;
    st.status = s.status; st.sorts = s.sorts ?? st.sorts; st.saved = s.saved ?? [];
    st.results = st.results ?? s.results; st.item = st.item ?? s.item; st.orders = st.orders ?? s.orders; st.subs = st.subs ?? s.subs; st.account = st.account ?? s.account;
    if (s.banner && !st.banner) st.banner = s.banner;
    paint();
  }

  // ------------------------------------------------------------------------------------------------ talking to the server
  async function run(path, payload, { tab = null, quietBusy = false } = {}) {
    st.busy = quietBusy ? st.busy : "Asking Amazon…"; st.err = null; if (tab) st.tab = tab; paint();
    const r = await api(path, payload);
    st.busy = "";
    absorb(r);
    paint();
    return r;
  }
  function absorb(r) {
    if (!r) return;
    if (r.results) { st.results = r.results; st.draft = null; }
    if (r.item) { st.item = r.item; st.img = 0; st.tab = "item"; }
    if (r.compare) { st.compare = r.compare; st.tab = "compare"; }
    if (r.orders) st.orders = r.orders;
    if (r.subs) st.subs = r.subs;
    if (r.account) st.account = r.account;
    if (r.needsConfirm && r.text && r.confirm_token) showAsk({ token: r.confirm_token, text: r.text, kind: r.mode ? "cart" : r.id ? "skip" : "open", asin: r.asin, mode: r.mode, id: r.id });
    if (r.error && !r.needsConfirm) {
      st.err = r.error;
      if (r.signIn && st.status) st.status.signedIn = false;
      if (r.captcha && st.status) st.status.paused = { kind: "captcha" };
    } else if (r.reply && (r.added || r.checkout || r.ok && /Skipped|Saved|Signed/.test(r.reply))) toast("Shopping", r.reply);
  }
  function runSearch(extra = {}) {
    const q = $(".sh-q")?.value.trim() ?? "";
    if (!q) { $(".sh-q")?.focus(); return; }
    st.draft = filtersNow();   // (what he set stays on the screen while Amazon is asked)
    return run("/shopping/search", { query: q, filters: st.draft, ...extra }, { tab: "search" });
  }
  function filtersNow() {
    const v = (s) => $(s)?.value ?? "";
    return { minPrice: v(".sh-fmin") || null, maxPrice: v(".sh-fmax") || null, brand: v(".sh-fbrand").trim() || null, minRating: v(".sh-frate") || null, prime: Boolean($(".sh-fprime")?.checked), sort: v(".sh-fsort") || "relevance" };
  }
  const loadOrders = (q) => run("/shopping/orders", { query: q }, { tab: "orders" });

  // ------------------------------------------------------------------------------------------------ the question (his yes)
  function showAsk(a) { st.ask = a; paintNotes(); setTimeout(() => askEl.querySelector("[data-a=yes]")?.focus(), 30); }
  async function answer(yes) {
    const a = st.ask; if (!a) return;
    st.ask = null; paintNotes();
    if (!yes) { api("/shopping/decline", { token: a.token }).catch(() => {}); return; }
    if (a.kind === "cart") await run("/shopping/cart", { asin: a.asin, mode: a.mode, yes: true });
    else if (a.kind === "skip") await run("/shopping/skip", { id: a.id, yes: true });
    else if (a.kind === "open") { await api("/shopping/allow-open", { yes: true }); toast("Shopping", "Okay. Dayspring may open Amazon for the next 15 minutes."); }
  }

  // ------------------------------------------------------------------------------------------------ painting
  function paint() {
    if (!root) return;
    for (const b of root.querySelectorAll("[data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === st.tab || (st.tab === "item" || st.tab === "compare") && b.dataset.tab === "search"));
    const acct = st.status?.signedIn ? (st.status.account ? `Amazon: ${st.status.account}` : "Amazon: signed in") : st.status?.signedIn === false ? "Amazon: not signed in" : "";
    $(".sh-acct").textContent = acct;
    paintNotes();
    const view = { search: viewSearch, item: viewItem, compare: viewCompare, orders: viewOrders, subs: viewSubs, account: viewAccount, saved: viewSaved }[st.tab] ?? viewSearch;
    const keepQ = $(".sh-q")?.value;
    body.innerHTML = (st.busy ? `<div class="sh-load" role="status">⏳ ${esc(st.busy)}</div>` : "") + (st.err ? `<div class="sh-note bad" role="alert"><p>${esc(st.err)}</p></div>` : "") + view();
    if (keepQ != null && $(".sh-q") && !$(".sh-q").value) $(".sh-q").value = keepQ;
    for (const im of body.querySelectorAll("img")) im.addEventListener("error", () => { im.replaceWith(Object.assign(document.createElement("div"), { className: "sh-ph", textContent: "🛒" })); }, { once: true });
  }
  function paintNotes() {
    const s = st.status;
    let html = "";
    if (s && s.feature && !s.enabled) html = `<p>Amazon shopping is turned off. Turn it on in Settings → Shopping.</p><button type="button" class="sb" data-a="settings">Open Settings</button>`;
    else if (s?.paused) html = `<p>Amazon asked to check that you're a person. Dayspring never answers those: the page is open in Dayspring's browser window. Solve it there yourself, then press Continue.</p><button type="button" class="sb" data-a="showwin">Show the window</button><button type="button" class="sb go" data-a="resume">Continue</button>`;
    else if (s && s.signedIn === false) html = `<p>Sign in to Amazon once, in Dayspring's browser window. You type your own password and codes there; Dayspring never sees or keeps them.</p><button type="button" class="sb go" data-a="signin">Sign in to Amazon</button>`;
    noteEl.hidden = !html; noteEl.innerHTML = html;
    askEl.hidden = !st.ask;
    askEl.innerHTML = st.ask ? `<p><b>${esc(st.ask.text)}</b></p><button type="button" class="sb go" data-a="yes">Yes</button><button type="button" class="sb" data-a="no">No</button>` : "";
    banEl.hidden = !st.banner;
    banEl.innerHTML = st.banner ? `<p>🧾 <b>Amazon's checkout is open in Dayspring's browser window.</b> ${esc(st.banner.text)}${st.banner.total != null ? ` Order total: ${money(st.banner.total)}.` : ""}</p><button type="button" class="sb" data-a="showwin">Show the window</button><button type="button" class="sb" data-a="banok">OK</button>` : "";
  }
  const sortOpts = (cur) => Object.entries(st.sorts && Object.keys(st.sorts).length ? st.sorts : { relevance: "Best match", "price-asc": "Price: low to high", "price-desc": "Price: high to low", reviews: "Customer reviews", newest: "Newest arrivals", bestsellers: "Best sellers" }).map(([k, v]) => `<option value="${k}"${k === cur ? " selected" : ""}>${esc(v)}</option>`).join("");
  function viewSearch() {
    const R = st.results, F = st.draft ?? R?.filters ?? {};
    const card = (x) => `<article class="sh-card" data-asin="${esc(x.asin)}" aria-label="Number ${x.n}: ${esc(x.title)}">
        <span class="sh-n" aria-hidden="true">${x.n}</span>
        ${safeUrl(x.image) ? `<img class="sh-img" src="${esc(x.image)}" alt="" loading="lazy" data-a="item" data-asin="${esc(x.asin)}">` : `<div class="sh-ph" data-a="item" data-asin="${esc(x.asin)}">🛒</div>`}
        ${x.sponsored ? '<span class="sh-spon">Sponsored</span>' : ""}${x.badge ? `<span class="sh-badge">${esc(x.badge)}</span>` : ""}
        <button type="button" class="sh-t" data-a="item" data-asin="${esc(x.asin)}" title="${esc(x.title)}">${esc(x.title)}</button>
        ${x.brand ? `<div class="sh-small">${esc(x.brand)}</div>` : ""}
        <div><span class="sh-price">${x.price != null ? money(x.price) : '<span class="sh-small">No price shown</span>'}</span>${x.listPrice && x.price && x.listPrice > x.price ? `<span class="sh-was">${money(x.listPrice)}</span>` : ""}</div>
        ${x.rating ? `<div class="sh-small">${stars(x.rating)}${x.reviews ? ` (${num(x.reviews)})` : ""}</div>` : ""}
        ${x.prime ? '<div class="sh-prime">✓prime</div>' : ""}${x.delivery ? `<div class="sh-small">${esc(x.delivery)}</div>` : ""}
        <div class="sh-acts"><button type="button" class="sb" data-a="item" data-asin="${esc(x.asin)}">Details</button>
          <button type="button" class="sb" data-a="cmp" data-n="${x.n}" aria-pressed="${st.cmp.has(x.n)}">☐ Compare</button></div></article>`;
    return `<form class="sh-search" role="search" autocomplete="off">
        <input class="sh-q" type="search" maxlength="200" enterkeyhint="search" placeholder="Describe it: waterproof work boot size 11" aria-label="Search Amazon" value="${esc(R?.query ?? "")}">
        <button type="submit" class="sb go">Search Amazon</button></form>
      <div class="sh-filters" role="group" aria-label="Filters (Amazon's own)">
        <label>$ <input class="sh-fmin" type="number" min="0" step="1" placeholder="min" aria-label="Lowest price" value="${F.minPrice ?? ""}"></label>
        <label>to <input class="sh-fmax" type="number" min="0" step="1" placeholder="max" aria-label="Highest price" value="${F.maxPrice ?? ""}"></label>
        <label>Brand <input class="sh-fbrand" type="text" list="sh-brands" maxlength="60" aria-label="Brand" value="${esc(F.brand ?? "")}"><datalist id="sh-brands">${(R?.brands ?? []).map((b) => `<option value="${esc(b)}">`).join("")}</datalist></label>
        <label>Rating <select class="sh-frate" aria-label="Rating"><option value="">Any</option>${[4, 3, 2, 1].map((n) => `<option value="${n}"${Number(F.minRating) === n ? " selected" : ""}>${n}★ &amp; up</option>`).join("")}</select></label>
        <label><input class="sh-fprime" type="checkbox"${F.prime ? " checked" : ""}> Prime</label>
        <label>Sort <select class="sh-fsort" aria-label="Sort">${sortOpts(F.sort ?? "relevance")}</select></label>
        <button type="button" class="sb" data-a="apply">Apply</button><button type="button" class="sb" data-a="clearf">Clear</button>
        ${st.cmp.size >= 2 ? `<button type="button" class="sb go" data-a="compare">Compare ${st.cmp.size}</button>` : ""}</div>
      ${!R ? `<div class="sh-empty">Describe what you want, or say “find … on Amazon”. Results come from amazon.com, looked up in Dayspring's own browser window.</div>`
        : !R.items.length ? `<div class="sh-empty">Amazon didn't show anything for “${esc(R.query)}”${R.filterText ? ` (${esc(R.filterText)})` : ""}. Try fewer words or looser filters.</div>`
        : `<div class="sh-meta">${R.items.length} results for “${esc(R.query)}”${R.filterText ? ` · ${esc(R.filterText)}` : ""} · say “open number 2”</div><div class="sh-grid">${R.items.map(card).join("")}</div>
           ${R.hasMore ? '<div class="sh-more"><button type="button" class="sb" data-a="more">Show more</button></div>' : ""}`}`;
  }
  function viewItem() {
    const d = st.item;
    if (!d) return `<div class="sh-empty">Pick an item from the results.</div>`;
    const imgs = d.images?.length ? d.images : [];
    const big = imgs[Math.min(st.img, imgs.length - 1)] ?? null;
    const dims = (d.variations ?? []).map((v) => `<div class="sh-dim" role="group" aria-label="${esc(v.name)}"><b>${esc(v.name)}: ${esc(v.selected || "choose")}</b><div class="sh-opts">${v.options.map((o) => `<button type="button" class="sb${o.available ? "" : " na"}" data-a="var" data-asin="${esc(o.asin ?? "")}" data-dim="${esc(v.name)}" data-val="${esc(o.label)}" aria-pressed="${o.selected}"${o.available ? "" : ' aria-disabled="true" title="Currently unavailable"'}>${esc(o.label)}</button>`).join("")}</div></div>`).join("");
    return `<button type="button" class="sb" data-a="back">‹ Back to results</button>
      <div class="sh-item" style="margin-top:.6em">
        <div class="sh-gal">${big && safeUrl(big) ? `<img class="big" src="${esc(big)}" alt="${esc(d.title)}">` : '<div class="sh-ph">🛒</div>'}
          ${imgs.length > 1 ? `<div class="sh-thumbs" aria-label="Pictures">${imgs.map((u, i) => safeUrl(u) ? `<button type="button" data-a="img" data-i="${i}" aria-label="Picture ${i + 1}" aria-pressed="${i === st.img}"><img src="${esc(u)}" alt="" loading="lazy"></button>` : "").join("")}</div>` : ""}</div>
        <div class="sh-info"><h2>${esc(d.title)}</h2>${d.brand ? `<div class="sh-small">${esc(d.brand)}</div>` : ""}
          <div class="sh-row"><span class="sh-price">${d.price != null ? money(d.price) : "No price shown"}</span>${d.listPrice && d.price && d.listPrice > d.price ? `<span class="sh-was">${money(d.listPrice)}</span>` : ""}${d.savings ? ` <span class="sh-badge">${esc(d.savings)}</span>` : ""}${d.deal ? ` <span class="sh-badge">${esc(d.deal)}</span>` : ""}</div>
          ${d.rating ? `<div class="sh-row">${stars(d.rating)}${d.reviews ? ` · ${num(d.reviews)} ratings` : ""}</div>` : ""}
          ${d.stock ? `<div class="sh-row"><b>${esc(d.stock)}</b></div>` : ""}${d.delivery ? `<div class="sh-row sh-small">🚚 ${esc(d.delivery)}</div>` : ""}
          ${d.seller || d.shipsFrom ? `<div class="sh-row sh-small">${d.shipsFrom ? `Ships from ${esc(d.shipsFrom)}` : ""}${d.seller && d.shipsFrom ? " · " : ""}${d.seller ? `Sold by ${esc(d.seller)}` : ""}</div>` : ""}
          ${dims}
          ${d.buyingOptions?.length ? `<div class="sh-row sh-small"><b>Buying options:</b> ${d.buyingOptions.map(esc).join(" · ")}</div>` : ""}
          <div class="sh-acts">
            <button type="button" class="sb go" data-a="cart" data-mode="cart"${d.canAddToCart ? "" : " disabled"}>Add to cart</button>
            <button type="button" class="sb warn" data-a="cart" data-mode="buynow"${d.canAddToCart ? "" : " disabled"} title="Puts it in your cart (after your yes) and opens Amazon's checkout for you to review. You place the order yourself.">Buy now…</button>
            <button type="button" class="sb" data-a="save">☆ Save for later</button>
            <button type="button" class="sb" data-a="amazon">↗ Open on Amazon</button>
            ${d.n ? `<button type="button" class="sb" data-a="cmp" data-n="${d.n}" aria-pressed="${st.cmp.has(d.n)}">☐ Compare</button>` : ""}</div>
          <p class="sh-small">Dayspring never places orders. Buy now stops at Amazon's checkout page for you to review and press Place your order yourself.</p></div></div>
      ${d.bullets?.length ? `<h3 class="sh-sec">About this item</h3><ul class="sh-bul">${d.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
      ${d.specs?.length ? `<h3 class="sh-sec">Product details</h3><table class="sh-specs"><tbody>${d.specs.map((s) => `<tr><th scope="row">${esc(s.name)}</th><td>${esc(s.value)}</td></tr>`).join("")}</tbody></table>` : ""}
      ${d.histogram?.length ? `<h3 class="sh-sec">Customer reviews ${d.rating ? `· ${d.rating} out of 5` : ""}</h3><div class="sh-hist">${d.histogram.map((h) => `<span>${h.stars} star</span><i role="img" aria-label="${h.pct}% gave ${h.stars} stars"><span style="width:${Math.max(0, Math.min(100, h.pct))}%"></span></i><span>${h.pct}%</span>`).join("")}</div>` : ""}
      ${d.topReviews?.length ? `<h3 class="sh-sec">Top reviews</h3>${d.topReviews.map((r) => `<div class="sh-rev"><div>${r.rating ? stars(r.rating) : ""} <b>${esc(r.title)}</b></div><div class="sh-small">${esc(r.author)}${r.date ? ` · ${esc(r.date)}` : ""}</div><p>${esc(r.body)}</p></div>`).join("")}` : ""}`;
  }
  function viewCompare() {
    const L = st.compare ?? [];
    if (L.length < 2) return `<div class="sh-empty">Tick ☐ Compare on two or three results.</div>`;
    const names = [...new Set(L.flatMap((x) => (x.specs ?? []).map((s) => s.name)))].slice(0, 12);
    const row = (label, f) => `<tr><th scope="row">${esc(label)}</th>${L.map((x) => `<td>${f(x)}</td>`).join("")}</tr>`;
    return `<button type="button" class="sb" data-a="back">‹ Back to results</button><table class="sh-cmp" style="margin-top:.6em"><tbody>
      ${row("", (x) => `${safeUrl(x.image) ? `<img src="${esc(x.image)}" alt="">` : ""}<div><button type="button" class="sh-t" data-a="item" data-asin="${esc(x.asin)}">${esc(x.title)}</button></div>`)}
      ${row("Price", (x) => (x.price != null ? `<b>${money(x.price)}</b>` : "—"))}${row("Rating", (x) => (x.rating ? `${stars(x.rating)}${x.reviews ? ` (${num(x.reviews)})` : ""}` : "—"))}
      ${row("Brand", (x) => esc(x.brand ?? "—"))}${row("Prime", (x) => (x.prime ? "✓" : x.prime === false ? "—" : "?"))}${row("Stock", (x) => esc(x.stock ?? "—"))}${row("Delivery", (x) => esc(x.delivery ?? "—"))}
      ${names.map((n) => row(n, (x) => esc(x.specs?.find((s) => s.name === n)?.value ?? "—"))).join("")}</tbody></table>`;
  }
  function viewOrders() {
    const O = st.orders;
    return `<form class="sh-osearch sh-search" role="search"><input type="search" placeholder="Search your orders (coffee filters)" aria-label="Search your orders" value="${esc(O?.query ?? "")}"><button type="submit" class="sb">Search</button><button type="button" class="sb" data-a="orders">All orders</button></form>
      ${!O ? '<div class="sh-empty">Your Amazon orders appear here.</div>' : !O.orders.length ? `<div class="sh-empty">${O.query ? `Nothing in your orders for “${esc(O.query)}”.` : "No orders to show."}</div>`
        : O.orders.map((o) => `<section class="sh-order" aria-label="Order of ${esc(o.date ?? "")}"><header><b>${esc(o.date ?? "")}</b>${o.total != null ? `<span>Total ${money(o.total)}</span>` : ""}${o.status ? `<span>${esc(o.status)}</span>` : ""}${o.id ? `<span class="sh-small">Order ${esc(o.id)}</span>` : ""}${o.track ? `<button type="button" class="sb" data-a="track" data-url="${esc(o.track)}">📍 Track package</button>` : ""}</header>
          ${o.items.map((it) => `<div class="sh-oi">${safeUrl(it.image) ? `<img src="${esc(it.image)}" alt="">` : ""}<div class="sh-ot"><span class="sh-n" style="position:static">${it.n}</span> ${esc(it.title)}</div>${it.asin ? `<button type="button" class="sb" data-a="reorder" data-n="${it.n}" data-asin="${esc(it.asin)}">Buy it again…</button>` : ""}</div>`).join("")}</section>`).join("")}`;
  }
  function viewSubs() {
    const S2 = st.subs, notify = st.status?.settings?.notify;
    return `<div class="sh-row" style="display:flex;gap:.6em;align-items:center"><button type="button" class="sw" role="switch" aria-checked="${Boolean(notify)}" data-a="notify" aria-label="Tell me about new subscriptions and upcoming deliveries"></button><span>Tell me about new subscriptions and upcoming deliveries (checked once a day)</span></div>
      <div class="sh-acts"><button type="button" class="sb" data-a="subsfresh">↻ Check now</button><button type="button" class="sb" data-a="page" data-page="subscriptions">↗ Manage on Amazon</button></div>
      ${!S2 ? '<div class="sh-empty">Your Subscribe & Save deliveries appear here.</div>' : !S2.items.length ? '<div class="sh-empty">No Subscribe & Save subscriptions.</div>'
        : S2.items.map((x) => `<div class="sh-oi sh-box">${safeUrl(x.image) ? `<img src="${esc(x.image)}" alt="">` : ""}<div class="sh-ot"><span class="sh-n" style="position:static">${x.n}</span> <b>${esc(x.title)}</b>${x.isNew ? ' <span class="sh-badge">New</span>' : ""}<div class="sh-small">${/^arriv/i.test(x.next ?? "") ? esc(x.next) : `Next: ${esc(x.next ?? "—")}`}${x.frequency ? ` · ${esc(x.frequency)}` : ""}${x.qty ? ` · qty ${x.qty}` : ""}${x.price != null ? ` · ${money(x.price)}` : ""}</div></div>${x.canSkip && x.id ? `<button type="button" class="sb" data-a="skip" data-id="${esc(x.id)}">Skip this delivery…</button>` : ""}</div>`).join("")}`;
  }
  function viewAccount() {
    const A = st.account;
    const pages = [["account", "Your Account"], ["orders", "Your orders"], ["comms", "Email preferences"], ["subscriptions", "Subscribe & Save"], ["prime", "Prime membership"], ["addresses", "Addresses"], ["payments", "Payments"], ["security", "Login & security"], ["cart", "Your cart"]];
    return `${!A ? '<div class="sh-empty">Your account appears here (read-only).</div>' : `<div class="sh-acct-grid">
        <div class="sh-box"><h3>Prime</h3>${A.prime ? `<div>${esc(A.prime.status)}</div>${A.prime.plan ? `<div class="sh-small">${esc(A.prime.plan)}</div>` : ""}${A.prime.renews ? `<div class="sh-small">Renews ${esc(A.prime.renews)}</div>` : ""}` : "—"}</div>
        <div class="sh-box"><h3>Default address</h3>${A.address ? `<div>${esc(A.address.name ?? "")}</div><div class="sh-small">${esc(A.address.street)}</div><div class="sh-small">${esc(A.address.city ?? "")}</div>` : "—"}</div>
        <div class="sh-box"><h3>Email preferences</h3>${A.comms?.length ? A.comms.map((c) => `<div class="sh-small">${c.on ? "✓" : "✗"} ${esc(c.name)}</div>`).join("") : "—"}</div></div>`}
      <h3 class="sh-sec">Change something on Amazon</h3><p class="sh-small">These open Amazon's own page in Dayspring's browser window, where you change it yourself. Dayspring never changes payment methods, addresses, your password, security or Prime.</p>
      <div class="sh-acts">${pages.map(([k, n]) => `<button type="button" class="sb" data-a="page" data-page="${k}">↗ ${esc(n)}</button>`).join("")}</div>
      <div class="sh-acts" style="margin-top:.8em"><button type="button" class="sb" data-a="signincheck">Am I signed in?</button><button type="button" class="sb" data-a="signout">Sign out of Amazon in Dayspring</button></div>`;
  }
  function viewSaved() {
    const L = st.saved ?? [];
    return !L.length ? '<div class="sh-empty">Nothing saved yet. Press ☆ Save for later on an item (kept on this computer, not on Amazon).</div>'
      : L.map((x) => `<div class="sh-oi sh-box">${safeUrl(x.image) ? `<img src="${esc(x.image)}" alt="">` : ""}<div class="sh-ot"><button type="button" class="sh-t" data-a="item" data-asin="${esc(x.asin)}">${esc(x.title)}</button><div class="sh-small">${x.price != null ? money(x.price) : ""}</div></div><button type="button" class="sb" data-a="unsave" data-asin="${esc(x.asin)}">Remove</button></div>`).join("");
  }

  // ------------------------------------------------------------------------------------------------ clicks
  async function onClick(e) {
    const t = e.target.closest("[data-tab],[data-a]"); if (!t || !root.contains(t)) return;
    if (t.dataset.tab) { setTab(t.dataset.tab); return; }
    const a = t.dataset.a;
    if (t.getAttribute("aria-disabled") === "true" || t.disabled) return;
    if (a === "close") return close();
    if (a === "yes" || a === "no") return answer(a === "yes");
    if (a === "item") return run("/shopping/item", { asin: t.dataset.asin }, { tab: st.tab });
    if (a === "back") { st.tab = "search"; paint(); report(); return; }
    if (a === "img") { st.img = Number(t.dataset.i) || 0; paint(); return; }
    if (a === "var") { if (t.dataset.asin) return run("/shopping/variant", { asin: t.dataset.asin }); return run("/shopping/variant", { dimension: t.dataset.dim, value: t.dataset.val }); }
    if (a === "more") return run("/shopping/search", { more: true });
    if (a === "apply") return runSearch({ keepFilters: false });
    if (a === "clearf") { for (const s of [".sh-fmin", ".sh-fmax", ".sh-fbrand"]) { const el = $(s); if (el) el.value = ""; } if ($(".sh-frate")) $(".sh-frate").value = ""; if ($(".sh-fprime")) $(".sh-fprime").checked = false; if ($(".sh-fsort")) $(".sh-fsort").value = "relevance"; return runSearch(); }
    if (a === "cmp") { const n = Number(t.dataset.n); if (st.cmp.has(n)) st.cmp.delete(n); else { if (st.cmp.size >= 3) st.cmp.delete([...st.cmp][0]); st.cmp.add(n); } paint(); return; }
    if (a === "compare") { const r = await run("/shopping/compare", { numbers: [...st.cmp] }); if (!r.error) st.cmp.clear(); return; }
    if (a === "cart") { const r = await api("/shopping/cart", { asin: st.item?.asin, mode: t.dataset.mode }); absorb(r); paint(); return; }
    if (a === "save") { const r = await api("/shopping/save", { asin: st.item?.asin }); absorb(r); if (r.reply) toast("Saved for later", r.reply); return; }
    if (a === "unsave") { await api("/shopping/unsave", { asin: t.dataset.asin }); st.saved = st.saved.filter((x) => x.asin !== t.dataset.asin); paint(); return; }
    if (a === "amazon") { const r = await api("/shopping/open", { asin: st.item?.asin }); toast("Amazon", r.reply ?? r.error ?? ""); return; }
    if (a === "orders") return loadOrders("");
    if (a === "reorder") { const r = await api("/shopping/reorder", { orderItem: Number(t.dataset.n), asin: t.dataset.asin }); absorb(r); paint(); return; }
    if (a === "track") { const r = await api("/shopping/open", { track: t.dataset.url }); toast("Amazon", r.reply ?? r.error ?? ""); return; }
    if (a === "skip") { const r = await api("/shopping/skip", { id: t.dataset.id }); absorb(r); paint(); return; }
    if (a === "subsfresh") return run("/shopping/subscriptions", { fresh: true });
    if (a === "notify") { const on = t.getAttribute("aria-checked") !== "true"; const r = await api("/shopping/settings", { notify: on }); if (r.status) st.status = r.status; paint(); toast("Subscribe & Save", on ? "Dayspring will tell you about new subscriptions and upcoming deliveries." : "No more Subscribe & Save notices."); return; }
    if (a === "page") { const r = await api("/shopping/open", { page: t.dataset.page }); toast("Amazon", r.reply ?? r.error ?? ""); return; }
    if (a === "signin") { const r = await api("/shopping/signin", {}); toast("Amazon", r.reply ?? r.error ?? ""); return; }
    if (a === "signout") { const r = await api("/shopping/signout", {}); toast("Amazon", r.reply ?? r.error ?? ""); refreshState(); return; }
    if (a === "signincheck") { const r = await api("/shopping/signin/check", {}); toast("Amazon", r.reply ?? r.error ?? ""); refreshState(); return; }
    if (a === "resume") { const r = await api("/shopping/resume", {}); if (r.resumed) { if (st.status) st.status.paused = null; st.err = null; paint(); } else toast("Amazon", r.text ?? ""); return; }
    if (a === "showwin") { await api("/shopping/window", { show: true }).catch(() => {}); return; }
    if (a === "banok") { st.banner = null; paintNotes(); return; }
    if (a === "settings") { if (window.dsOpenPage) window.dsOpenPage("/setup?embed=1&s=shopping"); else window.open("/setup?s=shopping", "_blank", "noopener"); return; }
  }
  function onChange(e) {
    if (e.target.matches(".sh-fsort, .sh-frate, .sh-fprime") && st.results) runSearch();
  }

  // ------------------------------------------------------------------------------------------------ the server's news
  function onServer(d) {
    if (!d?.do) return;
    if (d.do === "close") { close(); return; }
    if (d.do === "open") { open({ tab: d.tab, results: d.results, item: d.item, compare: d.compare, orders: d.orders, subs: d.subs, account: d.account, focus: false }); return; }
    if (!root) build();
    if (d.do === "ask") { if (!st.ask || st.ask.token !== d.token) showAsk({ token: d.token, text: d.text, kind: d.kind, asin: d.asin, mode: d.mode, id: d.id }); if (!st.open) open({ focus: false }); return; }
    if (d.do === "asked") { if (st.ask && st.ask.token === d.token) { st.ask = null; paintNotes(); } return; }
    if (d.do === "checkout") { st.banner = d.banner; open({ focus: false }); paintNotes(); return; }
    if (d.do === "paused") { st.status = { ...(st.status ?? {}), paused: { kind: d.kind } }; open({ focus: false }); return; }
    if (d.do === "resumed") { if (st.status) st.status.paused = null; st.err = null; paint(); return; }
    if (d.do === "signin") { st.status = { ...(st.status ?? {}), signedIn: d.signedIn, account: d.account ?? null }; if (d.text) toast("Amazon", d.text); paint(); return; }
    if (d.do === "back") { st.tab = "search"; paint(); return; }
    if (d.do === "subs") { if (d.subs) st.subs = d.subs; paint(); return; }
    if (d.do === "saved") { st.saved = d.saved ?? st.saved; paint(); return; }
    if (d.do === "cart") { if (d.added === false) toast("Amazon", "Amazon didn't confirm the cart. Have a look at your cart."); return; }
  }
  const listen = (es) => es.addEventListener("shopping", (e) => { let d = null; try { d = JSON.parse(e.data); } catch { return; } onServer(d); });
  if (window.dsEvents) listen(window.dsEvents); else addEventListener("ds-events", (e) => listen(e.detail), { once: true });
  addEventListener("ds-test-shop", (e) => onServer(e.detail ?? {}));

  // ------------------------------------------------------------------------------------------------ 🛒 by the clock (only when he turned shopping on)
  async function addButton() {
    const util = document.querySelector("#calBtns .util, .calbtns .util");
    if (!util || document.getElementById("shopBtn")) return;
    const s = await api("/shopping/status").catch(() => null);
    st.status = s && !s.error ? s : st.status;
    if (!s?.enabled) return;
    const b = document.createElement("button");
    b.id = "shopBtn"; b.type = "button"; b.title = "Shopping: Amazon search, your orders, Subscribe & Save"; b.innerHTML = '<i aria-hidden="true">🛒</i><span class="lbl">Shop</span>';
    b.onclick = () => (isOpen() ? close() : open({}));
    util.insertBefore(b, util.querySelector("#setBtn") ?? null);
  }
  setTimeout(addButton, 1200);

  window.dsShop = { open, close, isOpen, setTab, _state: () => ({ open: st.open, tab: st.tab, results: st.results?.items?.length ?? 0, item: st.item?.asin ?? null, title: st.item?.title ?? null, price: st.item?.price ?? null, stock: st.item?.stock ?? null, ask: st.ask ? { kind: st.ask.kind, text: st.ask.text } : null, banner: Boolean(st.banner), err: st.err, busy: st.busy, orders: st.orders?.orders?.length ?? 0, subs: st.subs?.items?.length ?? 0, account: Boolean(st.account), compare: st.compare?.length ?? 0, paused: Boolean(st.status?.paused), signedIn: st.status?.signedIn ?? null }) };
})();
