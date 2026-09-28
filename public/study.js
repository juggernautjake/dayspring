/* Study cards on the Dayspring display: click (or Enter on) the exam card or a course ring to open a small menu —
   open the next lesson in the study window, have Dayspring CHECK something you finished, see every lesson, or bring
   in progress from another browser. Self-contained: it only reads #examCard and #courses .course from the page. */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (path, body) => {
    const r = await fetch("/api" + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Dayspring couldn't do that just now. Try again in a moment, or restart Dayspring if it keeps happening.");
    return j;
  };
  const short = (t) => String(t ?? "").split(" — ")[0];

  const css = document.createElement("style");
  css.textContent = `
  #examCard,#courses .course{cursor:pointer;transition:transform .18s,box-shadow .18s,background .18s;border-radius:1em}
  #examCard:hover,#courses .course:hover,#examCard:focus-visible,#courses .course:focus-visible{outline:none;box-shadow:0 0 0 2px rgba(124,140,255,.55),0 0 22px rgba(124,140,255,.25)}
  #courses .course:hover{background:rgba(124,140,255,.07)}
  .stpop{position:fixed;z-index:40;width:min(27em,calc(100vw - 2em));max-height:min(78vh,40em);display:flex;flex-direction:column;gap:.55em;padding:1em 1.05em .95em;
    background:rgba(16,19,42,.96);backdrop-filter:blur(18px);border:1px solid rgba(170,180,255,.3);border-radius:1.05em;color:#eef0ff;
    box-shadow:0 22px 60px rgba(0,0,0,.6),0 0 30px rgba(124,140,255,.2);animation:stin .22s cubic-bezier(.2,.7,.2,1);font-size:.95em}
  @keyframes stin{from{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:none}}
  .stpop h3{margin:0;font-size:1.08em;font-weight:500;padding-right:2em}
  .stpop .sub{color:#a4abcc;font-size:.85em;margin-top:-.3em}
  .stpop .sub b{color:#ffd27a;font-weight:500}
  .stpop .x{position:absolute;top:.55em;right:.55em;width:1.9em;height:1.9em;border-radius:50%;border:0;background:rgba(255,255,255,.07);color:#a4abcc;cursor:pointer;font:inherit;font-size:.85em}
  .stpop .x:hover{background:rgba(255,255,255,.16);color:#fff}
  .stpop button.act{display:flex;align-items:center;gap:.6em;width:100%;text-align:left;font:inherit;color:#eef0ff;cursor:pointer;
    background:rgba(255,255,255,.05);border:1px solid rgba(170,180,255,.22);border-radius:.75em;padding:.6em .8em;transition:background .15s,border-color .15s}
  .stpop button.act:hover,.stpop button.act:focus-visible{background:rgba(124,140,255,.22);border-color:rgba(124,140,255,.55);outline:none}
  .stpop button.act.primary{background:linear-gradient(135deg,rgba(124,140,255,.5),rgba(167,139,250,.45));border-color:transparent}
  .stpop button.act.primary:hover{filter:brightness(1.12)}
  .stpop button.act:disabled{opacity:.55;cursor:progress}
  .stpop .ico{width:1.4em;text-align:center;flex:0 0 auto}
  .stpop .lbl{flex:1;min-width:0}
  .stpop .lbl small{display:block;color:#c9cdf0;opacity:.85;font-size:.8em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .stpop .msg{font-size:.9em;line-height:1.4;padding:.55em .7em;border-radius:.7em;background:rgba(255,255,255,.05);border:1px solid rgba(170,180,255,.16)}
  .stpop .msg.ok{border-color:rgba(126,227,176,.45);background:rgba(126,227,176,.08)}
  .stpop .msg.no{border-color:rgba(255,210,122,.45);background:rgba(255,210,122,.07)}
  .stpop .msg .row{display:flex;gap:.5em;margin-top:.5em;flex-wrap:wrap}
  .stpop .msg .row button{font:inherit;font-size:.9em;color:#eef0ff;background:rgba(255,255,255,.08);border:1px solid rgba(170,180,255,.28);border-radius:2em;padding:.25em .8em;cursor:pointer}
  .stpop .msg .row button:hover{background:rgba(124,140,255,.3)}
  .stpop ul{list-style:none;margin:0;padding:0;overflow:auto;flex:1;min-height:6em;border-top:1px solid rgba(170,180,255,.14)}
  .stpop li{display:flex;align-items:center;gap:.55em;padding:.42em .3em;border-bottom:1px solid rgba(170,180,255,.08);cursor:pointer;border-radius:.4em}
  .stpop li:hover,.stpop li:focus-visible{background:rgba(124,140,255,.14);outline:none}
  .stpop li .st{width:1.3em;text-align:center;flex:0 0 auto}
  .stpop li.done .t{color:#8e95b9}
  .stpop li.next{background:rgba(124,140,255,.12)}
  .stpop li.behind .st{color:#ffd27a}
  .stpop li .t{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:.92em}
  .stpop li .d{color:#8e95b9;font-size:.78em;white-space:nowrap}
  .stpop textarea{width:100%;min-height:5.5em;font:inherit;font-size:.8em;color:#eef0ff;background:rgba(0,0,0,.3);border:1px solid rgba(170,180,255,.28);border-radius:.6em;padding:.5em}
  `;
  document.head.appendChild(css);

  let pop = null, lastFocus = null;
  function closePop() { if (!pop) return; pop.remove(); pop = null; document.removeEventListener("keydown", onKey, true); lastFocus?.focus?.(); }
  function onKey(e) { if (e.key === "Escape" && (!e.dsTop || e.dsTop === pop)) { e.stopPropagation(); e.preventDefault(); closePop(); } }
  document.addEventListener("pointerdown", (e) => { if (pop && !pop.contains(e.target) && !e.target.closest?.("#examCard,#courses .course:not(.lnc)")) closePop(); }, true);

  function place(el, anchor) {
    // beside the card, inside the screen's margins (the safe area)
    const a = anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight, S = window.dsSafeRect?.() ?? { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    let left = a.right + 12, top = a.top;
    if (left + w > S.right - 10) left = a.left - w - 12;
    if (left < S.left + 10) left = Math.max(S.left + 10, Math.min(S.right - w - 10, a.left));
    if (top + h > S.bottom - 10) top = Math.max(S.top + 10, S.bottom - h - 10);
    top = Math.max(S.top + 10, top);
    el.style.left = left + "px"; el.style.top = top + "px";
    window.dsKeepInSafe?.(el);
  }

  async function show(course, anchor) {
    closePop();
    lastFocus = anchor;
    let st;
    try { st = await api("/study/state"); } catch (e) { return; }
    const c = st.courses[course];
    if (!c) return;
    pop = document.createElement("div");
    pop.className = "stpop"; pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", c.title);
    document.body.appendChild(pop);
    document.addEventListener("keydown", onKey, true);
    render(course, c, anchor);
  }

  function render(course, c, anchor, { list = false, msg = null, importing = false } = {}) {
    const next = c.items.find((i) => i.status === "next");
    const name = String(c.title).replace(/\s*\(.*$/, "");
    const checkWord = c.checker === "none" ? "Mark it done" : "I finished it — check it";
    pop.innerHTML = `
      <button class="x" data-a="close" aria-label="Close">✕</button>
      <h3>${esc(name)}</h3>
      <div class="sub">${c.done} of ${c.total} done${c.behind ? ` · <b>${c.behind} to catch up</b>` : ""}</div>
      ${next ? `<button class="act primary" data-a="open"><span class="ico">▶</span><span class="lbl">Open next<small>${esc(short(next.title))}</small></span></button>
      <button class="act" data-a="check"><span class="ico">✓</span><span class="lbl">${checkWord}<small>${c.checker === "none" ? "This course can't be checked automatically" : "Dayspring looks at your real progress first"}</small></span></button>`
      : `<div class="msg ok">Everything's done here. 🎉</div>`}
      <button class="act" data-a="list"><span class="ico">☰</span><span class="lbl">${list ? "Hide the list" : "See all lessons"}</span></button>
      ${c.canImport ? `<button class="act" data-a="import"><span class="ico">⤓</span><span class="lbl">Bring in progress<small>From the course's “Make a backup” in another browser</small></span></button>` : ""}
      ${importing ? `<textarea aria-label="Backup text" placeholder="Paste the backup text here"></textarea><button class="act primary" data-a="doimport"><span class="ico">⤓</span><span class="lbl">Bring it in</span></button>` : ""}
      ${msg ? `<div class="msg ${msg.cls ?? ""}" aria-live="polite">${esc(msg.text)}${msg.buttons ? `<div class="row">${msg.buttons.map((b) => `<button data-a="${b.a}"${b.id ? ` data-id="${b.id}"` : ""}>${esc(b.label)}</button>`).join("")}</div>` : ""}</div>` : ""}
      ${list ? `<ul>${c.items.map((i) => `<li tabindex="0" class="${i.status}" data-id="${i.id}" title="${esc(i.title)}"><span class="st">${{ done: "✓", next: "▶", behind: "!", upcoming: "○" }[i.status]}</span><span class="t">${esc(short(i.title))}</span><span class="d">${i.date ? new Date(i.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}</span></li>`).join("")}</ul>` : ""}`;
    place(pop, anchor);
    (pop.querySelector("textarea") ?? pop.querySelector("button.act"))?.focus();
    if (list) pop.querySelector("li.next")?.scrollIntoView({ block: "center" });

    const refresh = async (extra) => { try { const st = await api("/study/state"); c = st.courses[course]; } catch { /* keep */ } render(course, c, anchor, extra); };
    const busy = (btn, text) => { btn.disabled = true; const l = btn.querySelector(".lbl"); if (l) l.firstChild.textContent = text; };
    pop.onclick = async (e) => {
      const li = e.target.closest("li[data-id]");
      if (li) { try { const r = await api("/study/open", { course, id: li.dataset.id }); await refresh({ list: true, msg: { text: r.say, cls: r.needsSignIn ? "no" : "" } }); } catch (err) { await refresh({ list: true, msg: { text: err.message, cls: "no" } }); } return; }
      const b = e.target.closest("[data-a]"); if (!b) return;
      const a = b.dataset.a;
      if (a === "close") return closePop();
      if (a === "list") return render(course, c, anchor, { list: !list, msg });
      if (a === "import") return render(course, c, anchor, { list, importing: !importing });
      if (a === "open" || a === "openid") {
        busy(b, "Opening…");
        try { const r = await api("/study/open", { course, id: b.dataset.id || next?.id }); await refresh({ list, msg: { text: r.say, cls: r.needsSignIn ? "no" : "" } }); }
        catch (err) { await refresh({ list, msg: { text: err.message, cls: "no" } }); }
        return;
      }
      if (a === "check" || a === "force") {
        busy(b, a === "force" ? "Marking…" : "Checking…");
        try {
          const r = await api("/study/verify", { course, id: b.dataset.id || next?.id, force: a === "force" });
          const ch = r.checked?.[0] ?? {};
          const buttons = ch.ok ? (r.next ? [{ a: "openid", id: r.next.id, label: "Open the next one" }] : null)
            : [{ a: "openid", id: ch.id, label: "Open it" }, { a: "force", id: ch.id, label: "Mark it done anyway" }];
          await refresh({ list, msg: { text: r.say, cls: ch.ok ? "ok" : "no", buttons } });
        } catch (err) { await refresh({ list, msg: { text: err.message, cls: "no" } }); }
        return;
      }
      if (a === "doimport") {
        busy(b, "Bringing it in…");
        try { const r = await api("/study/import", { course, backup: pop.querySelector("textarea")?.value ?? "" }); await refresh({ list, msg: { text: r.say, cls: r.ok ? "ok" : "no" } }); }
        catch (err) { await refresh({ list, msg: { text: err.message, cls: "no" } }); }
      }
    };
    pop.onkeydown = (e) => { const li = e.target.closest?.("li[data-id]"); if (li && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); li.click(); } };
  }

  // Which course a card is: the exam card → the exam's course; the n-th ring → the n-th course (same order as the page).
  async function courseFor(el) {
    const st = await api("/study/state").catch(() => null);
    if (!st) return null;
    if (el.id === "examCard") return st.examCourse;
    const all = [...document.querySelectorAll("#courses .course:not(.lnc)")];   // (Lantern's courses, .lnc, open Lantern instead)
    return Object.keys(st.courses)[all.indexOf(el)] ?? null;
  }
  const activate = async (el) => { const c = await courseFor(el); if (c) show(c, el); };
  document.addEventListener("click", (e) => {
    const el = e.target.closest?.("#examCard,#courses .course:not(.lnc)");
    if (!el || e.target.closest("a,button")) return;
    e.stopPropagation(); activate(el);
  }, true);
  document.addEventListener("keydown", (e) => {
    if ((e.key !== "Enter" && e.key !== " ") || pop) return;
    const el = document.activeElement?.closest?.("#examCard,#courses .course:not(.lnc)");
    if (el) { e.preventDefault(); activate(el); }
  });
  // the rings are redrawn when progress changes: keep them focusable and labelled
  const label = () => {
    const ex = $("#examCard");
    if (ex && !ex.hasAttribute("tabindex")) { ex.tabIndex = 0; ex.setAttribute("role", "button"); ex.setAttribute("aria-label", "Study for the exam: open the next lesson or check progress"); }
    document.querySelectorAll("#courses .course:not(.lnc)").forEach((c) => { if (!c.hasAttribute("tabindex")) { c.tabIndex = 0; c.setAttribute("role", "button"); c.setAttribute("aria-label", (c.querySelector(".label")?.textContent ?? "Course") + ": open the next lesson or check progress"); } });
  };
  label();
  const box = $("#courses");
  if (box) new MutationObserver(label).observe(box, { childList: true });
})();
