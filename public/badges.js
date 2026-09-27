// Badges on the Dayspring screen and the Progress page: the Gallery (a trophy shelf per category), the detail view,
// the mystery "next badge" cards, the coin-flip entrance, the award reveal, and the badge case (3 pinned badges).
// Only earned badges' art is ever fetched (/api/xp/badge.svg refuses the rest); the next badge is a "?" card.
//   window.dsBadges = { gallery(root), reveal(record), flip(host, opts), refresh() }
// Developer preview (only on the developer's own computer: /api/dev/status answers there and nowhere else): a "Preview
// all" switch shows every badge, earned or not, with its art, name, description and a SAMPLE citation, clearly marked
// "Preview · not earned". Previewing never records, awards or marks anything seen. (/progress?preview=1&cat=workout)
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = (p, body) => fetch("/api" + p, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}).then((r) => r.json());
  const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const artURL = (key, { mode = "static", size = 120, face = "", style = 1, dev = false } = {}) => { const [cat, tier] = key.split(":"); return `/api/xp/badge.svg?cat=${encodeURIComponent(cat)}&tier=${tier}&mode=${mode}&size=${size}${face ? "&face=" + face : ""}${style ? "" : "&style=0"}${dev ? "&dev=1" : ""}`; };
  const mysteryURL = (cat, tier, size = 120) => `/api/xp/mystery.svg?cat=${encodeURIComponent(cat)}&tier=${tier}&size=${size}`;
  const svgCache = new Map();
  const svgText = (url) => { if (!svgCache.has(url)) svgCache.set(url, fetch(url).then((r) => (r.ok ? r.text() : ""))); return svgCache.get(url); };
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const shortDate = (iso) => { const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso); return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; };
  const n = (x) => Number(x ?? 0).toLocaleString("en-US");
  let V = null;                   // the last /xp/badges view
  const E = () => V?.entrance ?? { turns: Array(18).fill(3), duration: Array(18).fill(2), ease: [0.12, 0.7, 0.18, 1], wobbleDeg: 6, wobbleTime: 0.7, scaleFrom: 0.72, lift: 10, landSheen: 0.9, glints: 8, glintTime: 0.9, shadowMin: 0.3, quick: { turns: 1, duration: 0.8 }, reduced: { fade: 0.5, glint: 0.6 }, gridStagger: 0.35 };

  // ---------------------------------------------------------------------------------------- the coin-flip entrance
  // A cubic-bezier easing (x1,y1,x2,y2) as a function of t
  function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const X = (t) => ((ax * t + bx) * t + cx) * t, Y = (t) => ((ay * t + by) * t + cy) * t, dX = (t) => (3 * ax * t + 2 * bx) * t + cx;
    return (x) => { let t = x; for (let i = 0; i < 8; i++) { const e = X(t) - x, d = dX(t); if (Math.abs(e) < 1e-5 || !d) break; t -= e / d; } return Y(Math.min(1, Math.max(0, t))); };
  }
  // host: an element to fill. front/back: HTML. opts: { tier, quick, fromBack (start showing the back: the "?" card), palette }
  function flip(host, { front, back, tier = 1, quick = false, fromBack = false, palette = null } = {}) {
    const e = E();
    host.innerHTML = `<div class="bflip"><div class="bflip-shadow"></div><div class="bflip-coin"><div class="bface bfront">${front}</div><div class="bface bback">${back}</div></div><div class="bflip-glints"></div></div>`;
    const coin = $(".bflip-coin", host), shadow = $(".bflip-shadow", host), glints = $(".bflip-glints", host), wrap = $(".bflip", host);
    wrap.dataset.state = "flipping"; window.__dsBadgeFlips = (window.__dsBadgeFlips ?? 0) + 1;
    const done = () => { coin.style.willChange = ""; shadow.style.willChange = ""; wrap.dataset.state = "done"; };
    const burst = (count, time) => {
      const cols = palette ? [palette.a, palette.g1, palette.g2, palette.s] : ["#fff6c4", "#ffd479", "#9edcff", "#ffc2e6"];
      for (let i = 0; i < count; i++) {
        const s = document.createElement("i"); s.style.background = cols[i % cols.length]; glints.appendChild(s);
        const a = (i / count) * Math.PI * 2 + 0.3, r = 70 + (i % 3) * 18;
        s.animate([{ transform: "translate(-50%,-50%) scale(.2)", opacity: 0 }, { transform: `translate(calc(-50% + ${Math.cos(a) * r * 0.55}px), calc(-50% + ${Math.sin(a) * r * 0.55}px)) scale(1)`, opacity: 1, offset: 0.35 }, { transform: `translate(calc(-50% + ${Math.cos(a) * r}px), calc(-50% + ${Math.sin(a) * r}px)) scale(.3)`, opacity: 0 }], { duration: time * 1000, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" }).onfinish = () => s.remove();
      }
    };
    if (reduced()) {
      coin.style.transform = "none"; wrap.dataset.reduced = "1";
      return new Promise((ok) => { coin.animate([{ opacity: 0 }, { opacity: 1 }], { duration: e.reduced.fade * 1000, easing: "ease-out" }).onfinish = () => { burst(1, e.reduced.glint); done(); ok(); }; });
    }
    const turns = quick ? e.quick.turns : e.turns[tier - 1] ?? 3, D = (quick ? e.quick.duration : e.duration[tier - 1] ?? 2) * 1000, W = quick ? 250 : e.wobbleTime * 1000;
    const ease = bezier(...e.ease), start = fromBack ? 180 : 0, end = turns * 360, N = 48, main = D / (D + W);
    const k = [], ks = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, p = ease(t), a = start + (end - start) * p, sc = quick ? 1 : e.scaleFrom + (1 - e.scaleFrom) * p, y = quick ? 0 : -e.lift * (1 - p);
      k.push({ transform: `translateY(${y.toFixed(2)}px) scale(${sc.toFixed(3)}) rotateY(${a.toFixed(1)}deg)`, offset: t * main });
      const edge = Math.abs(Math.cos((a * Math.PI) / 180));
      ks.push({ transform: `translateX(-50%) scaleX(${(e.shadowMin + (1 - e.shadowMin) * edge).toFixed(3)})`, opacity: (0.25 + 0.3 * edge * p).toFixed(3), offset: t * main });
    }
    const wob = [e.wobbleDeg, -e.wobbleDeg * 0.55, e.wobbleDeg * 0.25, 0];
    wob.forEach((w, i) => { const t = main + ((i + 1) / wob.length) * (1 - main); k.push({ transform: `translateY(0px) scale(1) rotateY(${(end + (quick ? w * 0.4 : w)).toFixed(1)}deg)`, offset: Math.min(1, t) }); ks.push({ transform: "translateX(-50%) scaleX(1)", opacity: 0.55, offset: Math.min(1, t) }); });
    coin.style.willChange = "transform"; shadow.style.willChange = "transform, opacity";
    return new Promise((ok) => {
      const anim = coin.animate(k, { duration: D + W, easing: "linear", fill: "forwards" });
      shadow.animate(ks, { duration: D + W, easing: "linear", fill: "forwards" });
      setTimeout(() => { wrap.classList.add("landed"); if (!quick) burst(e.glints, e.glintTime); }, D - 60);
      anim.onfinish = () => { coin.getAnimations().forEach((a) => a.cancel()); coin.style.transform = "none"; done(); ok(); };
    });
  }

  // ---------------------------------------------------------------------------------------- the award reveal
  const queue = []; let revealing = false;
  async function reveal(rec) {
    queue.push(rec); if (revealing) return; revealing = true;
    while (queue.length) {
      const r = queue.shift();
      const [cat] = r.key.split(":");
      const pal = V?.palettes?.[cat] ?? null;
      const ov = document.createElement("div"); ov.className = "brev" + (r.preview ? " preview" : ""); ov.setAttribute("role", "dialog"); ov.setAttribute("aria-label", `${r.preview ? "Preview of the reveal" : "New badge"}: ${r.name}`);
      ov.innerHTML = r.preview
        ? `<div class="brev-card"><span class="bribbon">Preview · not earned</span><div class="brev-art"></div><p class="brev-kicker">🏅 New badge <span class="bdev-tag">Dev preview</span></p><h2>${esc(r.name)}</h2><p class="brev-with">${r.earned ? `Earned with: ${esc(r.summary ?? "")}` : "This is how the reveal looks when it's earned."}</p><p class="brev-cite">${r.earned ? "" : `<span class="bsample">Sample</span> `}${esc(r.citation)}</p><button type="button" class="brev-ok">Close</button></div>`
        : `<div class="brev-card"><div class="brev-art"></div><p class="brev-kicker">🏅 New badge${r.of > 1 ? ` · ${r.seq + 1} of ${r.of}` : ""}</p><h2>${esc(r.name)}</h2><p class="brev-with">Earned with: ${esc(r.polished ?? r.clincher?.summary ?? "")}</p><p class="brev-cite">${esc(r.citation)}</p><button type="button" class="brev-ok">Wonderful</button></div>`;
      document.body.appendChild(ov);
      const [front, back] = await Promise.all([svgText(artURL(r.key, { mode: "full", size: 220, dev: r.preview })), svgText(artURL(r.key, { face: "back", size: 220, dev: r.preview }))]);
      const shown = flip($(".brev-art", ov), { front, back, tier: r.tier, palette: pal });
      await new Promise((ok) => { const close = () => { clearTimeout(t); ov.classList.add("out"); setTimeout(() => { ov.remove(); ok(); }, 350); }; const t = setTimeout(close, 9000); $(".brev-ok", ov).onclick = close; ov.onclick = (ev) => { if (ev.target === ov) close(); }; });
      void shown;
    }
    revealing = false;
  }

  // ---------------------------------------------------------------------------------------- the gallery
  let G = { root: null, filter: "all", sort: "category", io: null, es: null, dev: false, preview: false };
  async function load() { V = await api(G.dev && G.preview ? "/xp/badges?dev=1" : "/xp/badges"); if (!V.preview) G.preview = false; return V; }
  // the developer's own computer? (404 everywhere else, so there's no switch and nothing to preview)
  const devStatus = () => fetch("/api/dev/status").then((r) => (r.ok ? r.json() : null)).then((j) => Boolean(j?.dev)).catch(() => false);
  function ringSVG(p, col) { const r = 26, c = 2 * Math.PI * r; return `<svg class="bring" viewBox="0 0 60 60" aria-hidden="true"><circle cx="30" cy="30" r="${r}" class="bring-bg"/><circle cx="30" cy="30" r="${r}" class="bring-fg" style="stroke:${col}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - p)).toFixed(1)}"/></svg>`; }
  const stagger = (i) => `--d:-${((i * 0.9) % 7).toFixed(2)}s;--d2:${((i * 1.37) % 9).toFixed(2)}s`;
  function earnedCard(c, t, i) {
    return `<button type="button" class="bcard earned${t.isNew ? " isnew" : ""}" data-key="${esc(t.key)}" aria-label="${esc(`${t.name}, ${c.label} ${t.tier} of 18, earned ${shortDate(t.at)}`)}">
      <span class="bart"${t.tier >= 4 ? " data-sheen" : ""} style="${stagger(i)}"><img src="${artURL(t.key, { size: 120 })}" alt="" width="96" height="96" loading="lazy" decoding="async"></span>
      ${t.isNew ? `<span class="bnew">NEW</span>` : ""}<span class="bname">${esc(t.name)}</span><span class="bmeta">${t.tier} of 18 · ${shortDate(t.at)}</span><span class="bcite">${esc(t.citation)}</span></button>`;
  }
  function nextCard(c) {
    const x = c.next, pal = V.palettes[c.cat], pct = Math.max(0, Math.min(1, x.pct ?? 0));
    return `<button type="button" class="bcard next${pct >= 0.95 ? " near" : ""}" data-next="${esc(c.cat)}" aria-label="${esc(`Your next ${c.label} badge: ${n(x.have)} of ${n(x.need)} XP`)}" style="--bc:${pal.s}">
      <span class="bmyst">${ringSVG(pct, pal.s)}<img src="${mysteryURL(c.cat, x.tier)}" alt="" width="80" height="80"></span>
      <span class="bname">${x.name ? esc(x.name) : "Mystery badge"}</span><span class="bmeta">${n(x.have)} / ${n(x.need)} XP</span><span class="bmeta">${n(x.toGo)} XP to go</span>${x.eta ? `<span class="beta">${esc(x.eta)}</span>` : ""}</button>`;
  }
  const lockedCard = (t) => `<div class="bcard locked" aria-label="Locked badge, tier ${t.tier}"><span class="block">🔒</span><span class="bmeta">${t.tier} of 18</span></div>`;
  // developer preview: a badge that isn't earned, with its real art (marked in the card's frame, never on the art)
  function previewCard(c, t, i) {
    return `<div class="bcard preview" role="button" tabindex="0" data-pkey="${esc(t.key)}" aria-label="${esc(`${t.name}, ${c.label} ${t.tier} of 18. Preview, not earned`)}">
      <span class="bribbon" aria-hidden="true">Preview · not earned</span>
      <span class="bart"${t.tier >= 4 ? " data-sheen" : ""} style="${stagger(i)}"><img src="${artURL(t.key, { size: 120, dev: true })}" alt="" width="96" height="96" loading="lazy" decoding="async"></span>
      <span class="bname">${esc(t.name)}</span><span class="bmeta">${t.tier} of 18 · ${n(t.need)} XP</span>
      <button type="button" class="bplay" data-play="${esc(t.key)}" title="Play the reveal animation" aria-label="${esc(`Play the reveal animation for ${t.name}`)}">▶</button></div>`;
  }
  const findTier = (key) => { for (const c of V.categories) { const t = c.tiers.find((y) => y.key === key); if (t) return { c, t }; } return null; };
  function playReveal(key) {
    const f = findTier(key); if (!f) return;
    const { t } = f, earned = t.state === "earned";
    reveal({ key, tier: t.tier, name: t.name, preview: true, earned, summary: earned ? t.summary : "", citation: earned ? t.citation : t.sampleCitation });
  }
  function shelf(c, idx) {
    const pal = V.palettes[c.cat], x = c.next;
    const head = x.done ? "All 18 earned!" : `${c.earned} of 18 · next${x.name ? `: ${esc(x.name)}` : ""} in ${n(x.toGo)} XP`;
    const tiers = c.tiers.filter((t) => G.filter !== "earned" || t.state === "earned");
    return `<section class="bshelf" data-cat="${esc(c.cat)}" style="--bc:${pal.p};--bs:${pal.s}">
      <header><span class="bchip" style="background:linear-gradient(135deg,${pal.s},${pal.p})"></span><h3>${esc(c.label)}</h3><span class="bhead">${head}</span></header>
      <div class="bbar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round((x.pct ?? 1) * 100)}"><i style="width:${Math.round((x.done ? 1 : x.pct ?? 0) * 100)}%"></i></div>
      <div class="bcards">${tiers.map((t, i) => (t.state === "earned" ? earnedCard(c, t, idx * 18 + i) : t.preview ? previewCard(c, t, idx * 18 + i) : t.state === "next" ? nextCard(c) : lockedCard(t))).join("")}</div></section>`;
  }
  function render() {
    const root = G.root; if (!root || !V) return;
    const cats = V.categories.filter((c) => G.filter === "all" || G.filter === "earned" ? true : c.cat === G.filter).filter((c) => G.filter !== "earned" || c.earned > 0);
    const pins = V.pins.map((k) => { for (const c of V.categories) { const t = c.tiers.find((t) => t.key === k); if (t) return { c, t }; } return null; }).filter(Boolean);
    const summary = `<div class="bsum"><div><b>${V.total}</b> of ${V.of} badges</div>${V.rarest ? `<div>Rarest: <b>${esc(V.rarest.name)}</b> <span class="xp-muted">(tier ${V.rarest.tier})</span></div>` : ""}${V.latest ? `<div>Newest: <b>${esc(V.latest.name)}</b> <span class="xp-muted">${shortDate(V.latest.at)}</span></div>` : ""}</div>`;
    const controls = `<div class="bctl"><label>Show <select id="bFilter"><option value="all">All</option><option value="earned">Earned</option>${V.categories.map((c) => `<option value="${esc(c.cat)}">${esc(c.label)}</option>`).join("")}</select></label>
      <label>Sort <select id="bSort"><option value="category">By category</option><option value="recent">Most recent</option></select></label>
      ${G.dev ? `<label class="bdev-toggle"><input type="checkbox" id="bPreview"${G.preview ? " checked" : ""}> Preview all <span class="bdev-tag">Dev</span></label>` : ""}</div>
      ${G.preview ? `<p class="bdev-banner" role="note"><span class="bdev-tag">Dev preview</span> Every badge is shown, earned or not, with its art and a sample citation. Only you see this, and nothing here is recorded, earned or marked as seen.</p>` : ""}`;
    const caseEl = `<section class="bcase"><h2>Badge case</h2>${pins.length ? `<div class="bcards">${pins.map(({ c, t }, i) => earnedCard(c, { ...t, isNew: false }, i)).join("")}</div>` : `<p class="xp-muted">Pin up to 3 favourite badges here: open a badge and choose “Pin to badge case”. They also show on the display.</p>`}</section>`;
    let body;
    if (!V.total && G.filter === "earned") body = `<p class="bempty">No badges yet. Check in on a task (a workout, a study session, a chore) and your first one comes within a few days.</p>`;
    else if (G.sort === "recent") {
      const all = []; for (const c of cats) for (const t of c.tiers) if (t.state === "earned") all.push({ c, t });
      all.sort((a, b) => Date.parse(b.t.at) - Date.parse(a.t.at));
      body = all.length ? `<section class="bshelf recent"><div class="bcards wrap">${all.map(({ c, t }, i) => earnedCard(c, t, i)).join("")}</div></section>` : `<p class="bempty">No badges yet. Your first one comes after a few days of check-ins.</p>`;
    } else body = cats.map(shelf).join("") || `<p class="bempty">Nothing here yet.</p>`;
    root.innerHTML = `<div class="bgal">${summary}${!V.total ? `<p class="bempty">Every category has 18 badges to collect over the years. Your first comes within a few days of check-ins, so finish something and tell Dayspring!</p>` : ""}${controls}${caseEl}${body}</div>`;
    $("#bFilter", root).value = G.filter; $("#bSort", root).value = G.sort;
    $("#bFilter", root).onchange = (e) => { G.filter = e.target.value; render(); };
    $("#bSort", root).onchange = (e) => { G.sort = e.target.value; render(); };
    for (const b of root.querySelectorAll(".bcard.earned")) b.onclick = () => detail(b.dataset.key);
    for (const b of root.querySelectorAll(".bcard.next")) b.onclick = () => nextDetail(b.dataset.next);
    const pv = $("#bPreview", root); if (pv) pv.onchange = async () => { G.preview = pv.checked; await refresh(); };
    for (const b of root.querySelectorAll(".bcard.preview")) {
      b.onclick = (e) => { if (e.target.closest(".bplay")) { playReveal(e.target.closest(".bplay").dataset.play); return; } previewDetail(b.dataset.pkey); };
      b.onkeydown = (e) => { if ((e.key === "Enter" || e.key === " ") && e.target === b) { e.preventDefault(); previewDetail(b.dataset.pkey); } };
    }
    observe(root);
    if (!G.preview) newFlips(root);            // previewing never marks anything as seen
  }
  // pause badges off-screen
  function observe(root) {
    G.io?.disconnect();
    if (!("IntersectionObserver" in window)) return;
    G.io = new IntersectionObserver((es) => { for (const e of es) e.target.classList.toggle("paused", !e.isIntersecting); }, { rootMargin: "80px" });
    for (const a of root.querySelectorAll(".bart")) G.io.observe(a);
  }
  // newly earned badges flip in once, staggered, then are marked seen
  async function newFlips(root) {
    const cards = [...root.querySelectorAll(".bcard.isnew")].filter((c) => !c.closest(".bcase"));
    if (!cards.length) return;
    const keys = [...new Set(cards.map((c) => c.dataset.key))];
    api("/xp/badges/seen", { keys }).catch(() => {});
    for (const c of V.categories) for (const t of c.tiers) if (keys.includes(t.key)) t.isNew = false;
    cards.forEach((card, i) => setTimeout(async () => {
      const key = card.dataset.key, tier = Number(key.split(":")[1]), art = $(".bart", card);
      if (!art) return;
      const img = art.innerHTML, back = await svgText(artURL(key, { face: "back", size: 120 }));
      const host = document.createElement("span"); host.className = "bflip-host"; art.replaceWith(host);
      await flip(host, { front: img, back, tier, palette: V.palettes[key.split(":")[0]] });
      host.replaceWith(art);
    }, i * E().gridStagger * 1000));
  }
  // a badge earned while the gallery is open: its "?" card flips over to reveal it
  async function flipReveal(rec) {
    const card = G.root?.querySelector(`.bcard.next[data-next="${CSS.escape(rec.key.split(":")[0])}"]`);
    const prevTier = V?.categories.find((c) => c.cat === rec.key.split(":")[0])?.next?.tier;
    if (!card || prevTier !== rec.tier) return false;
    const myst = $(".bmyst img", card)?.outerHTML ?? "";
    const front = await svgText(artURL(rec.key, { mode: "static", size: 120 }));
    const host = document.createElement("span"); host.className = "bflip-host"; $(".bmyst", card).replaceWith(host);
    card.classList.add("revealing");
    await flip(host, { front, back: myst, tier: rec.tier, fromBack: true, palette: V.palettes[rec.key.split(":")[0]] });
    api("/xp/badges/seen", { keys: [rec.key] }).catch(() => {});
    return true;
  }

  // ---------------------------------------------------------------------------------------- detail views
  function dialog(html, cls = "") {
    const d = document.createElement("div"); d.className = `bdlg ${cls}`; d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "true");
    d.innerHTML = `<div class="bdlg-card"><button type="button" class="bdlg-x" aria-label="Close">×</button>${html}</div>`;
    document.body.appendChild(d);
    const close = () => { d.remove(); document.removeEventListener("keydown", key); };
    const key = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", key);
    d.onclick = (e) => { if (e.target === d || e.target.classList.contains("bdlg-x")) close(); };
    setTimeout(() => $(".bdlg-x", d)?.focus(), 30);
    return d;
  }
  async function detail(key) {
    let t = null, c = null; for (const cc of V.categories) { const x = cc.tiers.find((y) => y.key === key); if (x) { t = x; c = cc; } }
    if (!t) return;
    const pinned = V.pins.includes(key), along = t.along;
    const d = dialog(`<div class="bdet-art${t.tier >= 16 ? " tilt" : ""}"></div>
      <p class="bdet-cite">${esc(t.citation)}</p>
      <h2>${esc(t.name)}</h2><p class="xp-muted">${esc(c.label)} · ${t.tier} of 18 · earned ${shortDate(t.at)}</p>
      <div class="bdet-act"><h4>The activity that earned it</h4><p><b>${esc(t.summary)}</b> <span class="xp-muted">+${t.clincher.amount} XP · ${shortDate(t.clincher.at)}</span></p>
      ${along.count > 1 ? `<p class="xp-muted">Along the way: ${along.count} ${esc(along.noun)} from ${shortDate(along.from)} to ${shortDate(along.to)}</p>` : ""}</div>
      <p class="bdet-desc">${esc(t.description)}</p>
      <button type="button" class="bpin">${pinned ? "Remove from badge case" : "Pin to badge case"}</button>${G.dev && G.preview ? ` <button type="button" class="bplay-big">▶ Play reveal animation <span class="bdev-tag">Dev</span></button>` : ""}`, "bdet");
    const pb = $(".bplay-big", d); if (pb) pb.onclick = () => playReveal(key);
    const artEl = $(".bdet-art", d);
    const [front, back] = await Promise.all([svgText(artURL(key, { mode: "full", size: 240 })), svgText(artURL(key, { face: "back", size: 240 }))]);
    await flip(artEl, { front, back, tier: t.tier, palette: V.palettes[c.cat] });
    // hover or tap: one quicker flip
    let busy = false;
    const again = () => { if (busy || reduced()) return; busy = true; flip(artEl, { front, back, tier: t.tier, quick: true }).then(() => (busy = false)); };
    artEl.addEventListener("click", again);
    artEl.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") again(); });
    // legendary badges tilt gently in 3D under the pointer
    if (t.tier >= 16 && !reduced()) artEl.addEventListener("pointermove", (e) => { if (busy) return; const r = artEl.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5; const coin = $(".bflip-coin", artEl); if (coin) coin.style.transform = `rotateY(${(x * 14).toFixed(1)}deg) rotateX(${(-y * 14).toFixed(1)}deg)`; });
    $(".bpin", d).onclick = async () => { const r = await api(pinned ? "/xp/badges/unpin" : "/xp/badges/pin", { key }); if (r.ok) { d.remove(); await refresh(); } };
  }
  // developer preview: an unearned badge up close (the same flip, tilt and art as an earned one; nothing is recorded)
  async function previewDetail(key) {
    const f = findTier(key); if (!f) return;
    const { c, t } = f;
    const d = dialog(`<span class="bribbon">Preview · not earned</span><div class="bdet-art${t.tier >= 16 ? " tilt" : ""}"></div>
      <p class="bdet-cite"><span class="bsample">Sample</span> ${esc(t.sampleCitation)}</p>
      <h2>${esc(t.name)}</h2><p class="xp-muted">${esc(c.label)} · ${t.tier} of 18 · earned at ${n(t.need)} badge XP · <span class="bdev-tag">Dev preview</span></p>
      <p class="bdet-desc">${esc(t.description)}</p>
      <p class="xp-muted">Only you see this preview. The citation is a sample: the real one describes the check-in that earns it.</p>
      <button type="button" class="bplay-big">▶ Play reveal animation</button>`, "bdet bpreview");
    $(".bplay-big", d).onclick = () => playReveal(key);
    const artEl = $(".bdet-art", d);
    const [front, back] = await Promise.all([svgText(artURL(key, { mode: "full", size: 240, dev: true })), svgText(artURL(key, { face: "back", size: 240, dev: true }))]);
    await flip(artEl, { front, back, tier: t.tier, palette: V.palettes[c.cat] });
    let busy = false;
    const again = () => { if (busy || reduced()) return; busy = true; flip(artEl, { front, back, tier: t.tier, quick: true }).then(() => (busy = false)); };
    artEl.addEventListener("click", again);
    artEl.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") again(); });
    if (t.tier >= 16 && !reduced()) artEl.addEventListener("pointermove", (e) => { if (busy) return; const r = artEl.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5; const coin = $(".bflip-coin", artEl); if (coin) coin.style.transform = `rotateY(${(x * 14).toFixed(1)}deg) rotateX(${(-y * 14).toFixed(1)}deg)`; });
  }
  function nextDetail(cat) {
    const c = V.categories.find((x) => x.cat === cat); if (!c) return;
    const x = c.next, pal = V.palettes[cat];
    dialog(`<div class="bdet-art"><span class="bmyst big">${ringSVG(x.pct ?? 0, pal.s)}<img src="${mysteryURL(cat, x.tier, 200)}" alt="A mystery badge" width="180" height="180"></span></div>
      <h2>${x.name ? esc(x.name) : `Your next ${esc(c.label)} badge`}</h2><p class="xp-muted">${esc(c.label)} · ${x.tier} of 18</p>
      <p><b>${n(x.have)} / ${n(x.need)} XP</b> · ${n(x.toGo)} XP to go${x.sessions ? ` (about ${x.sessions} more session${x.sessions === 1 ? "" : "s"})` : ""}</p>
      ${x.eta ? `<p class="xp-muted">That's ${esc(x.eta)}.</p>` : ""}<p class="xp-muted">What it looks like is a surprise until you earn it.</p>`, "bdet bnext");
  }

  // ---------------------------------------------------------------------------------------- settings (in the gallery)
  function settingsHTML() {
    const s = V.settings;
    return `<section class="bset"><h2>Badge settings</h2>
      <label>Name on badges <select id="bName"><option value="name">My name</option><option value="nickname">My nickname</option><option value="none">None (“You achieved…”)</option></select></label>
      <button type="button" id="bRename" class="xp-link">Update the names on my badges</button>
      <label class="xp-sw"><input type="checkbox" id="bHide" ${s.hideNextName ? "checked" : ""}> Keep the next badge's name a surprise</label>
      <label class="xp-sw"><input type="checkbox" id="bNudge" ${s.nudges ? "checked" : ""}> Gentle reminders when I'm close to a badge</label>
      <fieldset class="xp-rem"><legend>Reminders for</legend>${V.categories.map((c) => `<label><input type="checkbox" data-bn="${esc(c.cat)}" ${s.nudgeCats?.[c.cat] !== false ? "checked" : ""}> ${esc(c.label)}</label>`).join("")}</fieldset></section>`;
  }
  function wireSettings(root) {
    const sel = $("#bName", root); if (!sel) return; sel.value = V.settings.nameMode;
    const save = (badges) => api("/xp/settings", { badges }).then(refresh);
    sel.onchange = () => save({ nameMode: sel.value });
    $("#bRename", root).onclick = async () => { const r = await api("/xp/badges/rename", {}); $("#bRename", root).textContent = r.changed ? `Updated ${r.changed} badge${r.changed === 1 ? "" : "s"}` : "Already up to date"; await refresh(); };
    $("#bHide", root).onchange = (e) => save({ hideNextName: e.target.checked });
    $("#bNudge", root).onchange = (e) => save({ nudges: e.target.checked });
    for (const c of root.querySelectorAll("[data-bn]")) c.onchange = () => save({ nudgeCats: { [c.dataset.bn]: c.checked } });
  }

  async function gallery(root) {
    G.root = root;
    root.innerHTML = `<p class="xp-muted">Loading your badges…</p>`;
    // "show me all the badges" / "preview the running badges" open /progress?preview=1[&cat=workout]#badges
    const qs = new URLSearchParams(location.search);
    G.dev = await devStatus();
    if (G.dev && qs.get("preview") === "1") { G.preview = true; if (qs.get("cat")) G.filter = qs.get("cat"); }
    try { await load(); } catch { root.innerHTML = `<p class="xp-err">Badges couldn't load. Is Dayspring running?</p>`; return; }
    paint();
    listen();
  }
  function paint() { render(); G.root.insertAdjacentHTML("beforeend", settingsHTML()); wireSettings(G.root); }
  async function refresh() { if (!G.root) return; await load(); paint(); }
  // live: a badge earned while the gallery is open flips its "?" over, then the shelf refreshes
  function listen() {
    if (G.es) return;
    const on = (es) => es.addEventListener("xp", async (e) => {
      let d = {}; try { d = JSON.parse(e.data); } catch { return; }
      if (d.kind === "badge") { const flipped = await flipReveal(d).catch(() => false); setTimeout(refresh, flipped ? 900 : 0); }
      else if (["badge-revoked", "undo", "settings", "badge-polished"].includes(d.kind)) refresh();
    });
    if (window.dsEvents) { G.es = window.dsEvents; on(G.es); } else { try { G.es = new EventSource("/api/events"); on(G.es); } catch { /* fine without */ } }
  }

  window.dsBadges = { gallery, reveal, flip, refresh, _view: () => V, _dev: () => ({ dev: G.dev, preview: G.preview }) };
})();
