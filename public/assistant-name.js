// The assistant's name on the Dayspring screen (and the mini): the panel's label, the hints ("Say “Nova” and ask me
// anything"), the window title ("Nova · Dayspring": the product name stays last, so scripts/window.ps1 still finds the
// window), the free voice saying the name the way it's said ("Ee-fa"), and "Train my wake word".
// Loaded after tv.js; everything it changes comes from /api/assistant and the "assistant" event (lib/naming-routes.mjs).
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const PRODUCT = "Dayspring";
  let cur = { name: PRODUCT, say: "", wake: "Dayspring" };
  const cap = (s) => (window.dsWake ? window.dsWake.cap(s) : String(s ?? ""));

  // ---- the labels ----------------------------------------------------------------------------------------------------
  // The first time, the page's own words are remembered with markers ({N} the name, {W} the wake word), so later renames
  // replace the right words, and "Dayspring" as the app's name ("Dayspring mini", "Start Dayspring") is left alone.
  const orig = new Map();
  let lastCap = null;
  const mark = (s) => String(s).replace(/“Dayspring”/g, "“{W}”").replace(/“Dayspring, /g, "“{W}, ").replace(/\bType to Dayspring\b/g, "Type to {N}").replace(/\(Dayspring still speaks\)/g, "({N} still speaks)");
  function relabel() {
    const fill = (s) => s.replace(/\{N\}/g, cur.name).replace(/\{W\}/g, cur.wake);
    const text = (el, key) => { if (!el) return; if (!orig.has(key)) orig.set(key, mark(el.textContent)); el.textContent = fill(orig.get(key)); };
    const attr = (el, a, key) => { if (!el || !el.hasAttribute(a)) return; if (!orig.has(key)) orig.set(key, mark(el.getAttribute(a))); el.setAttribute(a, fill(orig.get(key))); };
    // the panel's label: its first bit of text (the mood tag after it stays)
    const lab = $(".talkhead .label");
    if (lab) { let n = [...lab.childNodes].find((x) => x.nodeType === 3); if (!n) { n = document.createTextNode(""); lab.prepend(n); } n.textContent = cur.name; lab.dataset.aname = cur.name; }
    // the hint under the ring, only while it's still the hint (tv.js writes what's being said there too)
    const capEl = $("#cap span");
    if (capEl && (orig.has("cap") ? capEl.textContent === lastCap : /“Dayspring”/.test(capEl.textContent))) { text(capEl, "cap"); lastCap = capEl.textContent; }
    attr($("#typeBox"), "placeholder", "type");
    for (const id of ["stopBtn", "pttBtn", "muteBtn"]) attr($("#" + id), "title", id);
    const al = [...document.querySelectorAll("#alarm p")].find((p) => /Dayspring|\{W\}/.test(orig.get("alarm") ?? p.textContent)); if (al) text(al, "alarm");
    // the window title: the name first, the product last (the hidden marker scripts/window.ps1 looks for)
    if (/^\/(display|tv|mini|)$/.test(location.pathname) || document.querySelector("#talkStatus")) document.title = cur.name === PRODUCT ? PRODUCT : `${cur.name} · ${PRODUCT}`;
    document.documentElement.dataset.assistant = cur.name;
  }
  function apply(v) {
    if (!v) return;
    const words = v.wake?.words ?? v.words ?? [];
    cur = { name: v.name || PRODUCT, say: v.say || "", wake: cap(String(words[0]?.text ?? words[0] ?? v.name ?? PRODUCT).replace(/^(hey|ok|okay|hi) /i, (m) => m)) };
    relabel();
  }

  // ---- the free voice says the name the way it's said -------------------------------------------------------------------
  const reName = () => (cur.say && cur.name ? new RegExp(`(^|[^\\p{L}\\p{N}])${cur.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\p{L}\\p{N}])`, "giu") : null);
  if (window.speechSynthesis && typeof window.speechSynthesis.speak === "function") {
    const speak0 = window.speechSynthesis.speak.bind(window.speechSynthesis);
    try { window.speechSynthesis.speak = (u) => { try { const re = reName(); if (re && u && typeof u.text === "string") u.text = u.text.replace(re, (m, a) => a + cur.say); } catch { /* as written */ } return speak0(u); }; } catch { /* read-only here */ }
  }
  window.dsAssistantName = () => cur.name;

  // ---- "Train my wake word" --------------------------------------------------------------------------------------------
  // The server keeps the session (lib/naming.mjs); this page, the one that listens, shows the card and sends what the
  // recognizer heard each time (its guesses, best first). tv.js hands every final result here while it's active.
  let T = null;              // { id, word, want, got, armedAt }
  const card = () => $("#wakeTrainCard");
  function paint(st) {
    let el = card();
    if (!el) { document.body.insertAdjacentHTML("beforeend", `<div class="sttcard" id="wakeTrainCard" role="dialog" aria-live="polite" aria-label="Train the wake word"></div>`); el = card(); }
    if (st.report) {
      const r = st.report;
      el.innerHTML = `<b>Wake word training: “${esc(st.shown)}”</b>
        <p>I recognized it <b>${r.recognized} of ${r.samples}</b> times (${r.successRate}%) before learning.${r.learned.length ? ` I'll now also accept ${r.learned.map((x) => `“${esc(x)}”`).join(", ")}.` : " Nothing new to learn: it already hears you."}</p>
        ${r.skipped.length ? `<p>Not kept: ${r.skipped.map((x) => `“${esc(x.text)}” (${esc(x.why)})`).join(", ")}.</p>` : ""}
        ${r.warnings.map((w) => `<p>⚠ ${esc(w)}</p>`).join("")}
        ${r.suggestions.length ? `<p>Easier to hear: ${r.suggestions.map((x) => `“${esc(cap(x))}”`).join(", ")} (Settings → Your assistant).</p>` : ""}
        <div class="row"><button class="big" id="wtDone">Done</button></div>`;
      $("#wtDone").onclick = () => card()?.remove();
      return;
    }
    if (st.cancelled) { el.innerHTML = `<b>Wake word training stopped</b><p>${esc(st.why ?? "")}</p><div class="row"><button id="wtDone">Close</button></div>`; $("#wtDone").onclick = () => card()?.remove(); return; }
    const ready = T && Date.now() >= T.armedAt;
    el.innerHTML = `<b>Train “${esc(st.shown)}”</b>
      <p id="wtSay">${ready ? `Now: say “${esc(st.shown)}” on its own.` : "Get ready…"}</p>
      <p>${st.got} of ${st.want} done${st.heard?.length ? `. I heard: ${st.heard.map((h) => `“${esc(h)}”`).join(", ")}` : ""}.</p>
      <div class="row"><button id="wtStop">Cancel</button>${st.got >= (st.min ?? 3) ? `<button id="wtFinish">Finish now</button>` : ""}</div>`;
    $("#wtStop").onclick = () => post("/wake/train/cancel");
    if ($("#wtFinish")) $("#wtFinish").onclick = () => post("/wake/train/finish");
  }
  const post = (p, body = {}) => fetch("/api" + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => null);
  function onTrain(st) {
    if (!st || st.active === false) return;
    if (window.dsIsSpeaker === false) return;               // another screen is the one listening
    if (st.done) { T = null; window.dsWakeTrain.active = false; paint(st); speakReport(st); return; }
    if (!T || T.id !== st.id) T = { id: st.id, word: st.word, armedAt: Date.now() + 1500 };
    window.dsWakeTrain.active = true;
    paint(st);
    clearTimeout(T.tick); T.tick = setTimeout(() => { if (T && !card()?.querySelector("#wtDone")) paint({ ...st }); }, Math.max(0, T.armedAt - Date.now()) + 50);
  }
  function speakReport(st) {
    const r = st.report; if (!r) return;
    const line = `I recognized it ${r.recognized} out of ${r.samples} times.${r.learned.length ? ` I learned ${r.learned.length === 1 ? "one new way" : `${r.learned.length} new ways`} you say it.` : ""}${r.warnings.length ? " There's a tip on the screen." : ""}`;
    try { window.dsCore?.speak?.(line); } catch { /* shown on screen */ }
  }
  window.dsWakeTrain = {
    active: false,
    // one final result from the recognizer: every guess it made (best first)
    take(result) {
      if (!T) return false;
      if (window.dsCore?.speaking || Date.now() < T.armedAt) return true;      // its own voice, or too early: not a sample
      const alts = []; for (let k = 0; k < (result?.length ?? 0); k++) { const t = String(result[k]?.transcript ?? "").trim(); if (t) alts.push(t); }
      if (!alts.length) return true;
      T.armedAt = Date.now() + 700;                                               // a breath between tries
      post("/wake/train/sample", { id: T.id, alternatives: alts }).then((st) => { if (st && st.ok !== false) onTrain(st); });
      return true;
    },
  };

  // ---- wiring ----------------------------------------------------------------------------------------------------------
  const hook = (es) => {
    if (!es || es.__dsAssistant) return; es.__dsAssistant = true;
    es.addEventListener("assistant", (e) => { try { const d = JSON.parse(e.data); apply(d); if (d.wakeConfig) window.dsSetWake?.(d.wakeConfig); else fetch("/api/wake/config").then((r) => r.json()).then((c) => window.dsSetWake?.(c)).catch(() => {}); } catch { /* bad event */ } });
    es.addEventListener("wake-train", (e) => { try { onTrain(JSON.parse(e.data)); } catch { /* bad event */ } });
  };
  if (window.dsEvents) hook(window.dsEvents);
  window.addEventListener("ds-events", (e) => hook(e.detail));
  fetch("/api/assistant").then((r) => r.json()).then(apply).catch(() => relabel());
  fetch("/api/wake/train").then((r) => r.json()).then((st) => { if (st && st.id && !st.done) onTrain(st); }).catch(() => {});
})();
