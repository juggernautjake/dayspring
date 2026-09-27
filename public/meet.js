// Meetings on the Dayspring screen: the "Meeting" chip (click: shrink the meeting to the corner or bring it back), the
// meeting panel (controls, who may ask, Demo mode and its pre-flight checklist, the rehearsal), the card that shows who
// is answering (the orb for Dayspring, the lantern for Lantern), and a results card with the lessons and links.
// The meeting itself runs in its own window (Google doesn't allow Meet inside another page); lib/meet drives it.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (path, body) => {
    const r = await fetch("/api" + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  };
  const tools = $(".talktools");
  if (!tools) return;
  const css = document.createElement("style");
  css.textContent = `
  .meetwrap{display:inline-flex;align-items:center;gap:.25em}
  .meetwrap .meetbtn{font:inherit}
  .meetpop{position:fixed;z-index:31;width:min(30em,94vw);max-height:calc(100vh - 16px);overflow:auto;background:rgba(20,24,54,.97);backdrop-filter:blur(16px);border:1px solid var(--edge2);border-radius:1em;padding:1em 1.1em;box-shadow:0 20px 60px rgba(0,0,0,.6);font-size:.9em;color:var(--ink)}
  .meetpop h4{margin:.1em 0 .4em;font-weight:500;font-size:1.05em}
  .meetpop h5{margin:1em 0 .35em;font-weight:500;font-size:.95em;color:var(--muted)}
  .meetpop p{margin:.35em 0;color:var(--muted);font-weight:300;line-height:1.4}
  .meetpop .row{display:flex;gap:.45em;flex-wrap:wrap;margin:.5em 0}
  .meetpop button{font:inherit;font-size:.9em;color:var(--ink);background:rgba(124,140,255,.25);border:1px solid var(--edge2);border-radius:.7em;padding:.35em .8em;cursor:pointer}
  .meetpop button.plain{background:transparent}
  .meetpop button.warn{background:rgba(234,67,53,.25)}
  .meetpop input[type=text],.meetpop input[type=url]{width:100%;box-sizing:border-box;font:inherit;color:var(--ink);background:rgba(255,255,255,.07);border:1px solid var(--edge2);border-radius:.6em;padding:.4em .55em}
  .meetpop .x{position:absolute;top:.5em;right:.6em;background:transparent;border:0;padding:.2em .4em}
  .meetpop .check{list-style:none;margin:.3em 0;padding:0;display:grid;gap:.35em}
  .meetpop .check li{display:grid;grid-template-columns:1.4em 1fr auto;gap:.4em;align-items:start;padding:.35em .5em;border-radius:.6em;background:rgba(255,255,255,.04)}
  .meetpop .check li small{display:block;color:var(--muted);font-weight:300}
  .meetpop .switch{display:flex;align-items:center;gap:.5em;margin:.35em 0}
  .meetpop .stat{font-size:.9em}
  .meetres{position:fixed;z-index:18;right:1.2em;top:4.5em;width:min(26em,40vw);background:rgba(20,24,54,.94);backdrop-filter:blur(14px);border:1px solid rgba(255,190,90,.45);border-radius:1em;padding:.8em 1em;font-size:.9em;box-shadow:0 14px 44px rgba(0,0,0,.5);animation:tin .4s ease}
  .meetres[data-as=dayspring]{border-color:rgba(124,140,255,.55)}
  .meetres .q{color:var(--muted);font-weight:300;margin-bottom:.4em}
  .meetres .a{white-space:pre-wrap;line-height:1.4;max-height:40vh;overflow:auto}
  .meetres .cites{margin-top:.6em;display:grid;gap:.35em}
  .meetres .cites a,.meetres .cites button{font:inherit;font-size:.9em;color:var(--ink);background:rgba(255,255,255,.07);border:1px solid var(--edge2);border-radius:.6em;padding:.3em .6em;cursor:pointer;text-decoration:none}
  .meetres .x{position:absolute;top:.4em;right:.5em;background:transparent;border:0;color:var(--muted);cursor:pointer}
  html.mini .meetres{left:.6em;right:.6em;width:auto;top:auto;bottom:5em}`;
  document.head.appendChild(css);

  const wrap = document.createElement("span");
  wrap.className = "meetwrap";
  wrap.innerHTML = `<button class="meetbtn" id="meetMore" title="Meetings: Dayspring and Lantern in a Google Meet call" aria-label="Meetings">📹</button>`;
  tools.appendChild(wrap);
  let st = { stage: "closed" }, chip = null, people = null, nameCard = null, pop = null, lastCardAs = null;

  // the shared parts (ecosystem-core/client/meet-tile.js and the lantern avatar)
  const parts = Promise.all([import("/eco/client/meet-tile.js"), import("/eco/client/lantern-avatar.js").catch(() => null)]).then(([tile, lamp]) => {
    chip = tile.mountChip(wrap, { onClick: () => chipClick() });
    wrap.insertBefore(chip.el, $("#meetMore"));
    nameCard = tile.mountNameCard(document.body, { lanternAvatar: lamp });
    chip.update(st);
    return { tile, lamp };
  }).catch(() => null);

  function paint() {
    chip?.update(st);
    $("#meetMore").textContent = st.stage && st.stage !== "closed" ? "▾" : "📹";
    if (pop) renderPop();
  }
  async function refresh() { try { st = await api("/meet/status"); paint(); } catch { /* restarting */ } }
  function chipClick() {
    if (st.stage === "in-call") return api("/meet/view", { view: st.view === "tile" ? "large" : "tile" }).then((r) => { st.view = r.view ?? st.view; paint(); }).catch(() => {});
    if (st.stage === "sign-in" || st.stage === "setup" || st.stage === "prejoin" || st.stage === "loading") return api("/meet/view", { view: "large" }).catch(() => {});
    openPop();
  }

  // ---- the meeting panel ----
  function closePop() { pop?.remove(); pop = null; }
  function openPop() { if (pop) return closePop(); pop = document.createElement("div"); pop.className = "meetpop"; document.body.appendChild(pop); renderPop(); place(); }
  function place() {
    if (!pop) return;
    const r = wrap.getBoundingClientRect();
    pop.style.top = Math.max(8, Math.min(innerHeight - pop.offsetHeight - 8, r.bottom + 8)) + "px";
    pop.style.left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, r.right - pop.offsetWidth)) + "px";
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && pop) closePop(); });
  let pre = null, cfg = null;
  async function renderPop() {
    if (!pop) return;
    const inCall = st.stage === "in-call";
    const active = st.stage && !["closed", "left"].includes(st.stage);
    const check = st.check ?? {};
    const tick = (v) => (v === true ? "✓" : v === false ? "✗" : "…");
    pop.innerHTML = `<button class="x plain" aria-label="Close">✕</button>
      <h4>📹 ${active ? (st.rehearsal ? "Rehearsal meeting" : inCall ? "In a meeting" : ({ loading: "Joining…", prejoin: "At the meeting's door", "sign-in": "Sign in to Google", setup: "Meeting window" }[st.stage] ?? "Meeting")) : "Meetings"}</h4>
      ${active ? `
        <p class="stat">Captions detected ${tick(check.captions)} · Chat ${tick(check.chat)}${st.fallbackTunein ? " · listening with Tune in (captions unreadable)" : ""}</p>
        <div class="row">
          <button data-v="${st.view === "tile" ? "large" : "tile"}">${st.view === "tile" ? "⤢ Bring it back" : "⤡ To the corner"}</button>
          <button data-c="mute">🎙️ Mute / unmute</button><button data-c="camera">📷 Camera</button><button data-c="captions">CC Captions</button><button data-c="chat">💬 Chat</button>
          <button class="warn" data-leave>Leave…</button>
        </div>
        <h5>Who can ask</h5><div id="meetPeople"></div>
      ` : `
        <p>Dayspring opens your Google Meet in its own window (a small tile in the corner while you use Dayspring), reads the captions to know who's talking, and answers the people you allow. Lantern answers too.</p>
        <label for="meetLink">Meet link</label>
        <div class="row"><input type="url" id="meetLink" placeholder="https://meet.google.com/abc-defg-hij"><button data-join>Join</button></div>
        <div class="row"><button class="plain" data-rehearse>▶ Rehearse (a pretend meeting)</button></div>
      `}
      <h5>Demo mode</h5>
      <label class="switch"><input type="checkbox" id="meetDemo" ${st.demo ? "checked" : ""}> Demo mode: anyone can ask Dayspring or Lantern</label>
      <label class="switch"><input type="checkbox" id="meetRoute" ${st.routeCourseToLantern ? "checked" : ""}> Hand course questions to Lantern</label>
      <label class="switch"><input type="checkbox" id="meetAnnounce" ${st.announce !== false ? "checked" : ""}> Say hello in the meeting chat when joining</label>
      <h5>Pre-flight checklist</h5><ul class="check" id="meetPre"><li><span>…</span><span>Checking…</span></li></ul>
      <p id="meetSound"></p>
      <label for="meetPublic">Public link to a lesson ({lesson} becomes the lesson, e.g. u4l2)</label>
      <div class="row"><input type="url" id="meetPublic" placeholder="https://…#{lesson}"><button data-savelink>Save</button></div>`;
    $(".x", pop).onclick = closePop;
    pop.querySelectorAll("[data-v]").forEach((b) => (b.onclick = async () => { const r = await api("/meet/view", { view: b.dataset.v }).catch(() => ({})); st.view = r.view ?? st.view; paint(); }));
    pop.querySelectorAll("[data-c]").forEach((b) => (b.onclick = async () => { const r = await api("/meet/control", { action: b.dataset.c }).catch((e) => ({ reply: e.message })); toast(r.reply); }));
    const lv = $("[data-leave]", pop); if (lv) lv.onclick = async () => { if (!lv.dataset.armed) { lv.dataset.armed = "1"; lv.textContent = "Click again to leave"; return; } const r = await api("/meet/leave", {}).catch(() => ({})); toast(r.reply || "Left the meeting."); refresh(); };
    const jb = $("[data-join]", pop); if (jb) jb.onclick = async () => { const link = $("#meetLink", pop).value.trim(); jb.disabled = true; const r = await api("/meet/join", { link }).catch((e) => ({ reply: e.message })); jb.disabled = false; toast(r.reply); refresh(); };
    const rb = $("[data-rehearse]", pop); if (rb) rb.onclick = async () => { rb.disabled = true; const r = await api("/meet/rehearse", {}).catch((e) => ({ reply: e.message })); toast(r.reply); refresh(); };
    $("#meetDemo", pop).onchange = async (e) => { st = await api("/meet/demo", { on: e.target.checked }).catch(() => st); paint(); };
    $("#meetRoute", pop).onchange = async (e) => { await api("/meet/settings", { routeCourseToLantern: e.target.checked }).catch(() => {}); refresh(); };
    $("#meetAnnounce", pop).onchange = async (e) => { await api("/meet/settings", { announce: e.target.checked }).catch(() => {}); refresh(); };
    $("[data-savelink]", pop).onclick = async () => { const v = $("#meetPublic", pop).value.trim(); try { await api("/meet/settings", { publicLessonUrl: v }); toast("Saved the lesson link."); loadPre(); } catch (e) { toast(e.message); } };
    const box = $("#meetPeople", pop);
    if (box) { const got = await parts; if (got) { people = got.tile.mountPeople(box, { adapter: { post: (p, b) => api(p, b) } }); people.update(st); } }
    try { cfg ??= await api("/meet/settings"); const c = Object.values(cfg.courses ?? {})[0]; if (c?.publicLessonUrl) $("#meetPublic", pop).value = c.publicLessonUrl; } catch { /* fine */ }
    loadPre();
    place();
  }
  async function loadPre() {
    if (!pop) return;
    try { pre = await api("/meet/preflight"); } catch { return; }
    const ul = $("#meetPre", pop); if (!ul) return;
    ul.innerHTML = pre.items.map((i) => `<li><span>${i.ok ? "✅" : "⬜"}</span><span>${esc(i.label)}<small>${esc(i.detail)}</small></span><span>${
      i.action === "signin" ? `<button data-a="signin">Sign in…</button>` : i.action === "soundtest" ? `<button data-a="sound">Test</button>` : i.action?.startsWith("confirm:") ? `<button data-a="${esc(i.action)}">${i.ok ? "Undo" : "Done"}</button>` : i.action === "rehearse" && !i.ok ? `<button data-a="rehearse">Rehearse</button>` : ""}</span></li>`).join("")
      + `<li><span>${pre.ready ? "🎉" : "•"}</span><span>${pre.ready ? "Everything's ready for the demo." : "Tick everything above before the meeting."}</span><span></span></li>`;
    ul.querySelectorAll("[data-a]").forEach((b) => (b.onclick = async () => {
      const a = b.dataset.a;
      if (a === "signin") { const r = await api("/meet/signin", {}).catch((e) => ({ reply: e.message })); toast(r.reply); }
      else if (a === "sound") await soundTest();
      else if (a === "rehearse") { const r = await api("/meet/rehearse", {}).catch((e) => ({ reply: e.message })); toast(r.reply); }
      else if (a.startsWith("confirm:")) { const k = a.slice(8); const item = pre.items.find((x) => x.action === a); await api("/meet/confirm", { [k]: !item?.ok }).catch(() => {}); }
      loadPre();
    }));
    place();
  }
  // the same test as Settings → Calls: play a test phrase into the call mixer and listen for it (read-only)
  async function soundTest() {
    const out = $("#meetSound", pop); if (out) out.textContent = "Listening… playing a test phrase into the call mixer.";
    const check = api("/calls/test", { ms: 5000 });
    try {
      await new Promise((r) => setTimeout(r, 700));
      const a = new Audio("/api/tts/stream?text=" + encodeURIComponent("Testing, one two three. This is Dayspring."));
      const devs = (await navigator.mediaDevices?.enumerateDevices?.().catch(() => [])) ?? [];
      const sink = devs.find((d) => d.kind === "audiooutput" && /^voicemeeter input/i.test(d.label));
      if (sink && a.setSinkId) await a.setSinkId(sink.deviceId).catch(() => {});
      await a.play().catch(() => {});
      const r = await check;
      const ok = Boolean(r.voice?.ok && r.voicemeeterRunning);
      await api("/meet/confirm", { soundTest: ok });
      if (out) out.textContent = ok ? "✓ My voice reached the call mixer, and Voicemeeter is running." : `✗ ${r.voicemeeterInstalled === false ? "Voicemeeter isn't installed." : !r.voicemeeterRunning ? "Voicemeeter isn't running." : "My voice didn't reach the call mixer."} Turn on “Answer into the call” in Settings → Calls.`;
    } catch (e) { if (out) out.textContent = "The test didn't run: " + e.message; }
  }

  // ---- little notes, the name card and the results card ----
  let toastEl = null, toastT = 0;
  function toast(text) {
    if (!text) return;
    toastEl?.remove(); clearTimeout(toastT);
    toastEl = document.createElement("div"); toastEl.className = "tunecard"; toastEl.innerHTML = `📹 ${esc(text)}`;
    document.body.appendChild(toastEl); toastT = setTimeout(() => { toastEl?.remove(); toastEl = null; }, 9000);
  }
  let resEl = null;
  function results(d) {
    resEl?.remove();
    if (!d.citations?.length && !d.chat) return;
    resEl = document.createElement("div"); resEl.className = "meetres"; resEl.dataset.as = d.as;
    const who = d.as === "lantern" ? "🏮 Lantern" : "● Dayspring";
    resEl.innerHTML = `<button class="x" aria-label="Close">✕</button><div class="q">${esc(who)} · ${esc(d.who ?? "")}: “${esc(d.question)}”</div>
      <div class="a">${esc((d.chat || d.spoken || "").replace(/\n📘[\s\S]*$/, ""))}</div>
      <div class="cites">${(d.citations ?? []).map((c) => `<div>📘 ${esc(c.label)}: ${esc(c.title)} ${c.publicUrl ? `<a href="${esc(c.publicUrl)}" target="_blank" rel="noopener">Open the lesson</a>` : ""} <button data-open="${esc(c.course)}|${esc(c.lessonId)}">Open in Lantern</button></div>`).join("")}</div>`;
    document.body.appendChild(resEl);
    $(".x", resEl).onclick = () => { resEl?.remove(); resEl = null; };
    resEl.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => { const [course, lesson] = b.dataset.open.split("|"); api("/lantern/open", { course, lesson }).catch((e) => toast(e.message)); }));
  }
  addEventListener("ds-call-speaking", (e) => {
    const d = e.detail ?? {};
    if (!nameCard || !lastCardAs) return;
    if (d.on) nameCard.speaking(true); else { nameCard.speaking(false); setTimeout(() => { if (!document.querySelector('.eco-meet-card[data-speaking="true"]')) nameCard.hide(); }, 2500); }
  });
  const hook = (es) => es.addEventListener("meet", (e) => {
    let d; try { d = JSON.parse(e.data); } catch { return; }
    if (d.kind === "state") { st = { ...st, ...d }; paint(); }
    else if (d.kind === "answering") { lastCardAs = d.as; parts.then(() => nameCard?.show({ as: d.as, text: d.text, speaking: false, ms: 60_000 })); }
    else if (d.kind === "handoff") parts.then(() => nameCard?.show({ as: "dayspring", text: `Dayspring — handing ${d.who}'s question to Lantern`, speaking: true, ms: 8000 }));
    else if (d.kind === "answer") { results(d); if (!d.spoken) setTimeout(() => nameCard?.hide(), 4000); }
    else if (d.kind === "notice") toast(d.text);
  });
  if (window.dsEvents) hook(window.dsEvents); else addEventListener("ds-events", (e) => hook(e.detail), { once: true });
  $("#meetMore").onclick = () => openPop();
  refresh();
  setInterval(refresh, 30_000);
})();
