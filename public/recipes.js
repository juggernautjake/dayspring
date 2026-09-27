// The Recipes page: your saved recipes (search, favourite, delete), adding one (paste, a web address), finding recipes
// online, and a recipe's easy steps with its timers and °F/°C. Everything shown is set with textContent (never HTML).
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const api = (p, o) => fetch("/api" + p, o).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "That didn't work. Try again."); return j; });
  const post = (p, b, m = "POST") => api(p, { method: m, headers: { "content-type": "application/json" }, body: JSON.stringify(b ?? {}) });
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const btn = (label, fn, cls = "") => { const b = el("button", cls, label); b.type = "button"; b.onclick = (e) => { e.stopPropagation(); fn(); }; return b; };
  const say = (t, bad = false) => { const m = $("#msg"); m.textContent = t; m.className = "msg" + (bad ? " bad" : ""); };
  let unit = (() => { try { return localStorage.getItem("ds-temp-unit") || "F"; } catch { return "F"; } })();

  function card(r, onOpen) {
    const c = el("article", "card"); c.tabIndex = 0;
    const im = el("div", "img");
    if (r.image) { const i = new Image(); i.alt = ""; i.loading = "lazy"; i.src = /^[a-f0-9]{16}\./.test(r.image) ? `/api/recipes/image/${encodeURIComponent(r.image)}` : r.image; i.onerror = () => { i.remove(); im.textContent = "🍽"; }; im.appendChild(i); } else im.textContent = "🍽";
    const bd = el("div", "bd");
    bd.appendChild(el("h3", "", (r.favourite ? "★ " : "") + r.title));
    bd.appendChild(el("div", "meta", [r.time ? `${r.time} min` : null, r.servings ? `serves ${r.servings}` : null, typeof r.ingredients === "number" ? `${r.ingredients} ingredients` : null].filter(Boolean).join(" · ")));
    for (const t of r.tags ?? []) bd.appendChild(el("span", "tag", t));
    c.append(im, bd);
    c.onclick = onOpen; c.onkeydown = (e) => { if (e.key === "Enter") onOpen(); };
    return c;
  }
  async function load() {
    const q = $("#q").value.trim();
    const { recipes } = await api("/recipes" + (q ? `?q=${encodeURIComponent(q)}` : ""));
    const list = $("#list"); list.replaceChildren();
    if (!recipes.length) list.appendChild(el("p", "meta", q ? "No saved recipe matches that." : "No recipes yet. Add one, or find one online."));
    for (const r of recipes) list.appendChild(card(r, () => open(r.id)));
  }
  function renderRecipe(r, { found = null } = {}) {
    const v = $("#view"); v.hidden = false; v.replaceChildren();
    const head = el("div", "row"); head.appendChild(el("h2", "", r.title)); v.appendChild(head);
    const src = r.source ?? {};
    if (src.site || src.author) v.appendChild(el("div", "meta", "From " + [src.author, src.site].filter(Boolean).join(" · ")));
    if (src.url && /^https?:\/\//.test(src.url)) { const a = el("a", "", "Original page ↗"); a.href = src.url; a.target = "_blank"; a.rel = "noopener noreferrer"; v.appendChild(a); }
    v.appendChild(el("div", "phase", "Ingredients"));
    const ul = el("ul"); for (const x of r.ingredients ?? []) ul.appendChild(el("li", "", x)); v.appendChild(ul);
    let phase = null, ol = null;
    for (const s of r.easy ?? []) {
      if (s.phase !== phase) { phase = s.phase; v.appendChild(el("div", "phase", phase)); ol = el("ol"); ol.start = s.n; v.appendChild(ol); }
      const li = el("li"); li.appendChild(el("div", "", s.text));
      for (const t of s.timers ?? []) li.appendChild(btn(`⏲ ${t.text}`, () => post("/timers", { action: "start", ms: t.ms, label: t.label || `step ${s.n}` }).then(() => say(`Started a ${t.text} timer.`)).catch((e) => say(e.message, true)), "chip"));
      for (const t of s.temps ?? []) li.appendChild(btn(unit === "C" ? `${t.c}°C` : `${t.f}°F`, () => { unit = unit === "C" ? "F" : "C"; try { localStorage.setItem("ds-temp-unit", unit); } catch { /* fine */ } renderRecipe(r, { found }); }, "chip temp"));
      if (s.uses?.length) li.appendChild(el("div", "meta", "Uses: " + s.uses.join(", ")));
      ol.appendChild(li);
    }
    const act = el("div", "row"); act.style.marginTop = "1em";
    if (found) {
      act.append(btn("Use this one", () => post("/recipes/found", { ref: found, then: "cook" }).then(() => say("Cooking mode is on the Dayspring screen.")).catch((e) => say(e.message, true)), "main"),
        btn("Save for later", () => post("/recipes/found", { ref: found, then: "save" }).then((x) => { say(`Saved ${x.recipe.title}.`); load(); }).catch((e) => say(e.message, true))));
    } else {
      act.append(btn("Start cooking", () => post("/cooking", { action: "start", id: r.id }).then(() => say("Cooking mode is on the Dayspring screen.")).catch((e) => say(e.message, true)), "main"),
        btn(r.favourite ? "★ Favourite" : "☆ Favourite", () => post(`/recipes/${r.id}`, { favourite: !r.favourite }).then(() => { open(r.id); load(); })),
        btn("Delete", () => { if (!confirm(`Delete ${r.title}?`)) return; api(`/recipes/${r.id}`, { method: "DELETE" }).then(() => { $("#view").hidden = true; say("Deleted."); load(); }); }));
    }
    act.appendChild(btn("Close", () => { v.hidden = true; }));
    v.appendChild(act);
    v.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  // only the newest open() renders, so a slow earlier answer can't paint over the recipe just tapped
  let openSeq = 0;
  async function open(id) { const n = ++openSeq; try { const { recipe } = await api(`/recipes/${encodeURIComponent(id)}`); if (n === openSeq) renderRecipe(recipe); } catch (e) { if (n === openSeq) say(e.message, true); } }

  $("#q").addEventListener("input", () => { clearTimeout(load.t); load.t = setTimeout(load, 200); });
  $("#addBtn").onclick = () => { $("#add").hidden = false; $("#find").hidden = true; $("#url").focus(); };
  $("#cancelAdd").onclick = () => { $("#add").hidden = true; };
  $("#findBtn").onclick = () => { $("#find").hidden = false; $("#add").hidden = true; $("#dish").focus(); };
  $("#saveText").onclick = async () => { try { const { recipe } = await post("/recipes", { text: $("#text").value }); say(`Saved ${recipe.title}.`); $("#text").value = ""; $("#add").hidden = true; load(); } catch (e) { say(e.message, true); } };
  $("#importBtn").onclick = async () => { say("Reading that page…"); try { const { recipe } = await post("/recipes/import", { url: $("#url").value.trim() }); say(`Saved ${recipe.title}.`); $("#url").value = ""; $("#add").hidden = true; load(); } catch (e) { say(e.message, true); } };
  const search = async () => {
    const dish = $("#dish").value.trim(); if (!dish) return;
    say("Looking for recipes… (this takes a few seconds)");
    try {
      const r = await api(`/recipes/find?q=${encodeURIComponent(dish)}`);
      const g = $("#found"); g.replaceChildren();
      if (!r.results.length) { say("I couldn't find recipes I can read for that. Try other words, or search the web."); return; }
      say(`Found ${r.results.length}.`);
      for (const x of r.results) g.appendChild(card({ ...x, image: x.image ? `/api/recipes/found-image?ref=${encodeURIComponent(x.tempId)}` : null, tags: x.site ? [x.site] : [] }, () => post("/recipes/found", { ref: x.tempId, then: "view" }).then((d) => renderRecipe(d.recipe, { found: x.tempId })).catch((e) => say(e.message, true))));
    } catch (e) { say(e.message, true); }
  };
  $("#searchBtn").onclick = search;
  $("#dish").addEventListener("keydown", (e) => { if (e.key === "Enter") search(); });
  load().catch((e) => say(e.message, true));
})();
