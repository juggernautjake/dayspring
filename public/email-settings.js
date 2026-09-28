// Settings → Email (public/setup.js shows it under "Apps & connections", the "email" release feature):
//   · Your mailboxes: Gmail and Outlook (their own sign-in), Yahoo, iCloud, AOL and any other (IMAP + SMTP with the servers
//     filled in); for each: nickname, colour, primary, "Let Dayspring send email from this account", organizing (Gmail),
//     new-mail notices, Test connection, Remove. The app password is typed here by the owner, sent once, saved encrypted
//     with Windows (DPAPI) and never shown again.
//   · Signatures: a rich editor per mailbox, several per mailbox, which one is the default, and whether replies get one
//   · Composing, Reading, Privacy (what the AI may see; clear the mail cache) and Voice (reading emails aloud)
// Mailbox changes save straight away; the rest saves with the section (Save, or moving to another section).
(() => {
  const C = window.dsMailCore;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (path, body) => {
    const r = await fetch("/api" + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || (j.error && !j.ok && !j.account)) { const e = new Error(j.error || "That didn't work. Try again."); e.data = j; throw e; }
    return j;
  };
  // email isn't in this release channel: the section is hidden (its routes answer 404)
  const enabled = (() => { try { const x = new XMLHttpRequest(); x.open("GET", "/api/mail/status", false); x.send(); return x.status !== 404; } catch { return true; } })();
  let root = null, ctx = {}, S = null, sigQuill = null, sigState = { key: null, idx: 0 }, sigDirty = false;
  const $ = (s) => root?.querySelector(s);
  const $$ = (s) => [...(root?.querySelectorAll(s) ?? [])];
  const sw = (id, on, label) => `<button type="button" class="sw" role="switch" id="${id}" aria-checked="${Boolean(on)}"${label ? ` aria-label="${esc(label)}"` : ""}></button>`;
  const toggle = (id, title, desc, on) => `<div class="toggle"><div class="txt"><b id="${id}-l">${title}</b><div>${desc}</div></div>${sw(id, on).replace('role="switch"', `role="switch" aria-labelledby="${id}-l"`)}</div>`;
  const isOn = (id) => $("#" + id)?.getAttribute("aria-checked") === "true";
  const say = (id, t, k = "") => { const m = $("#" + id); if (m) { m.className = "msg " + k; m.textContent = t; } };
  const LANGS = [["en-US", "English (US)"], ["en-GB", "English (UK)"], ["es-ES", "Español"], ["fr-FR", "Français"], ["de-DE", "Deutsch"], ["pt-BR", "Português (Brasil)"], ["it-IT", "Italiano"], ["nl-NL", "Nederlands"]];
  const TONES = [["friendly", "Friendly"], ["professional", "Professional"], ["formal", "Formal"], ["warm", "Warm"], ["brief", "Brief"], ["casual", "Casual"]];

  function html() {
    return `<h1>Email</h1>
      <p class="lead">Read, search and write email from every mailbox you have, on the Dayspring screen (✉ on the talk bar) or by voice: “read my new emails”, “write an email to Sam…”. An email is sent only when you press Send, or say yes after Dayspring reads back who it's to and the subject, and only from a mailbox where you turn sending on below.</p>
      <h2>Your mailboxes</h2>
      <div id="emBoxes" class="list" aria-live="polite"><p class="hint">Loading…</p></div>
      <div class="msg" id="emBoxMsg" role="status"></div>
      <h3>Add a mailbox</h3>
      <div class="row" style="gap:.5em;flex-wrap:wrap" id="emAdd">
        <button type="button" class="btn small" data-add="gmail">Gmail</button><button type="button" class="btn small" data-add="outlook">Outlook / Hotmail</button>
        <button type="button" class="btn small" data-add="yahoo">Yahoo</button><button type="button" class="btn small" data-add="icloud">iCloud</button><button type="button" class="btn small" data-add="aol">AOL</button>
        <button type="button" class="btn small" data-add="other">Another provider…</button>
      </div>
      <form id="emForm" hidden novalidate class="note" style="margin-top:.8em">
        <div class="row">
          <div class="field"><label for="emPreset">Provider</label><select id="emPreset"></select></div>
          <div class="field"><label for="emEmail">Email address</label><input id="emEmail" type="email" autocomplete="off" spellcheck="false" placeholder="name@example.com"></div>
        </div>
        <p class="hint" id="emHow"></p>
        <div class="row">
          <div class="field"><label for="emPass">App password</label><div class="secret-row" style="display:flex;gap:.4em"><input id="emPass" type="password" autocomplete="new-password" spellcheck="false" placeholder="abcd efgh ijkl mnop" style="flex:1"><button type="button" class="btn small ghost" id="emShow" aria-pressed="false">Show</button></div><div class="hint">Typed here by you, saved encrypted with your Windows account, never shown again.</div></div>
          <div class="field"><label for="emNick">Nickname (optional)</label><input id="emNick" type="text" maxlength="40" placeholder="Personal"></div>
        </div>
        <details id="emAdv"><summary>Servers (filled in for the providers above)</summary>
          <div class="row"><div class="field"><label for="emImapHost">IMAP server (reading)</label><input id="emImapHost" type="text" spellcheck="false"></div><div class="field"><label for="emImapPort">IMAP port</label><input id="emImapPort" type="number" min="1" max="65535"></div></div>
          <div class="row"><div class="field"><label for="emSmtpHost">SMTP server (sending)</label><input id="emSmtpHost" type="text" spellcheck="false"></div><div class="field"><label for="emSmtpPort">SMTP port</label><input id="emSmtpPort" type="number" min="1" max="65535"></div></div>
          <p class="hint">Encrypted connections only: SSL/TLS (993, 465) or STARTTLS (143, 587).</p>
        </details>
        ${toggle("emCanSend", "Let Dayspring send email from this mailbox", "Only when you press Send, or say yes after it reads back who it's to and the subject.", false)}
        <div class="row" style="gap:.5em;margin-top:.6em"><button type="button" class="btn" id="emTest">Test connection</button><button type="button" class="btn primary" id="emSave">Add mailbox</button><button type="button" class="btn ghost" id="emCancel">Cancel</button></div>
        <div class="msg" id="emAddMsg" role="status" aria-live="polite"></div>
      </form>

      <h2>Signatures</h2>
      <div class="row"><div class="field"><label for="emSigBox">Mailbox</label><select id="emSigBox"></select></div><div class="field"><label for="emSigPick">Signature</label><div style="display:flex;gap:.4em"><select id="emSigPick" style="flex:1"></select><button type="button" class="btn small" id="emSigAdd">+ New</button><button type="button" class="btn small ghost danger" id="emSigDel">Delete</button></div></div></div>
      <div class="row"><div class="field"><label for="emSigName">Name</label><input id="emSigName" type="text" maxlength="40" placeholder="Work"></div><div class="field"><label for="emSigDefault">Default for new emails</label><select id="emSigDefault"></select></div></div>
      <div id="emSigTb"></div><div id="emSigEd" style="background:#fff;color:#111;border-radius:0 0 .6em .6em;min-height:7em"></div>
      ${toggle("emSigReply", "Add the signature to replies and forwards too", "Off: only new emails get it.", true)}

      <h2>Composing</h2>
      <div class="row">
        <div class="field"><label for="emFont">Default font</label><select id="emFont">${C.FONTS.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}</select></div>
        <div class="field"><label for="emSize">Default size</label><select id="emSize">${["10px", "12px", "13px", "14px", "16px", "18px", "20px", "24px"].map((v) => `<option value="${v}">${v.replace("px", "")}</option>`).join("")}</select></div>
      </div>
      <div class="row">
        <div class="field"><label for="emReply">When you reply</label><select id="emReply"><option value="above">Write above the quoted email (usual)</option><option value="below">Write below the quoted email</option></select></div>
        <div class="field"><label for="emTone">Default tone when the AI writes or polishes</label><select id="emTone">${TONES.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></div>
      </div>
      <div class="row">
        <div class="field"><label for="emUndo">Undo send: wait before sending</label><div style="display:flex;gap:.6em;align-items:center"><input id="emUndo" type="range" min="0" max="30" step="1" style="flex:1"><output id="emUndoV" for="emUndo"></output></div><div class="hint">0 sends straight away. Say “undo send” or press Undo while it waits.</div></div>
        <div class="field"><label for="emAuto">Auto-save drafts every (seconds)</label><input id="emAuto" type="number" min="2" max="120"></div>
      </div>
      <div class="field"><label for="emLang">Spell check language</label><select id="emLang">${LANGS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select><div class="hint">The browser's own spell check marks misspelled words as you type.</div></div>

      <h2>Reading</h2>
      <div class="field"><label for="emImages">Pictures from the internet in emails</label><select id="emImages"><option value="ask">Hold them back; show when I ask (recommended)</option><option value="known">Show them from people I've written to</option><option value="never">Always hold them back</option></select><div class="hint">Pictures from the internet can tell the sender you opened their email. Pictures sent inside the email always show.</div></div>
      ${toggle("emMarkRead", "Mark an email read when I open it", "Off: it stays unread until you mark it.", true)}
      ${toggle("emConv", "Conversation view", "Show the other emails in the same conversation above the one you're reading.", true)}
      <div class="field"><label for="emPreview">Preview lines in the list</label><select id="emPreview"><option value="0">None</option><option value="1">1 line</option><option value="2">2 lines</option><option value="3">3 lines</option></select></div>
      ${toggle("emNotify", "Tell me about new email", "A note on the screen, and out loud when Dayspring is active (never in Quiet or Off). Choose which mailboxes above.", true)}

      <h2>Privacy</h2>
      <div class="field"><span class="lbl" id="emAi-l">What the AI may see of your email</span>
        <div role="radiogroup" aria-labelledby="emAi-l" id="emAi" style="display:grid;gap:.4em;margin-top:.3em">
          <label class="toggle" style="margin:0"><input type="radio" name="emAi" value="full"> <span class="txt"><b>Whole emails, when I ask about them</b><div>Needed for “summarise this email”, “reply saying…” and writing help. Nothing is sent to the AI unless you ask something that needs it.</div></span></label>
          <label class="toggle" style="margin:0"><input type="radio" name="emAi" value="headers"> <span class="txt"><b>Only who, what and when</b><div>The AI sees senders, subjects and dates, never what the emails say.</div></span></label>
          <label class="toggle" style="margin:0"><input type="radio" name="emAi" value="none"> <span class="txt"><b>Nothing</b><div>The AI can't read or write email; you use the Mail window yourself. Voice commands without AI still work.</div></span></label>
        </div></div>
      <p class="hint">Emails are never written to the activity log (only who a sent email went to and its subject), and never included when Dayspring is exported.</p>
      <div class="row" style="gap:.5em"><button type="button" class="btn" id="emClear">Clear the mail cache</button></div>
      <div class="msg" id="emClearMsg" role="status"></div>

      <h2>Voice</h2>
      ${toggle("emAloud", "Read emails aloud", "“Read the one from the bank” reads it out. Off: it's shown on the screen instead.", true)}
      <div class="field"><label for="emRate">Reading speed</label><div style="display:flex;gap:.6em;align-items:center"><input id="emRate" type="range" min="0.6" max="1.6" step="0.1" style="flex:1"><output id="emRateV" for="emRate"></output></div></div>
      <div class="msg" id="m"></div>`;
  }

  // ---- mailboxes ----
  const KIND = { gmail: "Gmail", outlook: "Outlook", imap: "Email" };
  function paintBoxes() {
    const box = $("#emBoxes"); if (!box) return;
    if (!S.boxes.length) { box.innerHTML = `<p class="hint">No mailbox yet. Add one below: Gmail, Outlook, Yahoo, iCloud, AOL or any other.</p>`; return; }
    box.innerHTML = S.boxes.map((b) => `<div class="item embox" role="group" aria-label="${esc(b.label)}" data-key="${esc(b.key)}"><div class="grow">
      <div class="t"><span aria-hidden="true" style="display:inline-block;width:.8em;height:.8em;border-radius:50%;background:${esc(b.color ?? "#7c8cff")};margin-right:.4em"></span>${esc(b.label)}${b.label !== b.email ? ` <span class="hint">${esc(b.email)}</span>` : ""} ${b.primary ? `<span class="pill on"><i aria-hidden="true"></i>Primary</span>` : ""}</div>
      <div class="s">${esc(b.provider ?? KIND[b.kind])}${b.canSend ? " · can send" : " · sending off"}${b.kind === "gmail" && !b.canOrganize ? " · organizing off" : ""}${b.needsSignIn?.length ? " · sign-in needed" : ""}</div>
      <div style="display:flex;flex-wrap:wrap;gap:.4em 1.2em;margin:.45em 0;align-items:center">
        <label><input type="checkbox" data-b="canSend" ${b.canSend || b.sendOn ? "checked" : ""}> Let Dayspring send email from this mailbox${b.sendOn && !b.canSend ? " (sign-in needed)" : ""}</label>
        ${b.kind === "gmail" ? `<label><input type="checkbox" data-b="canOrganize" ${b.canOrganize || b.organizeOn ? "checked" : ""}> Let Dayspring mark, star, archive and move to Trash</label>` : ""}
        <label><input type="checkbox" data-b="notify" ${b.notify !== false ? "checked" : ""}> New-mail notices</label>
      </div>
      <div style="display:flex;gap:.4em;flex-wrap:wrap;align-items:center"><input type="text" data-b="nickname" value="${esc(b.nickname ?? "")}" placeholder="Nickname (Work, Personal)" maxlength="40" aria-label="Nickname for ${esc(b.email)}" style="flex:1 1 10em">
        <select data-b="color" aria-label="Colour for ${esc(b.email)}">${S.colors.map((c) => `<option value="${c}" ${c === b.color ? "selected" : ""} style="background:${c}">● ${c}</option>`).join("")}</select>
        <button type="button" class="btn small ghost" data-a="save">Save name and colour</button></div>
      <div class="msg" data-msg role="status"></div>
      </div><div class="app-acts" style="display:flex;flex-direction:column;gap:.3em">
        ${b.primary ? "" : `<button type="button" class="btn small ghost" data-a="primary">Make primary</button>`}
        <button type="button" class="btn small" data-a="test">Test connection</button>
        ${b.kind === "imap" ? `<button type="button" class="btn small ghost" data-a="password">New password…</button>` : ""}
        <button type="button" class="btn small ghost danger" data-a="remove">Remove</button></div></div>`).join("");
    for (const row of $$(".embox")) {
      const key = row.dataset.key, b = S.boxes.find((x) => x.key === key), msg = (t, k = "") => { const m = row.querySelector("[data-msg]"); m.className = "msg " + k; m.textContent = t; };
      const upd = async (patch, done) => {
        msg("Saving…");
        try { const r = await api("/mail/box", { key, ...patch }); if (r.needsSignIn) { msg(`${key.startsWith("g:") ? "Google" : "Microsoft"} needs your OK for ${r.what?.join(" and ") || "that"}. The sign-in opened in your browser; this updates by itself.`, "ok"); poll(); } else { msg(done, "ok"); await load(); } }
        catch (e) { msg(e.message, "bad"); }
      };
      for (const cb of row.querySelectorAll("input[type=checkbox][data-b]")) cb.onchange = () => upd({ [cb.dataset.b]: cb.checked }, cb.checked ? "Turned on ✓" : "Turned off ✓");
      row.querySelector("[data-a=save]").onclick = () => upd({ nickname: row.querySelector("[data-b=nickname]").value, color: row.querySelector("[data-b=color]").value }, "Saved ✓");
      const pr = row.querySelector("[data-a=primary]"); if (pr) pr.onclick = () => upd({ primary: true }, "Primary mailbox changed ✓");
      row.querySelector("[data-a=test]").onclick = async (e) => {
        e.target.disabled = true; msg("Testing…");
        try {
          if (b.kind === "imap") { const r = await api("/mail/accounts/test", { id: key.slice(2) }); msg(`${r.imap.ok ? "✓ Reading (IMAP) works" : "✗ Reading: " + r.imap.error} · ${r.smtp.ok ? "✓ Sending (SMTP) works" : "✗ Sending: " + r.smtp.error}`, r.imap.ok && r.smtp.ok ? "ok" : "bad"); }
          else { const r = await api(`/mail/folders?account=${encodeURIComponent(key)}`); msg(`✓ Connected: ${r.folders.length} folders.`, "ok"); }
        } catch (err) { msg("✗ " + err.message, "bad"); }
        e.target.disabled = false;
      };
      const pw = row.querySelector("[data-a=password]");
      if (pw) pw.onclick = async () => { const p = prompt(`New app password for ${b.email} (it's saved encrypted and never shown):`); if (!p) return; try { await api("/mail/accounts/update", { id: key.slice(2), password: p }); const r = await api("/mail/accounts/test", { id: key.slice(2) }); msg(r.imap.ok ? "✓ New password works." : "✗ " + r.imap.error, r.imap.ok ? "ok" : "bad"); } catch (e) { msg(e.message, "bad"); } };
      const rm = row.querySelector("[data-a=remove]");
      rm.onclick = async () => {
        if (!rm.dataset.sure) { rm.dataset.sure = "1"; rm.textContent = b.kind === "imap" ? "Yes, remove" : b.kind === "gmail" ? "Yes, remove this Google account (Calendar and Drive too)" : "Yes, disconnect Outlook (its calendar too)"; setTimeout(() => { if (rm.isConnected) { delete rm.dataset.sure; rm.textContent = "Remove"; } }, 5000); return; }
        rm.disabled = true;
        try {
          if (b.kind === "imap") await api("/mail/accounts/remove", { id: key });
          else if (b.kind === "gmail") await api("/connect/google/account", { action: "remove", id: key.slice(2) });
          else await api("/connect/microsoft/disconnect", {});
          say("emBoxMsg", `Removed ${b.email} ✓`, "ok"); await load();
        } catch (e) { msg(e.message, "bad"); rm.disabled = false; }
      };
    }
  }
  let pollT = null;
  function poll() { clearInterval(pollT); const until = Date.now() + 180_000; pollT = setInterval(async () => { if (!root?.isConnected || Date.now() > until) return clearInterval(pollT); const before = JSON.stringify(S.boxes.map((b) => [b.key, b.canSend, b.canOrganize])); await load(); if (JSON.stringify(S.boxes.map((b) => [b.key, b.canSend, b.canOrganize])) !== before) { clearInterval(pollT); ctx.toast?.("Email: updated ✓"); } }, 3000); }

  // ---- adding ----
  function fillPreset(id) {
    const p = S.presets.find((x) => x.id === id) ?? S.presets.find((x) => x.id === "other");
    $("#emPreset").value = p.id;
    $("#emHow").innerHTML = `${esc(p.how)}${p.link ? ` <a href="${esc(p.link)}" target="_blank" rel="noopener" data-link="${esc(p.link)}">Open it ↗</a>` : ""}`;
    const l = $("#emHow a"); if (l) l.onclick = (e) => { e.preventDefault(); ctx.openLink?.(l.dataset.link); };
    $("#emImapHost").value = p.imap.host; $("#emImapPort").value = p.imap.port; $("#emSmtpHost").value = p.smtp.host; $("#emSmtpPort").value = p.smtp.port;
    $("#emAdv").open = p.id === "other";
  }
  function formBody() {
    return { preset: $("#emPreset").value, email: $("#emEmail").value.trim(), password: $("#emPass").value, nickname: $("#emNick").value.trim(),
      imapHost: $("#emImapHost").value.trim(), imapPort: Number($("#emImapPort").value) || undefined, smtpHost: $("#emSmtpHost").value.trim(), smtpPort: Number($("#emSmtpPort").value) || undefined, canSend: isOn("emCanSend") };
  }
  async function addStart(kind) {
    say("emAddMsg", ""); say("emBoxMsg", "");
    if (kind === "gmail") {
      if (!S.google?.configured) { say("emBoxMsg", "Gmail uses your Google sign-in. Set up Google once in Apps & connections → Google (about 10 minutes), then come back.", ""); return ctx.openLink ? (location.href = "/settings?s=apps&app=google" + (new URLSearchParams(location.search).get("embed") ? "&embed=1" : "")) : null; }
      if (S.google.gmailOff?.length) { const a = S.google.gmailOff[0]; await api("/connect/google/account", { action: "update", id: a.id, services: { gmail: true } }).catch(() => null); say("emBoxMsg", `Turning on Gmail for ${a.email}: approve it in your browser.`, "ok"); return poll(); }
      await api("/connect/google/account", { action: "add", services: { calendar: true, gmail: true, drive: true } }); say("emBoxMsg", "The Google sign-in opened in your browser. Pick the account; this updates by itself.", "ok"); return poll();
    }
    if (kind === "outlook") {
      if (S.microsoft?.connected) { say("emBoxMsg", "Outlook is already connected (see above)."); return; }
      if (!S.microsoft?.configured) { say("emBoxMsg", "Outlook uses your Microsoft sign-in. Set it up once in Apps & connections → Outlook + Microsoft To Do, then come back."); location.href = "/settings?s=apps&app=microsoft" + (new URLSearchParams(location.search).get("embed") ? "&embed=1" : ""); return; }
      await api("/connect/microsoft/start", {}); say("emBoxMsg", "The Microsoft sign-in opened in your browser; this updates by itself.", "ok"); return poll();
    }
    $("#emForm").hidden = false; fillPreset(kind); $("#emEmail").focus();
  }

  // ---- signatures (one rich editor, for the one being edited) ----
  function sigBoxes() { return S.boxes; }
  function paintSigs() {
    const sel = $("#emSigBox");
    if (!S.boxes.length) { sel.innerHTML = `<option value="">(add a mailbox first)</option>`; $("#emSigPick").innerHTML = ""; $("#emSigDefault").innerHTML = ""; if (sigQuill) sigQuill.enable(false); return; }
    sel.innerHTML = sigBoxes().map((b) => `<option value="${esc(b.key)}">${esc(b.label)}</option>`).join("");
    if (!S.boxes.some((b) => b.key === sigState.key)) sigState = { key: S.boxes[0].key, idx: 0 };
    sel.value = sigState.key;
    const b = S.boxes.find((x) => x.key === sigState.key);
    const sigs = b.signatures ?? [];
    $("#emSigPick").innerHTML = sigs.length ? sigs.map((s, i) => `<option value="${i}">${esc(s.name)}</option>`).join("") : `<option value="">(none yet)</option>`;
    $("#emSigDefault").innerHTML = `<option value="">No signature</option>` + sigs.map((s) => `<option value="${esc(s.id)}" ${s.id === b.defaultSig ? "selected" : ""}>${esc(s.name)}</option>`).join("");
    $("#emSigReply").setAttribute("aria-checked", String(b.replySig !== false));
    sigState.idx = Math.min(sigState.idx, Math.max(0, sigs.length - 1));
    $("#emSigPick").value = sigs.length ? String(sigState.idx) : "";
    const s = sigs[sigState.idx];
    $("#emSigName").value = s?.name ?? ""; $("#emSigName").disabled = !s; $("#emSigDel").disabled = !s;
    if (sigQuill) { sigQuill.enable(Boolean(s)); sigQuill.setContents(sigQuill.clipboard.convert({ html: s?.html ?? "" }), "silent"); sigQuill.history.clear(); }
  }
  function keepSig() {
    const b = S.boxes.find((x) => x.key === sigState.key), s = b?.signatures?.[sigState.idx];
    if (s && sigQuill) { s.html = C.semanticHtml(sigQuill); s.name = $("#emSigName").value.trim() || s.name; }
    if (b) { b.defaultSig = $("#emSigDefault").value || null; b.replySig = isOn("emSigReply"); }
  }
  function mountSig() {
    const Q = C?.setupQuill?.(); if (!Q) { $("#emSigEd").innerHTML = `<p class="hint" style="padding:.6em">The editor didn't load. Reload to try again.</p>`; return; }
    $("#emSigTb").innerHTML = `<span class="ql-formats"><select class="ql-font">${C.FONTS.map(([v]) => `<option value="${esc(v)}"></option>`).join("")}</select><select class="ql-size">${C.SIZES.map(([v]) => `<option value="${v}"${v === "14px" ? " selected" : ""}></option>`).join("")}</select></span><span class="ql-formats"><button type="button" class="ql-bold" aria-label="Bold"></button><button type="button" class="ql-italic" aria-label="Italic"></button><button type="button" class="ql-underline" aria-label="Underline"></button></span><span class="ql-formats"><select class="ql-color" aria-label="Colour"></select><button type="button" class="ql-link" aria-label="Link"></button><button type="button" class="ql-image" aria-label="Picture"></button><button type="button" class="ql-clean" aria-label="Clear formatting"></button></span>`;
    $("#emSigTb").className = "ql-toolbar ql-snow"; $("#emSigTb").style.background = "#f4f5fb"; $("#emSigTb").style.borderRadius = ".6em .6em 0 0";
    sigQuill = new Q($("#emSigEd"), { theme: "snow", placeholder: "Your signature…", modules: { toolbar: $("#emSigTb") } });
    sigQuill.root.setAttribute("aria-label", "Signature"); sigQuill.root.setAttribute("spellcheck", "true");
    sigQuill.on("text-change", (d, o, src) => { if (src !== "silent") sigDirty = true; });
    $("#emSigBox").onchange = () => { keepSig(); sigState = { key: $("#emSigBox").value, idx: 0 }; paintSigs(); };
    $("#emSigPick").onchange = () => { keepSig(); sigState.idx = Number($("#emSigPick").value) || 0; paintSigs(); };
    $("#emSigName").oninput = () => { sigDirty = true; };
    $("#emSigDefault").onchange = () => { sigDirty = true; };
    $("#emSigReply").addEventListener("click", () => { sigDirty = true; });
    $("#emSigAdd").onclick = () => { keepSig(); const b = S.boxes.find((x) => x.key === sigState.key); if (!b) return; b.signatures = [...(b.signatures ?? []), { id: "s" + Date.now().toString(36), name: `Signature ${(b.signatures?.length ?? 0) + 1}`, html: "" }]; if (!b.defaultSig) b.defaultSig = b.signatures[0].id; sigState.idx = b.signatures.length - 1; sigDirty = true; paintSigs(); $("#emSigName").focus(); };
    $("#emSigDel").onclick = () => { const b = S.boxes.find((x) => x.key === sigState.key); if (!b?.signatures?.length) return; const gone = b.signatures.splice(sigState.idx, 1)[0]; if (b.defaultSig === gone.id) b.defaultSig = b.signatures[0]?.id ?? null; sigState.idx = 0; sigDirty = true; paintSigs(); };
    paintSigs();
  }

  // ---- the rest ----
  function fill() {
    const p = S.prefs;
    $("#emFont").value = p.font; $("#emSize").value = p.size; $("#emReply").value = p.replyStyle; $("#emTone").value = p.tone;
    $("#emUndo").value = p.undoSeconds; $("#emUndoV").textContent = p.undoSeconds + " s"; $("#emAuto").value = p.autosaveSeconds; $("#emLang").value = p.spellLang;
    $("#emImages").value = p.remoteImages; $("#emPreview").value = String(p.previewLines);
    $("#emMarkRead").setAttribute("aria-checked", String(p.markReadOnOpen)); $("#emConv").setAttribute("aria-checked", String(p.conversationView)); $("#emNotify").setAttribute("aria-checked", String(p.notifyNew)); $("#emAloud").setAttribute("aria-checked", String(p.readAloud));
    for (const r of $$("input[name=emAi]")) r.checked = r.value === p.aiAccess;
    $("#emRate").value = p.readRate; $("#emRateV").textContent = "×" + Number(p.readRate).toFixed(1);
  }
  async function load() {
    S = await api("/mail/settings");
    if (!root?.isConnected) return;
    $("#emPreset").innerHTML = S.presets.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
    paintBoxes();
    if (sigQuill) { keepSig(); } paintSigs();
  }
  async function mount(el, c = {}) {
    root = el; ctx = c; sigQuill = null; sigDirty = false;
    try { S = await api("/mail/settings"); } catch (e) { $("#emBoxes").innerHTML = `<div class="note warn">${esc(e.message)}</div>`; return; }
    if (!root.isConnected) return;
    $("#emPreset").innerHTML = S.presets.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
    paintBoxes(); fill(); mountSig();
    for (const b of $$("[data-add]")) b.onclick = () => addStart(b.dataset.add).catch((e) => say("emBoxMsg", e.message, "bad"));
    $("#emPreset").onchange = () => fillPreset($("#emPreset").value);
    $("#emEmail").onchange = () => { const d = $("#emEmail").value.split("@")[1]?.toLowerCase(); const p = S.presets.find((x) => x.domains.includes(d)); if (p) fillPreset(p.id); };
    $("#emShow").onclick = () => { const i = $("#emPass"), show = i.type === "password"; i.type = show ? "text" : "password"; $("#emShow").textContent = show ? "Hide" : "Show"; $("#emShow").setAttribute("aria-pressed", String(show)); };
    $("#emCancel").onclick = () => { $("#emForm").hidden = true; $("#emPass").value = ""; };
    $("#emTest").onclick = async () => {
      const b = formBody(); if (!b.email || !b.password) return say("emAddMsg", "Type the email address and the app password first.", "bad");
      $("#emTest").disabled = true; say("emAddMsg", "Testing… (logging in to read and to send)");
      try { const r = await api("/mail/accounts/test", b); say("emAddMsg", `${r.imap.ok ? "✓ Reading (IMAP) works" : "✗ Reading: " + r.imap.error} · ${r.smtp.ok ? "✓ Sending (SMTP) works" : "✗ Sending: " + r.smtp.error}`, r.imap.ok ? "ok" : "bad"); }
      catch (e) { say("emAddMsg", e.message, "bad"); }
      $("#emTest").disabled = false;
    };
    $("#emSave").onclick = async () => {
      const b = formBody(); if (!b.email || !b.password) return say("emAddMsg", "Type the email address and the app password first.", "bad");
      $("#emSave").disabled = true; say("emAddMsg", "Testing and adding…");
      try {
        const r = await api("/mail/accounts/add", b);
        $("#emPass").value = ""; $("#emForm").hidden = true;
        say("emBoxMsg", `Added ${r.account.email} ✓${r.test.smtp.ok ? "" : ` (sending didn't work yet: ${r.test.smtp.error})`}`, r.test.smtp.ok ? "ok" : "");
        await load();
      } catch (e) { say("emAddMsg", e.message, "bad"); }
      $("#emSave").disabled = false;
    };
    $("#emForm").addEventListener("submit", (e) => { e.preventDefault(); $("#emSave").click(); });
    $("#emUndo").oninput = () => { $("#emUndoV").textContent = $("#emUndo").value + " s"; };
    $("#emRate").oninput = () => { $("#emRateV").textContent = "×" + Number($("#emRate").value).toFixed(1); };
    $("#emClear").onclick = async () => { const b = $("#emClear"); if (!b.dataset.sure) { b.dataset.sure = "1"; b.textContent = "Yes, clear it (cached emails and the list of people you've emailed)"; return; } try { await api("/mail/cache/clear", {}); say("emClearMsg", "Cleared ✓", "ok"); } catch (e) { say("emClearMsg", e.message, "bad"); } delete b.dataset.sure; b.textContent = "Clear the mail cache"; };
    ctx.onLeave?.(() => clearInterval(pollT));
  }
  async function save() {
    if (!S) return;
    const prefs = { font: $("#emFont").value, size: $("#emSize").value, replyStyle: $("#emReply").value, tone: $("#emTone").value, undoSeconds: Number($("#emUndo").value), autosaveSeconds: Number($("#emAuto").value),
      spellLang: $("#emLang").value, remoteImages: $("#emImages").value, previewLines: Number($("#emPreview").value), markReadOnOpen: isOn("emMarkRead"), conversationView: isOn("emConv"), notifyNew: isOn("emNotify"),
      aiAccess: $$("input[name=emAi]").find((r) => r.checked)?.value ?? "full", readAloud: isOn("emAloud"), readRate: Number($("#emRate").value) };
    const r = await api("/mail/settings", { prefs });
    S.prefs = r.prefs;
    keepSig();
    for (const b of S.boxes) await api("/mail/box", { key: b.key, signatures: b.signatures ?? [], defaultSig: b.defaultSig ?? null, replySig: b.replySig !== false });
    sigDirty = false;
  }
  window.DayspringEmail = { enabled, html, mount, save, _state: () => S };
})();
