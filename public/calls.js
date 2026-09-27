// Settings → Calls: Dayspring in Discord, Zoom, Google Meet and Teams, and the Discord chat companion.
//   · Call apps: for each app, the exact microphone and speaker to pick on this computer, where that setting lives, and a
//     Test button (plays a test phrase into the call mixer while listening to it). Dayspring never changes a device.
//   · Speed: how quickly it answered the last 10 times (end of speech → first sound) and the settings that affect it.
//   · Discord chat: who can DM it, a "Dayspring channel", sharing your schedule, a Discord-only personality, the invite link.
// Everything saves as you go (data/calls.json), so no Save button.
(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (path, body) => {
    const r = await fetch("/api" + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "That didn't work. Try again.");
    return j;
  };
  let root = null, opts = {}, S = null, apps = null, appId = null, timer = null;
  const $ = (s) => root?.querySelector(s);
  const $$ = (s) => [...(root?.querySelectorAll(s) ?? [])];
  const ms = (v) => (v == null ? "–" : v >= 1000 ? (v / 1000).toFixed(2) + " s" : Math.round(v) + " ms");

  function html() {
    return `<h1>Calls</h1>
      <p class="lead">Dayspring can join your calls in two ways. <b>Tune in</b> (the 🎧 button on the Dayspring screen) works with any call app, no bot needed: it listens to your headset and answers into the call through Voicemeeter. The <b>Discord bot</b> joins your server as its own member and also chats in text.</p>
      <div id="cl-status" class="cl-status" aria-live="polite">Loading…</div>
      <h2>🎧 Call apps: what to pick so people hear Dayspring</h2>
      <p class="hint">Each call app needs two settings, once. Dayspring shows them here but never changes them for you.</p>
      <div class="cl-tabs" role="tablist" id="cl-tabs"></div>
      <div id="cl-card" class="cl-card"></div>
      <div class="row" style="gap:.6em;align-items:center;flex-wrap:wrap"><button type="button" class="btn small" id="cl-test">▶ Test</button><span class="hint" id="cl-test-out">Plays “Testing, one two three” into the call mixer and checks it arrived.</span></div>
      <table class="cl-table" id="cl-table"></table>

      <h2>⚡ Speed</h2>
      <p class="hint">How long from the end of the question to the first word of the answer. Aim: under 1.5 s with AI, under 0.8 s without.</p>
      <div id="cl-hud" class="cl-hud"></div>
      <div class="row cl-grid">
        <div class="field"><label for="cl-hang">Wait after someone stops talking</label><input type="range" id="cl-hang" min="250" max="1200" step="50"><div class="hint"><span id="cl-hang-v"></span>. Shorter answers sooner; too short cuts people off mid-pause.</div></div>
        <div class="field"><label for="cl-ack">While thinking</label><select id="cl-ack"><option value="off">Say nothing</option><option value="earcon">A soft blip</option><option value="mmhm">A short “mm-hm” (Discord bot)</option></select></div>
      </div>
      <div class="cl-toggles">
        ${tog("quickTranscript", "Quick listening", "Use the fast speech model's words when they're clear (skips a second, slower pass).")}
        ${tog("bargeIn", "Stop when someone talks over me", "The Discord bot hears everyone separately, so this works well there.")}
        ${tog("bargeInTunein", "…with Tune in too", "Tune in hears one mixed sound, so my own voice can trigger it. Best with headphones and “Answer into the call” off.")}
      </div>
      <div class="field"><label for="cl-arb">When the Discord bot and Tune in are both in the call</label><select id="cl-arb"><option value="bot">The bot answers (recommended: no double answers)</option><option value="tunein">Tune in answers</option></select></div>

      <h2>💬 Discord chat</h2>
      <p class="hint">Talk to Dayspring in Discord: @mention it, start a message with its name, use /ask /joke /time /weather /remind /help, or talk in its own channel. You get everything; friends get fun and answers, never your private things.</p>
      <div class="row cl-grid">
        <div class="field"><label for="cl-dm">Direct messages from</label><select id="cl-dm"><option value="anyone">Anyone</option><option value="server">People in a server with the bot</option><option value="owner">Only me</option><option value="off">Nobody</option></select></div>
        <div class="field"><label for="cl-chan">Dayspring's channel ID (optional)</label><input type="text" id="cl-chan" inputmode="numeric" placeholder="Every message there is for Dayspring" autocomplete="off"></div>
      </div>
      <div class="row cl-grid">
        <div class="field"><label for="cl-persona">Personality in Discord</label><select id="cl-persona"><option value="">The same as everywhere</option></select></div>
      </div>
      <div class="cl-toggles">${tog("shareSchedule", "Share my schedule with Discord", "Friends may ask what you're up to today. Your files, texts and prayer list stay private either way.")}</div>
      <div class="row" style="gap:.6em;align-items:center;flex-wrap:wrap"><button type="button" class="btn small" id="cl-invite">Copy invite link</button><span class="hint" id="cl-invite-out">Adds the bot (and its slash commands) to a server you manage.</span></div>
      <p class="hint">Setting up the bot the first time: Settings → Connections → Discord bot, and the <a href="/help#discord-bot">step-by-step guide</a>. All call apps: <a href="/help#discord-calls">Dayspring in calls</a>.</p>`;
  }
  function tog(key, title, desc) { return `<div class="toggle"><div class="txt"><b id="cl-${key}-l">${esc(title)}</b><div>${esc(desc)}</div></div><button type="button" class="sw" role="switch" id="cl-${key}" data-key="${key}" aria-labelledby="cl-${key}-l" aria-checked="false"></button></div>`; }

  function paintStatus(st) {
    if (!root?.isConnected || !$("#cl-status")) return;   // another Settings section is showing now
    const t = st.tunein ?? {}, b = st.bot ?? {}, talk = st.talk ?? {};
    const bits = [];
    bits.push(t.on ? `🎧 <b>Listening in this call</b>${t.appLabel ? ` · ${esc(t.appLabel)}` : ""} (hearing ${esc(t.device || "your headset")})` : "🎧 Tune in is off");
    bits.push(talk.talk ? (talk.voicemeeter?.running ? "🔈 Answers go into the call" : "⚠️ Answers into the call are on, but Voicemeeter isn't running") : "🔈 Answers stay in your headset");
    bits.push(!b.configured ? "🤖 Discord bot not set up" : b.status === "online" ? `🤖 Discord bot online${b.voice ? ` · in ${esc(b.voice.channel)}` : ""}` : `🤖 Discord bot ${esc(b.status)}${b.lastError ? ": " + esc(b.lastError) : ""}`);
    if (st.answering) bits.push(`Answering: ${st.answering === "bot" ? "the Discord bot" : "Tune in"}`);
    $("#cl-status").innerHTML = bits.map((x) => `<span>${x}</span>`).join("");
  }
  function paintApps() {
    if (!root?.isConnected || !$("#cl-card")) return;   // another Settings section is showing now
    if (!apps) return;
    const detected = apps.app?.app ?? null;
    appId ??= detected || "discord";
    $("#cl-tabs").innerHTML = apps.guides.map((g) => `<button type="button" role="tab" aria-selected="${g.app === appId}" data-app="${g.app}">${esc(g.name.replace(" (Chrome or Edge)", ""))}${g.app === detected ? " •" : ""}</button>`).join("");
    const g = apps.guides.find((x) => x.app === appId) ?? apps.guides.at(-1);
    const noVm = apps.devices?.voicemeeterInstalled === false;
    $("#cl-card").innerHTML = `
      <div class="cl-dev"><span>🎙️ Microphone / Input</span><code>${esc(g.microphone)}</code><small>${esc(g.micWhy)}</small></div>
      <div class="cl-dev"><span>🔊 Speaker / Output</span><code>${esc(g.speaker)}</code><small>${esc(g.speakerWhy)}${apps.listening ? "" : " (Tune in is off now, so this is your Windows default.)"}</small></div>
      <p><b>Where:</b> ${esc(g.where)}</p>
      ${g.extras?.length ? `<ul>${g.extras.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      ${noVm ? `<p class="warn">Voicemeeter isn't installed yet, so “${esc(g.microphone)}” doesn't exist on this computer. On the Dayspring screen, open 🎧 ▾ and turn on “Answer into the call”: it sets Voicemeeter up.</p>` : ""}
      <p class="hint">Dayspring can't see ${esc(g.name.split(" (")[0])}'s own settings, so it can't tick these off for you. The Test button checks Dayspring's side.</p>`;
    $("#cl-table").innerHTML = `<thead><tr><th>App</th><th>Microphone</th><th>Speaker</th></tr></thead><tbody>${apps.guides.map((x) => `<tr><td>${esc(x.name)}</td><td><code>${esc(x.microphone)}</code></td><td>${esc(x.speaker)}</td></tr>`).join("")}</tbody>`;
    $$("#cl-tabs [data-app]").forEach((b) => b.onclick = () => { appId = b.dataset.app; paintApps(); });
  }
  function paintHud(l) {
    if (!root?.isConnected || !$("#cl-hud")) return;   // another Settings section is showing now
    const rows = l.last ?? [];
    if (!rows.length) { $("#cl-hud").innerHTML = `<p class="hint">No answers yet. Say “Dayspring, what time is it?” in a call and the timings show up here.</p>`; return; }
    const max = Math.max(1500, ...rows.map((r) => r.total ?? 0));
    const bar = (r) => { const w = (v) => (v == null ? 0 : Math.max(0, Math.min(100, v / max * 100))); return `<div class="cl-bar" title="words ${ms(r.stt)} · AI starts ${ms(r.firstToken)} · first sentence ${ms(r.firstSentence)} · first sound ${ms(r.firstAudio)}"><i class="s" style="width:${w(r.stt)}%"></i><i class="t" style="left:${w(r.stt)}%;width:${w(r.firstSentence) - w(r.stt)}%"></i><i class="a" style="left:${w(r.firstSentence)}%;width:${w(r.firstAudio) - w(r.firstSentence)}%"></i></div>`; };
    $("#cl-hud").innerHTML = `<p>Typical: <b>${ms(l.median)}</b>${l.median != null ? (l.median <= 1500 ? " ✓" : " (slower than the 1.5 s aim)") : ""}</p>
      <table class="cl-table"><thead><tr><th>When</th><th>Where</th><th>Words</th><th>First sentence</th><th>First sound</th><th></th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(new Date(r.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}</td><td>${esc({ tunein: "Tune in", "discord-voice": "Discord voice", "discord-text": "Discord chat" }[r.via] ?? r.via)}${r.offline ? " · no AI" : ""}</td><td>${ms(r.stt)}</td><td>${ms(r.firstSentence)}</td><td><b>${ms(r.total)}</b>${r.timeout ? " (never played)" : ""}</td><td>${bar(r)}</td></tr>`).join("")}</tbody></table>
      <p class="hint">Bars: blue = hearing the words, gold = the AI's first sentence, green = the voice starting.</p>`;
  }
  function paintSettings() {
    if (!root?.isConnected || !$("#cl-hang")) return;   // another Settings section is showing now
    $("#cl-hang").value = S.hangMs; $("#cl-hang-v").textContent = `${S.hangMs} ms`;
    $("#cl-ack").value = S.ack; $("#cl-arb").value = S.arbitration; $("#cl-dm").value = S.dm; $("#cl-chan").value = S.chatChannelId || "";
    $$(".sw[data-key]").forEach((b) => b.setAttribute("aria-checked", String(Boolean(S[b.dataset.key]))));
    const bt = $("#cl-bargeInTunein"); if (bt) { bt.disabled = !S.bargeIn; bt.closest(".toggle").style.opacity = S.bargeIn ? "" : ".5"; }
    if ($("#cl-persona").dataset.loaded) $("#cl-persona").value = S.discordPersona || "";
  }
  async function save(patch) {
    try { S = await api("/calls/settings", patch); paintSettings(); opts.toast?.("Saved"); } catch (e) { opts.toast?.(e.message); }
  }
  async function load() {
    const [st, a, l] = await Promise.all([api("/calls/status").catch(() => null), api("/calls/apps").catch(() => null), api("/calls/latency").catch(() => ({ last: [] }))]);
    if (!root?.isConnected || !$("#cl-status")) return;
    if (st) { S = st.settings; paintStatus(st); paintSettings(); }
    if (a) { apps = a; paintApps(); }
    paintHud(l);
  }

  async function test() {
    const out = $("#cl-test-out"), btn = $("#cl-test");
    if (!out || !btn) return;
    btn.disabled = true; out.textContent = "Listening… playing the test phrase into the call mixer.";
    const check = api("/calls/test", { ms: 5000 });
    try {
      // play the test phrase where call answers go: "Voicemeeter Input"
      await new Promise((r) => setTimeout(r, 700));
      const a = new Audio("/api/tts/stream?text=" + encodeURIComponent("Testing, one two three. This is Dayspring."));
      const devs = (await navigator.mediaDevices?.enumerateDevices?.().catch(() => [])) ?? [];
      const sink = devs.find((d) => d.kind === "audiooutput" && /^voicemeeter input/i.test(d.label));
      if (sink && a.setSinkId) await a.setSinkId(sink.deviceId).catch(() => {});
      await a.play().catch(() => {});
      const r = await check;
      const lines = [];
      if (r.voicemeeterInstalled === false) lines.push("✗ Voicemeeter isn't installed, so there's no call mixer yet.");
      else {
        lines.push(r.voice?.ok ? "✓ My voice reached the call mixer (Voicemeeter Input)." : `✗ My voice didn't reach the call mixer${sink ? "" : " (this browser can't see “Voicemeeter Input”)"}.`);
        lines.push(r.voicemeeterRunning ? "✓ Voicemeeter is running." : "✗ Voicemeeter isn't running: start it, or turn on “Answer into the call”.");
        lines.push(r.talk ? "✓ “Answer into the call” is on." : "• “Answer into the call” is off: answers stay in your headset.");
        if (r.callMic) lines.push(`→ In your call app, the microphone must be “${r.callMic}”.`);
      }
      if (r.listening) lines.push(r.listening.ok ? `✓ I can hear ${r.listening.device}.` : `• ${r.listening.device ?? "Your speaker"} was quiet during the test (normal if nobody was talking).`);
      out.innerHTML = lines.map(esc).join("<br>");
    } catch (e) { out.textContent = "The test didn't finish: " + e.message; }
    finally { btn.disabled = false; }
  }

  function mount(el, o = {}) {
    root = el; opts = o;
    load();
    api("/persona").then((p) => { const s = $("#cl-persona"); if (!s) return; s.innerHTML += (p.presets ?? []).map((x) => `<option value="${esc(x.id)}">${esc(x.icon)} ${esc(x.name)}</option>`).join(""); s.dataset.loaded = "1"; if (S) s.value = S.discordPersona || ""; }).catch(() => {});
    $("#cl-test").onclick = test;
    $("#cl-hang").oninput = () => { $("#cl-hang-v").textContent = `${$("#cl-hang").value} ms`; };
    $("#cl-hang").onchange = () => save({ hangMs: Number($("#cl-hang").value) });
    $("#cl-ack").onchange = () => save({ ack: $("#cl-ack").value });
    $("#cl-arb").onchange = () => save({ arbitration: $("#cl-arb").value });
    $("#cl-dm").onchange = () => save({ dm: $("#cl-dm").value });
    $("#cl-persona").onchange = () => save({ discordPersona: $("#cl-persona").value });
    $("#cl-chan").onchange = () => { const v = $("#cl-chan").value.trim(); if (v && !/^\d{15,22}$/.test(v)) return opts.toast?.("A channel ID is a long number (right-click the channel → Copy Channel ID)."); save({ chatChannelId: v }); };
    $$(".sw[data-key]").forEach((b) => b.onclick = () => { if (b.disabled) return; save({ [b.dataset.key]: b.getAttribute("aria-checked") !== "true" }); });
    $("#cl-invite").onclick = async () => {
      try { const r = await api("/discord/invite"); if (!r.url) { $("#cl-invite-out").textContent = r.why; return; } await navigator.clipboard?.writeText(r.url).catch(() => {}); $("#cl-invite-out").innerHTML = `Copied. Open it in your browser: <code>${esc(r.url)}</code>`; }
      catch (e) { $("#cl-invite-out").textContent = e.message; }
    };
    clearInterval(timer);
    timer = setInterval(() => { if (!root?.isConnected || !$("#cl-status")) return clearInterval(timer); api("/calls/latency").then(paintHud).catch(() => {}); api("/calls/status").then(paintStatus).catch(() => {}); }, 5000);
  }
  window.DayspringCalls = { html, mount };
})();
