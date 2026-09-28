// Settings → This app: Features (what's finished, new and in progress, with the off switches), Compatibility (the devices,
// services, browsers and systems that work, searchable) and Testing (the step-by-step checklist, development only).
// Data: /api/features, /api/compat, /api/testing (lib/feature-routes.mjs). setup.js shows these as sections.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (path, body) => {
    const r = await fetch("/api" + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `That didn't work (${r.status}).`);
    return j;
  };
  const when = (iso) => { try { return new Date(iso).toLocaleDateString([], { dateStyle: "medium" }); } catch { return iso ?? ""; } };
  const STAGE = { stable: ["Finished", "The owner has confirmed these work."], beta: ["New", "Built and tested automatically, not yet confirmed. Each can be switched off."], dev: ["In progress", "Still being built. Only in the development version."] };

  // ================================================================================================= Features
  const featuresPage = {
    html: () => `<div class="fu-page"><h1>Features</h1>
      <p class="lead">What's finished, what's new, and what's still being built. New features are part of this version and can be switched off if they get in your way.</p>
      <div id="fuChan" class="note" aria-live="polite">Looking…</div>
      <div id="fuList"></div>
      <div class="msg" id="m" aria-live="polite"></div></div>`,
    async mount(card, { toast } = {}) {
      const root = card?.querySelector?.(".fu-page") ?? card;
      const paint = (st) => {
        const box = $("#fuList", root); if (!box) return;
        $("#fuChan", root).innerHTML = st.channel === "dev"
          ? `🧪 This is the <b>development version</b>: every feature is included, including ones still being built. They may have bugs. Settings → Updates switches to the production version.`
          : `✅ This is the <b>production version</b>: finished features, plus new ones marked <span class="fu-new">New</span>.${st.developer ? " Developer preview: in-progress features can be tried here, one at a time." : ""}`;
        const groups = ["beta", "dev", "stable"].map((stage) => {
          const list = st.features.filter((f) => f.stage === stage);
          if (!list.length) return "";
          const rows = list.map((f) => `<div class="fu-row${f.on ? "" : " off"}" data-id="${esc(f.id)}">
              <div class="fu-txt"><b>${esc(f.name)}</b>${f.stage === "beta" ? ' <span class="fu-new">New</span>' : ""}${f.promoted ? ' <span class="fu-chip ok">Confirmed</span>' : ""}
                <div class="hint">${esc(f.description)}</div>
                <div class="fu-meta">${esc(f.area)} · since ${esc(f.since)}${f.verifiedAt ? ` · confirmed ${esc(when(f.verifiedAt))}` : ""}${f.checklist?.length ? ` · ${f.checklist.length} tests` : ""}</div></div>
              ${f.switchable ? `<label class="fu-sw"><input type="checkbox" data-sw="${esc(f.id)}" ${f.on ? "checked" : ""}> <span>${f.on ? "On" : "Off"}</span></label>` : `<span class="fu-state">${f.on ? "On" : stage === "dev" ? "Not in this version" : "Off"}</span>`}
            </div>`).join("");
          return `<h2>${STAGE[stage][0]} <span class="hint">(${list.length})</span></h2><p class="hint">${STAGE[stage][1]}</p>${stage === "stable" ? `<details class="fu-details"><summary>Show the ${list.length} finished features</summary>${rows}</details>` : rows}`;
        });
        box.innerHTML = groups.join("");
      };
      const load = async () => { try { paint(await api("/features")); } catch (e) { const m = $("#m", root); if (m) { m.className = "msg bad"; m.textContent = e.message; } } };
      root.addEventListener("change", async (e) => {
        const cb = e.target.closest?.("[data-sw]"); if (!cb) return;
        try { await api("/features/switch", { id: cb.dataset.sw, on: cb.checked }); toast?.(cb.checked ? "Switched on" : "Switched off. The Dayspring screen shows the change after it reloads."); }
        catch (err) { cb.checked = !cb.checked; const m = $("#m", root); if (m) { m.className = "msg bad"; m.textContent = err.message; } }
        load();
      });
      await load();
    },
  };

  // ================================================================================================= Compatibility
  const STATUS_ICON = { verified: "✅", "tested-sim": "🧪", expected: "👍", untested: "❔", "not-supported": "⛔" };
  const compatPage = {
    html: () => `<div class="fu-page"><h1>Compatibility</h1>
      <p class="lead">Devices, services, browsers and systems, and how sure we are that each one works with Dayspring. Pick one to see how to set it up.</p>
      <div class="fu-filters" role="search">
        <input type="search" id="cpQ" placeholder="Search: Kasa, Bambu, webcam, Gmail…" aria-label="Search the compatibility list" autocomplete="off">
        <select id="cpCat" aria-label="Category"><option value="">Every category</option></select>
        <select id="cpStatus" aria-label="Status"><option value="">Any status</option></select>
        <label class="fu-check"><input type="checkbox" id="cpOffline"> Works offline</label>
      </div>
      <div id="cpCounts" class="hint" aria-live="polite"></div>
      <div id="cpList" class="fu-cards"><div class="hint">Looking…</div></div>
      <details class="note fu-legend"><summary>What the statuses mean</summary><ul>
        <li>✅ <b>Verified</b>: confirmed working on a real device by the owner.</li>
        <li>🧪 <b>Passes simulator tests</b>: Dayspring's automated tests pass against a simulated device of this kind.</li>
        <li>👍 <b>Expected to work</b>: it uses a protocol Dayspring speaks, according to the maker's or the community's documentation.</li>
        <li>❔ <b>Untested</b>: it might work; nobody has tried it yet.</li>
        <li>⛔ <b>Not supported</b>: it can't work with Dayspring, and the card says why.</li></ul></details></div>`,
    async mount(card, { toast } = {}) {
      const root = card?.querySelector?.(".fu-page") ?? card;
      let data = null;
      try { data = await api("/compat"); } catch (e) { $("#cpList", root).innerHTML = `<div class="msg bad">${esc(e.message)}</div>`; return; }
      $("#cpCat", root).insertAdjacentHTML("beforeend", data.categories.map((c) => `<option value="${esc(c.id)}">${esc(c.label)} (${c.count})</option>`).join(""));
      $("#cpStatus", root).insertAdjacentHTML("beforeend", data.statuses.map((s) => `<option value="${esc(s.id)}">${STATUS_ICON[s.id] ?? ""} ${esc(s.label)}</option>`).join(""));
      const conn = Object.fromEntries(data.connections.map((c) => [c.id, c.label]));
      const catLabel = Object.fromEntries(data.categories.map((c) => [c.id, c.label]));
      const stLabel = Object.fromEntries(data.statuses.map((s) => [s.id, s.label]));
      const norm = (s) => String(s ?? "").toLowerCase();
      const cardOf = (e) => `<article class="fu-card st-${esc(e.status)}" data-id="${esc(e.id)}">
          <header><b>${esc(e.brand)} ${esc(e.model)}</b><span class="fu-chip st-${esc(e.status)}">${STATUS_ICON[e.status] ?? ""} ${esc(stLabel[e.status] ?? e.status)}</span></header>
          <div class="fu-meta">${esc(catLabel[e.category] ?? e.category)} · ${esc(conn[e.connection] ?? e.connection)} · ${e.offline ? "works offline" : "needs the internet"}${e.verifiedAt ? ` · verified ${esc(when(e.verifiedAt))}` : ""} · checked ${esc(e.lastChecked)}</div>
          ${e.capabilities?.length ? `<div class="fu-caps">${e.capabilities.map((c) => `<span>${esc(c)}</span>`).join("")}</div>` : ""}
          ${e.reason ? `<p class="fu-reason"><b>Why not:</b> ${esc(e.reason)}</p>` : ""}
          ${e.notes ? `<p class="hint">${esc(e.notes)}</p>` : ""}
          ${e.howToSetUp?.length ? `<details><summary>${e.status === "not-supported" ? "What to do instead" : "How to set it up"}</summary><ol>${e.howToSetUp.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>${e.links?.length ? `<p class="hint">${e.links.map((l) => `<a href="${esc(l)}" target="_blank" rel="noopener">${esc(l.replace(/^https:\/\/(www\.)?/, "").replace(/\/$/, ""))}</a>`).join(" · ")}</p>` : ""}</details>` : ""}
        </article>`;
      const draw = () => {
        const q = norm($("#cpQ", root).value).trim(), cat = $("#cpCat", root).value, st = $("#cpStatus", root).value, off = $("#cpOffline", root).checked;
        const words = q.split(/\s+/).filter(Boolean);
        const hits = data.entries.filter((e) => (!cat || e.category === cat) && (!st || e.status === st) && (!off || e.offline)
          && words.every((w) => norm(`${e.brand} ${e.model} ${e.category} ${catLabel[e.category]} ${e.connection} ${(e.capabilities ?? []).join(" ")} ${e.notes}`).includes(w)));
        $("#cpCounts", root).textContent = `${hits.length} of ${data.entries.length} shown`;
        $("#cpList", root).innerHTML = hits.length ? hits.map(cardOf).join("") : `<div class="hint">Nothing matches. Try fewer words, or another category.</div>`;
      };
      for (const id of ["#cpQ", "#cpCat", "#cpStatus", "#cpOffline"]) $(id, root).addEventListener(id === "#cpQ" ? "input" : "change", draw);
      draw();
      root._compatData = data;
      void toast;
    },
  };

  // ================================================================================================= Testing
  const RESULT = { pass: ["Pass", "✓"], fail: ["Fail", "✗"], skip: ["Skip", "↷"], blocked: ["Blocked", "⏸"] };
  const testingPage = {
    html: () => `<div class="fu-page"><h1>Testing</h1>
      <p class="lead">Go through each feature step by step. Mark each test Pass, Fail, Skip or Blocked, and add a note. When every test of a feature has passed, promote it to stable. Export the results for the next release.</p>
      <div class="fu-filters"><select id="tsFeat" aria-label="Feature"><option value="">Every feature</option></select>
        <select id="tsShow" aria-label="Show"><option value="">Every test</option><option value="todo">Not done yet</option><option value="fail">Failed or blocked</option></select>
        <a class="btn small" id="tsMd" href="/api/testing/export?format=md" download>Export Markdown</a> <a class="btn small" id="tsCsv" href="/api/testing/export?format=csv" download>Export CSV</a></div>
      <div id="tsProg" class="fu-prog" aria-live="polite"><div class="hint">Looking…</div></div>
      <div id="tsList"></div>
      <div class="msg" id="m" aria-live="polite"></div></div>`,
    async mount(card, { toast } = {}) {
      const root = card?.querySelector?.(".fu-page") ?? card;
      let data = null, compatNames = {};
      const say = (t, kind = "") => { const m = $("#m", root); if (m) { m.className = "msg " + kind; m.textContent = t; } };
      try { const c = await api("/compat"); compatNames = Object.fromEntries(c.entries.map((e) => [e.id, { name: `${e.brand} ${e.model}`, status: e.status }])); } catch { /* names only */ }
      const load = async () => { data = await api("/testing"); };
      const paintProg = () => {
        $("#tsProg", root).innerHTML = data.progress.map((p) => `<div class="fu-pg" data-f="${esc(p.feature)}">
            <div class="fu-pg-t"><b>${esc(p.name)}</b> <span class="fu-chip">${esc(p.stage)}</span> <span>${p.pass}/${p.total} passed</span>${p.fail ? ` <span class="bad">${p.fail} failed</span>` : ""}${p.blocked ? ` <span class="warn">${p.blocked} blocked</span>` : ""}</div>
            <div class="fu-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${p.total}" aria-valuenow="${p.pass}" aria-label="${esc(p.name)}: ${p.pass} of ${p.total} passed"><i style="width:${Math.round((p.pass / p.total) * 100)}%"></i></div>
            ${p.stage === "stable" && p.verifiedAt ? `<span class="hint">Confirmed ${esc(when(p.verifiedAt))}</span> <button type="button" class="btn small" data-unpromote="${esc(p.feature)}">Undo</button>` : p.stage === "stable" ? "" : `<button type="button" class="btn small" data-promote="${esc(p.feature)}" ${p.canPromote ? "" : "disabled"} title="${p.canPromote ? "Every test passed" : "Every test must pass first"}">Promote to stable</button>`}
          </div>`).join("");
      };
      const item = (t) => {
        const r = data.results[t.id];
        return `<article class="fu-test${r ? " r-" + esc(r.status) : ""}" data-t="${esc(t.id)}">
          <header><span class="fu-id">${esc(t.id)}</span> <b>${esc(t.title)}</b>${t.stage ? ` <span class="fu-chip">Home stage ${esc(t.stage)}</span>` : ""}${r ? ` <span class="fu-chip r-${esc(r.status)}">${RESULT[r.status][1]} ${RESULT[r.status][0]} · ${esc(when(r.at))}</span>` : ""}</header>
          ${t.safety ? `<p class="fu-safety">⚠ ${esc(t.safety)}</p>` : ""}
          ${t.needs?.length ? `<p class="hint"><b>You need:</b> ${t.needs.map(esc).join(", ")}</p>` : ""}
          <ol>${t.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
          <p><b>Expected:</b> ${esc(t.expected)}</p>
          <div class="fu-actions" role="group" aria-label="Result for ${esc(t.id)}">${Object.entries(RESULT).map(([k, [label, ic]]) => `<button type="button" class="btn small${r?.status === k ? " on" : ""}" data-r="${k}" aria-pressed="${r?.status === k}">${ic} ${label}</button>`).join("")}
            ${r ? `<button type="button" class="btn small ghost" data-r="clear">Clear</button>` : ""}</div>
          <textarea class="fu-note" placeholder="Notes (what happened, the device, the version)" aria-label="Notes for ${esc(t.id)}">${esc(r?.note ?? "")}</textarea>
          ${t.compat?.length && r?.status === "pass" ? `<div class="fu-compat">${t.compat.map((c) => compatNames[c] ? (compatNames[c].status === "verified" ? `<span class="fu-chip ok">✅ ${esc(compatNames[c].name)} verified</span>` : `<button type="button" class="btn small" data-verify="${esc(c)}">Mark ${esc(compatNames[c].name)} as verified</button>`) : "").join(" ")}</div>` : ""}
        </article>`;
      };
      const paintList = () => {
        const f = $("#tsFeat", root).value, show = $("#tsShow", root).value;
        const list = data.items.filter((t) => (!f || t.feature === f) && (!show || (show === "todo" ? !data.results[t.id] : ["fail", "blocked"].includes(data.results[t.id]?.status))));
        const byF = new Map(); for (const t of list) byF.set(t.feature, [...(byF.get(t.feature) ?? []), t]);
        const names = Object.fromEntries(data.progress.map((p) => [p.feature, p.name]));
        $("#tsList", root).innerHTML = list.length ? [...byF].map(([fid, ts]) => `<h2>${esc(names[fid] ?? fid)}</h2>${ts.map(item).join("")}`).join("") : `<p class="hint">No tests to show.</p>`;
      };
      const paint = () => { paintProg(); paintList(); };
      try { await load(); } catch (e) { $("#tsProg", root).innerHTML = `<div class="msg bad">${esc(e.message)}</div>`; return; }
      $("#tsFeat", root).insertAdjacentHTML("beforeend", data.progress.map((p) => `<option value="${esc(p.feature)}">${esc(p.name)} (${p.total})</option>`).join(""));
      $("#tsFeat", root).addEventListener("change", paintList);
      $("#tsShow", root).addEventListener("change", paintList);
      root.addEventListener("click", async (e) => {
        const b = e.target.closest?.("button"); if (!b || !root.contains(b)) return;
        try {
          if (b.dataset.r) {
            const art = b.closest("[data-t]"), id = art.dataset.t, note = $(".fu-note", art)?.value ?? "";
            const out = await api("/testing/result", { id, status: b.dataset.r === "clear" ? null : b.dataset.r, note });
            if (out.result) data.results[id] = out.result; else delete data.results[id];
            const i = data.progress.findIndex((p) => p.feature === out.progress?.feature); if (i >= 0) data.progress[i] = out.progress;
            art.outerHTML = item(data.items.find((t) => t.id === id)); paintProg();
            toast?.(out.result ? `${id}: ${RESULT[out.result.status][0]}` : `${id}: cleared`);
          } else if (b.dataset.promote) {
            if (!confirm("Promote this feature to stable? It stops being marked New and can no longer be switched off here.")) return;
            const out = await api("/testing/promote", { feature: b.dataset.promote }); data.progress = out.progress; paint(); say(`Promoted ${out.promoted.id} to stable. Export the results so the next release includes it.`, "ok");
          } else if (b.dataset.unpromote) {
            const out = await api("/testing/unpromote", { feature: b.dataset.unpromote }); data.progress = out.progress; paint();
          } else if (b.dataset.verify) {
            const art = b.closest("[data-t]"); const out = await api("/compat/verify", { id: b.dataset.verify, test: art?.dataset.t ?? null });
            compatNames[out.entry.id] = { name: `${out.entry.brand} ${out.entry.model}`, status: out.entry.status }; if (art) art.outerHTML = item(data.items.find((t) => t.id === art.dataset.t));
            toast?.(`${out.entry.brand} ${out.entry.model} is now verified`);
          }
        } catch (err) { say(err.message, "bad"); }
      });
      // notes save when you leave the box (with the current result, if there is one)
      root.addEventListener("change", async (e) => {
        const ta = e.target.closest?.(".fu-note"); if (!ta) return;
        const art = ta.closest("[data-t]"), id = art.dataset.t, cur = data.results[id];
        if (!cur) return;   // saved with the first result
        try { const out = await api("/testing/result", { id, status: cur.status, note: ta.value }); data.results[id] = out.result; toast?.("Note saved"); } catch (err) { say(err.message, "bad"); }
      });
      paint();
    },
  };

  window.DayspringFeatureUI = { features: featuresPage, compat: compatPage, testing: testingPage };
})();
