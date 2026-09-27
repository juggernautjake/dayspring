// The file-access chooser, shared by the first-run setup (/welcome) and Settings → Permissions (/setup).
// Plain HTML controls (radio buttons, selects, checkboxes, a text box), so it works the same in Chrome, Edge, Brave and
// Firefox on Windows 10 and 11, with a keyboard or a mouse. Nothing is picked until the owner picks it: "No file access"
// is marked as the recommended one, but it still needs a click.
//   const fa = DayspringFileAccess.create(root, { state, onChange })   state: GET /api/setup/permissions
//   fa.chosen()   → true once an option is picked          fa.value() → the body for POST /api/setup/permissions
//   fa.problem()  → a sentence when the choice isn't complete yet (e.g. "Only what I choose" with nothing added), else ""
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const getJSON = async (path, body) => {
    const r = await fetch("/api" + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Something went wrong (${r.status})`);
    return j;
  };
  let seq = 0;

  function create(root, { state = {}, onChange = () => {}, compact = false } = {}) {
    const id = `fa${++seq}`;
    // what's on screen; mode stays null until the owner picks (or, in Settings, they already picked before)
    const S = {
      mode: state.choiceMade || (state.files && state.files !== "off") ? (state.files === "folders" ? "custom" : state.files ?? "off") : null,
      allAccess: state.allAccess ?? "read",
      entries: (state.entries ?? []).map((e) => ({ path: e.path, kind: e.kind ?? "folder", access: e.access ?? "read", subfolders: e.subfolders !== false })),
      ask: (state.writeConfirm ?? "ask") !== "on",
      del: Boolean(state.can?.delete),
      create: state.can?.create !== false, edit: state.can?.edit !== false, move: state.can?.move !== false,
      cwd: null, roots: null,
    };
    if (!state.choiceMade && state.files === "off") S.mode = null;       // a fresh install: nothing is picked for them
    const card = (v, icon, title, desc, tag = "") => `<label class="fa-card${v === "off" ? " fa-suggest" : ""}"><input type="radio" name="${id}-mode" value="${v}"${S.mode === v ? " checked" : ""}>
      <span class="fa-card-body"><span class="fa-card-t"><span aria-hidden="true">${icon}</span> ${title}${tag ? ` <span class="fa-tag">${tag}</span>` : ""}</span><small>${desc}</small></span></label>`;
    const accessSel = (i, v) => `<select data-acc="${i}" aria-label="What Dayspring may do here"><option value="read"${v === "read" ? " selected" : ""}>Read only</option><option value="readwrite"${v === "readwrite" ? " selected" : ""}>Read &amp; write</option><option value="none"${v === "none" ? " selected" : ""}>Blocked</option></select>`;
    root.innerHTML = `<div class="fa" id="${id}">
      <fieldset class="fa-choices"><legend class="fa-legend">What may Dayspring do with the files on this computer?</legend>
        ${card("off", "🔒", "No file access", "It won't look at, open or search any of your files. You can change this any time.", "Recommended")}
        ${card("custom", "📁", "Only the folders and files I choose", "Add places one by one. Each can be read only, read &amp; write, or blocked.")}
        ${card("all", "🖥️", "Everything on this computer", "Read only, or read &amp; write. Windows, program folders, other people's files and passwords always stay protected.")}
      </fieldset>
      <p class="fa-need" id="${id}-need" role="status"></p>
      <div class="fa-panel" id="${id}-all" hidden>
        <div class="fa-row"><span class="fa-lbl" id="${id}-al">Everywhere on this computer, Dayspring may</span>
          <label class="fa-radio"><input type="radio" name="${id}-aa" value="read"${S.allAccess === "read" ? " checked" : ""}> Read only</label>
          <label class="fa-radio"><input type="radio" name="${id}-aa" value="readwrite"${S.allAccess === "readwrite" ? " checked" : ""}> Read &amp; write</label></div>
      </div>
      <div class="fa-panel" id="${id}-custom" hidden>
        <div class="fa-add"><label class="fa-lbl" for="${id}-path">Add a folder or file</label>
          <div class="fa-addrow"><input type="text" id="${id}-path" spellcheck="false" autocomplete="off" placeholder="Type or paste a path, like C:\\Users\\you\\Documents">
            <button type="button" class="fa-btn fa-primary" id="${id}-addbtn">Add</button><button type="button" class="fa-btn" id="${id}-browsebtn" aria-expanded="false">Browse…</button></div>
          <div class="fa-quick" id="${id}-quick"></div>
          <p class="fa-msg" id="${id}-msg" role="status"></p></div>
        <div class="fa-browser" id="${id}-browser" hidden><div class="fa-crumbs" id="${id}-crumbs"></div><div class="fa-tree" id="${id}-tree"></div></div>
        <div class="fa-list" id="${id}-list" aria-live="polite"></div>
      </div>
      <div class="fa-panel" id="${id}-change" hidden>
        <label class="fa-check"><input type="checkbox" id="${id}-ask"${S.ask ? " checked" : ""}><span><b>Ask me before every change</b><small>Dayspring says what it's about to change and waits for your yes. A backup is always made first either way.</small></span></label>
        <label class="fa-check"><input type="checkbox" id="${id}-del"${S.del ? " checked" : ""}><span><b>Can delete files</b><small>Off unless you turn it on. Deleted things always go to the Recycle Bin, and Dayspring always asks first.</small></span></label>
        <div class="fa-kinds" role="group" aria-labelledby="${id}-kl"><span class="fa-lbl" id="${id}-kl">Where it may write, Dayspring can</span>
          <label class="fa-radio"><input type="checkbox" data-can="create"${S.create ? " checked" : ""}> create new files and folders</label>
          <label class="fa-radio"><input type="checkbox" data-can="edit"${S.edit ? " checked" : ""}> edit existing files</label>
          <label class="fa-radio"><input type="checkbox" data-can="move"${S.move ? " checked" : ""}> rename and move things</label></div>
      </div>
      <div class="fa-summary" id="${id}-sum" aria-live="polite"></div>
    </div>`;
    const el = (x) => $(`#${id}-${x}`, root);

    // ---- the chosen places ----
    function drawList() {
      const box = el("list");
      box.innerHTML = S.entries.length ? `<div class="fa-lbl">Dayspring may use</div>` + S.entries.map((e, i) => `<div class="fa-entry">
          <span class="fa-path" title="${esc(e.path)}">${e.kind === "file" ? "📄" : "📁"} ${esc(e.path)}</span>
          <span class="fa-ctl">${accessSel(i, e.access)}${e.kind === "folder" ? `<label class="fa-sub"><input type="checkbox" data-sub="${i}"${e.subfolders ? " checked" : ""}> Include subfolders</label>` : ""}
          <button type="button" class="fa-btn fa-rm" data-rm="${i}" aria-label="Remove ${esc(e.path)}">✕</button></span></div>`).join("")
        : `<p class="fa-empty">Nothing added yet. Type a path above, use a quick pick, or press Browse.</p>`;
    }
    const norm = (p) => String(p ?? "").trim().replace(/^"|"$/g, "").replace(/\//g, "\\");
    async function addPath(raw, kindHint) {
      const p = norm(raw);
      if (!p) { msg("Type a folder or file path first."); return; }
      if (!/^[a-z]:\\/i.test(p)) { msg("Use a full path that starts with a drive letter, like C:\\Users\\you\\Documents."); return; }
      if (S.entries.some((e) => e.path.toLowerCase() === p.toLowerCase())) { msg("That's already on the list."); return; }
      let kind = kindHint;
      if (!kind) {                              // ask the folder browser whether it's a folder or a file (and that it exists)
        try { await getJSON(`/fs/list?path=${encodeURIComponent(p)}`); kind = "folder"; }
        catch (err) { if (/file, not a folder/i.test(err.message)) kind = "file"; else { msg(`${err.message} Check the spelling, or use Browse.`); return; } }
      }
      S.entries.push({ path: p, kind, access: "read", subfolders: true });
      el("path").value = ""; msg("");
      drawList(); if (!el("browser").hidden) browse(S.cwd); changed();
    }
    const msg = (t) => { el("msg").textContent = t; };

    // ---- the folder browser (lists names only) ----
    async function loadRoots() {
      if (S.roots) return;
      S.roots = await getJSON("/fs/roots").catch(() => ({ places: [], drives: [], users: [] }));
      el("quick").innerHTML = (S.roots.places ?? []).slice(0, 8).map((pl, i) => `<button type="button" class="fa-chip" data-q="${i}" title="${esc(pl.path)}">＋ ${esc(pl.label)}</button>`).join("");
    }
    async function browse(path) {
      S.cwd = path;
      const tree = el("tree"), crumbs = el("crumbs");
      let items = [];
      if (!path) {
        await loadRoots();
        items = [...(S.roots.places ?? []), ...(S.roots.drives ?? [])].map((x) => ({ name: x.label, path: x.path, kind: "folder" }));
        crumbs.innerHTML = `<b>This computer</b>`;
      } else {
        tree.innerHTML = `<p class="fa-empty">Loading…</p>`;
        let r; try { r = await getJSON(`/fs/list?path=${encodeURIComponent(path)}`); } catch (err) { tree.innerHTML = `<p class="fa-empty">${esc(err.message)}</p>`; return; }
        items = r.items ?? [];
        crumbs.innerHTML = `<button type="button" class="fa-link" data-go="">This computer</button> › ${r.parent ? `<button type="button" class="fa-link" data-go="${esc(r.parent)}">Up</button> › ` : ""}<b>${esc(r.path)}</b> <button type="button" class="fa-btn fa-small" data-addhere="${esc(r.path)}">Add this folder</button>`;
      }
      const has = (p) => S.entries.some((e) => e.path.toLowerCase() === String(p).toLowerCase());
      tree.innerHTML = items.length ? items.slice(0, 400).map((x) => `<div class="fa-node"><span>${x.kind === "file" ? "📄" : "📁"} ${x.kind === "folder" ? `<button type="button" class="fa-link" data-go="${esc(x.path)}">${esc(x.name)}</button>` : esc(x.name)}</span>
        ${has(x.path) ? `<span class="fa-added">Added</span>` : `<button type="button" class="fa-btn fa-small" data-addp="${esc(x.path)}" data-kind="${x.kind}">Add</button>`}</div>`).join("") : `<p class="fa-empty">This folder is empty.</p>`;
    }

    // ---- what it means, in plain words (worked out by the server, the same rules it enforces) ----
    let sumT = 0, sumGen = 0;
    function summary() {
      clearTimeout(sumT);
      const box = el("sum");
      if (!S.mode) { box.innerHTML = `<p class="fa-empty">Pick one of the options above to see what Dayspring will and won't be able to do.</p>`; return; }
      sumT = setTimeout(async () => {
        const gen = ++sumGen;
        let r; try { r = await getJSON("/setup/permissions/preview", value()); } catch { return; }
        if (gen !== sumGen) return;
        box.innerHTML = `<div class="fa-cols"><div><h3>Dayspring will be able to</h3><ul>${r.will.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
          <div><h3>Dayspring won't</h3><ul class="fa-wont">${r.wont.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div></div>`;
      }, 150);
    }
    function paint() {
      $$(`.fa-card`, root).forEach((c) => c.classList.toggle("on", $("input", c).checked));
      el("all").hidden = S.mode !== "all";
      el("custom").hidden = S.mode !== "custom";
      const canWrite = (S.mode === "all" && S.allAccess === "readwrite") || (S.mode === "custom" && S.entries.some((e) => e.access === "readwrite"));
      el("change").hidden = !canWrite;
      el("need").textContent = S.mode ? "" : "Pick one of these to continue.";
      summary();
    }
    function changed() { paint(); onChange(api); }

    // ---- wiring ----
    root.addEventListener("change", (ev) => {
      const t = ev.target;
      if (t.name === `${id}-mode`) { S.mode = t.value; if (S.mode === "custom") { loadRoots(); } changed(); return; }
      if (t.name === `${id}-aa`) { S.allAccess = t.value; changed(); return; }
      if (t.dataset.acc !== undefined) { S.entries[Number(t.dataset.acc)].access = t.value; changed(); return; }
      if (t.dataset.sub !== undefined) { S.entries[Number(t.dataset.sub)].subfolders = t.checked; changed(); return; }
      if (t.id === `${id}-ask`) { S.ask = t.checked; changed(); return; }
      if (t.id === `${id}-del`) { S.del = t.checked; changed(); return; }
      if (t.dataset.can) { S[t.dataset.can] = t.checked; changed(); }
    });
    root.addEventListener("click", (ev) => {
      const b = ev.target.closest("button"); if (!b || !root.contains(b)) return;
      if (b.id === `${id}-addbtn`) addPath(el("path").value);
      else if (b.id === `${id}-browsebtn`) { const open = el("browser").hidden; el("browser").hidden = !open; b.setAttribute("aria-expanded", String(open)); if (open) browse(S.cwd); }
      else if (b.dataset.rm !== undefined) { S.entries.splice(Number(b.dataset.rm), 1); drawList(); if (!el("browser").hidden) browse(S.cwd); changed(); }
      else if (b.dataset.q !== undefined) { const pl = S.roots.places[Number(b.dataset.q)]; addPath(pl.path, "folder"); }
      else if (b.dataset.go !== undefined) browse(b.dataset.go || null);
      else if (b.dataset.addp !== undefined) addPath(b.dataset.addp, b.dataset.kind === "file" ? "file" : "folder");
      else if (b.dataset.addhere !== undefined) addPath(b.dataset.addhere, "folder");
    });
    // Enter in the path box adds it (and never jumps to the next setup step)
    el("path").addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); ev.stopPropagation(); addPath(el("path").value); } });

    function value() {
      return { files: S.mode ?? "off", allAccess: S.allAccess, entries: S.mode === "custom" ? S.entries.map((e) => ({ ...e })) : [],
        writeConfirm: S.ask ? "ask" : "on", can: { create: S.create, edit: S.edit, move: S.move, delete: S.del }, choice: Boolean(S.mode) };
    }
    const api = {
      chosen: () => Boolean(S.mode),
      value,
      problem: () => (!S.mode ? "Pick one of the file-access options first. \"No file access\" is fine if you're not sure." : S.mode === "custom" && !S.entries.length ? "Add at least one folder or file, or pick another option." : ""),
    };
    drawList(); paint();
    if (S.mode === "custom") loadRoots();
    return api;
  }
  window.DayspringFileAccess = { create };
})();
