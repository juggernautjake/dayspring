// The Mail window on the Dayspring screen: every mailbox (or all inboxes together), folders | list | reader, search,
// several emails selected at once (archive, read/unread, star, Trash with a confirm), threads, attachments, and the ✉
// button on the talk bar with the unread count. Emails are shown in a sandboxed frame (no scripts, nothing loads from the
// internet unless "Show images"): the server already cleaned them (lib/mail/sanitize.mjs). Writing is mail-compose.js.
// Keys (when the window has focus): j/k next/previous · Enter open · r reply · a reply all · f forward · e archive ·
// # Trash · s star · u unread · x select · c write · / search · ? all the shortcuts · Esc back / close.
(() => {
  const C = window.dsMailCore; if (!C) return;
  const { $, esc, api, when, size, confirmBox, note } = C;
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const FOLDER_NAMES = { inbox: "📥 Inbox", starred: "⭐ Starred", sent: "📤 Sent", drafts: "📝 Drafts", archive: "🗄 Archive", trash: "🗑 Trash" };

  // ---- the ✉ button on the talk bar, with the unread count ----
  const tools = $(".talktools");
  const wrap = document.createElement("span"); wrap.className = "mailbtnwrap";
  wrap.innerHTML = `<button id="mailBtn" title="Email: read and write mail" aria-label="Email">✉</button><span class="mailbadge" id="mailBadge" hidden aria-hidden="true"></span>`;
  // (added once Dayspring says email is on in this version, so it never flashes up where it isn't)
  let status = null;
  function badge(n) {
    const b = $("#mailBadge"); if (!b) return;
    b.hidden = !n; b.textContent = n > 99 ? "99+" : String(n || "");
    $("#mailBtn")?.setAttribute("aria-label", n ? `Email, ${n} unread` : "Email");
  }
  let off = false;         // the "email" feature isn't in this release channel: no button, no window (the routes answer 404)
  async function refreshStatus() {
    try { status = await api("/mail/status"); off = false; if (!wrap.isConnected && tools) tools.appendChild(wrap); badge(status.unread?.total ?? 0); document.documentElement.style.setProperty("--preview-lines", String(status.prefs?.previewLines ?? 1)); }
    catch (e) { if (e.status === 404) { off = true; wrap.remove(); close(); } }
    return status;
  }
  $("#mailBtn", wrap).onclick = () => (W ? close() : open());

  // ---- the window ----
  let W = null;
  function build() {
    const el = document.createElement("div");
    el.className = "mailwin"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Mail"); el.tabIndex = -1;
    el.innerHTML = `<header class="mw-bar">
        <h3>✉ Mail</h3>
        <select class="mw-acct" aria-label="Mailbox"></select>
        <select class="mw-foldersel" aria-label="Folder"></select>
        <input type="search" class="mw-search" placeholder="Search mail" aria-label="Search mail">
        <button type="button" data-a="compose" title="Write an email (c)">✏ Write</button>
        <button type="button" data-a="invite" title="Write a meeting invitation">📅 Invite</button>
        <button type="button" data-a="refresh" aria-label="Refresh" title="Refresh">↻</button>
        <button type="button" data-a="settings" aria-label="Email settings" title="Email settings">⚙</button>
        <button type="button" data-a="help" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">?</button>
        <button type="button" data-a="close" aria-label="Close" title="Close (Esc)">✕</button>
      </header>
      <div class="mw-body">
        <nav class="mw-folders" aria-label="Folders"></nav>
        <section class="mw-list" aria-label="Messages">
          <div class="mw-bulk" hidden><span class="n"></span><button type="button" data-b="archive">🗄 Archive</button><button type="button" data-b="read">Mark read</button><button type="button" data-b="unread">Mark unread</button><button type="button" data-b="star">⭐ Star</button><button type="button" data-b="trash" class="warn">🗑 Trash…</button><button type="button" data-b="none" class="plain">Clear</button></div>
          <div class="mw-rows" role="listbox" aria-multiselectable="true" aria-label="Emails" tabindex="0"></div>
        </section>
        <article class="mw-read" aria-label="Email"><div class="mw-empty">Pick an email to read it.</div></article>
      </div>
      <div class="mw-status" role="status" aria-live="polite"></div>`;
    document.body.appendChild(el);
    W = { el, account: "all", folder: "inbox", q: "", rows: [], sel: new Set(), cursor: -1, openId: null, msg: null, textView: false, folders: [], gen: 0 };
    $(".mw-acct", el).onchange = (e) => { W.account = e.target.value; W.sel.clear(); loadFolders(); loadList(); };
    $(".mw-foldersel", el).onchange = (e) => setFolder(e.target.value);
    let t = 0; $(".mw-search", el).oninput = (e) => { clearTimeout(t); t = setTimeout(() => { W.q = e.target.value.trim(); loadList(); }, 350); };
    for (const b of $$("[data-a]", el)) b.onclick = () => bar(b.dataset.a);
    for (const b of $$("[data-b]", el)) b.onclick = () => bulk(b.dataset.b);
    new ResizeObserver(() => { if (!W) return; const w = el.clientWidth; el.classList.toggle("narrow", w < 760); el.classList.toggle("medium", w >= 760 && w < 1100); }).observe(el);
    el.addEventListener("keydown", keys);
    return el;
  }
  function say(t) { if (W) $(".mw-status", W.el).textContent = t ?? ""; }
  function fillAccounts() {
    if (!W) return;
    const s = $(".mw-acct", W.el), boxes = status?.boxes ?? [];
    s.innerHTML = `<option value="all">All inboxes</option>` + boxes.map((b) => `<option value="${esc(b.key)}">${esc(b.label)}${b.primary ? " (primary)" : ""}</option>`).join("");
    if (![...s.options].some((o) => o.value === W.account)) W.account = "all";
    s.value = W.account;
  }
  async function open({ account = null, folder = null, id = null } = {}) {
    await refreshStatus();
    if (off) return;
    if (!W) build();
    if (account) W.account = account;
    if (folder) W.folder = folder;
    fillAccounts();
    W.el.focus({ preventScroll: true });
    if (!status?.connected) {
      $(".mw-rows", W.el).innerHTML = `<div class="mw-empty">No mailbox is connected yet.<br><br>Add Gmail, Outlook, Yahoo, iCloud or any other email in <b>Settings → Email</b>.<br><br><button type="button" data-go="settings">Open Email settings</button></div>`;
      $("[data-go=settings]", W.el).onclick = () => bar("settings");
      $(".mw-folders", W.el).innerHTML = "";
      return;
    }
    await loadFolders();
    await loadList();
    if (id) openMessage(id);
  }
  function close() { W?.el.remove(); W = null; }
  async function loadFolders() {
    if (!W) return;
    let list = Object.keys(FOLDER_NAMES).map((id) => ({ id, name: FOLDER_NAMES[id] }));
    if (W.account !== "all") { try { const r = await api(`/mail/folders?account=${encodeURIComponent(W.account)}`); list = r.folders.map((f) => ({ ...f, name: FOLDER_NAMES[f.id] ?? "📁 " + f.name })); } catch (e) { say(e.message); } }
    if (!W) return;
    W.folders = list;
    const unread = status?.unread?.boxes ?? {}, n = W.account === "all" ? status?.unread?.total ?? 0 : unread[W.account] ?? 0;
    const std = list.filter((f) => !f.custom), custom = list.filter((f) => f.custom);
    $(".mw-folders", W.el).innerHTML = std.map((f) => `<button type="button" data-f="${esc(f.id)}" aria-current="${f.id === W.folder}"><span>${esc(f.name)}</span>${f.id === "inbox" && n ? `<span class="cnt">${n}</span>` : ""}</button>`).join("")
      + (custom.length ? `<h5>Folders</h5>` + custom.map((f) => `<button type="button" data-f="${esc(f.id)}" aria-current="${f.id === W.folder}"><span>${esc(f.name)}</span></button>`).join("") : "");
    for (const b of $$("[data-f]", W.el)) b.onclick = () => setFolder(b.dataset.f);
    $(".mw-foldersel", W.el).innerHTML = list.map((f) => `<option value="${esc(f.id)}"${f.id === W.folder ? " selected" : ""}>${esc(f.name)}</option>`).join("");
  }
  function setFolder(f) { if (!W) return; W.folder = f; W.sel.clear(); W.cursor = -1; $$("[data-f]", W.el).forEach((b) => b.setAttribute("aria-current", String(b.dataset.f === f))); $(".mw-foldersel", W.el).value = f; loadList(); }
  async function loadList() {
    if (!W) return;
    const gen = ++W.gen;
    say("Loading…");
    try {
      const r = await api(`/mail/list?account=${encodeURIComponent(W.account)}&folder=${encodeURIComponent(W.folder)}&q=${encodeURIComponent(W.q)}&limit=60`);
      if (!W || gen !== W.gen) return;
      W.rows = r.messages;
      renderRows();
      say(r.errors?.length ? r.errors.map((e) => `${e.label}: ${e.error}`).join(" · ") : `${r.messages.length ? r.messages.length : "No"} email${r.messages.length === 1 ? "" : "s"}${W.q ? ` matching “${W.q}”` : ""}.`);
    } catch (e) { if (W && gen === W.gen) { W.rows = []; renderRows(); say(e.message); } }
  }
  function renderRows() {
    if (!W) return;
    const box = $(".mw-rows", W.el), multi = W.account === "all" && (status?.boxes?.length ?? 0) > 1;
    if (!W.rows.length) { box.innerHTML = `<div class="mw-empty">${W.q ? "Nothing matches that search." : W.folder === "inbox" ? "Your inbox is empty. 🎉" : "Nothing here."}</div>`; bulkBar(); return; }
    box.innerHTML = W.rows.map((m, i) => `<div class="mw-row${m.unread ? " unread" : ""}${i === W.cursor ? " cursor" : ""}" role="option" aria-selected="${W.sel.has(m.id)}" data-i="${i}" id="mwr-${i}">
      ${multi ? `<span class="acct" style="background:${esc(m.color ?? "#7c8cff")}" title="${esc(m.accountLabel)}"></span>` : ""}
      <input type="checkbox" aria-label="Select" ${W.sel.has(m.id) ? "checked" : ""}><span class="dot" aria-hidden="true"></span>
      <span class="who" title="${esc(m.from?.address ?? "")}">${esc(W.folder === "sent" || W.folder === "drafts" ? "To: " + (m.to ?? []).map(C.who).join(", ") : C.who(m.from) || "(unknown)")}</span>
      <span class="when">${esc(when(m.date))}</span>
      <span class="subj">${esc(m.subject || "(no subject)")}</span>
      <span class="snip">${esc(m.snippet ?? "")}</span>
      <span class="tags" style="grid-column:4">${m.hasAttachments ? `<span title="Has attachments">📎</span>` : ""}${m.starred ? `<span title="Starred">⭐</span>` : ""}</span></div>`).join("");
    for (const r of $$(".mw-row", box)) {
      const i = Number(r.dataset.i);
      r.onclick = (e) => { if (e.target.matches("input")) return; W.cursor = i; openMessage(W.rows[i].id); };
      $("input", r).onchange = (e) => { const id = W.rows[i].id; if (e.target.checked) W.sel.add(id); else W.sel.delete(id); r.setAttribute("aria-selected", String(e.target.checked)); bulkBar(); };
    }
    bulkBar();
  }
  function bulkBar() { if (!W) return; const b = $(".mw-bulk", W.el); b.hidden = !W.sel.size; $(".n", b).textContent = `${W.sel.size} selected`; }
  async function bulk(action) {
    if (!W) return;
    if (action === "none") { W.sel.clear(); renderRows(); return; }
    const ids = [...W.sel]; if (!ids.length) return;
    if (action === "trash" && !(await confirmBox(`Move ${ids.length} email${ids.length === 1 ? "" : "s"} to the Trash? You can restore them from there.`, { ok: "Move to Trash", danger: true }))) return;
    say("Working…");
    try { const r = await api("/mail/act", { ids, action, confirm: action === "trash" }); W.sel.clear(); say(`Done: ${r.done}${r.failed ? `, ${r.failed} didn't work (${r.error})` : ""}.`); await loadList(); refreshStatus(); }
    catch (e) { say(e.message); }
  }

  // ---- reading ----
  async function openMessage(id, { images = false } = {}) {
    if (!W) await open();
    const i = W.rows.findIndex((m) => m.id === id); if (i >= 0) W.cursor = i;
    $$(".mw-row", W.el).forEach((r) => r.classList.toggle("cursor", Number(r.dataset.i) === W.cursor));
    W.openId = id; W.el.classList.add("reading");
    const pane = $(".mw-read", W.el);
    pane.innerHTML = `<div class="mw-empty">Opening…</div>`;
    try {
      const m = await api(`/mail/message?id=${encodeURIComponent(id)}&mark=1${images ? "&images=1" : ""}`);
      if (!W || W.openId !== id) return;
      W.msg = m;
      const row = W.rows.find((x) => x.id === id); if (row && row.unread) { row.unread = false; renderRows(); refreshStatus(); }
      renderReader();
    } catch (e) { pane.innerHTML = `<div class="mw-empty">${esc(e.message)}</div>`; }
  }
  function renderReader() {
    const m = W.msg, pane = $(".mw-read", W.el);
    const isDraft = W.folder === "drafts";
    const moveOpts = W.folders.filter((f) => !["starred", "drafts", "sent", W.folder].includes(f.id));
    pane.innerHTML = `<div class="mw-rhead"><button type="button" class="mw-back plain" data-r="back">← Back</button>
        <h2>${esc(m.subject || "(no subject)")}</h2>
        <div class="meta"><b>${esc(m.fromText)}</b><br>To: ${esc(m.toText || "—")}${m.ccText ? `<br>Cc: ${esc(m.ccText)}` : ""}<br>${esc(new Date(m.date).toLocaleString())}${(status?.boxes?.length ?? 0) > 1 ? ` · ${esc(m.accountLabel)}` : ""}</div></div>
      <div class="mw-racts" role="toolbar" aria-label="Email actions">
        ${isDraft ? `<button type="button" class="primary" data-r="editdraft">✏ Open in the editor</button>` : `<button type="button" data-r="reply" title="Reply (r)">↩ Reply</button><button type="button" data-r="replyAll" title="Reply all (a)">↩↩ Reply all</button><button type="button" data-r="forward" title="Forward (f)">→ Forward</button><button type="button" data-r="forwardAtt" title="Forward as an attachment">📎→ As attachment</button>`}
        <button type="button" data-r="star" aria-pressed="${m.starred}" title="Star (s)">${m.starred ? "⭐ Starred" : "☆ Star"}</button>
        <button type="button" data-r="unread" title="Mark unread (u)">✉ Unread</button>
        <button type="button" data-r="archive" title="Archive (e)">🗄 Archive</button>
        <button type="button" class="warn" data-r="trash" title="Move to Trash (#)">🗑 Trash</button>
        ${moveOpts.length ? `<select data-r="move" aria-label="Move to folder"><option value="">📁 Move to…</option>${moveOpts.map((f) => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join("")}</select>` : ""}
        <button type="button" data-r="text" aria-pressed="${W.textView}">${W.textView ? "🖼 Formatted" : "🔤 Plain text"}</button>
      </div>
      ${m.blocked && !m.imagesShown ? `<div class="mw-note" role="note">🛡 ${m.blocked} picture${m.blocked === 1 ? " was" : "s were"} held back (they can tell the sender you opened it).<button type="button" data-r="images">Show pictures</button><button type="button" data-r="imagesAlways">Always from ${esc(m.from?.address ?? "this sender")}</button></div>` : ""}
      ${m.senderAllowed ? `<div class="mw-note" role="note">Pictures from ${esc(m.from.address)} always show.<button type="button" data-r="imagesNever" class="plain">Stop</button></div>` : ""}
      <div class="mw-thread" hidden></div>
      ${W.textView ? `<div class="mw-text" tabindex="0">${esc(m.text || "(no text)")}</div>` : `<iframe class="mw-frame" title="The email's content" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer"></iframe>`}
      ${m.attachments.length ? `<div class="mw-atts" aria-label="Attachments">${m.attachments.map((a) => `<div class="mw-att"><span>📎</span><span class="n" title="${esc(a.name)}">${esc(a.name)}</span><small>${esc(size(a.size))}</small><button type="button" data-open="${a.idx}">Open</button><button type="button" data-save="${a.idx}">Save…</button></div>`).join("")}</div>` : ""}`;
    const fr = $(".mw-frame", pane); if (fr) fr.srcdoc = m.doc;
    for (const b of $$("[data-r]", pane)) if (b.tagName === "SELECT") b.onchange = () => b.value && act("move", b.value); else b.onclick = () => act(b.dataset.r);
    for (const b of $$("[data-open]", pane)) b.onclick = () => window.open(`/api/mail/attachment?id=${encodeURIComponent(m.id)}&idx=${b.dataset.open}&inline=1`, "_blank", "noopener");
    for (const b of $$("[data-save]", pane)) b.onclick = () => saveAtt(m, Number(b.dataset.save));
    if (status?.prefs?.conversationView !== false && m.threadId) loadThread(m);
  }
  async function loadThread(m) {
    try {
      const t = await api(`/mail/thread?id=${encodeURIComponent(m.id)}`);
      if (!W || W.msg?.id !== m.id || t.messages.length < 2) return;
      const box = $(".mw-thread", W.el); box.hidden = false;
      box.innerHTML = `<small>${t.messages.length} in this conversation</small>` + t.messages.map((x) => `<button type="button" data-t="${esc(x.id)}" aria-current="${x.id === m.id}"><b>${esc(C.who(x.from))}</b><span class="s">${esc(x.snippet)}</span><span>${esc(when(x.date))}</span></button>`).join("");
      for (const b of $$("[data-t]", box)) b.onclick = () => openMessage(b.dataset.t);
    } catch { /* no thread */ }
  }
  async function saveAtt(m, idx) {
    const a = m.attachments.find((x) => x.idx === idx);
    if (!(await confirmBox(`Save “${a.name}” (${size(a.size)}) to your Downloads folder?`, { ok: "Save" }))) return;
    try { const r = await api("/mail/attachment/save", { id: m.id, idx, confirm: true }); note(r.saved ? `Saved to ${r.to}` : r.text || r.error || "It wasn't saved."); }
    catch (e) { note(e.message); }
  }
  async function act(a, arg) {
    const m = W?.msg; if (!m) return;
    const next = () => { const i = W.rows.findIndex((x) => x.id === m.id); W.rows.splice(i, 1); renderRows(); const n = W.rows[Math.min(i, W.rows.length - 1)]; if (n && !W.el.classList.contains("narrow")) openMessage(n.id); else { $(".mw-read", W.el).innerHTML = `<div class="mw-empty">Pick an email to read it.</div>`; W.el.classList.remove("reading"); W.msg = null; } };
    try {
      if (a === "back") { W.el.classList.remove("reading"); return; }
      if (["reply", "replyAll", "forward", "forwardAtt"].includes(a)) { const c = await api("/mail/compose", { id: m.id, mode: a === "forwardAtt" ? "forward" : a, asAttachment: a === "forwardAtt" }); window.dsMailCompose?.open(c); return; }
      if (a === "editdraft") { const c = await api("/mail/drafts/open", { id: m.id }); window.dsMailCompose?.open(c); return; }
      if (a === "star") { await api("/mail/act", { ids: [m.id], action: m.starred ? "unstar" : "star" }); m.starred = !m.starred; const r = W.rows.find((x) => x.id === m.id); if (r) r.starred = m.starred; renderRows(); renderReader(); return; }
      if (a === "unread") { await api("/mail/act", { ids: [m.id], action: "unread" }); const r = W.rows.find((x) => x.id === m.id); if (r) r.unread = true; renderRows(); refreshStatus(); say("Marked unread."); return; }
      if (a === "archive") { await api("/mail/act", { ids: [m.id], action: "archive" }); say("Archived."); next(); refreshStatus(); return; }
      if (a === "trash") { if (!(await confirmBox("Move this email to the Trash? You can restore it from there.", { ok: "Move to Trash", danger: true }))) return; await api("/mail/act", { ids: [m.id], action: "trash", confirm: true }); say("Moved to the Trash."); next(); refreshStatus(); return; }
      if (a === "move") { await api("/mail/act", { ids: [m.id], action: "move", folder: arg }); say("Moved."); next(); return; }
      if (a === "text") { W.textView = !W.textView; renderReader(); return; }
      if (a === "images") return openMessage(m.id, { images: true });
      if (a === "imagesAlways") { await api("/mail/images", { sender: m.from.address, allow: true }); return openMessage(m.id); }
      if (a === "imagesNever") { await api("/mail/images", { sender: m.from.address, allow: false }); return openMessage(m.id); }
    } catch (e) { say(e.message); note(e.message); }
  }
  function bar(a) {
    if (a === "close") return close();
    if (a === "refresh") { refreshStatus(); loadFolders(); return loadList(); }
    if (a === "compose") return window.dsMailCompose?.newEmail({ account: W?.account && W.account !== "all" ? W.account : null });
    if (a === "invite") return window.dsMailCompose?.newInvite({});
    if (a === "settings") return window.dsOpenPage ? window.dsOpenPage("/settings?embed=1&s=email") : window.open("/settings?s=email", "_blank");
    if (a === "help") return help();
  }
  function help() {
    const el = document.createElement("div"); el.className = "mailhelp"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Keyboard shortcuts");
    const row = (k, t) => `<tr><td>${k.split(" ").map((x) => `<kbd>${esc(x)}</kbd>`).join(" ")}</td><td>${esc(t)}</td></tr>`;
    el.innerHTML = `<div class="box"><button type="button" class="x plain" aria-label="Close">✕</button><h4>Mail window</h4><table>${[["j", "Next email"], ["k", "Previous email"], ["Enter", "Open"], ["r", "Reply"], ["a", "Reply all"], ["f", "Forward"], ["e", "Archive"], ["#", "Move to Trash"], ["s", "Star"], ["u", "Mark unread"], ["x", "Select"], ["c", "Write an email"], ["/", "Search"], ["Esc", "Back, then close"]].map(([k, t]) => row(k, t)).join("")}</table>
      <h4>Email editor</h4><table>${[["Ctrl+Enter", "Send"], ["Ctrl+S", "Save the draft"], ["Ctrl+B", "Bold"], ["Ctrl+I", "Italic"], ["Ctrl+U", "Underline"], ["Ctrl+K", "Link"], ["Ctrl+Shift+7", "Numbered list"], ["Ctrl+Shift+8", "Bulleted list"], ["Ctrl+Z", "Undo"], ["Ctrl+Y", "Redo"], ["Ctrl+Shift+D", "Dictate"], ["Esc", "Minimise"], ["Ctrl+/", "These shortcuts"]].map(([k, t]) => row(k, t)).join("")}</table>
      <h4>By voice</h4><p style="line-height:1.5;margin:.2em 0">“Read my new emails” · “Any emails from Sam?” · “Read the one from the bank” · “Summarise my inbox” · “Write an email to Sam about…” · “Make it shorter” · “Add Rich to CC” · “Send it” · “Undo send”</p></div>`;
    document.body.appendChild(el);
    const close2 = () => { el.remove(); document.removeEventListener("keydown", k, true); };
    const k = (e) => { if (e.key === "Escape") { e.stopPropagation(); close2(); } };
    document.addEventListener("keydown", k, true);
    el.onclick = (e) => { if (e.target === el) close2(); };
    $(".x", el).onclick = close2; $(".x", el).focus();
  }
  window.dsMailHelp = help;
  function keys(e) {
    if (!W || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.matches("input, select, textarea, iframe, [contenteditable]")) { if (e.key === "Escape" && e.target.matches(".mw-search")) { e.target.blur(); W.el.focus(); } return; }
    const k = e.key, rows = W.rows;
    const go = (d) => { if (!rows.length) return; W.cursor = Math.max(0, Math.min(rows.length - 1, (W.cursor < 0 ? -1 : W.cursor) + d)); $$(".mw-row", W.el).forEach((r) => r.classList.toggle("cursor", Number(r.dataset.i) === W.cursor)); $(`#mwr-${W.cursor}`, W.el)?.scrollIntoView({ block: "nearest" }); };
    const cur = rows[W.cursor];
    const map = {
      j: () => go(1), ArrowDown: () => go(1), k: () => go(-1), ArrowUp: () => go(-1),
      Enter: () => cur && openMessage(cur.id), o: () => cur && openMessage(cur.id),
      r: () => W.msg && act("reply"), a: () => W.msg && act("replyAll"), f: () => W.msg && act("forward"), e: () => W.msg && act("archive"), "#": () => W.msg && act("trash"),
      s: () => W.msg && act("star"), u: () => W.msg && act("unread"), c: () => bar("compose"), "/": () => $(".mw-search", W.el).focus(), "?": () => help(),
      x: () => { if (!cur) return; if (W.sel.has(cur.id)) W.sel.delete(cur.id); else W.sel.add(cur.id); renderRows(); },
      Escape: () => { if (W.el.classList.contains("reading") && W.el.classList.contains("narrow")) W.el.classList.remove("reading"); else close(); },
    };
    const fn = map[k]; if (!fn) return;
    e.preventDefault(); e.stopPropagation(); fn();
  }

  // ---- what the server says (a voice command, the AI, new mail, a send) ----
  function onEvent(d) {
    if (!d) return;
    switch (d.kind) {
      case "open": open({ account: d.account && d.account !== "all" ? d.account : "all" }); break;
      case "show": open().then(() => openMessage(d.id)); break;
      case "unread": badge(d.unread?.total ?? 0); if (status) status.unread = d.unread; break;
      case "new": refreshStatus(); if (W && W.folder === "inbox" && !W.q) loadList(); break;
      case "changed": if (W && W.msg?.id !== d.id) { /* the list refreshes itself below */ } refreshStatus(); break;
      case "boxes": refreshStatus().then(() => { fillAccounts(); if (W) { loadFolders(); loadList(); } }); break;
      case "sent": refreshStatus(); if (W && W.folder === "sent") loadList(); break;
    }
    window.dsMailCompose?.onEvent?.(d);
  }
  const hook = (es) => es.addEventListener("mail", (e) => { let d; try { d = JSON.parse(e.data); } catch { return; } onEvent(d); });
  if (window.dsEvents) hook(window.dsEvents); else addEventListener("ds-events", (e) => hook(e.detail), { once: true });
  refreshStatus();
  setInterval(refreshStatus, 3 * 60_000);
  window.dsMail = { open, close, openMessage, refresh: () => loadList(), status: () => status, refreshStatus, onEvent, get win() { return W; } };
})();
