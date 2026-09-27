// 🎧 Tune in — the display's button for listening to whatever plays in the headset (a Discord call, a game, a video).
// Click: on/off. The little ▾ opens options: which device to listen to, and whether Dayspring's answers go into the
// call (through Voicemeeter) or only into the headset. Loaded by tv.html after tv.js; it only talks to the server
// (/api/tunein, /api/call/*) and the event stream, so it works alongside the rest of the page.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const api = (path, body) => fetch("/api" + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok && !j.ok && j.error) throw new Error(j.error); return j; });
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  let st = { on: false, talk: {} }, audioEl = null;

  // ---- look ----
  const css = document.createElement("style");
  css.textContent = `
  .tune{display:inline-flex;align-items:stretch;border-radius:.7em;border:1px solid var(--edge2);background:rgba(255,255,255,.07);overflow:hidden}
  .talktools .tune button{border:0;border-radius:0;background:transparent;margin:0}
  .talktools .tune button + button{border-left:1px solid var(--edge2);padding:.2em .35em}
  .tune.on{background:rgba(94,234,212,.18);border-color:rgba(94,234,212,.6);box-shadow:0 0 0 0 rgba(94,234,212,.5);animation:tunepulse 2.4s ease-out infinite}
  .tune.on #tuneBtn{color:#bff7ee}
  .tune.wake{background:rgba(255,210,122,.3);border-color:var(--gold,#ffd27a)}
  .tune.busy{opacity:.6}
  @keyframes tunepulse{0%{box-shadow:0 0 0 0 rgba(94,234,212,.45)}70%{box-shadow:0 0 0 .55em rgba(94,234,212,0)}100%{box-shadow:0 0 0 0 rgba(94,234,212,0)}}
  .tunepop{position:fixed;z-index:30;width:min(24em,92vw);background:rgba(20,24,54,.96);backdrop-filter:blur(16px);border:1px solid var(--edge2);border-radius:1em;padding:1em 1.1em;box-shadow:0 20px 60px rgba(0,0,0,.6);font-size:.9em;color:var(--ink)}
  .tunepop h4{margin:0 0 .3em;font-weight:500;font-size:1.05em}
  .tunepop p{margin:.35em 0;color:var(--muted);font-weight:300;line-height:1.4}
  .tunepop label{display:flex;align-items:center;gap:.5em;margin:.6em 0 .2em}
  .tunepop select{width:100%;font:inherit;color:var(--ink);background:rgba(255,255,255,.07);border:1px solid var(--edge2);border-radius:.6em;padding:.35em .5em}
  .tunepop .row{display:flex;gap:.5em;margin-top:.8em;justify-content:flex-end}
  .tunepop button{font:inherit;font-size:.9em;color:var(--ink);background:rgba(124,140,255,.25);border:1px solid var(--edge2);border-radius:.7em;padding:.35em .9em;cursor:pointer}
  .tunepop button.plain{background:transparent}
  .tunepop .warn{color:var(--gold,#ffd27a)}
  .tunepop code{background:rgba(255,255,255,.08);padding:.05em .35em;border-radius:.35em;font-size:.92em}
  .tunepop .x{position:absolute;top:.5em;right:.6em;background:transparent;border:0;padding:.2em .4em}
  .tunecard{position:fixed;z-index:19;left:50%;bottom:calc(1.2em + var(--sy,0px));transform:translateX(-50%);max-width:min(40em,80vw);background:rgba(20,24,54,.92);backdrop-filter:blur(14px);border:1px solid rgba(94,234,212,.45);border-radius:1em;padding:.6em 1em;font-size:.95em;box-shadow:0 14px 44px rgba(0,0,0,.5);animation:tin .4s ease}
  .tunecard small{display:block;color:var(--muted);font-weight:300}`;
  document.head.appendChild(css);

  // ---- the button (after ✋ Stop) ----
  const wrap = document.createElement("span");
  wrap.className = "tune";
  wrap.innerHTML = `<button id="tuneBtn" title="Tune in: listen to your headset (calls, games) and answer when someone says my name">🎧</button><button id="tuneMore" title="Tune in options" aria-label="Tune in options">▾</button>`;
  const tools = $(".talktools");
  if (!tools) return;
  tools.insertBefore(wrap, $("#typeBtn") ?? tools.firstChild?.nextSibling ?? null);
  const btn = $("#tuneBtn");

  function paint() {
    wrap.classList.toggle("on", Boolean(st.on));
    btn.textContent = st.on ? "🎧 On" : "🎧";
    btn.title = st.on ? `Tuned in to ${st.device || "your headset"}${st.talk?.talk ? " · answers go into the call" : ""}. Click to stop.` : "Tune in: listen to your headset (calls, games) and answer when someone says my name";
  }
  async function refresh() { try { st = await api("/tunein"); paint(); } catch { /* server restarting */ } }

  // ---- toggling ----
  async function toggle(on = !st.on) {
    wrap.classList.add("busy");
    try {
      let dev = null; try { dev = localStorage.getItem("ds-tune-device") || null; } catch { /* no storage */ }   // chosen in the Sound panel
      const r = await api("/tunein", on && dev ? { on, device: dev } : { on });
      if (r.needsInstall) return showInstall(r.why);
      if (on && !r.ok) card("Couldn't tune in", r.why || "Something went wrong.");
      st = { ...st, ...r }; paint();
      if (on && r.ok) card("🎧 Tuned in", `Listening to ${r.device || "your headset"}. Say “Dayspring” on the call and I'll answer${r.talk?.talk ? " into the call" : " in your headset"}.`);
      if (!on) card("🎧 Tuned out", "I've stopped listening to your headset.");
    } catch (e) { card("Couldn't tune in", e.message); }
    finally { wrap.classList.remove("busy"); }
  }
  btn.onclick = () => toggle();

  // ---- popovers ----
  let pop = null;
  function closePop() { pop?.remove(); pop = null; }
  function openPop(html) {
    closePop();
    pop = document.createElement("div"); pop.className = "tunepop"; pop.innerHTML = `<button class="x plain" aria-label="Close">✕</button>` + html;
    document.body.appendChild(pop);
    const r = wrap.getBoundingClientRect();
    pop.style.top = Math.min(innerHeight - pop.offsetHeight - 8, r.bottom + 8) + "px";
    pop.style.left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, r.right - pop.offsetWidth)) + "px";
    $(".x", pop).onclick = closePop;
    return pop;
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && pop && (!e.dsTop || e.dsTop === pop)) closePop(); });

  function showInstall(why) {
    const p = openPop(`<h4>🎧 Tune in needs speech-to-text</h4>
      <p>${esc(why || "")}</p>
      <p>Dayspring understands calls with Whisper, running right on this computer: free, and nothing you hear leaves the PC. It's a one-time download of about 220 MB.</p>
      <div class="row"><button class="plain" data-no>Not now</button><button data-go>Install</button></div>`);
    $("[data-no]", p).onclick = closePop;
    $("[data-go]", p).onclick = async () => {
      $(".row", p).innerHTML = `<p>Downloading… this takes a minute or two.</p>`;
      try { await api("/tunein/install", {}); closePop(); toggle(true); }
      catch (e) { $(".row", p).innerHTML = `<p class="warn">${esc(e.message)}</p>`; }
    };
  }

  $("#tuneMore").onclick = async () => {
    if (pop) return closePop();
    let devs = [];
    try { devs = (await api("/tunein/devices")).devices ?? []; } catch { /* list unavailable */ }
    const t = st.talk ?? {};
    const p = openPop(`<h4>🎧 Tune in</h4>
      <p>Listens to what plays in your headset and answers when anyone says “Dayspring”. Nothing anyone says is saved unless it was for me. People on the call can ask questions; only you can make changes.</p>
      <label for="tuneDev">Listen to</label>
      <select id="tuneDev"><option value="">Whatever Windows is playing through (now: ${esc(devs.find((d) => d.default)?.name ?? "default")})</option>${devs.filter((d) => !/voicemeeter/i.test(d.name)).map((d) => `<option value="${esc(d.name)}" ${st.deviceWanted === d.name ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select>
      <label><input type="checkbox" id="tuneTalk" ${t.talk ? "checked" : ""}> Answer into the call (friends hear me)</label>
      <p id="tuneTalkHelp">${t.talk
        ? `On. In Discord → User Settings → Voice &amp; Video, <b>Input Device</b> must be <code>Voicemeeter Out B1</code> (your mic still goes through). ${t.voicemeeter?.running ? "" : '<span class="warn">Voicemeeter isn\'t running, so friends can\'t hear you until it starts.</span>'}`
        : "Off: my answers play only in your headset. Turning it on uses Voicemeeter to mix my voice with your mic; you'll set Discord's input to <code>Voicemeeter Out B1</code> once."}</p>
      ${t.bridge ? `<p><button class="plain" id="tuneFinish">I'm done using the call mixer</button></p>` : ""}
      <div class="row"><button id="tuneGo">${st.on ? "Stop listening" : "Start listening"}</button></div>`);
    $("#tuneGo", p).onclick = async () => { const dev = $("#tuneDev", p).value; closePop(); if (st.on) return toggle(false); st.deviceWanted = dev; const r = await api("/tunein", { on: true, device: dev || null }).catch((e) => ({ why: e.message })); if (r.needsInstall) return showInstall(r.why); st = { ...st, ...r }; paint(); card(r.ok ? "🎧 Tuned in" : "Couldn't tune in", r.ok ? `Listening to ${r.device || "your headset"}.` : r.why); };
    $("#tuneTalk", p).onchange = async (e) => {
      $("#tuneTalkHelp", p).textContent = e.target.checked ? "Setting up Voicemeeter…" : "Okay.";
      const s = await api("/call/talk", { on: e.target.checked }).catch((err) => ({ error: err.message }));
      st.talk = s;
      if (e.target.checked && !s.talk) { e.target.checked = false; $("#tuneTalkHelp", p).innerHTML = `<span class="warn">${esc(s.error || "Couldn't set that up.")}</span>`; return; }
      $("#tuneTalkHelp", p).innerHTML = s.talk
        ? `Done. <b>One step in Discord:</b> User Settings → Voice &amp; Video → <b>Input Device</b> → <code>Voicemeeter Out B1</code>. Keep Output on your headset. Your friends will still hear you, plus me when I answer.`
        : "Off: my answers stay in your headset. Discord keeps working as it is.";
      paint();
    };
    const fin = $("#tuneFinish", p);
    if (fin) fin.onclick = async () => {
      if (!confirmInline(fin, "First set Discord's Input Device back to your headset mic, then click again.")) return;
      st.talk = await api("/call/finish", {}); closePop(); card("Call mixer closed", "Voicemeeter is off. Discord should use your headset mic directly now.");
    };
  };
  function confirmInline(el, msg) { if (el.dataset.armed) return true; el.dataset.armed = "1"; el.textContent = msg; return false; }

  // ---- what it heard and says ----
  let cardEl = null, cardTimer = 0;
  function card(title, text) {
    cardEl?.remove(); clearTimeout(cardTimer);
    cardEl = document.createElement("div"); cardEl.className = "tunecard"; cardEl.innerHTML = `${esc(title)}${text ? `<small>${esc(text)}</small>` : ""}`;
    document.body.appendChild(cardEl);
    cardTimer = setTimeout(() => { cardEl?.remove(); cardEl = null; }, 9000);
  }
  let outs = null;
  async function sinkFor(label) {
    if (!label || !navigator.mediaDevices?.enumerateDevices) return null;
    outs ??= (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audiooutput");
    return outs.find((d) => d.label.toLowerCase().startsWith(label.toLowerCase()))?.deviceId ?? null;
  }
  navigator.mediaDevices?.addEventListener?.("devicechange", () => { outs = null; });
  // ✋ Stop (tv.js stopSpeaking) ends a call answer too: the one playing stops and any still waiting are dropped
  let callGen = 0;
  window.dsStopCall = () => { callGen++; try { audioEl?.pause(); } catch { /* gone */ } api("/tunein/speaking", { on: false }).catch(() => {}); };
  function speak(text) { const g = callGen; const run = () => (g === callGen ? speakNow(text) : null); return window.dsVoiceLock ? window.dsVoiceLock.run(run) : run(); }
  async function speakNow(text) {
    // ask the server where answers go right now (the call mixer may have come up after this page loaded)
    try { const fresh = await api("/tunein"); st = { ...st, ...fresh }; } catch { /* use what we have */ }
    const talkTo = st.talk?.talk ? st.talk.playTo : null;
    const ms = 3000 + text.length * 75;
    api("/tunein/speaking", { on: true, ms }).catch(() => {});
    const done = () => api("/tunein/speaking", { on: false }).catch(() => {});
    try {
      const r = await fetch("/api/tts?text=" + encodeURIComponent(text));
      if (r.status === 204 || !r.ok) {         // free voices: the browser speaks (it can't be sent into the call)
        await new Promise((ok) => { const u = new SpeechSynthesisUtterance(text); u.onend = u.onerror = () => { done(); ok(); }; speechSynthesis.speak(u); setTimeout(ok, 8000 + text.length * 90); }); return;
      }
      const url = URL.createObjectURL(await r.blob());
      audioEl?.pause(); audioEl = new Audio(url);
      audioEl.volume = Math.max(0, Math.min(1, window.dsCallVolume ?? 1));   // Sound panel → "Call answers"
      let sink = await sinkFor(talkTo);
      if (talkTo && !sink) { outs = null; sink = await sinkFor(talkTo); }   // the device list may be stale
      if (talkTo && !sink) card("Couldn't reach the call", `I can't find “${talkTo}”, so I answered in your headset only. Is Voicemeeter running?`);
      if (sink && audioEl.setSinkId) {
        const set = await audioEl.setSinkId(sink).then(() => true).catch(() => false);
        if (!set) card("Couldn't reach the call", "Chrome wouldn't send my voice to the call mixer, so I answered in your headset only.");
      }
      const mine = audioEl;
      await new Promise((ok) => { mine.onended = mine.onerror = mine.onpause = () => { URL.revokeObjectURL(url); done(); ok(); }; mine.play().catch(() => { done(); ok(); }); setTimeout(ok, 8000 + text.length * 90); });
    } catch { done(); }
  }

  try {
    const hookTunein = (es) => es.addEventListener("tunein", (e) => {
      const d = JSON.parse(e.data);
      if (d.kind === "state") { st = { ...st, ...d }; paint(); }
      else if (d.kind === "wake") { wrap.classList.add("wake"); setTimeout(() => wrap.classList.remove("wake"), 6000); }
      else if (d.kind === "heard") { wrap.classList.remove("wake"); card("🎧 " + d.text, "Heard on the call"); }
      else if (d.kind === "reply") { card(d.text, d.heard ? `“${d.heard}”` : ""); speak(d.text); }
    });
    if (window.dsEvents) hookTunein(window.dsEvents); else addEventListener("ds-events", (e) => hookTunein(e.detail), { once: true });
  } catch { /* no live updates */ }

  // The rest of the display speaks too (announcements, replies): tell Tune in, so it never answers itself.
  const log = $("#log");
  if (log) new MutationObserver((ms) => { if (!st.on) return; for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains("ai") && n.textContent.trim()) api("/tunein/said", { text: n.textContent.trim() }).catch(() => {}); }).observe(log, { childList: true });
  const ss = window.speechSynthesis;
  if (ss) { const orig = ss.speak.bind(ss); ss.speak = (u) => { if (st.on) api("/tunein/speaking", { on: true, ms: 2000 + (u.text?.length ?? 0) * 75 }).catch(() => {}); return orig(u); }; }
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...a) { if (st.on && this !== audioEl && !this.muted && !(this.duration > 60)) api("/tunein/speaking", { on: true, ms: Math.min(20000, (this.duration || 6) * 1000 + 500) }).catch(() => {}); return play.apply(this, a); };

  refresh();
  setInterval(refresh, 60_000);
})();
