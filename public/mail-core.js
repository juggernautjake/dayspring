// Shared by the Mail window (mail.js), the email and invitation editors (mail-compose.js) and Settings → Email
// (email-settings.js): talking to /api/mail, small dialogs, the sending toast, dictation's words, and turning what's in the
// rich editor (Quill) into email-safe HTML. window.dsMailCore.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  async function api(path, body, { method, headers = {}, raw = null } = {}) {
    const init = raw ? { method: "POST", headers, body: raw } : body === undefined && !method ? { headers } : { method: method ?? "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body ?? {}) };
    const r = await fetch("/api" + path, init);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || (j && j.error && !j.needsConfirm && j.ok !== true && !j.queued)) { const e = new Error(j.error || `Dayspring couldn't do that (${r.status}).`); e.data = j; e.status = r.status; throw e; }
    return j;
  }
  const size = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round((n ?? 0) / 1024)) + " KB");
  const when = (iso) => { const d = new Date(iso); if (isNaN(d)) return ""; const t = new Date(); return d.toDateString() === t.toDateString() ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : d.getFullYear() === t.getFullYear() ? d.toLocaleDateString([], { month: "short", day: "numeric" }) : d.toLocaleDateString(); };
  const who = (a) => (a?.name ? a.name : a?.address ?? "");
  // "Sam <sam@x.com>, bo@y.org" ⇄ [{ name, address }]
  function parseList(s) {
    return String(s ?? "").split(/[,;](?=(?:[^"]*"[^"]*")*[^"]*$)/).map((x) => x.trim()).filter(Boolean).map((x) => { const m = /^(.*?)<([^>]+)>\s*$/.exec(x); return m ? { name: m[1].replace(/^["'\s]+|["'\s]+$/g, ""), address: m[2].trim() } : { name: "", address: x }; });
  }
  const fmtList = (l) => l.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(", ");
  const isEmail = (s) => /^[^@\s<>(),;:"]+@[^@\s<>(),;:"]+\.[^@\s<>(),;:"]+$/.test(String(s ?? "").trim());

  // ---- small dialogs (inside the safe area) ----
  function confirmBox(text, { ok = "OK", cancel = "Cancel", danger = false } = {}) {
    return new Promise((done) => {
      const el = document.createElement("div"); el.className = "mailconfirm"; el.setAttribute("role", "alertdialog"); el.setAttribute("aria-modal", "true");
      el.innerHTML = `<div class="box"><p style="margin:.2em 0;line-height:1.45">${esc(text)}</p><div class="row"><button type="button" data-v="0">${esc(cancel)}</button><button type="button" class="${danger ? "warn" : "primary"}" data-v="1">${esc(ok)}</button></div></div>`;
      document.body.appendChild(el);
      const close = (v) => { el.remove(); document.removeEventListener("keydown", key, true); done(v); };
      const key = (e) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); close(false); } };
      document.addEventListener("keydown", key, true);
      el.querySelectorAll("[data-v]").forEach((b) => (b.onclick = () => close(b.dataset.v === "1")));
      el.onclick = (e) => { if (e.target === el) close(false); };
      el.querySelector('[data-v="1"]').focus();
    });
  }
  let noteEl = null, noteT = 0;
  function note(text, { ms = 6000, action = null } = {}) {
    noteEl?.remove(); clearTimeout(noteT);
    if (!text) return;
    noteEl = document.createElement("div"); noteEl.className = "mailtoast"; noteEl.setAttribute("role", "status");
    noteEl.innerHTML = `<span>✉ ${esc(text)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ""}<button type="button" class="plain" aria-label="Close">✕</button>`;
    document.body.appendChild(noteEl);
    const el = noteEl;
    if (action) el.querySelector("button").onclick = () => { action.run(); el.remove(); };
    el.querySelector("button[aria-label=Close]").onclick = () => el.remove();
    noteT = setTimeout(() => el.remove(), ms);
    return el;
  }

  // ---- dictation: what was said → text, with spoken punctuation ("comma", "new paragraph") ----
  const PUNCT = [[/\b(?:new|next) paragraph\b/g, "\u0001P"], [/\b(?:new|next) line\b/g, "\u0001L"], [/\b(?:full stop|period)\b/g, "\u0001."], [/\bcomma\b/g, "\u0001,"], [/\bquestion mark\b/g, "\u0001?"],
    [/\bexclamation (?:mark|point)\b/g, "\u0001!"], [/\bsemi ?colon\b/g, "\u0001;"], [/\bcolon\b/g, "\u0001:"], [/\b(?:em )?dash\b/g, "\u0001—"], [/\bhyphen\b/g, "\u0001-"], [/\b(?:open|begin) quote\b/g, "\u0001“"],
    [/\b(?:close|end) quote\b/g, "\u0001”"], [/\b(?:open|left) paren(?:thesis)?\b/g, "\u0001("], [/\b(?:close|right) paren(?:thesis)?\b/g, "\u0001)"]];
  const STOP = /\s*\b(?:(?:ok(?:ay)? )?(?:stop|end|finish) (?:dictating|dictation)|that'?s all|that is all|i'?m done|i am done|done dictating)\b[.!]*\s*$/i;
  // dictateText("hello comma how are you question mark new paragraph thanks", { capFirst }) → { text, stop }
  function dictateText(raw, { capFirst = true } = {}) {
    let s = " " + String(raw ?? "").trim() + " ";
    const stop = STOP.test(s.trim());
    s = s.replace(STOP, " ");
    let low = s;
    for (const [re, to] of PUNCT) low = low.replace(new RegExp(re.source, "gi"), to);
    let out = "", cap = capFirst;
    for (const part of low.split(/(\u0001[PL.,?!;:—\-“”()])/)) {
      if (!part) continue;
      if (part[0] === "\u0001") {
        const k = part[1];
        out = out.replace(/\s+$/, "");
        if (k === "P") { out += "\n\n"; cap = true; }
        else if (k === "L") { out += "\n"; cap = true; }
        else if (k === "“" || k === "(") out += " " + k;
        else if (k === "—") out += " —";
        else { out += k; if (".?!".includes(k)) cap = true; }
        continue;
      }
      let w = part.replace(/\s+/g, " ");
      if (!w.trim()) { if (out && !/[\s(“]$/.test(out) && !/^[\n]/.test(w)) out += " "; continue; }
      w = w.trim();
      if (cap) { w = w[0].toUpperCase() + w.slice(1); cap = false; }
      out += (out && !/[\s(“\n]$/.test(out) ? " " : "") + w;
    }
    return { text: out.replace(/ {2,}/g, " ").replace(/ ([,.?!;:)”])/g, "$1").replace(/[ \t]+$/, ""), stop };
  }
  // the editor's HTML as it is (a signature): Quill's own, with plain spaces
  const semanticHtml = (quill) => quill.getSemanticHTML().replace(/&nbsp;(?!&nbsp;| )/g, " ").replace(/ (?=&nbsp;)/g, "&nbsp;").replace(/^<p><\/p>$/, "");

  // ---- the rich editor's content as email HTML ----
  // Quill's classes mean nothing in someone else's mail app, so indents, code, quotes and tables get inline styles, and
  // the whole message sits in one div with the chosen font and size (class ds-mail: the editor strips it when loading).
  function emailHtml(quill, { font = "Arial, Helvetica, sans-serif", size = "14px" } = {}) {
    const t = document.createElement("template");
    t.innerHTML = quill.getSemanticHTML();
    for (const el of t.content.querySelectorAll("*")) {
      const cls = [...el.classList];
      const ind = cls.find((c) => /^ql-indent-\d+$/.test(c));
      if (ind) el.style.paddingLeft = Number(ind.slice(10)) * 2 + "em";
      const al = cls.find((c) => /^ql-align-/.test(c)); if (al) el.style.textAlign = al.slice(9);
      const fn = cls.find((c) => /^ql-font-/.test(c)); if (fn) el.style.fontFamily = fn.slice(8);
      for (const c of cls) if (/^ql-/.test(c)) el.classList.remove(c);
      if (!el.classList.length) el.removeAttribute("class");
      if (el.tagName === "BLOCKQUOTE" && !el.style.borderLeft) { el.style.margin = "0 0 0 .8ex"; el.style.borderLeft = "2px solid #c8cdd8"; el.style.paddingLeft = "1ex"; }
      if (el.tagName === "PRE") { el.style.fontFamily = "Consolas, 'Courier New', monospace"; el.style.background = "#f4f5f8"; el.style.padding = "8px"; el.style.borderRadius = "4px"; el.style.whiteSpace = "pre-wrap"; el.removeAttribute("data-language"); el.removeAttribute("spellcheck"); }
      if (el.tagName === "CODE" && el.parentElement?.tagName !== "PRE") { el.style.fontFamily = "Consolas, 'Courier New', monospace"; el.style.background = "#f1f2f6"; el.style.padding = "0 3px"; }
      if (el.tagName === "TABLE") { el.style.borderCollapse = "collapse"; el.removeAttribute("data-row"); }
      if (el.tagName === "TD" || el.tagName === "TH") { el.style.border = "1px solid #bbb"; el.style.padding = "4px 8px"; el.removeAttribute("data-row"); }
      if (el.tagName === "TR") el.removeAttribute("data-row");
      if (el.tagName === "HR") { el.style.border = "0"; el.style.borderTop = "1px solid #bbb"; }
      if (el.tagName === "IMG") { el.style.maxWidth = "100%"; }
    }
    const inner = t.innerHTML.replace(/&nbsp;(?!&nbsp;| )/g, " ").replace(/ (?=&nbsp;)/g, "&nbsp;");
    return `<div class="ds-mail" style="font-family:${font.replace(/"/g, "'")};font-size:${size};line-height:1.5">${inner}</div>`;
  }
  // HTML for loading into the editor: without the ds-mail wrapper Dayspring adds
  function editorHtml(html) {
    const t = document.createElement("template"); t.innerHTML = String(html ?? "");
    const kids = [...t.content.childNodes].filter((n) => n.nodeType === 1 || String(n.textContent).trim());
    if (kids.length === 1 && kids[0].nodeType === 1 && kids[0].classList?.contains("ds-mail")) return kids[0].innerHTML;
    return t.innerHTML;
  }
  const FONTS = [["Arial, Helvetica, sans-serif", "Arial"], ["Georgia, serif", "Georgia"], ["'Times New Roman', Times, serif", "Times"], ["Verdana, Geneva, sans-serif", "Verdana"], ["'Trebuchet MS', sans-serif", "Trebuchet"], ["'Courier New', Courier, monospace", "Courier"], ["Tahoma, sans-serif", "Tahoma"], ["'Segoe UI', sans-serif", "Segoe UI"]];
  const SIZES = [["10px", "Small"], ["12px", "12"], ["13px", "13"], ["14px", "Normal"], ["16px", "16"], ["18px", "18"], ["20px", "Large"], ["24px", "Larger"], ["32px", "Huge"]];
  const EMOJI = "😀 😄 😊 🙂 😉 😍 🥰 😘 😎 🤔 😅 😂 🤣 😢 😭 😮 😴 🙏 👍 👎 👏 🙌 🤝 👋 💪 ❤️ 💙 💚 💛 💜 🔥 ✨ 🎉 🎂 🎁 ⭐ ✅ ❌ ⚠️ ❓ 📅 ⏰ 📌 📎 ✉️ 📞 🏠 🚗 ☕ 🍕 🌞 🌧️ ❄️ 🌸 🐶 🐱 ⛪ 📖 💡 📝 🙂‍↕️ 🤗 😇".split(" ");
  // Quill's formats, set up once: inline styles (not classes) for font, size, colour and alignment, and a divider (<hr>)
  let quillReady = false;
  function setupQuill() {
    const Q = window.Quill; if (!Q || quillReady) return Q;
    quillReady = true;
    const Font = Q.import("attributors/style/font"); Font.whitelist = FONTS.map((f) => f[0]); Q.register(Font, true);
    const Size = Q.import("attributors/style/size"); Size.whitelist = SIZES.map((s) => s[0]); Q.register(Size, true);
    Q.register(Q.import("attributors/style/align"), true);
    Q.register(Q.import("attributors/style/direction"), true);
    const BlockEmbed = Q.import("blots/block/embed");
    class Divider extends BlockEmbed { static blotName = "divider"; static tagName = "hr"; }
    Q.register(Divider, true);
    // the pickers' labels
    const css = document.createElement("style");
    css.textContent = FONTS.map(([v, l]) => `.ql-snow .ql-picker.ql-font .ql-picker-label[data-value="${v.replace(/"/g, '\\"')}"]::before,.ql-snow .ql-picker.ql-font .ql-picker-item[data-value="${v.replace(/"/g, '\\"')}"]::before{content:"${l}";font-family:${v}}`).join("")
      + SIZES.map(([v, l]) => `.ql-snow .ql-picker.ql-size .ql-picker-label[data-value="${v}"]::before,.ql-snow .ql-picker.ql-size .ql-picker-item[data-value="${v}"]::before{content:"${l}"}`).join("");
    document.head.appendChild(css);
    return Q;
  }
  window.dsMailCore = { $, esc, api, size, when, who, parseList, fmtList, isEmail, confirmBox, note, dictateText, emailHtml, editorHtml, semanticHtml, FONTS, SIZES, EMOJI, setupQuill };
})();
