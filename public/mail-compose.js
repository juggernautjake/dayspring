// The email editor and the invitation editor on the Dayspring screen: small windows, several open at once, that can be
// moved, resized, maximised and minimised to tabs along the bottom, always inside the screen's margins.
// The email editor: From, To/Cc/Bcc (with suggestions from people he's written to), Subject, a full rich-text toolbar
// (Quill, vendored in /vendor/quill: fonts and sizes, bold/italic/underline/strike, colour and highlight, headings, lists,
// indent, alignment, quotes, links, pictures, dividers, code, tables, emoji, GIFs, clear formatting, undo/redo), attachments
// (this computer, drag and drop, Dayspring's media library and Drive, another email), signatures, auto-save to the
// mailbox's Drafts, AI help (polish, shorter, friendlier, more formal), dictation (word for word, or "organize my thoughts").
// Sending happens only from the Send button here (or his spoken yes after the read-back), with a few seconds to undo.
// Changes the AI makes show up here as edits he can undo. window.dsMailCompose; window.dsDictation (tv.js hands it speech).
(() => {
  const C = window.dsMailCore; if (!C) return;
  const { $, esc, api, size, confirmBox, note } = C;
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const eds = new Map();                 // compose or invite id → the editor
  let info = { prefs: {}, boxes: [], ai: false };
  const GAP = 10;
  const safe = () => window.dsSafeRect?.() ?? { left: 0, top: 0, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight };
  async function refresh() { try { const s = await api("/mail/status"); info = { prefs: s.prefs ?? {}, boxes: s.boxes ?? [], ai: Boolean(s.ai) }; } catch { /* keep */ } return info; }

  // ---- the tabs for minimised editors ----
  let tabs = null;
  function tabBar() { if (!tabs || !tabs.isConnected) { tabs = document.createElement("div"); tabs.className = "mailtabs"; tabs.setAttribute("aria-label", "Minimised emails"); document.body.appendChild(tabs); } return tabs; }
  function paintTabs() {
    const bar = tabBar();
    bar.innerHTML = [...eds.values()].filter((e) => e.min && !e.sending).map((e) => `<button type="button" data-t="${esc(e.id)}" title="Open it again">${e.kind === "invite" ? "📅" : "✉"} ${esc(e.title())}</button>`).join("");
    for (const b of $$("[data-t]", bar)) b.onclick = () => restore(eds.get(b.dataset.t));
    // the open editors keep clear of the tabs (they're capped by --mail-tabs-h and moved up if they sat on them)
    const h = bar.children.length ? bar.offsetHeight + GAP : 0;
    document.documentElement.style.setProperty("--mail-tabs-h", h + "px");
    for (const e of eds.values()) if (!e.min && !e.el.hidden) requestAnimationFrame(() => place(e, { keep: true }));
  }
  const tabsH = () => (tabs?.isConnected && tabs.children.length ? tabs.offsetHeight + GAP : 0);
  function restore(ed) { if (!ed) return; ed.min = false; ed.el.hidden = false; paintTabs(); place(ed, { keep: true }); ed.quill?.focus(); }

  // ---- windows: placed inside the safe area, dragged by the title bar, resized from the corner ----
  function place(ed, { keep = false } = {}) {
    const el = ed.el, S = safe(), th = tabsH();
    if (ed.max) { el.style.left = S.left + GAP + "px"; el.style.top = S.top + GAP + "px"; el.style.right = "auto"; el.style.bottom = "auto"; return; }
    if (!keep || !el.style.left) {
      const fs = parseFloat(getComputedStyle(el).fontSize) || 14, n = [...eds.values()].filter((x) => x !== ed && !x.min).length;
      const w = Math.min(46 * fs, S.width - 2 * GAP), h = Math.min(ed.kind === "invite" ? 40 * fs : 38 * fs, S.height - 2 * GAP - th);
      el.style.width = w + "px"; el.style.height = h + "px";
      el.style.left = Math.max(S.left + GAP, S.right - GAP - w - n * 28) + "px";
      el.style.top = Math.max(S.top + GAP, S.bottom - GAP - th - h - n * 28) + "px";
    }
    window.dsKeepInSafe?.(el);
    // (above the minimised tabs, when it would cover them)
    if (th) { const r = el.getBoundingClientRect(); if (r.bottom > S.bottom - th) el.style.top = Math.max(S.top + GAP, S.bottom - th - r.height) + "px"; }
  }
  function draggable(ed) {
    const bar = $(".mc-bar", ed.el);
    bar.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button") || ed.max) return;
      const r = ed.el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      bar.setPointerCapture(e.pointerId);
      const move = (ev) => { const S = safe(); ed.el.style.left = Math.max(S.left, Math.min(S.right - ed.el.offsetWidth, ev.clientX - dx)) + "px"; ed.el.style.top = Math.max(S.top, Math.min(S.bottom - ed.el.offsetHeight, ev.clientY - dy)) + "px"; };
      const up = () => { bar.removeEventListener("pointermove", move); bar.removeEventListener("pointerup", up); window.dsKeepInSafe?.(ed.el); };
      bar.addEventListener("pointermove", move); bar.addEventListener("pointerup", up);
    });
    new ResizeObserver(() => requestAnimationFrame(() => { if (ed.el.isConnected && !ed.el.hidden) window.dsKeepInSafe?.(ed.el); })).observe(ed.el);
  }
  function windowButtons(ed) {
    $("[data-w=min]", ed.el).onclick = () => { ed.min = true; ed.el.hidden = true; paintTabs(); };
    $("[data-w=max]", ed.el).onclick = () => { ed.max = !ed.max; ed.el.classList.toggle("max", ed.max); $("[data-w=max]", ed.el).setAttribute("aria-pressed", String(ed.max)); $("[data-w=max]", ed.el).textContent = ed.max ? "❐" : "▢"; place(ed, { keep: true }); };
    $("[data-w=close]", ed.el).onclick = () => ed.closeWin();
  }

  // ---- To / Cc / Bcc: chips with suggestions ----
  function chips(host, value, onChange, { label }) {
    host.className = "chips"; host.setAttribute("role", "group"); host.setAttribute("aria-label", label);
    let list = C.parseList(value), sug = [], at = -1, t = 0;
    const input = document.createElement("input"); input.type = "text"; input.setAttribute("aria-label", label); input.autocomplete = "off"; input.spellcheck = false;
    const box = document.createElement("div"); box.className = "suggest"; box.hidden = true; box.setAttribute("role", "listbox");
    const paint = () => {
      $$(".chip", host).forEach((c) => c.remove());
      for (const [i, a] of list.entries()) {
        const c = document.createElement("span"); c.className = "chip" + (C.isEmail(a.address) ? "" : " bad"); c.title = a.address;
        c.innerHTML = `<span>${esc(a.name || a.address)}</span><button type="button" class="x" aria-label="Remove ${esc(a.name || a.address)}">✕</button>`;
        $(".x", c).onclick = () => { list.splice(i, 1); paint(); onChange(C.fmtList(list)); };
        host.insertBefore(c, input);
      }
    };
    const add = (a) => { if (!a?.address) return; if (!list.some((x) => x.address.toLowerCase() === a.address.toLowerCase())) list.push(a); input.value = ""; box.hidden = true; paint(); onChange(C.fmtList(list)); };
    const commit = () => { const v = input.value.trim().replace(/[,;]$/, ""); if (!v) return false; for (const a of C.parseList(v)) add(a); return true; };
    const showSug = () => { box.innerHTML = sug.map((s, i) => `<button type="button" role="option" aria-selected="${i === at}" data-i="${i}">${esc(s.name || s.address)} <small>${esc(s.name ? s.address : "")}${s.people ? " · in your people" : ""}</small></button>`).join(""); box.hidden = !sug.length; for (const b of $$("button", box)) b.onmousedown = (e) => { e.preventDefault(); add(sug[Number(b.dataset.i)]); }; };
    input.oninput = () => { clearTimeout(t); const q = input.value.trim(); if (/[,;]$/.test(input.value)) { commit(); return; } if (q.length < 1) { box.hidden = true; return; } t = setTimeout(async () => { try { sug = (await api(`/mail/contacts?q=${encodeURIComponent(q)}`)).contacts; at = sug.length ? 0 : -1; showSug(); } catch { /* no suggestions */ } }, 180); };
    input.onkeydown = (e) => {
      if (!box.hidden && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); at = (at + (e.key === "ArrowDown" ? 1 : -1) + sug.length) % sug.length; showSug(); return; }
      if (e.key === "Enter" || e.key === "Tab" || e.key === ",") { if (!box.hidden && at >= 0 && sug[at] && input.value.trim()) { e.preventDefault(); add(sug[at]); return; } if (input.value.trim()) { if (e.key !== "Tab") e.preventDefault(); commit(); } }
      if (e.key === "Backspace" && !input.value && list.length) { list.pop(); paint(); onChange(C.fmtList(list)); }
      if (e.key === "Escape" && !box.hidden) { e.stopPropagation(); box.hidden = true; }
    };
    input.onblur = () => { setTimeout(() => { box.hidden = true; }, 150); commit(); };
    host.append(input, box); paint();
    return { set: (v) => { list = C.parseList(v); paint(); }, get: () => C.fmtList(list), focus: () => input.focus(), input };
  }

  // ---- the toolbar ----
  const TB = () => `
    <span class="ql-formats"><select class="ql-font" aria-label="Font">${C.FONTS.map(([v]) => `<option value="${esc(v)}"></option>`).join("")}</select><select class="ql-size" aria-label="Size">${C.SIZES.map(([v]) => `<option value="${v}"${v === "14px" ? " selected" : ""}></option>`).join("")}</select></span>
    <span class="ql-formats"><select class="ql-header" aria-label="Paragraph style"><option value="1"></option><option value="2"></option><option value="3"></option><option selected></option></select></span>
    <span class="ql-formats"><button type="button" class="ql-bold" aria-label="Bold"></button><button type="button" class="ql-italic" aria-label="Italic"></button><button type="button" class="ql-underline" aria-label="Underline"></button><button type="button" class="ql-strike" aria-label="Strikethrough"></button></span>
    <span class="ql-formats"><select class="ql-color" aria-label="Text colour"></select><select class="ql-background" aria-label="Highlight"></select></span>
    <span class="ql-formats"><button type="button" class="ql-list" value="ordered" aria-label="Numbered list"></button><button type="button" class="ql-list" value="bullet" aria-label="Bulleted list"></button><button type="button" class="ql-indent" value="-1" aria-label="Outdent"></button><button type="button" class="ql-indent" value="+1" aria-label="Indent"></button><select class="ql-align" aria-label="Alignment"></select></span>
    <span class="ql-formats"><button type="button" class="ql-blockquote" aria-label="Quote"></button><button type="button" class="ql-code" aria-label="Code (monospace)"></button><button type="button" class="ql-code-block" aria-label="Code block"></button><button type="button" class="ql-link" aria-label="Link"></button><button type="button" class="ql-image" aria-label="Picture"></button></span>
    <span class="ql-formats"><button type="button" class="ql-divider mc-x" aria-label="Divider line" title="Divider line">―</button><button type="button" class="ql-tablemenu mc-x" aria-label="Table" title="Table">▦</button><button type="button" class="ql-emoji mc-x" aria-label="Emoji" title="Emoji">😊</button><button type="button" class="ql-gif mc-x" aria-label="GIF" title="GIF" hidden>GIF</button><button type="button" class="ql-clean" aria-label="Clear formatting"></button></span>
    <span class="ql-formats"><button type="button" class="ql-undo mc-x" aria-label="Undo" title="Undo (Ctrl+Z)">↶</button><button type="button" class="ql-redo mc-x" aria-label="Redo" title="Redo (Ctrl+Y)">↷</button><button type="button" class="ql-dictate mc-x" aria-label="Dictate" title="Dictate (Ctrl+Shift+D)" aria-pressed="false">🎙</button><button type="button" class="ql-shortcuts mc-x" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (Ctrl+/)">⌨</button></span>`;
  function popover(ed, anchor, cls, html) {
    $$(".mc-menu, .mc-emoji", ed.el).forEach((x) => x.remove());
    const p = document.createElement("div"); p.className = cls; p.innerHTML = html; ed.el.appendChild(p);
    const r = anchor.getBoundingClientRect(), er = ed.el.getBoundingClientRect();
    p.style.left = Math.max(4, Math.min(er.width - p.offsetWidth - 4, r.left - er.left)) + "px"; p.style.top = Math.max(4, Math.min(er.height - p.offsetHeight - 4, r.bottom - er.top + 4)) + "px";
    const off = (e) => { if (!p.contains(e.target) && e.target !== anchor) { p.remove(); document.removeEventListener("pointerdown", off, true); } };
    setTimeout(() => document.addEventListener("pointerdown", off, true), 0);
    return p;
  }
  function makeQuill(ed, host, tb, { placeholder }) {
    const Q = C.setupQuill();
    const quill = new Q(host, {
      theme: "snow", placeholder,
      modules: {
        table: true, history: { delay: 700, maxStack: 300, userOnly: false },
        toolbar: { container: tb, handlers: {
          divider() { const r = quill.getSelection(true); quill.insertEmbed(r.index, "divider", true, "user"); quill.setSelection(r.index + 1, "silent"); },
          undo() { quill.history.undo(); }, redo() { quill.history.redo(); },
          emoji() { const b = $(".ql-emoji", tb); const p = popover(ed, b, "mc-emoji", C.EMOJI.map((e) => `<button type="button" aria-label="${esc(e)}">${e}</button>`).join("")); for (const x of $$("button", p)) x.onclick = () => { const r = quill.getSelection(true); quill.insertText(r.index, x.textContent, "user"); quill.setSelection(r.index + x.textContent.length); p.remove(); }; },
          tablemenu() {
            const t = quill.getModule("table"), b = $(".ql-tablemenu", tb);
            const p = popover(ed, b, "mc-menu", [["t33", "Insert a table (3 × 3)"], ["t22", "Insert a table (2 × 2)"], ["rowb", "Add a row below"], ["colr", "Add a column to the right"], ["rowx", "Delete this row"], ["colx", "Delete this column"], ["tx", "Delete the table"]].map(([k, l]) => `<button type="button" data-k="${k}">${l}</button>`).join(""));
            for (const x of $$("button", p)) x.onclick = () => { quill.focus(); const k = x.dataset.k; try { if (k === "t33") t.insertTable(3, 3); else if (k === "t22") t.insertTable(2, 2); else if (k === "rowb") t.insertRowBelow(); else if (k === "colr") t.insertColumnRight(); else if (k === "rowx") t.deleteRow(); else if (k === "colx") t.deleteColumn(); else if (k === "tx") t.deleteTable(); } catch { note("Put the cursor in the table first."); } p.remove(); };
          },
          gif() { window.dsGifPicker?.open({ onPick: (g) => ed.gif?.(g) }); },
          dictate() { if (dict.ed === ed && dict.active) dict.finish(); else { const b = $(".ql-dictate", tb); const p = popover(ed, b, "mc-menu", `<button type="button" data-m="words">🎙 Word for word (say “comma”, “new paragraph”)</button><button type="button" data-m="organize">🧠 Organize my thoughts${info.ai ? "" : " (needs an AI key; without one it's written as you say it)"}</button>`); for (const x of $$("button", p)) x.onclick = () => { p.remove(); dict.start(ed, x.dataset.m); }; } },
          shortcuts() { window.dsMailHelp?.(); },
        } },
        keyboard: { bindings: {
          send: { key: "Enter", shortKey: true, handler: () => { ed.send?.(); return false; } },
          save: { key: "s", shortKey: true, handler: () => { ed.push?.({ save: true }); return false; } },
          link: { key: "k", shortKey: true, handler: (range) => { if (range.length) { const url = prompt("Link address:", "https://"); if (url) quill.format("link", url, "user"); } else $(".ql-link", tb).click(); return false; } },
          ol: { key: "7", shortKey: true, shiftKey: true, handler: (range, ctx) => { quill.format("list", ctx.format.list === "ordered" ? false : "ordered", "user"); return false; } },
          ul: { key: "8", shortKey: true, shiftKey: true, handler: (range, ctx) => { quill.format("list", ctx.format.list === "bullet" ? false : "bullet", "user"); return false; } },
          redoY: { key: "y", shortKey: true, handler: () => { quill.history.redo(); return false; } },
          dict: { key: "d", shortKey: true, shiftKey: true, handler: () => { if (dict.ed === ed && dict.active) dict.finish(); else dict.start(ed, "words"); return false; } },
          help: { key: "/", shortKey: true, handler: () => { window.dsMailHelp?.(); return false; } },
        } },
      },
    });
    quill.root.setAttribute("spellcheck", "true");
    quill.root.setAttribute("lang", info.prefs.spellLang || "en-US");
    quill.root.style.fontFamily = info.prefs.font || "Arial, Helvetica, sans-serif";
    quill.root.style.fontSize = info.prefs.size || "14px";
    quill.root.setAttribute("aria-label", placeholder);
    if (window.dsGifPicker?.open) $(".ql-gif", tb).hidden = false;
    return quill;
  }
  function setHtml(quill, html, source = "silent") {
    const delta = quill.clipboard.convert({ html: C.editorHtml(html) });
    quill.setContents(delta, source);
  }
  function aiBar(ed, text, undo) {
    const b = $(".mc-ai", ed.el); b.hidden = false;
    b.innerHTML = `<span>✨ ${esc(text)}</span><button type="button" data-u>Undo</button><button type="button" class="plain" data-k>Keep</button>`;
    $("[data-u]", b).onclick = () => { undo(); b.hidden = true; };
    $("[data-k]", b).onclick = () => { b.hidden = true; };
  }

  // ---- the email editor ----
  function openEmail(c, { dictate = null } = {}) {
    if (eds.has(c.id)) { const ed = eds.get(c.id); restore(ed); if (dictate) dict.start(ed, dictate); return ed; }
    const el = document.createElement("div");
    el.className = "mailcomp"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Email editor");
    el.innerHTML = `<div class="mc-bar"><span class="t"></span><button type="button" class="plain" data-w="min" aria-label="Minimise" title="Minimise (Esc)">▁</button><button type="button" class="plain" data-w="max" aria-label="Maximise" aria-pressed="false" title="Maximise">▢</button><button type="button" class="plain" data-w="close" aria-label="Close (the draft is kept)" title="Close (the draft is kept)">✕</button></div>
      <div class="mc-fields">
        <label>From</label><div class="row"><select data-f="account" aria-label="From"></select></div>
        <label>To</label><div class="row"><div data-f="to"></div><button type="button" class="plain" data-show="cc">Cc</button><button type="button" class="plain" data-show="bcc">Bcc</button></div>
        <label data-row="cc" hidden>Cc</label><div class="row" data-row="cc" hidden><div data-f="cc"></div></div>
        <label data-row="bcc" hidden>Bcc</label><div class="row" data-row="bcc" hidden><div data-f="bcc"></div></div>
        <label>Subject</label><div class="row"><input type="text" data-f="subject" aria-label="Subject" maxlength="400" spellcheck="true"></div>
      </div>
      <div class="mc-tb ql-toolbar">${TB()}</div>
      <div class="mc-editor"></div>
      <div class="mc-atts" aria-label="Attachments"></div><div class="mc-warn" role="status"></div>
      <div class="mc-ai" hidden role="status"></div>
      <div class="mc-dict" hidden role="status"><span class="rec" aria-hidden="true"></span><b class="mode"></b><span class="heard"></span><button type="button" data-d="done">Done</button><button type="button" class="plain" data-d="cancel">Cancel</button></div>
      <div class="mc-foot">
        <button type="button" class="primary" data-a="send" title="Send (Ctrl+Enter)">Send ➤</button>
        <button type="button" data-a="save" title="Save the draft (Ctrl+S)">💾 Save draft</button>
        <button type="button" data-a="attach" title="Attach files">📎 Attach ▾</button>
        <button type="button" data-a="sig" title="Insert your signature">✍ Signature</button>
        <span data-ai hidden><button type="button" data-a="polish" title="Fix grammar and flow">✨ Polish</button><button type="button" data-a="shorter">✂ Shorter</button><button type="button" data-a="tone" title="Friendlier or more formal">🎭 Tone ▾</button></span>
        <button type="button" class="warn" data-a="discard" title="Discard (the draft is deleted too)">🗑</button>
        <span class="st" role="status" aria-live="polite"></span>
      </div>
      <div class="mc-drop" hidden>Drop files to attach them</div>
      <input type="file" multiple hidden data-file>`;
    document.body.appendChild(el);
    const ed = { id: c.id, kind: "email", el, c: { ...c }, atts: [...(c.attachments ?? [])], rev: c.rev, dirty: false, draftDirty: false, min: false, max: false, t: 0 };
    ed.title = () => ed.c.subject || (ed.c.kind === "forward" ? "Forward" : ed.c.kind?.startsWith("reply") ? "Reply" : "New email");
    eds.set(c.id, ed);
    // fields
    const acc = $("[data-f=account]", el);
    const fillFrom = () => { acc.innerHTML = info.boxes.map((b) => `<option value="${esc(b.key)}">${esc(b.label)}${b.label !== b.email ? ` <${esc(b.email)}>` : ""}${b.canSend ? "" : " (sending off)"}</option>`).join(""); acc.value = ed.c.account; };
    fillFrom();
    ed.to = chips($("[data-f=to]", el), c.to, (v) => { ed.c.to = v; dirty(); }, { label: "To" });
    ed.cc = chips($("[data-f=cc]", el), c.cc, (v) => { ed.c.cc = v; dirty(); }, { label: "Cc" });
    ed.bcc = chips($("[data-f=bcc]", el), c.bcc, (v) => { ed.c.bcc = v; dirty(); }, { label: "Bcc" });
    const showRow = (k, on = true) => $$(`[data-row=${k}]`, el).forEach((x) => (x.hidden = !on));
    if (c.cc) showRow("cc"); if (c.bcc) showRow("bcc");
    for (const b of $$("[data-show]", el)) b.onclick = () => { showRow(b.dataset.show); (b.dataset.show === "cc" ? ed.cc : ed.bcc).focus(); };
    const subj = $("[data-f=subject]", el); subj.value = c.subject ?? "";
    subj.oninput = () => { ed.c.subject = subj.value; $(".t", el).textContent = ed.title(); dirty(); };
    acc.onchange = () => { ed.c.account = acc.value; dirty(); };
    $(".t", el).textContent = ed.title();
    // the editor
    const tb = $(".mc-tb", el);
    const quill = ed.quill = makeQuill(ed, $(".mc-editor", el), tb, { placeholder: "Write your email…" });
    setHtml(quill, c.html ?? "");
    quill.history.clear();
    quill.on("text-change", (d, o, src) => { if (src !== "silent") dirty(); });
    if (info.ai) $("[data-ai]", el).hidden = false;
    // saving: to Dayspring on every pause, to the mailbox's Drafts every few seconds while it changes
    const st = (t) => { $(".st", el).textContent = t; };
    function dirty() { ed.dirty = true; ed.draftDirty = true; clearTimeout(ed.t); ed.t = setTimeout(() => ed.push(), 1000); st("Editing…"); }
    ed.fields = () => ({ account: ed.c.account, to: ed.to.get(), cc: ed.cc.get(), bcc: ed.bcc.get(), subject: subj.value, html: C.emailHtml(quill, info.prefs), attachments: ed.atts.map((a) => a.id) });
    ed.push = async ({ save = false } = {}) => {
      clearTimeout(ed.t);
      try {
        const r = await api(`/mail/compose/${ed.id}`, { ...ed.fields(), save });
        ed.rev = r.rev; ed.dirty = false; ed.c = { ...ed.c, ...r, attachments: undefined };
        if (save) { ed.draftDirty = false; st(r.saveError ? `Couldn't save to Drafts: ${r.saveError}` : `Saved in Drafts ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`); }
        else st("Saved");
        return r;
      } catch (e) { st(e.status === 404 ? "This email isn't open on the server anymore." : e.message); return null; }
    };
    const every = Math.max(2, Number(info.prefs.autosaveSeconds) || 5) * 1000;
    ed.timer = setInterval(() => { if (ed.draftDirty && !ed.sending && document.contains(el)) ed.push({ save: true }); }, every);
    // attachments
    const paintAtts = () => {
      const box = $(".mc-atts", el);
      box.innerHTML = ed.atts.map((a, i) => `<span class="mc-att${a.missing ? " missing" : ""}"><span>${a.type === "message/rfc822" ? "✉" : "📎"}</span><span class="n" title="${esc(a.name)}">${esc(a.name)}</span><small>${esc(size(a.size))}</small><button type="button" class="x" data-rm="${i}" aria-label="Remove ${esc(a.name)}">✕</button></span>`).join("");
      for (const b of $$("[data-rm]", box)) b.onclick = () => { ed.atts.splice(Number(b.dataset.rm), 1); paintAtts(); dirty(); };
      const total = ed.atts.reduce((n, a) => n + (a.size ?? 0), 0), w = $(".mc-warn", el);
      w.className = "mc-warn" + (total > 25 * 1048576 ? " bad" : "");
      w.textContent = total > 25 * 1048576 ? `Attachments: ${size(total)}. That's over the 25 MB most email allows (Gmail's limit): remove some, or share them with a Drive link.` : total > 18 * 1048576 ? `Attachments: ${size(total)}, close to the 25 MB limit.` : ed.atts.some((a) => a.missing) ? "An attachment is missing (Dayspring restarted): remove it and attach it again." : "";
    };
    ed.paintAtts = paintAtts; paintAtts();
    ed.upload = async (files) => {
      for (const f of files) {
        if (f.size > 25 * 1048576) { note(`${f.name} is ${size(f.size)}: too big for email. Share it with a Drive link instead.`); continue; }
        st(`Attaching ${f.name}…`);
        try { const a = await api("/mail/attachments", undefined, { raw: f, headers: { "x-file-name": encodeURIComponent(f.name), "content-type": f.type || "application/octet-stream", "x-file-from": "computer" } }); ed.atts.push(a); paintAtts(); dirty(); st(`Attached ${f.name}`); }
        catch (e) { note(e.message); }
      }
    };
    ed.addAtt = (a) => { ed.atts.push(a); paintAtts(); dirty(); };
    const fileIn = $("[data-file]", el); fileIn.onchange = () => { ed.upload([...fileIn.files]); fileIn.value = ""; };
    // drag and drop: pictures dropped into the text go in the text; anything else is attached
    let depth = 0;
    el.addEventListener("dragenter", (e) => { if ([...(e.dataTransfer?.types ?? [])].includes("Files")) { depth++; $(".mc-drop", el).hidden = false; } });
    el.addEventListener("dragleave", () => { depth = Math.max(0, depth - 1); if (!depth) $(".mc-drop", el).hidden = true; });
    el.addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.types ?? [])].includes("Files")) e.preventDefault(); });
    el.addEventListener("drop", (e) => {
      depth = 0; $(".mc-drop", el).hidden = true;
      const files = [...(e.dataTransfer?.files ?? [])]; if (!files.length) return;
      e.preventDefault(); e.stopPropagation();
      const inText = quill.root.contains(e.target), pics = inText ? files.filter((f) => /^image\/(png|jpe?g|gif|webp)$/.test(f.type) && f.size < 5 * 1048576) : [];
      for (const f of pics) { const r = new FileReader(); r.onload = () => { const s = quill.getSelection(true); quill.insertEmbed(s?.index ?? quill.getLength(), "image", r.result, "user"); }; r.readAsDataURL(f); }
      ed.upload(files.filter((f) => !pics.includes(f)));
    }, true);
    // GIFs from the GIF picker (lib/gifs): in the text (embedded, so it shows even where web pictures are blocked) or attached
    ed.gif = async (g) => {
      const how = await gifChoice(ed); if (!how) return;
      try {
        let blob = null;
        if (g.file) blob = await (await fetch(g.file)).blob();
        if (!blob) { const a = await api("/mail/attachments/from", { source: "url", ref: g.url, name: g.title || "animation" }); if (how === "attach") return ed.addAtt(a); blob = await (await fetch(`/api/mail/attachments/${a.id}`)).blob(); }
        if (how === "attach") { const f = new File([blob], (g.title || "animation").replace(/[^\w .-]+/g, " ").trim().slice(0, 50) + ".gif", { type: blob.type || "image/gif" }); return ed.upload([f]); }
        if (blob.size > 5 * 1048576) { note("That GIF is over 5 MB: attach it instead."); return; }
        const url = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(blob); });
        const s = quill.getSelection(true); quill.insertEmbed(s?.index ?? quill.getLength(), "image", url, "user");
      } catch (e) { note(`The GIF couldn't be added: ${e.message}`); }
    };
    // the buttons
    ed.send = async () => {
      if (ed.sending) return;
      const f = ed.fields();
      if (!C.parseList(f.to).length && !C.parseList(f.cc).length && !C.parseList(f.bcc).length) { note("Who should it go to? Add someone in To."); ed.to.focus(); return; }
      const bad = [...C.parseList(f.to), ...C.parseList(f.cc), ...C.parseList(f.bcc)].filter((a) => !C.isEmail(a.address));
      if (bad.length) { note(`These aren't email addresses: ${bad.map((a) => a.address).join(", ")}`); return; }
      if (!f.subject.trim() && !(await confirmBox("Send it without a subject?", { ok: "Send anyway" }))) return;
      st("Sending…");
      try {
        await ed.push();
        const r = await api("/mail/send", { id: ed.id, patch: f }, { headers: { "x-dayspring-mail": "send" } });
        if (r.queued) { ed.sending = r.oid; el.hidden = true; paintTabs(); sendingToast(ed, r); }
      } catch (e) { st(e.message); note(e.message); }
    };
    ed.closeWin = async () => {
      if (dict.ed === ed) dict.cancel();
      if (ed.dirty || ed.draftDirty) await ed.push({ save: true });
      await api(`/mail/compose/${ed.id}/close`, {}).catch(() => {});
      destroy(ed);
    };
    const act = async (a, btn) => {
      if (a === "send") return ed.send();
      if (a === "save") return ed.push({ save: true });
      if (a === "attach") return attachMenu(ed, btn);
      if (a === "discard") { if (!(await confirmBox("Discard this email? Its saved draft is deleted too.", { ok: "Discard", danger: true }))) return; await api(`/mail/compose/${ed.id}/discard`, {}).catch(() => {}); return destroy(ed); }
      if (a === "sig") { const b = info.boxes.find((x) => x.key === ed.c.account); const s = await api("/mail/settings").then((x) => x.boxes.find((y) => y.key === ed.c.account)).catch(() => null); const sig = s?.signatures?.find((y) => y.id === s.defaultSig) ?? s?.signatures?.[0]; if (!sig?.html) { note(`No signature for ${b?.label ?? "this mailbox"} yet: add one in Settings → Email → Signatures.`); return; } const r = quill.getSelection(true); quill.history.cutoff(); quill.clipboard.dangerouslyPasteHTML(r.index, "<p><br></p>" + sig.html, "user"); quill.history.cutoff(); return; }
      if (a === "polish" || a === "shorter") return rewrite(ed, a);
      if (a === "tone") { const p = popover(ed, btn, "mc-menu", `<button type="button" data-t="friendlier">🙂 Friendlier</button><button type="button" data-t="formal">👔 More formal</button><button type="button" data-t="longer">➕ A little longer</button>`); for (const x of $$("button", p)) x.onclick = () => { p.remove(); rewrite(ed, x.dataset.t); }; }
    };
    for (const b of $$("[data-a]", el)) b.onclick = () => act(b.dataset.a, b);
    for (const b of $$("[data-d]", el)) b.onclick = () => (b.dataset.d === "done" ? dict.finish() : dict.cancel());
    el.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector(".mailconfirm, .mailpick, .mailhelp")) { const pop = $(".mc-menu, .mc-emoji", el); if (pop) pop.remove(); else if (!$(".ql-tooltip:not(.ql-hidden)", el)) $("[data-w=min]", el).click(); e.stopPropagation(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !quill.hasFocus()) { e.preventDefault(); ed.send(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && !quill.hasFocus()) { e.preventDefault(); ed.push({ save: true }); }
    });
    el.addEventListener("focusin", () => api(`/mail/compose/${ed.id}/focus`, {}).catch(() => {}), { once: false });
    windowButtons(ed); draggable(ed); place(ed);
    (c.to ? quill : ed.to).focus();
    if (c.unresolved?.length) note(`I don't have an email address for ${c.unresolved.join(" and ")}: type it in To.`);
    if (dictate) dict.start(ed, dictate);
    return ed;
  }
  function destroy(ed) { clearInterval(ed.timer); clearTimeout(ed.t); if (dict.ed === ed) dict.cancel(); ed.el.remove(); eds.delete(ed.id); paintTabs(); }
  async function rewrite(ed, how) {
    const st = $(".st", ed.el); st.textContent = "Rewriting…";
    try {
      const r = await api("/mail/ai", { action: how, html: C.emailHtml(ed.quill, info.prefs), tone: info.prefs.tone });
      ed.quill.history.cutoff(); setHtml(ed.quill, r.html, "user"); ed.quill.history.cutoff();
      aiBar(ed, { polish: "Polished.", shorter: "Made shorter.", friendlier: "Made friendlier.", formal: "Made more formal.", longer: "Made a little longer." }[how] ?? "Rewritten.", () => ed.quill.history.undo());
      st.textContent = "";
    } catch (e) { st.textContent = e.message; }
  }
  function gifChoice(ed) {
    return new Promise((done) => {
      const p = popover(ed, $(".ql-gif", ed.el), "mc-menu", `<button type="button" data-g="inline">In the email</button><button type="button" data-g="attach">As an attachment</button>`);
      for (const x of $$("button", p)) x.onclick = () => { p.remove(); done(x.dataset.g); };
      setTimeout(() => { if (!p.isConnected) done(null); }, 60_000);
    });
  }
  // 📎 Attach ▾: this computer, Dayspring (media library and Drive), another email, a file by its path
  function attachMenu(ed, btn) {
    const p = popover(ed, btn, "mc-menu", `<button type="button" data-k="pc">💻 From this computer…</button><button type="button" data-k="ds">🎵 From Dayspring (music, videos, Drive)…</button><button type="button" data-k="mail">✉ An email…</button><button type="button" data-k="path">📂 A file Dayspring may read (by its path)…</button>`);
    for (const x of $$("button", p)) x.onclick = () => { p.remove(); const k = x.dataset.k; if (k === "pc") $("[data-file]", ed.el).click(); else if (k === "ds") pickDayspring(ed); else if (k === "mail") pickEmail(ed); else pickPath(ed); };
  }
  function picker(title, bodyHtml) {
    const el = document.createElement("div"); el.className = "mailpick"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", title);
    el.innerHTML = `<div class="box"><h4 style="margin:.1em 0 .5em;font-weight:500">${esc(title)}</h4>${bodyHtml}<div class="row"><button type="button" data-x>Close</button></div></div>`;
    document.body.appendChild(el);
    const close = () => { el.remove(); document.removeEventListener("keydown", k, true); };
    const k = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("keydown", k, true);
    $("[data-x]", el).onclick = close; el.onclick = (e) => { if (e.target === el) close(); };
    return { el, close };
  }
  function pickDayspring(ed) {
    const pk = picker("Attach from Dayspring", `<input type="search" placeholder="Search your music, videos and Drive" aria-label="Search"><ul aria-label="Results"><li><small>Type to search.</small></li></ul>`);
    const inp = $("input", pk.el), ul = $("ul", pk.el); let t = 0;
    inp.oninput = () => { clearTimeout(t); t = setTimeout(async () => {
      try { const r = await api(`/mail/attach/search?q=${encodeURIComponent(inp.value.trim())}`); ul.innerHTML = r.items.length ? r.items.map((x, i) => `<li><button type="button" data-i="${i}">${x.source === "drive" ? "☁" : "🎵"} ${esc(x.name)} <small>${esc(x.detail)}${x.size ? " · " + esc(size(x.size)) : ""}</small></button></li>`).join("") : `<li><small>Nothing found.</small></li>`;
        for (const b of $$("[data-i]", ul)) b.onclick = async () => { const x = r.items[Number(b.dataset.i)]; b.disabled = true; try { ed.addAtt(await api("/mail/attachments/from", { source: x.source, ref: x.ref })); pk.close(); } catch (e) { note(e.message); b.disabled = false; } }; }
      catch (e) { ul.innerHTML = `<li><small>${esc(e.message)}</small></li>`; } }, 300); };
    inp.focus();
  }
  function pickPath(ed) {
    const pk = picker("Attach a file by its path", `<p style="margin:.2em 0;color:var(--muted)">Only files Settings → Permissions lets Dayspring read.</p><input type="text" placeholder="C:\\Users\\…\\Documents\\budget.xlsx" aria-label="File path"><div class="row"><button type="button" class="primary" data-go>Attach</button></div>`);
    const inp = $("input", pk.el);
    $("[data-go]", pk.el).onclick = async () => { try { ed.addAtt(await api("/mail/attachments/from", { source: "file", ref: inp.value.trim() })); pk.close(); } catch (e) { note(e.message); } };
    inp.onkeydown = (e) => { if (e.key === "Enter") $("[data-go]", pk.el).click(); };
    inp.focus();
  }
  function pickEmail(ed) {
    const pk = picker("Attach emails", `<input type="search" placeholder="Search your mail" aria-label="Search your mail"><ul aria-label="Emails"><li><small>Loading…</small></li></ul><div class="row"><button type="button" class="primary" data-go>Attach the ticked emails</button></div>`);
    const inp = $("input", pk.el), ul = $("ul", pk.el); let rows = [], t = 0;
    const load = async () => { try { const r = await api(`/mail/list?account=all&folder=inbox&q=${encodeURIComponent(inp.value.trim())}&limit=30`); rows = r.messages; ul.innerHTML = rows.map((m, i) => `<li><label><input type="checkbox" data-i="${i}"> <span>${esc(C.who(m.from))} · <b>${esc(m.subject || "(no subject)")}</b> <small>${esc(C.when(m.date))}</small></span></label></li>`).join("") || `<li><small>Nothing found.</small></li>`; } catch (e) { ul.innerHTML = `<li><small>${esc(e.message)}</small></li>`; } };
    inp.oninput = () => { clearTimeout(t); t = setTimeout(load, 300); };
    $("[data-go]", pk.el).onclick = async () => { for (const cb of $$("input[data-i]:checked", ul)) { try { ed.addAtt(await api("/mail/attachments/from", { source: "email", ref: rows[Number(cb.dataset.i)].id })); } catch (e) { note(e.message); } } pk.close(); };
    load(); inp.focus();
  }
  // "Sending in 10 s… Undo"
  function sendingToast(ed, r) {
    const secs = Math.max(0, Math.round((r.sendAt - Date.now()) / 1000));
    if (!secs) { note("Sending…"); return; }
    let left = secs;
    const el = note(`Sending in ${left} s…`, { ms: secs * 1000 + 800, action: { label: "Undo", run: async () => { try { await api("/mail/undo", { oid: r.oid }); } catch (e) { note(e.message); } } } });
    const span = el && $("span", el);
    const iv = setInterval(() => { left--; if (!span?.isConnected || left < 0) return clearInterval(iv); span.textContent = `✉ Sending in ${left} s…`; }, 1000);
  }

  // ---- the invitation editor (a Google Meet or Outlook meeting with a description, agenda, links and Drive files) ----
  function openInvite(v) {
    if (eds.has(v.id)) { const ed = eds.get(v.id); restore(ed); return ed; }
    const el = document.createElement("div");
    el.className = "mailcomp invite"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Meeting invitation");
    const durs = [15, 30, 45, 60, 90, 120, 180];
    el.innerHTML = `<div class="mc-bar"><span class="t"></span><button type="button" class="plain" data-w="min" aria-label="Minimise">▁</button><button type="button" class="plain" data-w="max" aria-label="Maximise" aria-pressed="false">▢</button><button type="button" class="plain" data-w="close" aria-label="Close">✕</button></div>
      <div class="mc-inv">
        <label>Title</label><div class="row"><input type="text" data-i="title" aria-label="Title" style="flex:1" maxlength="200"></div>
        <label>When</label><div class="row"><input type="date" data-i="date" aria-label="Date"><input type="time" data-i="start" aria-label="Start time"><select data-i="minutes" aria-label="Length">${durs.map((d) => `<option value="${d}">${d < 60 ? d + " min" : d / 60 + " hour" + (d > 60 ? "s" : "")}</option>`).join("")}</select></div>
        <label>Guests</label><div class="row"><div data-i="invitees"></div></div>
        <label>Where</label><div class="row"><label style="text-align:left"><input type="checkbox" data-i="meet"> Video link</label><select data-i="provider" aria-label="Calendar"><option value="google">Google Calendar (Meet)</option><option value="microsoft">Outlook (Teams)</option></select><input type="text" data-i="location" placeholder="Place (optional)" aria-label="Place" style="flex:1"></div>
      </div>
      <div class="mc-tb ql-toolbar">${TB()}</div>
      <div class="mc-editor"></div>
      <div class="mc-atts" aria-label="Files on the invitation"></div>
      <div class="mc-ai" hidden role="status"></div>
      <div class="mc-foot"><button type="button" class="primary" data-a="create">📅 Create and send invitations</button><button type="button" data-a="agenda">📋 Add an agenda</button><button type="button" data-a="drive">☁ Add a Drive file</button><button type="button" class="warn" data-a="discard" aria-label="Discard">🗑</button><span class="st" role="status" aria-live="polite"></span></div>`;
    document.body.appendChild(el);
    const ed = { id: v.id, kind: "invite", el, v: { ...v }, min: false, max: false, t: 0 };
    ed.title = () => ed.v.title || "Invitation";
    eds.set(v.id, ed);
    const f = (k) => $(`[data-i=${k}]`, el);
    f("title").value = v.title; f("date").value = v.date; f("start").value = v.start; f("minutes").value = String(durs.includes(v.minutes) ? v.minutes : 30); f("meet").checked = v.meet !== false; f("provider").value = v.provider; f("location").value = v.location ?? "";
    ed.guests = chips(f("invitees"), (v.invitees ?? []).join(", "), () => dirty(), { label: "Guests (email addresses)" });
    const quill = ed.quill = makeQuill(ed, $(".mc-editor", el), $(".mc-tb", el), { placeholder: "Description, agenda, links…" });
    $(".ql-dictate", el).hidden = true;
    setHtml(quill, v.html ?? ""); quill.history.clear();
    const st = (t) => { $(".st", el).textContent = t; };
    const paintFiles = () => { const box = $(".mc-atts", el); box.innerHTML = (ed.v.attachments ?? []).map((a, i) => `<span class="mc-att"><span>☁</span><span class="n">${esc(a.title)}</span><button type="button" class="x" data-rm="${i}" aria-label="Remove ${esc(a.title)}">✕</button></span>`).join(""); for (const b of $$("[data-rm]", box)) b.onclick = () => { ed.v.attachments.splice(Number(b.dataset.rm), 1); paintFiles(); dirty(); }; };
    paintFiles();
    ed.fields = () => ({ title: f("title").value.trim(), date: f("date").value, start: f("start").value, minutes: Number(f("minutes").value), invitees: C.parseList(ed.guests.get()).map((a) => a.address), meet: f("meet").checked, provider: f("provider").value, location: f("location").value, html: C.emailHtml(quill, info.prefs), attachments: ed.v.attachments ?? [] });
    ed.push = async () => { clearTimeout(ed.t); try { const r = await api(`/mail/invite/${ed.id}`, ed.fields()); ed.v = { ...ed.v, ...r }; st("Saved"); return r; } catch (e) { st(e.message); return null; } };
    function dirty() { clearTimeout(ed.t); ed.t = setTimeout(() => ed.push(), 900); $(".t", el).textContent = "📅 " + (f("title").value || "Invitation"); st("Editing…"); }
    for (const k of ["title", "date", "start", "minutes", "meet", "provider", "location"]) f(k).addEventListener(k === "title" || k === "location" ? "input" : "change", dirty);
    quill.on("text-change", (d, o, src) => { if (src !== "silent") dirty(); });
    $(".t", el).textContent = "📅 " + ed.title();
    ed.closeWin = async () => { await ed.push(); destroy(ed); };
    ed.send = async () => {
      const x = ed.fields();
      if (!x.invitees.length && !(await confirmBox("No guests: create it just on your calendar?", { ok: "Create" }))) return;
      st("Creating…");
      try {
        await ed.push();
        const r = await api(`/mail/invite/${ed.id}/create`, { patch: x }, { headers: { "x-dayspring-mail": "create" } });
        if (r.error) throw new Error(r.error);
        note(r.said || "Done: it's on your calendar."); destroy(ed);
      } catch (e) { st(e.message); note(e.message); }
    };
    for (const b of $$("[data-a]", el)) b.onclick = async () => {
      const a = b.dataset.a;
      if (a === "create") return ed.send();
      if (a === "discard") { if (!(await confirmBox("Discard this invitation?", { ok: "Discard", danger: true }))) return; await api(`/mail/invite/${ed.id}/discard`, {}).catch(() => {}); return destroy(ed); }
      if (a === "agenda") { const r = quill.getSelection(true); quill.history.cutoff(); quill.clipboard.dangerouslyPasteHTML(r?.index ?? quill.getLength(), "<h3>Agenda</h3><ol><li>Welcome</li><li>…</li><li>Questions</li></ol>", "user"); quill.history.cutoff(); return; }
      if (a === "drive") {
        const pk = picker("Add a Google Drive file", `<input type="search" placeholder="Search your Drive" aria-label="Search your Drive"><ul><li><small>Type to search.</small></li></ul>`);
        const inp = $("input", pk.el), ul = $("ul", pk.el); let t = 0;
        inp.oninput = () => { clearTimeout(t); t = setTimeout(async () => { try { const r = await api(`/mail/attach/search?q=${encodeURIComponent(inp.value.trim())}`); const items = r.items.filter((x) => x.source === "drive"); ul.innerHTML = items.map((x, i) => `<li><button type="button" data-i="${i}">☁ ${esc(x.name)} <small>${esc(x.detail)}</small></button></li>`).join("") || `<li><small>Nothing in Drive matches.</small></li>`;
          for (const bb of $$("[data-i]", ul)) bb.onclick = async () => { try { const r2 = await api(`/mail/invite/${ed.id}/attach`, { ref: items[Number(bb.dataset.i)].ref }); ed.v = { ...ed.v, ...r2 }; paintFiles(); pk.close(); } catch (e) { note(e.message); } }; } catch (e) { ul.innerHTML = `<li><small>${esc(e.message)}</small></li>`; } }, 300); };
        inp.focus();
      }
    };
    el.addEventListener("keydown", (e) => { if (e.key === "Escape" && !document.querySelector(".mailconfirm, .mailpick")) { $("[data-w=min]", el).click(); e.stopPropagation(); } });
    windowButtons(ed); draggable(ed); place(ed);
    f("title").focus();
    return ed;
  }

  // ---- dictation: Dayspring's own listening (tv.js) hands every phrase here while it's on ----
  const dict = {
    ed: null, mode: "words", active: false, buf: "",
    start(ed, mode = "words") {
      if (!ed || ed.kind !== "email") return;
      if (window.dsIsStopped?.() || (window.dsListenState && window.dsListenState !== "active")) { note("Listening is off. Turn it on (🎤 on the talk bar), then press 🎙 again."); return; }
      if (dict.active && dict.ed !== ed) dict.cancel();
      Object.assign(dict, { ed, mode: mode === "organize" ? "organize" : "words", active: true, buf: "" });
      const bar = $(".mc-dict", ed.el); bar.hidden = false;
      $(".mode", bar).textContent = dict.mode === "organize" ? "🧠 Listening: say everything you want in it, in any order" : "🎙 Dictating word for word";
      $(".heard", bar).textContent = "Say “stop dictating” when you're done.";
      $(".ql-dictate", ed.el)?.setAttribute("aria-pressed", "true");
      if (!ed.quill.getSelection()) ed.quill.setSelection(Math.max(0, firstLineEnd(ed.quill)), 0, "silent");
    },
    take(text) {
      if (!dict.active || !dict.ed?.el.isConnected) { dict.active = false; return false; }
      const ed = dict.ed, q = ed.quill;
      if (dict.mode === "organize") {
        const r = C.dictateText(text, { capFirst: false });
        const raw = String(text).replace(/\s*\b((ok(ay)? )?(stop|end|finish) (dictating|dictation)|that'?s all|that is all|i'?m done|i am done|done dictating)\b[.!]*\s*$/i, "");
        dict.buf = (dict.buf + " " + raw).trim();
        $(".heard", ed.el).textContent = "“…" + dict.buf.slice(-120) + "”";
        if (r.stop) dict.finish();
        return true;
      }
      const sel = q.getSelection(true), before = q.getText(Math.max(0, sel.index - 2), Math.min(2, sel.index));
      const r = C.dictateText(text, { capFirst: !before.trim() || /[.!?]\s*$|\n$/.test(before) });
      if (r.text) {
        const lead = before && !/[\s\n]$/.test(before) && !/^[,.?!;:)\n]/.test(r.text) ? " " : "";
        q.insertText(sel.index, lead + r.text, "user");
        q.setSelection(sel.index + lead.length + r.text.length, 0, "user");
        $(".heard", ed.el).textContent = "“" + r.text.slice(-120) + "”";
      }
      if (r.stop) dict.finish();
      return true;
    },
    interim(text) { if (dict.active && dict.ed) $(".heard", dict.ed.el).textContent = "… " + String(text).slice(-120); },
    async finish() {
      const ed = dict.ed; if (!ed) return;
      const mode = dict.mode, text = dict.buf;
      dict.stop();
      if (mode !== "organize" || !text.trim()) return;
      const st = $(".st", ed.el); st.textContent = info.ai ? "Writing it up…" : "Writing down what you said…";
      try {
        const to = C.parseList(ed.to.get())[0];
        const r = await api("/mail/organize", { text, tone: info.prefs.tone, to: to?.name || to?.address || "", subject: ed.c.subject || "" });
        const q = ed.quill;
        q.history.cutoff();
        if (!$("[data-f=subject]", ed.el).value && r.subject) { $("[data-f=subject]", ed.el).value = r.subject; ed.c.subject = r.subject; $(".t", ed.el).textContent = ed.title(); }
        q.clipboard.dangerouslyPasteHTML(0, r.html, "user");
        q.history.cutoff();
        aiBar(ed, r.how === "ai" ? "Wrote it up from what you said. Look it over." : "Wrote down what you said (no AI key, so it's as you said it).", () => q.history.undo());
        st.textContent = "";
        ed.push();
      } catch (e) { st.textContent = e.message; }
    },
    stop() { const ed = dict.ed; dict.active = false; dict.ed = null; if (ed?.el.isConnected) { $(".mc-dict", ed.el).hidden = true; $(".ql-dictate", ed.el)?.setAttribute("aria-pressed", "false"); } },
    cancel() { dict.buf = ""; dict.stop(); },
  };
  const firstLineEnd = (q) => { const t = q.getText(); const i = t.indexOf("\n"); return i < 0 ? t.length : i; };
  window.dsDictation = { get active() { return dict.active && Boolean(dict.ed?.el.isConnected); }, get mode() { return dict.mode; }, take: (t) => dict.take(t), interim: (t) => dict.interim(t), stop: () => dict.finish(), _dict: dict };

  // ---- what the server says: the AI wrote or changed something, a send went out or came back ----
  const newest = (kind) => [...eds.values()].filter((e) => e.kind === kind).sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0] ?? [...eds.values()].filter((e) => e.kind === kind).at(-1) ?? null;
  async function onEvent(d) {
    switch (d.kind) {
      case "compose": await refresh(); openEmail(d.compose, { dictate: d.dictate ?? null }); break;
      case "edit": {
        let ed = eds.get(d.compose.id);
        if (!ed) { await refresh(); ed = openEmail(d.compose); aiBar(ed, `Dayspring wrote this${d.note ? `: ${d.note}` : "."}`, () => {}); break; }
        restore(ed);
        const c = d.compose, before = { ...ed.fields() };
        if (c.to !== undefined) ed.to.set(c.to); if (c.cc !== undefined) { ed.cc.set(c.cc); if (c.cc) $$("[data-row=cc]", ed.el).forEach((x) => (x.hidden = false)); } if (c.bcc !== undefined) { ed.bcc.set(c.bcc); if (c.bcc) $$("[data-row=bcc]", ed.el).forEach((x) => (x.hidden = false)); }
        $("[data-f=subject]", ed.el).value = c.subject ?? ""; ed.c.subject = c.subject; $(".t", ed.el).textContent = ed.title();
        if (c.account) { $("[data-f=account]", ed.el).value = c.account; ed.c.account = c.account; }
        ed.atts = c.attachments ?? ed.atts; ed.paintAtts();
        const bodyChanged = C.editorHtml(c.html) !== C.editorHtml(before.html);
        if (bodyChanged) { ed.quill.history.cutoff(); setHtml(ed.quill, c.html, "api"); ed.quill.history.cutoff(); }
        ed.rev = c.rev;
        aiBar(ed, `Dayspring changed it${d.note ? `: ${d.note}` : "."}`, async () => {
          if (bodyChanged) ed.quill.history.undo();
          ed.to.set(before.to); ed.cc.set(before.cc); ed.bcc.set(before.bcc); $("[data-f=subject]", ed.el).value = before.subject; ed.c.subject = before.subject; $(".t", ed.el).textContent = ed.title();
          ed.atts = ed.atts.filter((a) => before.attachments.includes(a.id)); ed.paintAtts();
          await ed.push();
        });
        break;
      }
      case "invite": await refresh(); openInvite(d.invite); break;
      case "invite-edit": {
        const ed = eds.get(d.invite.id); if (!ed) { await refresh(); openInvite(d.invite); break; }
        restore(ed); const v = d.invite, f = (k) => $(`[data-i=${k}]`, ed.el);
        f("title").value = v.title; f("date").value = v.date; f("start").value = v.start; f("minutes").value = String(v.minutes); f("meet").checked = v.meet; f("provider").value = v.provider; f("location").value = v.location ?? "";
        ed.guests.set(v.invitees.join(", ")); ed.v = { ...ed.v, ...v };
        ed.quill.history.cutoff(); setHtml(ed.quill, v.html, "api"); ed.quill.history.cutoff();
        aiBar(ed, `Dayspring changed it${d.note ? `: ${d.note}` : "."}`, () => ed.quill.history.undo());
        $(".mc-atts", ed.el) && (ed.v.attachments = v.attachments);
        break;
      }
      case "invite-created": { const ed = eds.get(d.inviteId); if (ed) destroy(ed); note(d.meet ? `Invitations are on their way. Meeting link: ${d.meet}` : "The invitation is on your calendar and on its way."); break; }
      case "invite-closed": { const ed = eds.get(d.inviteId); if (ed) destroy(ed); break; }
      case "sending": { const ed = eds.get(d.composeId); if (ed && !ed.sending) { ed.sending = d.oid; ed.el.hidden = true; paintTabs(); sendingToast(ed, { oid: d.oid, sendAt: d.sendAt }); } else if (!ed && d.undoMs) sendingToast({}, { oid: d.oid, sendAt: d.sendAt }); break; }
      case "sent": { const ed = eds.get(d.composeId); if (ed) destroy(ed); note(`Sent ✓ “${d.subject || "no subject"}”`); break; }
      case "undone": { const ed = eds.get(d.composeId); if (ed) { ed.sending = null; ed.min = false; ed.el.hidden = false; paintTabs(); place(ed, { keep: true }); } else if (d.compose) { await refresh(); openEmail(d.compose); } note("Not sent. It's back in the editor."); break; }
      case "failed": { const ed = eds.get(d.composeId); if (ed) { ed.sending = null; ed.el.hidden = false; paintTabs(); } else if (d.compose) { await refresh(); openEmail(d.compose); } note(`It wasn't sent: ${d.error}`, { ms: 15000 }); break; }
      case "closed": { const ed = eds.get(d.composeId); if (ed) destroy(ed); break; }
      case "dictate": { const ed = dict.ed ?? newest("email"); if (d.mode === "off") dict.finish(); else if (ed) { restore(ed); dict.start(ed, d.mode); } break; }
      case "boxes": refresh(); break;
    }
  }
  async function newEmail({ account = null, to = "", subject = "", html = null, dictate = null } = {}) {
    await refresh();
    if (!info.boxes.length) { note("Add a mailbox in Settings → Email first."); return null; }
    try { const c = await api("/mail/compose", { account, to, subject, html }); return openEmail(c, { dictate }); } catch (e) { note(e.message); return null; }
  }
  async function newInvite(fields = {}) {
    await refresh();
    try { const v = await api("/mail/invite", fields); return openInvite(v); } catch (e) { note(e.message); return null; }
  }
  async function open(c, opts) { await refresh(); return openEmail(c, opts); }
  window.dsMailCompose = { open, openInvite: async (v) => { await refresh(); return openInvite(v); }, newEmail, newInvite, onEvent, editors: eds, dictation: dict };
  refresh();
})();
