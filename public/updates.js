// The update notice on the Dayspring screen: "Dayspring 1.2.0 is ready", what's new, and four choices:
// Update now · Next time I open Dayspring · When I'm not using it · Not now. The server (lib/updater.mjs) does the work;
// this card only asks. It also shows progress while an update installs, and a note when Dayspring was stopped.
(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const md = (t) => esc(t).split(/\r?\n/).map((l) => /^\s*[-*]\s+/.test(l) ? `<li>${l.replace(/^\s*[-*]\s+/, "").replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")}</li>` : /^#+\s/.test(l) ? `<b class="h">${l.replace(/^#+\s/, "")}</b>` : l.trim() ? `<p>${l.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")}</p>` : "").join("").replace(/(<li>.*?<\/li>)+/g, (x) => `<ul>${x}</ul>`);
  const css = document.createElement("style");
  css.textContent = `
  #dsUpdate{position:fixed;left:50%;bottom:calc(var(--sb,3vh) + 1.2em);transform:translateX(-50%);z-index:60;width:min(40em,calc(100vw - 2em));max-height:70vh;display:flex;flex-direction:column;gap:.6em;
    background:rgba(16,19,44,.94);color:#f4f5ff;border:1px solid rgba(255,255,255,.18);border-radius:1.1em;padding:1em 1.1em;box-shadow:0 1.2em 3em rgba(0,0,0,.45);backdrop-filter:blur(14px);font-size:clamp(14px,1.6vmin,20px)}
  #dsUpdate h3{margin:0;font-size:1.15em;display:flex;align-items:center;gap:.45em}
  #dsUpdate .x{margin-left:auto;background:none;border:0;color:inherit;font-size:1.1em;cursor:pointer;opacity:.75;padding:.1em .35em;border-radius:.4em}
  #dsUpdate .x:hover,#dsUpdate .x:focus-visible{opacity:1;background:rgba(255,255,255,.12)}
  #dsUpdate .notes{overflow:auto;max-height:34vh;padding:.2em .6em;border-radius:.6em;background:rgba(255,255,255,.05);line-height:1.4}
  #dsUpdate .notes ul{margin:.3em 0;padding-left:1.2em} #dsUpdate .notes p{margin:.35em 0} #dsUpdate .notes .h{display:block;margin-top:.5em}
  #dsUpdate .acts{display:flex;flex-wrap:wrap;gap:.45em}
  #dsUpdate .acts button{flex:1 1 auto;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.08);color:inherit;border-radius:.7em;padding:.55em .8em;font:inherit;cursor:pointer}
  #dsUpdate .acts button.go{background:#6f7dff;border-color:#8b97ff;color:#fff;font-weight:600}
  #dsUpdate .acts button:hover,#dsUpdate .acts button:focus-visible{filter:brightness(1.15);outline:2px solid rgba(255,255,255,.5);outline-offset:1px}
  #dsUpdate small{opacity:.75} #dsUpdate .st{font-weight:600}
  #dsStopped{position:fixed;inset:0;z-index:80;display:grid;place-items:center;background:rgba(8,10,24,.92);color:#f4f5ff;font-size:clamp(16px,2.4vmin,30px);text-align:center;padding:2em}`;
  document.head.appendChild(css);

  let card = null, shownFor = null;
  const post = (path, body) => fetch("/api" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "That didn't work."); return j; });
  const close = () => { card?.remove(); card = null; };

  function show(info, { quiet = false } = {}) {
    if (!info?.available || !info.latest) return;
    if (card && shownFor === info.latest) return;
    close(); shownFor = info.latest;
    card = document.createElement("section");
    card.id = "dsUpdate"; card.setAttribute("role", "dialog"); card.setAttribute("aria-label", "A new version of Dayspring");
    card.innerHTML = `<h3>⬆️ ${esc(info.name || "Dayspring " + info.latest)} is ready <button class="x" type="button" aria-label="Close">✕</button></h3>
      <small>You have ${esc(info.current)}. Your schedule, settings and keys are backed up first and stay as they are.</small>
      ${info.notes ? `<div class="notes" tabindex="0" aria-label="What's new"><b class="h">What's new</b>${md(info.notes)}</div>` : ""}
      <div class="acts"><button class="go" data-c="now" type="button">Update now</button><button data-c="launch" type="button">Next time I open Dayspring</button><button data-c="idle" type="button">When I'm not using it</button><button data-c="later" type="button">Not now</button></div>
      <div class="st" aria-live="polite"></div>`;
    document.body.appendChild(card);
    card.querySelector(".x").onclick = close;
    card.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    card.querySelectorAll("[data-c]").forEach((b) => (b.onclick = async () => {
      const st = card.querySelector(".st");
      card.querySelectorAll("[data-c]").forEach((x) => (x.disabled = true));
      st.textContent = b.dataset.c === "now" ? "Installing… Dayspring will restart in about a minute." : "One moment…";
      try {
        const r = await post("/update/choose", { choice: b.dataset.c });
        if (b.dataset.c !== "now") { st.textContent = r.message ?? "Okay."; setTimeout(close, 5000); }
      } catch (e) { st.textContent = e.message; card.querySelectorAll("[data-c]").forEach((x) => (x.disabled = false)); }
    }));
    if (!quiet) setTimeout(() => card?.querySelector(".go")?.focus(), 50);
  }

  function progress(s) {
    if (!card || !s) return;
    const st = card.querySelector(".st");
    if (st && s.message && ["downloading", "applying", "restarting", "error"].includes(s.phase)) st.textContent = s.message;
    if (s.phase === "error") card.querySelectorAll("[data-c]").forEach((x) => (x.disabled = false));
  }

  function stopped() {
    if (document.getElementById("dsStopped")) return;
    const d = document.createElement("div"); d.id = "dsStopped";
    d.innerHTML = `<div><h2>Dayspring has stopped</h2><p>Start it again with the Dayspring icon on your desktop or in the Start menu.<br>You can close this window.</p></div>`;
    document.body.appendChild(d);
  }

  function hook(es) {
    es.addEventListener("update", (e) => { try { const i = JSON.parse(e.data); show(i, { quiet: i.quiet }); } catch { /* bad event */ } });
    es.addEventListener("updatestatus", (e) => { try { progress(JSON.parse(e.data)); } catch { /* bad event */ } });
    es.addEventListener("window", (e) => { try { if (JSON.parse(e.data).action === "quit") stopped(); } catch { /* bad event */ } });
  }
  if (window.dsEvents) hook(window.dsEvents); else addEventListener("ds-events", (e) => hook(e.detail), { once: true });

  // a newer version found while this screen was closed: show it (unless they already chose what to do with it)
  setTimeout(() => fetch("/api/update/status").then((r) => r.json()).then((s) => {
    const L = s.latest;
    if (L?.available && !(s.plan && s.plan.version === L.latest) && s.when === "ask") show({ ...L, current: s.version }, { quiet: true });
  }).catch(() => {}), 8000);
  window.dsUpdates = { show, close };
})();
