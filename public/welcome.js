// Dayspring's first-run guided setup (/welcome). A friendly guide (a free, natural Windows voice) talks the new owner
// through each step; captions show what he says, and he can be muted, paused, or asked to repeat himself. Every step
// saves as it goes through the same /api/setup/* routes as Settings, and /api/welcome/state remembers where they are,
// so closing the page picks up at the same step. Everything here can be changed later in Settings.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = { get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } } };
  async function api(path, body, method) {
    const verb = method ?? (body === undefined ? "GET" : "POST");
    const r = await fetch("/api" + path, verb === "GET" ? {} : { method: verb, headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
    const ct = r.headers.get("content-type") ?? "";
    const j = ct.includes("json") ? await r.json().catch(() => ({})) : { ok: r.ok, blob: await r.blob() };
    if (!r.ok && (j.error || r.status >= 400)) throw Object.assign(new Error(j.error || `Something went wrong (${r.status})`), { status: r.status, data: j });
    return j;
  }
  const toast = (t) => { const el = $("#toast"); el.textContent = t; el.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("show"), 2600); };
  const msg = (el, text, kind = "") => { if (!el) return; el.className = "msg " + kind; el.textContent = text; };

  /* ================================================================ the guide's voice ================================ */
  // A warm male voice, separate from Dayspring's own voice: Edge's free Natural voices Andrew, Brian or Guy, else Windows'
  // David (the list is in voices.js); with an ElevenLabs key, ElevenLabs' Will. Choosing Dayspring's voice never changes it.
  const G = { voice: null, muted: store.get("ds-welcome-muted", false), paused: false, last: "", blocked: false, speaking: false, unlocked: false };
  const PREF = [/andrew.*natural/i, /guy.*natural/i, /brian.*natural/i, /christopher.*natural/i, /eric.*natural/i, /roger.*natural/i, /davis.*natural/i, /natural.*(andrew|guy|brian|christopher|eric|roger)/i,
    /microsoft (andrew|guy|brian|christopher|eric|roger|davis|mark|david)/i, /google us english/i, /\b(male|man)\b/i];
  function pickVoice() {
    if (window.dsVoicePrefs) return (G.voice = window.dsVoicePrefs.pick("guide"));
    const vs = (window.speechSynthesis?.getVoices() ?? []).filter((v) => /^en(-|_|$)/i.test(v.lang));
    for (const re of PREF) { const v = vs.find((x) => re.test(x.name)); if (v) return (G.voice = v); }
    return (G.voice = vs.find((v) => /en-us/i.test(v.lang)) ?? vs[0] ?? null);
  }
  window.speechSynthesis?.addEventListener?.("voiceschanged", pickVoice);
  pickVoice();
  const chunks = (t) => String(t).replace(/\s+/g, " ").match(/[^.!?]+[.!?]+["”']?\s*|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  function say(text) {
    if (!text) return;
    G.last = text;
    const parts = chunks(text);
    // the caption is the whole line, one span per sentence, so it can follow along while he talks
    $("#caption").innerHTML = parts.map((x, i) => `<span data-c="${i}">${esc(x)}</span>`).join(" ");
    window.__guideLog?.push(text);                       // (tests)
    if (G.muted || G.quiet) return;
    let eleven = false; try { eleven = W.setup?.voice?.provider === "elevenlabs" && Boolean(W.setup?.voice?.ready); } catch { /* not loaded yet */ }
    if (eleven) { elevenSay(text, parts).catch(() => { G.noEleven = true; }); if (!G.noEleven) return; }
    if (!window.speechSynthesis) return;
    speechSynthesis.cancel(); G.paused = false; paintPause();
    parts.forEach((part, i) => {
      const u = new SpeechSynthesisUtterance(part);
      if (G.voice ?? pickVoice()) u.voice = G.voice;
      u.rate = 1; u.pitch = 1; u.volume = 1;
      u.onstart = () => { G.speaking = true; $("#guide").classList.add("talking"); const el = $(`#caption [data-c="${i}"]`); $$("#caption [data-c]").forEach((x) => x.classList.toggle("now", x === el)); el?.scrollIntoView({ block: "nearest" }); };
      if (i === parts.length - 1) u.onend = () => { G.speaking = false; $("#guide").classList.remove("talking"); $$("#caption .now").forEach((x) => x.classList.remove("now")); };
      u.onerror = (e) => { $("#guide").classList.remove("talking"); if (e.error === "not-allowed") { G.blocked = true; $("#caption").textContent = text + "  (Tap anywhere to hear me.)"; } };
      speechSynthesis.speak(u);
    });
  }
  // ElevenLabs' Will for the guide (only once ElevenLabs is connected); the free voice if that doesn't work
  async function elevenSay(text, parts) {
    if (G.noEleven) throw new Error("off");
    try { speechSynthesis?.cancel(); } catch { /* none */ }
    G.audio?.pause();
    const r = await fetch("/api/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, voice: window.dsVoicePrefs?.ELEVEN.guide ?? "Will" }) });
    if (!r.ok || r.status === 204) { G.noEleven = true; throw new Error("no audio"); }
    const a = G.audio = new Audio(URL.createObjectURL(await r.blob()));
    a.onplay = () => { G.speaking = true; $("#guide").classList.add("talking"); $$("#caption [data-c]").forEach((x) => x.classList.add("now")); };
    a.onended = () => { G.speaking = false; $("#guide").classList.remove("talking"); $$("#caption .now").forEach((x) => x.classList.remove("now")); };
    await a.play().catch((e) => { if (e.name === "NotAllowedError") { G.blocked = true; $("#caption").textContent = text + "  (Tap anywhere to hear me.)"; } else throw e; });
  }
  function stopTalking() { try { speechSynthesis.cancel(); } catch { /* none */ } try { G.audio?.pause(); } catch { /* none */ } $("#guide").classList.remove("talking"); G.speaking = false; }
  // browsers only let a page talk after the first click or key press
  const unlock = () => { if (G.unlocked) return; G.unlocked = true; if (G.blocked) { G.blocked = false; say(G.last); } };
  addEventListener("pointerdown", unlock, { capture: true }); addEventListener("keydown", unlock, { capture: true });
  function paintMute() { $("#gMute").textContent = G.muted ? "🔇" : "🔊"; $("#gMute").setAttribute("aria-pressed", String(G.muted)); $("#gMute").title = G.muted ? "Unmute the guide" : "Mute the guide"; }
  function paintPause() { $("#gPause").textContent = G.paused ? "▶" : "⏸"; $("#gPause").title = G.paused ? "Keep talking" : "Pause"; }
  $("#gMute").onclick = () => { G.muted = !G.muted; store.set("ds-welcome-muted", G.muted); if (G.muted) stopTalking(); else say(G.last); paintMute(); };
  $("#gRepeat").onclick = () => { if (G.muted) { toast("The guide is muted. His words are in the box above."); return; } say(G.last); };
  $("#gPause").onclick = () => { if (!window.speechSynthesis) return; if (G.paused) { speechSynthesis.resume(); G.paused = false; } else if (speechSynthesis.speaking) { speechSynthesis.pause(); G.paused = true; } paintPause(); };
  paintMute(); paintPause();

  /* ================================================================ shared data ===================================== */
  const W = { state: {}, setup: null, ai: "anthropic", idx: 0, name: "" };
  const who = () => (W.name ? `, ${W.name}` : "");

  // The AI providers: why, what it costs, and the exact steps (current as of 2026)
  const PROV = {
    anthropic: {
      name: "Claude", by: "Anthropic", icon: "✳️", tag: "Recommended",
      pitch: "The most natural to talk to, careful with your schedule, excellent at reading and explaining documents, and it can look things up on the web.",
      cost: "Pay as you go: you buy credit ahead of time (from $5) and it's used as you talk. Everyday use is typically a few dollars a month.",
      note: "A Claude.ai Pro or Max chat subscription is separate from API credit. Dayspring uses API credit from the Claude Console.",
      keyHint: "It starts with sk-ant-",
      steps: [
        { t: "<b>Open the Claude Console</b> and sign up, or sign in if you already have an account (email or Google).", url: "https://platform.claude.com/", label: "Open Claude Console" },
        { t: "<b>Add credit:</b> go to <b>Settings → Billing</b>, add a payment method, and buy credit. $5 is plenty to start; auto-reload is optional.", url: "https://platform.claude.com/settings/billing", label: "Open Billing" },
        { t: "<b>Make a key:</b> <b>Settings → API keys → Create key</b>. Name it <i>Dayspring</i>, then click <b>Copy</b>. It's only shown once, so copy it now.", url: "https://platform.claude.com/settings/keys", label: "Open API keys" },
        { t: "<b>Paste the key below</b> and press <b>Test</b>. It stays on this computer." },
      ],
    },
    openai: {
      name: "ChatGPT", by: "OpenAI", icon: "◎",
      pitch: "OpenAI's models: great all-rounders, plus OpenAI's own natural voices as an option.",
      cost: "Pay as you go: you buy credit ahead of time (from $5; $10 is the default) and credits last a year. Everyday use is typically a few dollars a month.",
      note: "A ChatGPT Plus or Pro subscription doesn't include API credit. The API is billed separately at platform.openai.com.",
      keyHint: "It starts with sk-",
      steps: [
        { t: "<b>Open the OpenAI Platform</b> and sign in with your OpenAI (ChatGPT) account, or sign up.", url: "https://platform.openai.com/", label: "Open OpenAI Platform" },
        { t: "<b>Add credit:</b> <b>Settings → Billing → Add payment details</b>, then pick an amount ($5 minimum).", url: "https://platform.openai.com/settings/organization/billing/overview", label: "Open Billing" },
        { t: "<b>Make a key:</b> <b>API keys → Create new secret key</b>. Name it <i>Dayspring</i> and click <b>Copy</b>. It's only shown once.", url: "https://platform.openai.com/api-keys", label: "Open API keys" },
        { t: "<b>Paste the key below</b> and press <b>Test</b>. It stays on this computer." },
      ],
    },
    xai: {
      name: "Grok", by: "xAI", icon: "𝕏",
      pitch: "xAI's Grok models: quick and conversational.",
      cost: "New accounts usually get some free trial credit for their first month; after that you top up prepaid credit.",
      note: "Grok in the X app (or X Premium) is separate from the API. You don't need X Premium; the API is its own account at console.x.ai.",
      keyHint: "It starts with xai-",
      steps: [
        { t: "<b>Open the xAI Console</b> and sign up with your email (or sign in). Finish the short welcome questions.", url: "https://console.x.ai/team/default/api-keys", label: "Open xAI Console" },
        { t: "<b>Credit:</b> check your trial credit, or add prepaid credit under <b>Billing</b> in the console." },
        { t: "<b>Make a key:</b> <b>API Keys → Create API Key</b>, name it <i>Dayspring</i>, and copy it right away.", url: "https://console.x.ai/team/default/api-keys", label: "Open API Keys" },
        { t: "<b>Paste the key below</b> and press <b>Test</b>. It stays on this computer." },
      ],
    },
    ollama: {
      name: "Ollama", by: "free, on this computer", icon: "🦙", tag: "Free",
      pitch: "Runs an AI model right on this computer: free and private, no account. It needs a fairly strong PC (16 GB of memory or more), and answers are slower and simpler than Claude's.",
      cost: "Free.",
      note: "Everything stays on your computer. The first download is about 5 GB.",
      steps: [
        { t: "<b>Install Ollama:</b> download it and run <b>OllamaSetup.exe</b>. It starts itself when it's done.", url: "https://ollama.com/download/windows", label: "Download Ollama" },
        { t: "<b>Get a model:</b> open <b>PowerShell</b> (Start → type PowerShell) and run this. It downloads about 5 GB:", code: "ollama pull llama3.1:8b" },
        { t: "<b>Press Check</b> below. Dayspring will find Ollama on this computer." },
      ],
    },
  };
  const AI_BENEFITS = [
    ["💬", "Talk naturally: ask anything, the way you'd ask a person"], ["🗓️", "Plans and reshuffles your day for you (\"fit a haircut in Saturday\")"],
    ["📄", "Reads your documents and explains or summarizes them"], ["🔎", "Looks things up on the web"], ["🎯", "Coaching, check-ins and encouragement that know your week"],
    ["🧑‍💻", "Can even change its own code by voice (with an AI coding tool)"],
  ];
  const friendly = (e, prov) => {
    const t = String(e?.message ?? e ?? "");
    if (/401|403|invalid|incorrect|unauthori[sz]ed|authentication|not accepted|api key/i.test(t)) return "That key wasn't accepted. Copy it again from the page (it's only shown once; you can make a new one) and paste it here.";
    if (/credit|balance|billing|quota|402|insufficient|payment|exceeded/i.test(t)) return "The key works, but there's no credit on the account yet. Add credit in Billing, wait a minute, then press Test again.";
    if (prov === "ollama" && /ECONNREFUSED|fetch failed|11434|connect/i.test(t)) return "I can't reach Ollama yet. Make sure it finished installing (look for the llama in the system tray), then press Check again.";
    if (/model/i.test(t) && prov === "ollama") return "Ollama is running, but the model isn't downloaded yet. Run the ollama pull command above, wait for it to finish, then press Check.";
    if (/timeout|timed out|network|ENOTFOUND/i.test(t)) return "I couldn't reach the service. Check the internet connection and try again.";
    return t || "That didn't work. Try again in a moment.";
  };
  const walk = (steps) => `<ol class="walk">${steps.map((s, i) => `<li data-i="${i}">${s.t}${s.code ? `<div class="codebox"><span class="code">${esc(s.code)}</span><button class="btn small" data-copy="${esc(s.code)}" type="button">Copy</button></div>` : ""}${s.url ? `<div class="acts"><a class="btn small" href="${esc(s.url)}" target="_blank" rel="noopener" data-open="${i}">${esc(s.label ?? "Open")} <span class="ext">↗</span></a></div>` : ""}</li>`).join("")}</ol>`;
  function wireWalk(root) {
    $$("[data-copy]", root).forEach((b) => (b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast("Copied"); } catch { toast("Select it and press Ctrl+C"); } }));
    $$("[data-open]", root).forEach((a) => a.addEventListener("click", () => a.closest("li")?.classList.add("done")));
  }
  const sw = (id, on) => `<button class="sw" id="${id}" role="switch" aria-checked="${on ? "true" : "false"}" type="button"></button>`;
  const wireSw = (root) => $$(".sw", root).forEach((s) => (s.onclick = () => { s.setAttribute("aria-checked", String(s.getAttribute("aria-checked") !== "true")); s.dispatchEvent(new Event("change")); }));
  const isOn = (el) => el?.getAttribute("aria-checked") === "true";
  const seg = (name, opts, cur) => `<div class="seg" role="group" data-seg="${name}">${opts.map(([v, t]) => `<button type="button" data-v="${v}" class="${v === cur ? "on" : ""}">${t}</button>`).join("")}</div>`;
  const wireSeg = (root, cb) => $$("[data-seg]", root).forEach((g) => $$("button", g).forEach((b) => (b.onclick = () => { $$("button", g).forEach((x) => x.classList.toggle("on", x === b)); cb?.(g.dataset.seg, b.dataset.v, g); })));
  const segVal = (root, name) => $(`[data-seg="${name}"] button.on`, root)?.dataset.v;

  /* ================================================================ the steps ======================================= */
  // show(): whether the step applies (depends on earlier answers); say(): what the guide says; next(): save, false = stay
  const STEPS = [
    { id: "welcome", title: "Welcome", nextLabel: "Let's begin →",
      say: () => "Hi! I'm Dayspring. I'll walk you through getting set up. It takes about ten minutes, and you can skip anything and come back to it later in Settings. If you'd rather read than listen, press the speaker button to mute me, or the circle arrow to hear something again.",
      render: () => `<div class="hero"><div class="bigsun" aria-hidden="true"></div><div class="eyebrow">Welcome</div><h1>Let's set up Dayspring</h1>
        <p class="lead">Your day, planned and gently kept on track: a schedule, reminders, an alarm that wakes you kindly, music, and (if you'd like) an AI assistant you can simply talk to.</p>
        <p class="hint">About 10 minutes · everything can be changed later in Settings · nothing leaves your computer unless you connect a service</p></div>` },

    { id: "you", title: "About you", required: true,
      say: () => "First, what should I call you? You can add a few nicknames too, if you like. I'll use them now and then.",
      render: () => { const o = W.setup?.owner ?? {}; return `<div class="eyebrow">Step 1</div><h1>What should I call you?</h1>
        <div class="field" style="max-width:24em"><label for="name">Your first name</label><input id="name" type="text" autocomplete="given-name" value="${esc(o.name)}" placeholder="Sam" maxlength="60"></div>
        <div class="field"><span class="lbl">Nicknames <span class="hint">(optional)</span></span><div id="nicks" class="chips">${(o.nicknames ?? []).map((n) => nickChip(n)).join("")}</div>
          <div class="row" style="max-width:24em;margin-top:.4em"><input id="nickIn" type="text" placeholder="e.g. Champ" maxlength="40"><button class="btn small" id="nickAdd" type="button">+ Add</button></div></div>
        <div class="msg" id="m"></div>`; },
      mount: () => { const add = () => { const v = $("#nickIn").value.trim().replace(/\s+/g, " "); if (!v) return;
          if ($$("#nicks .chip").some((c) => c.dataset.n.toLowerCase() === v.toLowerCase())) { $("#nickIn").value = ""; return toast(`“${v}” is already on the list.`); }
          if ($$("#nicks .chip").length >= 30) return toast("That's the most (30)."); $("#nicks").insertAdjacentHTML("beforeend", nickChip(v)); $("#nickIn").value = ""; $("#nickIn").focus(); };
        $("#nickAdd").onclick = add; $("#nickIn").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); add(); } };
        $("#nicks").onclick = (e) => { const x = e.target.closest("[data-rm]"); if (x) x.closest(".chip").remove(); };
        setTimeout(() => $("#name")?.focus(), 150); },
      next: async () => {
        const name = $("#name").value.trim();
        if (!name) { msg($("#m"), "Please type your name. It's the one thing I need.", "bad"); $("#name").focus(); return false; }
        const r = await api("/setup/owner", { name, nicknames: $$("#nicks .chip").map((c) => c.dataset.n) });
        W.setup.owner = r.owner; W.name = name; return true;
      } },

    { id: "ai", title: "AI assistant",
      say: () => `Nice to meet you${who()}! Next, a big choice. Would you like an AI voice assistant built in? With one, you can talk to me about anything. I can plan and reshuffle your day, read and explain your documents, and look things up. It's pay as you go, usually a few dollars a month. I recommend Claude. Or choose no thanks, and I'll work as a simple scheduler, which is free.`,
      render: () => `<div class="eyebrow">Step 2</div><h1>Would you like an AI assistant?</h1>
        <p class="lead">Dayspring works without one, as a scheduler with reminders, an alarm, music and built-in voice commands. An AI brain turns it into an assistant you can really talk to.</p>
        <div class="benefits">${AI_BENEFITS.map(([i, t]) => `<div class="benefit"><span>${i}</span><div>${t}</div></div>`).join("")}</div>
        <div class="choices wide" role="radiogroup" aria-label="AI">${["anthropic", "openai", "xai", "ollama"].map((k) => { const p = PROV[k]; return `<button class="choice${W.ai === k ? " on" : ""}" data-ai="${k}" role="radio" aria-checked="${W.ai === k}" type="button">${p.tag ? `<span class="tag${k === "anthropic" ? " gold" : ""}">${p.tag}</span>` : ""}<span class="ic">${p.icon}</span><b>${p.name} <small>· ${p.by}</small></b><small>${p.pitch}</small></button>`; }).join("")}
          <button class="choice${W.ai === "none" ? " on" : ""}" data-ai="none" role="radio" aria-checked="${W.ai === "none"}" type="button"><span class="ic">🗓️</span><b>No thanks</b><small>Just the scheduler: free, no accounts. You can add AI any time in Settings.</small></button></div>
        <div class="note" id="costNote"></div>`,
      mount: () => { const paint = () => { const p = PROV[W.ai]; $("#costNote").innerHTML = W.ai === "none" ? "No account or payment needed. You'll get the schedule, reminders, alarm, music and built-in commands." : `<b>Cost:</b> ${p.cost}<br><span class="hint">${p.note}</span>`; };
        $$("[data-ai]").forEach((b) => (b.onclick = () => { W.ai = b.dataset.ai; $$("[data-ai]").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-checked", String(x === b)); }); paint(); saveState(); }));
        paint(); },
      next: async () => { if (W.ai === "none") await api("/setup/ai", { provider: "none" }).catch(() => {}); await saveState(); return true; } },

    { id: "aikey", title: "Connect the AI", show: () => W.ai !== "none",
      say: () => { const p = PROV[W.ai]; return W.ai === "ollama" ? "Great, Ollama runs right on this computer, for free. Download and install it with the first button, then copy the command into PowerShell to get a model. When it's done, press Check and I'll find it." : `Great choice. Here's how to get ${p.name} connected. Follow the numbered steps. Each button opens the right page for you. You'll sign in, add a little credit, then create a key. Copy the key, paste it in the box at the bottom, and press Test. I'll wait right here.`; },
      render: () => { const p = PROV[W.ai]; const set = W.setup?.ai?.provider === W.ai && W.setup?.ai?.ready; return `<div class="eyebrow">Step 3 · ${p.name}</div><h1>${W.ai === "ollama" ? "Set up Ollama" : `Connect ${p.name}`}</h1>
        <p class="lead">${p.pitch}</p>${walk(p.steps)}
        ${W.ai === "ollama" ? `<div class="row"><button class="btn primary" id="aiTest" type="button">Check</button></div>` : `<div class="field"><label for="aiKey">Your ${p.name} API key</label>
          <div class="keybox"><input id="aiKey" type="password" autocomplete="off" spellcheck="false" placeholder="${set ? "A key is already saved; paste a new one to replace it" : esc(p.keyHint)}"><button class="btn small" id="aiShow" type="button">Show</button><button class="btn primary" id="aiTest" type="button">Test</button></div>
          <span class="hint">${esc(p.keyHint)} · stored only on this computer (in Dayspring's .env file)</span></div>`}
        <div class="msg" id="m">${set ? "✓ Already connected." : ""}</div>
        <div class="note"><b>Good to know:</b> ${p.note}</div>`; },
      mount: (root) => { wireWalk(root); if (W.setup?.ai?.provider === W.ai && W.setup?.ai?.ready) $("#m").className = "msg ok";
        $("#aiShow")?.addEventListener("click", () => { const k = $("#aiKey"); k.type = k.type === "password" ? "text" : "password"; $("#aiShow").textContent = k.type === "password" ? "Show" : "Hide"; });
        $("#aiKey")?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); $("#aiTest").click(); } });
        $("#aiTest").onclick = testAi; },
      next: async () => {
        if (W.setup?.ai?.provider === W.ai && W.setup?.ai?.ready && !$("#aiKey")?.value.trim()) return true;
        if (!W.aiOk) { const ok = await testAi(); if (!ok) return false; }
        return true;
      },
      skip: () => { say("No problem. You can finish connecting it any time in Settings, under AI brain. Until then, I'll work as a scheduler."); } },

    { id: "voice", title: "Voice", show: () => W.ai !== "none",
      say: () => `Now, my voice. Right now I'm using a free voice built into Windows. If you'd like me to sound more natural and expressive, you can connect ElevenLabs. There's a free plan with about ten minutes of speech a month, and paid plans for more. Or keep a free voice${W.ai === "openai" ? ", or use OpenAI's voices with the key you just added" : ""}.`,
      render: () => `<div class="eyebrow">Step 4</div><h1>Pick my voice</h1>
        <div class="choices" role="radiogroup" aria-label="Voice type">
          <button class="choice" data-vt="elevenlabs" type="button"><span class="tag gold">Most natural</span><span class="ic">🎙️</span><b>ElevenLabs</b><small>Lifelike, expressive voices and a huge voice library. Free plan: about 10 minutes of speech a month.</small></button>
          <button class="choice" data-vt="browser" type="button"><span class="tag">Free</span><span class="ic">🔈</span><b>Free Windows voices</b><small>Built in. The "Natural" ones (best in Microsoft Edge) sound good.</small></button>
          ${W.ai === "openai" ? `<button class="choice" data-vt="openai" type="button"><span class="ic">◎</span><b>OpenAI voices</b><small>Uses the OpenAI key you just added (billed per use, pennies).</small></button>` : ""}
        </div><div id="vpane"></div>`,
      mount: () => { $$("[data-vt]").forEach((b) => (b.onclick = () => { $$("[data-vt]").forEach((x) => x.classList.toggle("on", x === b)); W.vt = b.dataset.vt; paneVoice(); }));
        const cur = W.setup?.voice?.provider; const pick = $(`[data-vt="${cur === "elevenlabs" || cur === "openai" ? cur : "browser"}"]`) ?? $("[data-vt=browser]"); pick.click(); },
      next: async () => saveVoice() },

    { id: "scheduler", title: "Scheduler mode", show: () => W.ai === "none",
      say: () => "Okay! Without AI, I'll be your scheduler. Here's what I can do: your schedule and repeating events, reminders and snoozes, a gentle alarm, music and videos, reading documents aloud, the weather, and a set of built-in voice commands like the ones listed here. You can add an AI later, any time, in Settings.",
      render: () => `<div class="eyebrow">Step 3</div><h1>Dayspring as your scheduler</h1><p class="lead">Free, no accounts. Here's what works right away:</p>
        <div class="benefits">${[["🗓️", "Your schedule: day, week, month, year views; drag to change things; repeating events"], ["⏰", "Reminders, a gentle wake-up alarm, and snooze"], ["🔔", "Spoken heads-ups when the next thing starts"], ["🎵", "Music and YouTube videos, with a music bar and a library"], ["📄", "Open documents and read them aloud"], ["🌤️", "Weather, and a living sky that follows the real weather"], ["🎧", "Voice commands, no AI needed"]].map(([i, t]) => `<div class="benefit"><span>${i}</span><div>${t}</div></div>`).join("")}</div>
        <h2>Things you can say</h2><div class="chips">${["what's on today?", "add dentist Friday at 3pm", "add gym every Monday and Wednesday at 6pm", "remind me to call Mom at 5", "move lunch to 1", "snooze", "set an alarm", "play some music", "what's the weather?", "read the bulletin in Downloads"].map((s) => `<span class="chip">“${s}”</span>`).join("")}</div>
        <div class="note">Want more later? Settings → AI brain adds Claude, ChatGPT, Grok or Ollama in a few minutes.</div>` },

    { id: "week", title: "Your week",
      say: () => "Let's rough out your week, so I know when to wake you and when you're busy. Just the basics. You can fine-tune everything later on the schedule. And tell me your town, for the weather and the sky.",
      render: () => `<div class="eyebrow">Your week</div><h1>The shape of your day</h1>
        <div class="row"><div class="field" style="flex:0 1 11em"><label for="wake">I usually get up at</label><input id="wake" type="time" value="07:00"></div>
          <div class="field" style="flex:0 1 11em"><label for="bed">and go to bed at</label><input id="bed" type="time" value="22:30"></div></div>
        <div class="toggle"><div class="txt"><b>Wake me up with an alarm</b><div>A gentle alarm at your wake-up time. You can snooze it, or turn it off any time.</div></div>${sw("alarmSw", true)}</div>
        <div class="toggle"><div class="txt"><b>I work or have classes on set days</b><div>Adds them to your week so I plan around them.</div></div>${sw("workSw", false)}</div>
        <div id="workBox" class="sub" hidden><div class="field"><span class="lbl">Which days?</span><div class="chips" id="wdays">${[["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"], ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun"]].map(([d, t]) => `<button type="button" class="chip${["mon", "tue", "wed", "thu", "fri"].includes(d) ? " on" : ""}" data-d="${d}">${t}</button>`).join("")}</div></div>
          <div class="row"><div class="field" style="flex:0 1 11em"><label for="ws">From</label><input id="ws" type="time" value="09:00"></div><div class="field" style="flex:0 1 11em"><label for="we">to</label><input id="we" type="time" value="17:00"></div><div class="field" style="flex:1 1 12em"><label for="wt">Called</label><input id="wt" type="text" value="Work" maxlength="40"></div></div></div>
        <h2>Where are you?</h2><div class="row" style="max-width:32em"><input id="place" type="search" placeholder="Your town, e.g. Denver"><button class="btn small" id="find" type="button">Find</button></div>
        <div class="results" id="places"></div><div class="msg" id="m"></div>`,
      mount: (root) => { wireSw(root); $("#workSw").addEventListener("change", () => { $("#workBox").hidden = !isOn($("#workSw")); });
        $$("#wdays .chip").forEach((c) => (c.onclick = () => c.classList.toggle("on")));
        const loc = W.setup?.owner?.location; if (loc?.place) msg($("#m"), `✓ ${loc.place}`, "ok");
        const find = async () => { const q = $("#place").value.trim(); if (q.length < 2) return; msg($("#m"), "Looking…", "busy"); const r = await api(`/setup/location?q=${encodeURIComponent(q)}`, undefined, "GET").catch(() => ({ results: [] }));
          msg($("#m"), r.error ?? (r.results.length ? "" : "I couldn't find that. Try a nearby bigger town."), r.results.length ? "" : "bad");
          $("#places").innerHTML = r.results.map((x, i) => `<button class="btn small" type="button" data-p="${i}">📍 ${esc(x.place)}</button>`).join("");
          $$("[data-p]").forEach((b) => (b.onclick = async () => { W.place = r.results[Number(b.dataset.p)]; $("#places").innerHTML = ""; msg($("#m"), `✓ ${W.place.place}`, "ok"); })); };
        $("#find").onclick = find; $("#place").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); find(); } }; },
      next: async () => {
        const t = { wake: $("#wake").value || "07:00", bed: $("#bed").value || "22:30", meals: true };
        if (isOn($("#workSw"))) Object.assign(t, { workDays: $$("#wdays .chip.on").map((c) => c.dataset.d), workStart: $("#ws").value, workEnd: $("#we").value, workTitle: $("#wt").value.trim() || "Work" });
        const first = !W.state.done?.week;
        await api("/setup/schedule", { action: "template", replace: first, template: t });
        if (!isOn($("#alarmSw"))) await api("/settings", { alarm: false }).catch(() => {});
        if (W.place) await api("/setup/owner", { location: W.place });
        return true;
      } },

    { id: "interests", title: "Interests",
      say: () => `What are you into${who()}? Pick anything that fits. It helps me suggest videos, pick encouraging quotes, turn on the right features, and offer a few starter routines. You can change these whenever you like.`,
      render: () => `<div class="eyebrow">Interests</div><h1>What are you into?</h1><p class="lead">Pick as many as you like. They shape what Dayspring suggests and which features turn on.</p><div id="groups"><p class="hint">Loading…</p></div>
        <div class="field" style="max-width:36em"><label id="other-l">Add your own</label><div id="other"></div></div>
        <div id="suggBox" hidden><h2>Add these to your week?</h2><p class="hint">Starter routines from what you picked. Tick the ones you want; you can move or delete them later.</p><div class="sugg" id="sugg"></div></div>`,
      mount: async () => {
        const r = await api("/welcome/interests", undefined, "GET").catch(() => null); if (!r) { $("#groups").innerHTML = `<p class="msg bad">Couldn't load the list.</p>`; return; }
        W.cat = r.catalog; const picked = new Set(r.picked?.ids ?? []);
        $("#groups").innerHTML = r.groups.map((g) => `<div class="group"><h3>${g}</h3><div class="chips">${r.catalog.filter((c) => c.group === g).map((c) => `<button type="button" class="chip${picked.has(c.id) ? " on" : ""}" data-i="${c.id}" aria-pressed="${picked.has(c.id)}"><span>${c.emoji}</span>${esc(c.label)}</button>`).join("")}</div></div>`).join("");
        W.other = window.dsChipInput($("#other"), { values: r.picked?.other ?? [], max: 40, placeholder: "e.g. woodworking, marine wildlife", label: "Add your own interest" });
        const upd = async () => { const ids = $$("#groups .chip.on").map((c) => c.dataset.i); const s = await api(`/welcome/interests?ids=${ids.join(",")}`, undefined, "GET").catch(() => ({ suggestions: [] }));
          const keep = new Set($$("#sugg input:checked").map((x) => x.value));
          $("#suggBox").hidden = !s.suggestions.length;
          $("#sugg").innerHTML = s.suggestions.map((x) => `<label><input type="checkbox" value="${esc(x.key)}"${keep.has(x.key) ? " checked" : ""}><span><b>${esc(x.title)}</b> <small>· ${esc(daysText(x.days))}, ${esc(x.start)}–${esc(x.end)} · from ${esc(x.from)}</small></span></label>`).join(""); };
        $$("#groups .chip").forEach((c) => (c.onclick = () => { c.classList.toggle("on"); c.setAttribute("aria-pressed", String(c.classList.contains("on"))); upd(); }));
        upd();
      },
      next: async () => { await api("/welcome/interests", { ids: $$("#groups .chip.on").map((c) => c.dataset.i), other: W.other?.values() ?? [], addRoutines: $$("#sugg input:checked").map((x) => x.value) }); return true; } },

    { id: "permissions", title: "Permissions", required: true, blocked: () => !P.fa?.chosen(),
      say: () => "Now, privacy. What may I do with the files on this computer? Please pick one: no file access, which I recommend if you're not sure, only the folders and files you choose, or everything. You also decide whether I may only read, or also make changes, and whether I may delete anything. I'll never touch passwords, keys, Windows or other people's files, and I keep a log of everything I do.",
      render: () => permHtml(), mount: (root) => permMount(root), next: async () => permSave() },

    { id: "cli", title: "AI coding tool", show: () => W.ai !== "none",
      say: () => { const t = cliFor(); return `Optional, but fun. An AI coding tool lets me work on my own code when you ask. For example, Dayspring, add a button that shows tomorrow's weather. It can also fix things and automate chores on your computer. Since you chose ${PROV[W.ai].name}, I recommend ${t === "claude" ? "Claude Code" : "Codex, by OpenAI"}. I can install it with one click, then help you sign in. Or skip it.`; },
      render: () => cliHtml(), mount: (root) => cliMount(root) },

    { id: "apps", title: "Apps",
      say: () => "Let's connect your apps. Each one is optional. YouTube and Spotify for music. Your calendar and email from Google or Microsoft. Notion for notes. Phone Link for your texts, and Discord. Press Connect on any you use, and I'll walk you through it. Or set them up later.",
      render: () => appsHtml(), mount: (root) => appsMount(root) },

    { id: "sound", title: "Sound",
      say: () => "Now, sound. First, a helper called Voicemeeter. It lets me talk into calls, like Discord, so friends can hear my answers. I set it up in a safe mode, so it can't take over your headset. Then pick where my voice plays, and which microphone I listen with.",
      render: () => soundHtml(), mount: (root) => soundMount(root), next: async () => soundSave() },

    { id: "screen", title: "Screen",
      say: () => "Almost done. Which screen should I live on? A TV, a second monitor, or this one. And which browser: Edge has the nicest free voices. You can fine-tune sizes and margins later in Settings, under Screen.",
      render: () => screenHtml(), mount: (root) => screenMount(root), next: async () => screenSave() },

    { id: "done", title: "All set", nextLabel: "Open Dayspring →",
      say: () => `That's it${who()}! You're all set. Here's a quick summary. Press Open Dayspring to start. Say "Dayspring" any time you need me, and you can change anything in Settings. It's good to meet you.`,
      render: () => doneHtml(), mount: () => doneMount(),
      next: async () => {
        // file access must have been chosen: if it wasn't, back to that step (nothing else is decided for them)
        const f = await api("/setup/finish", {}).catch((e) => e);
        if (f instanceof Error && f.data?.need === "files") { toast(f.message); const i = STEPS.findIndex((s) => s.id === "permissions"); if (i >= 0) await show(i); return false; }
        await saveState({ finished: true }); await openDayspring(); return false;
      } },
  ];

  /* ---------------- step helpers ---------------- */
  // an install runs in the background: { id, state: "running"|"done"|"failed", log, error }
  async function pollJob(path, first, onTick) {
    let j = first;
    for (let i = 0; j && j.state === "running" && i < 400; i++) { onTick?.(j); await new Promise((r) => setTimeout(r, 1500)); j = await api(`${path}?id=${encodeURIComponent(first.id)}`, undefined, "GET").catch(() => j); }
    return j ?? { state: "failed", error: "no answer" };
  }
  const nickChip = (n) => `<span class="chip on" data-n="${esc(n)}">${esc(n)} <button type="button" data-rm aria-label="Remove ${esc(n)}" style="background:none;border:0;color:inherit;cursor:pointer;padding:0 0 0 .2em">✕</button></span>`;
  const daysText = (d) => (d === "daily" ? "every day" : Array.isArray(d) ? d.map((x) => x[0].toUpperCase() + x.slice(1)).join(", ") : String(d));

  async function testAi() {
    const k = $("#aiKey")?.value.trim() ?? "";
    const already = W.setup?.ai?.provider === W.ai && W.setup?.ai?.ready;
    if (W.ai !== "ollama" && !k && !already) { msg($("#m"), "Paste your key first.", "bad"); $("#aiKey")?.focus(); return false; }
    msg($("#m"), W.ai === "ollama" ? "Looking for Ollama…" : "Testing your key…", "busy");
    try {
      const t = await api("/setup/ai/test", { provider: W.ai, key: k || undefined });
      if (!t.ok) throw new Error(t.error || "not accepted");
      const s = await api("/setup/ai", { provider: W.ai, key: k || undefined, skipTest: true });
      if (s.ok === false) throw new Error(s.error);
      W.setup.ai = s.ai; W.aiOk = true;
      msg($("#m"), `✓ Connected! ${PROV[W.ai].name} answered in ${((t.ms ?? 0) / 1000).toFixed(1)} s.`, "ok");
      $$(".walk li").forEach((li) => li.classList.add("done"));
      say(`It works! ${PROV[W.ai].name} is connected. Press Next when you're ready.`);
      return true;
    } catch (e) { const f = friendly(e, W.ai); msg($("#m"), f, "bad"); say(f); return false; }
  }

  // ---- voice ----
  const ELEVEN = [
    { t: "<b>Make a free ElevenLabs account</b> (or sign in).", url: "https://elevenlabs.io/app/sign-up", label: "Open ElevenLabs" },
    { t: "<b>Create a key:</b> <b>Developers → API Keys → Create API Key</b>. Name it <i>Dayspring</i>. Leave <b>Restrict key</b> on, but allow <b>Text to Speech</b> and <b>Voices: Read</b>, so I can speak and see your voices. Copy the key.", url: "https://elevenlabs.io/app/developers/api-keys", label: "Open API keys" },
    { t: "<b>Optional:</b> browse the <b>Voice Library</b> and click <b>Add to my voices</b> on any you like. They'll show up here.", url: "https://elevenlabs.io/app/voice-library", label: "Open Voice Library" },
    { t: "<b>Paste the key below</b> and press <b>Connect</b>." },
  ];
  let vChoice = null;
  function paneVoice() {
    const p = $("#vpane"); vChoice = null;
    if (W.vt === "elevenlabs") {
      const has = W.setup?.keys?.ELEVENLABS_API_KEY?.set;
      p.innerHTML = `${walk(ELEVEN)}<div class="field"><label for="elKey">Your ElevenLabs API key</label><div class="keybox"><input id="elKey" type="password" autocomplete="off" spellcheck="false" placeholder="${has ? "A key is already saved; paste a new one to replace it" : "sk_…"}"><button class="btn primary" id="elGo" type="button">Connect</button></div></div><div class="msg" id="vm"></div><div id="vlist"></div>`;
      wireWalk(p); $("#elGo").onclick = elConnect; $("#elKey").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); elConnect(); } };
      if (has) listVoices("elevenlabs");
    } else if (W.vt === "openai") {
      p.innerHTML = `<p class="hint">Six-plus voices from OpenAI; press ▶ to hear one, then click it to choose.</p><div id="vlist"></div><div class="msg" id="vm"></div>`; listVoices("openai");
    } else {
      p.innerHTML = `<p class="hint">These are the voices built into this computer. The ones marked ✨ Natural sound best (they come with Microsoft Edge). Press ▶ to hear one, click to choose.</p><div class="voices" id="vlist"></div><div class="msg" id="vm"></div>`;
      const draw = () => { const vs = (speechSynthesis?.getVoices() ?? []).filter((v) => /^en/i.test(v.lang)).sort((a, b) => /natural/i.test(b.name) - /natural/i.test(a.name));
        $("#vlist").innerHTML = vs.length ? vs.map((v, i) => `<div class="voice" data-v="${esc(v.name)}"><button class="play" type="button" data-pv="${i}" aria-label="Hear ${esc(v.name)}">▶</button><div class="g"><div class="n">${/natural/i.test(v.name) ? "✨ " : ""}${esc(v.name.replace(/^Microsoft /, "").replace(/ Online \(Natural\)/, ""))}</div><div class="d">${esc(v.lang)}</div></div></div>`).join("") : `<p class="empty">No voices found in this browser.</p>`;
        $$("[data-pv]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const u = new SpeechSynthesisUtterance(`Hi${who()}. This is how I'd sound.`); u.voice = vs[Number(b.dataset.pv)]; speechSynthesis.cancel(); speechSynthesis.speak(u); }));
        $$("#vlist .voice").forEach((el) => (el.onclick = () => { $$("#vlist .voice").forEach((x) => x.classList.toggle("on", x === el)); vChoice = { name: el.dataset.v }; }));
        const cur = W.setup?.voice?.browserVoice || window.dsVoicePrefs?.pick("assistant", vs)?.name;
        if (cur) { const el = $(`#vlist .voice[data-v="${CSS.escape(cur)}"]`); el?.classList.add("on"); if (el && !W.setup?.voice?.browserVoice) el.querySelector(".d").textContent += " · Dayspring's default"; } };
      draw(); speechSynthesis?.addEventListener?.("voiceschanged", draw, { once: true });
    }
  }
  async function elConnect() {
    const k = $("#elKey").value.trim();
    if (!k && !W.setup?.keys?.ELEVENLABS_API_KEY?.set) { msg($("#vm"), "Paste your key first.", "bad"); return; }
    msg($("#vm"), "Checking your key…", "busy");
    try {
      if (k) { const t = await fetch("/api/setup/voice/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "elevenlabs", key: k, text: `Hi${who()}! This is ElevenLabs. Much better, right?` }) });
        if ((t.headers.get("content-type") ?? "").includes("json")) { const j = await t.json(); throw new Error(j.error || "not accepted"); }
        stopTalking(); new Audio(URL.createObjectURL(await t.blob())).play().catch(() => {});
        await api("/setup/voice", { provider: "elevenlabs", key: k }); W.setup.keys = (await api("/setup/keys", undefined, "GET")).keys; }
      msg($("#vm"), "✓ Connected. Now pick a voice below.", "ok"); listVoices("elevenlabs");
    } catch (e) { const t = String(e.message); msg($("#vm"), /401|invalid|unauthori/i.test(t) ? "That key wasn't accepted. Copy it again from ElevenLabs." : /permission|missing_permissions|voices_read/i.test(t) ? "The key works but needs the Text to Speech and Voices: Read permissions. Edit the key on ElevenLabs and turn them on." : friendly(e), "bad"); }
  }
  async function listVoices(pv) {
    const r = await api(`/setup/voices?provider=${pv}`, undefined, "GET").catch(() => ({ voices: [] }));
    const host = $("#vlist"); if (!host) return;
    host.className = "voices";
    host.innerHTML = r.voices.length ? r.voices.map((v, i) => `<div class="voice" data-i="${i}"><button class="play" type="button" data-pv="${i}" aria-label="Hear ${esc(v.name)}">▶</button><div class="g"><div class="n">${v.mine ? "⭐ " : ""}${esc(v.name)}</div><div class="d">${esc(v.describe ?? "")}</div></div></div>`).join("") : `<p class="empty">No voices to show yet.</p>`;
    if (pv === "elevenlabs" && r.canList === false) host.insertAdjacentHTML("beforebegin", `<p class="hint" id="vperm">Showing the built-in voices. To see your own library, give the key the <b>Voices: Read</b> permission on ElevenLabs.</p>`);
    $$("[data-pv]", host).forEach((b) => (b.onclick = async (e) => { e.stopPropagation(); const v = r.voices[Number(b.dataset.pv)]; b.textContent = "…";
      try { const t = await fetch("/api/setup/voice/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: pv, voice: v.name, text: `Hi${who()}! I'm ${v.name}. This is how I'd sound.` }) }); if ((t.headers.get("content-type") ?? "").includes("json")) throw new Error((await t.json()).error); stopTalking(); await new Audio(URL.createObjectURL(await t.blob())).play(); }
      catch (err) { toast(friendly(err)); } finally { b.textContent = "▶"; } }));
    $$(".voice", host).forEach((el) => (el.onclick = () => { $$(".voice", host).forEach((x) => x.classList.toggle("on", x === el)); const v = r.voices[Number(el.dataset.i)]; vChoice = { name: v.name, id: v.id }; }));
  }
  async function saveVoice() {
    if (W.vt === "elevenlabs") {
      if (!W.setup?.keys?.ELEVENLABS_API_KEY?.set) { msg($("#vm"), "Connect your ElevenLabs key first, or pick the free voices.", "bad"); return false; }
      await api("/setup/voice", { provider: "elevenlabs", ...(vChoice ? { voice: vChoice.name, voiceId: vChoice.id } : {}) });
    } else if (W.vt === "openai") await api("/setup/voice", { provider: "openai", ...(vChoice ? { voice: vChoice.id ?? vChoice.name } : {}) });
    else await api("/setup/voice", { provider: "browser", browserVoice: vChoice?.name ?? W.setup?.voice?.browserVoice ?? null });
    return true;
  }

  // ---- permissions ----
  // File access is chosen here, never left to a default: Next stays off until one of the three options is picked (the
  // chooser itself is file-access.js, the same one Settings → Permissions uses). The other abilities follow.
  const P = { fa: null, state: null, programs: "ask", browser: false, web: true };
  function permHtml() {
    return `<div class="eyebrow">Privacy</div><h1>What may Dayspring do on this computer?</h1>
      <p class="lead">You choose what I can see and change. Nothing is picked for you: choose one of the three below to go on. Passwords, keys, Windows and other people's files are always off limits, and I keep a log of everything I do.</p>
      <div id="faBox"></div>
      <h2>Other abilities</h2>
      <div class="toggle"><div class="txt"><b>Open programs</b><div>"Open Spotify", "start Word", and opening a terminal.</div></div>${seg("programs", [["off", "Off"], ["ask", "Ask first"], ["on", "On"]], P.programs)}</div>
      <div class="toggle"><div class="txt"><b>Use a web browser for you</b><div>Open sites, click and read pages in my own browser window. I never type passwords or payment details.</div></div>${sw("brSw", P.browser)}</div>
      <div class="toggle"><div class="txt"><b>Look things up on the internet</b><div>Search the web when you ask a question.</div></div>${sw("webSw", P.web)}</div>`;
  }
  async function permMount(root) {
    const cur = await api("/setup/permissions", undefined, "GET").catch(() => null);
    P.state = cur ?? {};
    if (cur) { P.programs = cur.programs ?? "ask"; P.browser = Boolean(cur.browser); P.web = cur.web !== false; root.innerHTML = permHtml() + guideLink("permissions"); }
    wireSw(root);
    wireSeg(root, (name, v) => { if (name === "programs") P.programs = v; });
    P.fa = window.DayspringFileAccess.create($("#faBox", root), { state: P.state, onChange: () => { $("#next").disabled = !P.fa.chosen(); } });
    $("#next").disabled = !P.fa.chosen();
  }
  async function permSave() {
    const why = P.fa?.problem();
    if (why) { toast(why); say(why); throw new Error(why); }
    const v = P.fa.value();
    const body = { ...v, programs: P.programs, browser: isOn($("#brSw")), web: isOn($("#webSw")),
      // older Dayspring versions understand these
      folders: v.files === "custom" ? v.entries.filter((e) => e.access !== "none").map((e) => e.path) : [], writeFiles: v.writeConfirm };
    P.state = await api("/setup/permissions", body);
    return true;
  }

  // ---- the AI coding tool ----
  const cliFor = () => (W.ai === "openai" ? "codex" : "claude");
  const CLI = {
    claude: { name: "Claude Code", by: "Anthropic", signin: [
      { t: "Open <b>PowerShell</b> (Start → type PowerShell → Enter)." },
      { t: "Type this and press Enter:", code: "claude" },
      { t: "Choose how to sign in: your <b>Claude account</b> (a Pro or Max plan includes Claude Code) or your <b>Console account</b> (uses the same API credit as Dayspring). A browser window opens; approve it." },
      { t: "Back in PowerShell you'll see a welcome message. Type <code>/exit</code> to close it, then press <b>Check again</b> below." }] },
    codex: { name: "Codex", by: "OpenAI", signin: [
      { t: "Open <b>PowerShell</b> (Start → type PowerShell → Enter)." },
      { t: "Type this and press Enter:", code: "codex login" },
      { t: "A browser window opens: <b>sign in with ChatGPT</b> (Plus and Pro plans include Codex) or with your OpenAI API account." },
      { t: "When it says you're signed in, close PowerShell and press <b>Check again</b> below." }] },
  };
  function cliHtml() {
    const rec = cliFor();
    return `<div class="eyebrow">Optional</div><h1>An AI coding tool</h1>
      <p class="lead">With a coding tool, Dayspring can change its own code when you ask ("add a button that shows tomorrow's weather"), fix problems, and automate chores on this computer. You can mix and match: any tool works with any AI above.</p>
      <div class="choices">${["claude", "codex"].map((k) => `<button class="choice${k === rec ? " on" : ""}" data-cli="${k}" type="button">${k === rec ? `<span class="tag gold">Recommended</span>` : ""}<span class="ic">${k === "claude" ? "✳️" : "◎"}</span><b>${CLI[k].name}</b><small>by ${CLI[k].by}${k === "claude" ? ". Works best with Dayspring." : ". Great if you use ChatGPT."}</small></button>`).join("")}</div>
      <div id="clipane"></div>`;
  }
  function cliMount() {
    W.cli = cliFor();
    $$("[data-cli]").forEach((b) => (b.onclick = () => { W.cli = b.dataset.cli; $$("[data-cli]").forEach((x) => x.classList.toggle("on", x === b)); cliPane(); }));
    cliPane();
  }
  async function cliPane() {
    const t = W.cli, c = CLI[t], p = $("#clipane");
    p.innerHTML = `<p class="msg busy">Checking this computer…</p>`;
    const st = await api(`/cli/status?fresh=1&provider=${W.ai}`, undefined, "GET").catch(() => null);
    const s = (Array.isArray(st?.tools) ? st.tools.find((x) => x.id === t) : st?.[t]) ?? {};
    const installed = Boolean(s.installed), signedIn = s.signedIn ?? s.loggedIn;
    const steps = c.signin;
    p.innerHTML = `<h2>1 · Install ${c.name}</h2>
      ${installed ? `<p class="msg ok">✓ ${c.name} is installed${s.version ? ` (${esc(s.version)})` : ""}.</p>` : `<div class="row"><button class="btn primary" id="cliInstall" type="button">Install ${c.name}</button><span class="hint">Takes a minute or two. Windows may ask for permission.</span></div>`}
      <div class="msg" id="cm"></div>
      <h2>2 · Sign in</h2>${signedIn ? `<p class="msg ok">✓ Signed in.</p>` : `${installed ? `<div class="row" style="margin:.3em 0 .6em"><button class="btn primary" id="cliLogin" type="button">Open the sign-in window</button><span class="hint">Or follow the steps yourself:</span></div>` : ""}${walk(steps)}`}
      ${s.needs ? `<p class="hint">You'll need: ${esc(s.needs)}</p>` : ""}
      <div class="row"><button class="btn" id="cliCheck" type="button">Check again</button></div>`;
    wireWalk(p);
    $("#cliCheck").onclick = cliPane;
    $("#cliLogin")?.addEventListener("click", async () => { try { const r = await api("/cli/login", { tool: t }); msg($("#cm"), r.ok === false ? r.text : "A PowerShell window opened. Follow its steps in your browser, then press Check again.", r.ok === false ? "bad" : "ok"); say("A sign-in window opened. Follow the steps in your browser, then come back and press Check again."); } catch (e) { msg($("#cm"), e.message, "bad"); } });
    $("#cliInstall")?.addEventListener("click", async () => {
      $("#cliInstall").disabled = true; msg($("#cm"), `Installing ${c.name}… this can take a couple of minutes.`, "busy"); say(`Installing ${c.name} now. This can take a couple of minutes.`);
      try { const r = await api("/cli/install", { tool: t, method: "powershell" }); const done = await pollJob("/cli/job", r, (j) => msg($("#cm"), `Installing ${c.name}… ${esc(j.log?.at(-1) ?? "")}`, "busy"));
        if (done.state !== "done") throw new Error(done.error || done.log?.at(-1) || "install failed");
        msg($("#cm"), `✓ ${c.name} is installed. Now sign in (step 2).`, "ok"); say(`${c.name} is installed. Now let's sign in. Press Open the sign-in window.`); setTimeout(cliPane, 800); }
      catch (e) { msg($("#cm"), `The install didn't finish: ${e.message}. You can try again, or skip this and set it up later.`, "bad"); $("#cliInstall").disabled = false; }
    });
  }

  // ---- apps & connections ----
  const APPS = [
    { id: "youtube", name: "YouTube", logo: "▶️", what: "Videos and music in Dayspring. Sign in so YouTube Premium means no ads." },
    { id: "spotify", name: "Spotify", logo: "🎧", what: "Your playlists and music, playing inside Dayspring (needs Spotify Premium)." },
    { id: "google", name: "Google Calendar + Gmail", logo: "📅", what: "See your Google calendar in your day, and have me read and draft emails." },
    { id: "microsoft", name: "Outlook + Microsoft To Do", logo: "📬", what: "Your Outlook calendar, mail and To Do tasks." },
    { id: "notion", name: "Notion", logo: "📝", what: "Search, read and add to your Notion pages and databases." },
    { id: "phone", name: "Phone Link (texts)", logo: "📱", what: "Hear your texts and phone notifications (iPhone or Android)." },
    { id: "discord", name: "Discord", logo: "💬", what: "A Dayspring bot in your server's voice channel and chat." },
  ];
  const SPOTIFY_STEPS = [
    { t: "Sign in to the <b>Spotify Developer Dashboard</b> with your Spotify account.", url: "https://developer.spotify.com/dashboard", label: "Open Spotify Dashboard" },
    { t: `Click <b>Create app</b>. Name it <i>Dayspring</i>. Under <b>Redirect URIs</b> add exactly <code>http://127.0.0.1:${location.port || 4747}/spotify/callback</code>. Tick <b>Web API</b> and <b>Web Playback SDK</b>, agree, and <b>Save</b>.` },
    { t: "Under <b>User Management</b>, add the email of your Spotify account." },
    { t: "Open the app's <b>Settings</b>, copy the <b>Client ID</b> (not the secret), paste it below and press <b>Connect</b>." },
  ];
  const PHONE_STEPS = [
    { t: "Open <b>Phone Link</b> on this computer (Start → type Phone Link) and pair your phone. On iPhone it uses Bluetooth; on Android, the Link to Windows app." },
    { t: "Allow <b>notifications</b> and <b>messages</b> in Phone Link when it asks." },
    { t: "Press <b>Turn on</b> below. I'll announce new texts and read them when you say yes." },
  ];
  let guides = {};
  function appsHtml() {
    return `<div class="eyebrow">Apps</div><h1>Connect your apps</h1><p class="lead">All optional. Press <b>Connect</b> on any you use; I'll walk you through it. You can do these later in Settings.</p>
      <div class="apps">${APPS.map((a) => `<div class="app" data-app="${a.id}"><div class="hd"><span class="logo">${a.logo}</span><b>${esc(a.name)}</b><span class="status" id="st-${a.id}">…</span></div><p>${esc(a.what)}</p><div class="acts"><button class="btn small primary" type="button" data-conn="${a.id}">Connect</button></div></div>`).join("")}</div>
      <div id="appDrawer"></div>`;
  }
  async function appsMount() {
    guides = (await api("/welcome/guides", undefined, "GET").catch(() => ({ guides: {} }))).guides ?? {};
    $$("[data-conn]").forEach((b) => (b.onclick = () => openApp(b.dataset.conn)));
    appStatuses();
  }
  const setSt = (id, ok, text) => { const el = $("#st-" + id); if (!el) return; el.className = "status" + (ok ? " ok" : ""); el.textContent = ok ? "✓ " + (text ?? "Connected") : text ?? "Not connected"; };
  async function appStatuses() {
    const keys = (await api("/setup/keys", undefined, "GET").catch(() => ({ keys: {} }))).keys ?? {};
    const ps = await api("/player/status", undefined, "GET").catch(() => null);
    setSt("spotify", ps?.spotify?.signedIn, ps?.spotify?.signedIn ? "Connected" : keys.SPOTIFY_CLIENT_ID?.set ? "Needs sign-in" : "Not connected");
    setSt("youtube", false, "Sign in when ready");
    setSt("phone", Boolean(W.setup?.owner?.features?.phone), W.setup?.owner?.features?.phone ? "On" : "Off");
    const dc = await api("/setup/discord", undefined, "GET").catch(() => null); setSt("discord", dc?.bot?.status === "online" || dc?.keys?.DISCORD_BOT_TOKEN?.set, dc?.bot?.status === "online" ? "Online" : dc?.keys?.DISCORD_BOT_TOKEN?.set ? "Set up" : "Not connected");
    for (const id of ["google", "microsoft", "notion"]) { const s = await api(`/connect/${id}/status`, undefined, "GET").catch(() => null); setSt(id, Boolean(s?.connected), s?.connected ? ((s.who ?? s.account) ? `Connected · ${s.who ?? s.account}` : "Connected") : s ? "Not connected" : "Coming soon"); }
  }
  function drawer(title, html) { $("#appDrawer").innerHTML = `<div class="drawer"><h2>${title}</h2>${html}<div class="msg" id="am"></div></div>`; wireWalk($("#appDrawer")); $("#appDrawer").scrollIntoView({ behavior: "smooth", block: "start" }); }
  async function openApp(id) {
    const a = APPS.find((x) => x.id === id);
    if (id === "youtube") {
      drawer("YouTube", `<p>A YouTube window opens on this computer. Sign in with your Google account; Dayspring remembers it, and YouTube Premium means no ads.</p><button class="btn primary" id="ytGo" type="button">Open the YouTube sign-in</button>`);
      say("A YouTube window will open. Sign in with your Google account, and I'll remember it.");
      $("#ytGo").onclick = async () => { try { await api("/media/login", { service: "youtube" }); msg($("#am"), "✓ The sign-in window is open. Sign in there, then close it.", "ok"); setSt("youtube", true, "Signed in (if you finished)"); } catch (e) { msg($("#am"), e.message, "bad"); } };
    } else if (id === "spotify") {
      drawer("Spotify", `${walk(SPOTIFY_STEPS)}<div class="keybox"><input id="spId" type="text" spellcheck="false" placeholder="Client ID (32 letters and numbers)"><button class="btn primary" id="spGo" type="button">Connect</button></div>`);
      say("Spotify needs a free developer app, which takes about five minutes. Follow the steps, then paste the Client ID and press Connect. A Spotify sign-in page will open.");
      $("#spGo").onclick = async () => { const v = $("#spId").value.trim(); if (!/^[a-f0-9]{32}$/i.test(v)) return msg($("#am"), "That doesn't look like a Client ID (32 letters and numbers).", "bad");
        try { await api("/setup/key", { name: "SPOTIFY", value: v }); await api("/player/spotify/login", {}); msg($("#am"), "✓ Saved. The Spotify sign-in opened in your browser: approve it there.", "ok"); setSt("spotify", false, "Finishing sign-in"); } catch (e) { msg($("#am"), e.message, "bad"); } };
    } else if (id === "phone") {
      drawer("Phone Link", `${walk(PHONE_STEPS)}<button class="btn primary" id="phGo" type="button">Turn on texts</button>`);
      say("Phone Link comes with Windows. Pair your phone in the Phone Link app, then turn this on.");
      $("#phGo").onclick = async () => { const r = await api("/setup/features", { features: { phone: true } }).catch((e) => ({ error: e.message })); if (r.error) return msg($("#am"), r.error, "bad"); W.setup.owner = r.owner; setSt("phone", true, "On"); msg($("#am"), "✓ On. New texts will be announced once Phone Link is paired.", "ok"); };
    } else if (id === "discord") {
      drawer("Discord", `<p>Dayspring can join your Discord server as its own bot, so friends can talk to it in voice and chat. It takes about 5 minutes on Discord's developer site. The full walkthrough is in the guide.</p><div class="row"><a class="btn primary" href="/help#discord-bot" target="_blank" rel="noopener">Open the Discord guide ↗</a><a class="btn" href="/setup?s=apps&app=discord" target="_blank" rel="noopener">Enter the bot token in Settings ↗</a></div>`);
      say("The Discord bot takes about five minutes. I've opened the guide for you. It walks through every click.");
    } else {
      const g = guides[id];
      if (!g) { drawer(a.name, `<p>This connection isn't available in this version yet. Check back after the next update.</p>`); return; }
      const steps = (g.steps ?? []).map((s) => ({ t: esc(s.text ?? s.t ?? ""), url: s.link ?? s.url, label: s.linkLabel ?? s.label, code: s.copy ?? s.code }));
      const fields = g.fields ?? [];
      drawer(esc(g.name ?? a.name), `${g.what ? `<p class="lead">${esc(g.what)}</p>` : ""}${g.needs || g.time ? `<p class="hint">${g.needs ? "You'll need: " + esc(g.needs) : ""}${g.needs && g.time ? " · " : ""}${g.time ? esc(/^about /i.test(g.time) ? g.time : "About " + g.time) : ""}</p>` : ""}${walk(steps)}${fields.map((f) => { const k = f.key ?? f.name; return `<div class="field"><label for="f-${esc(k)}">${esc(f.label ?? k)}</label><input id="f-${esc(k)}" data-f="${esc(k)}" type="${f.secret ? "password" : "text"}" spellcheck="false" autocomplete="off" placeholder="${esc(f.placeholder ?? "")}"></div>`; }).join("")}${(g.notes ?? []).map((n) => `<p class="hint">${esc(n)}</p>`).join("")}<button class="btn primary" id="gConn" type="button">Connect</button>`);
      say(`Here's how to connect ${g.name ?? a.name}. Follow the numbered steps. Each button opens the right page. Then fill in the boxes and press Connect.`);
      $("#gConn").onclick = async () => {
        const body = Object.fromEntries($$("[data-f]").map((i) => [i.dataset.f, i.value.trim()]));
        msg($("#am"), "Connecting…", "busy");
        try { const r = await api(`/connect/${id}/start`, body);
          if (r.url) { if (!r.opened) window.open(r.url, "_blank", "noopener"); msg($("#am"), "A sign-in page opened in your browser. Approve it there; I'll show ✓ when it's done.", "ok"); pollConn(id); }
          else if (r.connected || r.done || r.ok) { msg($("#am"), "✓ Connected.", "ok"); setSt(id, true, r.who ? `Connected · ${r.who}` : "Connected"); say(`${a.name} is connected.`); }
          else throw new Error(r.error || "didn't connect"); }
        catch (e) { msg($("#am"), e.message, "bad"); }
      };
    }
  }
  function pollConn(id, n = 0) { if (n > 60) return; setTimeout(async () => { const s = await api(`/connect/${id}/status`, undefined, "GET").catch(() => null); if (s?.connected) { setSt(id, true, (s.who ?? s.account) ? `Connected · ${s.who ?? s.account}` : "Connected"); msg($("#am"), "✓ Connected.", "ok"); say(`${APPS.find((a) => a.id === id).name} is connected.`); } else pollConn(id, n + 1); }, 3000); }

  // ---- sound ----
  let snd = { out: null, mic: null };
  function soundHtml() {
    return `<div class="eyebrow">Sound</div><h1>Sound and calls</h1>
      <div class="app" style="margin:.6em 0"><div class="hd"><span class="logo">🎛️</span><b>Voicemeeter (for calls)</b><span class="status" id="vmSt">…</span></div>
        <p>Lets Dayspring answer <b>into</b> voice calls (Discord and others), mixed with your microphone. It's the official free VB-Audio mixer. Dayspring sets it up in a safe shared mode, so it never takes over your headset. Windows will ask for permission to install it.</p>
        <div class="acts"><button class="btn primary small" id="vmGo" type="button">Install Voicemeeter</button><a class="btn small" href="https://vb-audio.com/Voicemeeter/banana.htm" target="_blank" rel="noopener">About it ↗</a></div><div class="msg" id="vmm"></div></div>
      <h2>Where should my voice play?</h2><div class="devs" id="outs"><p class="hint">Looking for speakers…</p></div>
      <h2>Which microphone should I listen with?</h2><div class="devs" id="mics"></div>
      <p class="hint">This only changes Dayspring's own sound. Your other apps and Windows' default devices stay the same.</p>`;
  }
  async function soundMount() {
    const vs = await api("/voicemeeter/status", undefined, "GET").catch(() => null);
    const paintVm = (s) => { const el = $("#vmSt"); if (!s) { el.textContent = "Unknown"; $("#vmGo").hidden = true; msg($("#vmm"), "Voicemeeter setup isn't available in this version; you can skip it.", ""); return; }
      el.className = "status" + (s.installed ? " ok" : ""); el.textContent = s.installed ? "✓ Installed" : "Not installed"; $("#vmGo").hidden = Boolean(s.installed); };
    paintVm(vs);
    $("#vmGo").onclick = async () => { $("#vmGo").disabled = true; msg($("#vmm"), "Downloading and installing… approve the Windows prompt when it appears.", "busy"); say("Installing Voicemeeter. Windows will ask for permission. Please click Yes.");
      try { const r = await api("/voicemeeter/install", { mode: "install" }); const j = await pollJob("/voicemeeter/job", r, (x) => msg($("#vmm"), `Installing… ${esc(x.log?.at(-1) ?? "")}`, "busy"));
        if (j.state !== "done") throw new Error(j.error || j.log?.at(-1) || "install failed");
        const st = await api("/voicemeeter/status", undefined, "GET").catch(() => ({ installed: true })); paintVm(st);
        msg($("#vmm"), st.needsRestart ? "✓ Installed. Windows needs a restart to finish; you can do that after setup." : "✓ Installed and set up safely.", "ok"); say("Voicemeeter is installed and set up safely."); }
      catch (e) { msg($("#vmm"), `It didn't install: ${e.message}. You can skip this and add it later in Settings → Sound.`, "bad"); $("#vmGo").disabled = false; } };
    const r = await api("/setup/devices", undefined, "GET").catch(() => ({ devices: [] }));
    const ds = r.devices ?? [];
    const ico = (d) => ({ headset: "🎧", headphones: "🎧", tv: "📺", "laptop-speaker": "💻", "laptop-mic": "🎙️", speaker: "🔊", microphone: "🎙️" }[d.type] ?? "🔈");
    const outs = ds.filter((d) => d.outputs?.length), mics = ds.filter((d) => d.inputs?.length);
    $("#outs").innerHTML = `<div class="dev on" data-out=""><span>🪟</span><div class="g"><b>Windows default</b><div class="hint">Whatever Windows is set to</div></div></div>` + outs.map((d) => `<div class="dev" data-out="${esc(d.key)}"><span>${ico(d)}</span><div class="g"><b>${esc(d.nickname || d.name)}</b><div class="hint">${esc(d.typeWord ?? "")}</div></div>${d.inUse?.sound ? `<span class="status ok">in use</span>` : ""}</div>`).join("");
    $("#mics").innerHTML = `<div class="dev on" data-mic=""><span>🪟</span><div class="g"><b>Windows default</b><div class="hint">Whatever Windows is set to</div></div></div>` + mics.map((d) => `<div class="dev" data-mic="${esc(d.key)}"><span>${ico(d)}</span><div class="g"><b>${esc(d.nickname || d.name)}</b><div class="hint">${esc(d.typeWord ?? "")}</div></div></div>`).join("");
    $$("[data-out]").forEach((el) => (el.onclick = () => { $$("[data-out]").forEach((x) => x.classList.toggle("on", x === el)); snd.out = el.dataset.out || null; }));
    $$("[data-mic]").forEach((el) => (el.onclick = () => { $$("[data-mic]").forEach((x) => x.classList.toggle("on", x === el)); snd.mic = el.dataset.mic || null; }));
  }
  async function soundSave() {
    if (snd.out) await api("/devices/use", { key: snd.out, as: "sound" }).catch(() => {});
    if (snd.mic) await api("/devices/use", { key: snd.mic, as: "mic" }).catch(() => {});
    return true;
  }

  // ---- screen ----
  let scr = { display: "auto", browser: "default", openAs: "auto" };
  const OPEN_AS = [
    { v: "auto", icon: "✨", t: "Automatic", d: "Its own window here, full screen on a TV or second screen" },
    { v: "window", icon: "🪟", t: "App window", d: "A clean window of its own, no browser bars" },
    { v: "compact", icon: "▫️", t: "Dayspring mini", d: "A small window you can put anywhere" },
    { v: "fullscreen", icon: "📺", t: "Full screen", d: "Fills the screen, like a TV display" },
    { v: "tab", icon: "🌐", t: "Browser tab", d: "A normal tab in your browser; it may ask about the microphone" },
  ];
  function screenHtml() { return `<div class="eyebrow">Screen</div><h1>Where should Dayspring live?</h1><p class="lead">Dayspring runs full screen on a TV or second monitor, or in a window on this one.</p><div class="screens" id="scrs"><p class="hint">Looking for screens…</p></div>
    <h2 style="margin-top:1em">How should it open?</h2><div class="devs" id="oas">${OPEN_AS.map((o) => `<div class="dev" role="button" tabindex="0" data-oa="${o.v}"><span>${o.icon}</span><div class="g"><b>${o.t}</b><div class="hint">${o.d}</div></div></div>`).join("")}</div>
    <p class="hint">You can change this any time in <b>Settings → Screen</b>, or say "open Dayspring in my browser".</p>
    <label class="field" for="brSel" style="display:block;margin-top:1em"><b>Which browser should Dayspring use?</b>
      <select id="brSel" style="margin-top:.4em"><option value="default">Your default browser</option></select></label>
    <p class="hint" id="brNote">Any browser on this computer works. Microsoft Edge has the most natural-sounding free voices.</p>
    <p class="hint">Sizes, margins and layout can be fine-tuned later in <b>Settings → Screen</b> (there's a "Fit to screen" helper for TVs).</p>`; }
  async function screenMount(root) {
    const r = await api("/setup/screens", undefined, "GET").catch(() => ({ screens: [] }));
    scr.display = r.display ?? "auto"; scr.browser = r.displayBrowser ?? "default"; scr.openAs = r.openAs ?? "auto";
    const paintOa = () => $$("[data-oa]").forEach((x) => { x.classList.toggle("on", x.dataset.oa === scr.openAs); x.setAttribute("aria-pressed", String(x.dataset.oa === scr.openAs)); });
    $$("[data-oa]").forEach((el) => { el.onclick = () => { scr.openAs = el.dataset.oa; paintOa(); }; el.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.click(); } }; });
    paintOa();
    // the browsers on this computer; "Your default browser" names the one Windows uses
    api("/setup/browsers", undefined, "GET").then((b) => {
      const sel = $("#brSel"); if (!sel) return;
      const def = (b.browsers ?? []).find((x) => x.isDefault);
      sel.innerHTML = `<option value="default">Your default browser${def ? " (" + esc(def.name) + ")" : ""}</option>` + (b.browsers ?? []).map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("");
      sel.value = [...sel.options].some((o) => o.value === scr.browser) ? scr.browser : "default";
      const note = () => { const id = sel.value === "default" ? def?.id : sel.value; const x = (b.browsers ?? []).find((y) => y.id === id); $("#brNote").textContent = (x?.note ? x.note + " " : "") + "Microsoft Edge has the most natural-sounding free voices, but any browser works."; };
      sel.onchange = () => { scr.browser = sel.value; note(); }; note();
    }).catch(() => {});
    const ss = r.screens ?? [], max = Math.max(1, ...ss.map((s) => s.width));
    $("#scrs").innerHTML = `<button class="scr${scr.display === "auto" ? " on" : ""}" data-sc="auto" type="button" style="width:7em;height:4.5em"><b>✨</b>Automatic<small>2nd screen if there is one</small></button>` + ss.map((s) => `<button class="scr${String(scr.display) === String(s.number) ? " on" : ""}" data-sc="${s.number}" type="button" style="width:${Math.max(6, (s.width / max) * 11)}em;height:${Math.max(3.8, (s.height / max) * 11)}em"><b>${s.number}</b>${s.primary ? "This screen" : "Screen " + s.number}<small>${s.width}×${s.height}</small></button>`).join("");
    $$("[data-sc]").forEach((b) => (b.onclick = () => { $$("[data-sc]").forEach((x) => x.classList.toggle("on", x === b)); scr.display = b.dataset.sc; }));
  }
  async function screenSave() { await api("/setup/display", { display: scr.display, displayBrowser: scr.browser, openAs: scr.openAs }).catch(() => {}); return true; }

  // ---- done ----
  function doneHtml() {
    const o = W.setup?.owner ?? {}, ai = W.setup?.ai;
    const rows = [["You", esc(o.name || "—") + (o.nicknames?.length ? ` <span class="hint">(${esc(o.nicknames.join(", "))})</span>` : "")],
      ["AI assistant", ai?.ready && ai.provider !== "none" ? `✓ ${esc(PROV[ai.provider]?.name ?? ai.label)}` : "Scheduler mode (add AI any time in Settings)"],
      ["Voice", esc({ elevenlabs: "ElevenLabs", openai: "OpenAI", browser: "Free Windows voice" }[W.setup?.voice?.provider] ?? "Free Windows voice")],
      ["Interests", esc((o.interests ?? []).slice(0, 6).join(", ") || "—")],
      ["Files", esc(permSummaryShort())]];
    return `<div class="hero"><div class="bigsun" aria-hidden="true"></div><div class="eyebrow">All set</div><h1>Welcome to Dayspring${W.name ? ", " + esc(W.name) : ""}!</h1></div>
      <dl class="sumlist">${rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join("")}</dl>
      <div class="note"><b>Getting around:</b> say <b>“Dayspring”</b> and ask anything${W.ai === "none" ? " from the built-in commands" : ""}. Everything you chose can be changed in <a href="/setup" target="_blank" rel="noopener">Settings</a>, and the <a href="/help" target="_blank" rel="noopener">Guide</a> explains every feature.</div>
      <p><a class="btn" href="/setup?s=apps" target="_blank" rel="noopener">🔌 Apps &amp; connections</a> <span class="hint">Connect calendars, music, smart home and more any time.</span></p>`;
  }
  const permSummaryShort = () => { const q = W.setup?.permissions ?? P.state ?? {}; const n = (q.entries ?? []).length; return q.files === "all" ? `Everything (${q.allAccess === "readwrite" ? "read & change" : "read only"})${q.can?.delete ? ", can delete" : ""}` : q.files === "custom" && n ? `${n} chosen place${n === 1 ? "" : "s"}${q.can?.delete ? ", can delete" : ""}` : "No file access"; };
  function doneMount() { /* nothing */ }
  // Dayspring opens in its own window (full screen on a TV or second screen, an app window here), in the browser chosen
  // on the Screen step. This setup tab can be closed then. If that can't happen, this tab becomes the Dayspring screen.
  async function openDayspring(screen) {
    const r = await api("/app/open", screen ? { screen } : {}).catch(() => null);
    if (r?.setup) { toast("One more thing: I need your name first."); const i = STEPS.findIndex((s) => s.id === "you"); if (i >= 0) show(i); return; }
    if (!r || r.ok === false && !r.noScreen) { location.href = "/display"; return; }
    const card = $("#card");
    card.innerHTML = r.noScreen
      ? `<div class="eyebrow">Almost there</div><h1>The screen you chose isn't connected</h1><p class="lead">${esc(r.message ?? "")}</p><p><button class="btn primary" id="hereBtn" type="button">Open Dayspring on this screen</button></p>`
      : `<div class="hero"><div class="bigsun" aria-hidden="true"></div><div class="eyebrow">All set</div><h1>Dayspring is open</h1></div><p class="lead">It's in its own window${r.primary === false ? " on your other screen" : ""}. You can close this tab now.</p><p class="hint">Next time, start it with the <b>Dayspring</b> icon on your desktop or in the Start menu. It opens right where you left it, and it never opens twice.</p><p><button class="btn" id="hereBtn" type="button">I don't see it</button></p>`;
    $("#next").hidden = true; $("#back").hidden = true; $("#skip").hidden = true;
    if (!r.noScreen) try { presence?.close(); } catch { /* fine */ }
    $("#hereBtn").onclick = () => (r.noScreen ? openDayspring("primary") : (location.href = "/display"));
    say(r.noScreen ? "The screen you chose isn't connected. You can open me on this screen instead." : "I'm open in my own window now. You can close this tab.");
  }

  /* ================================================================ navigation ===================================== */
  const visible = () => STEPS.filter((s) => !s.show || s.show());
  function paintRail() {
    const vs = visible(), cur = vs.indexOf(STEPS[W.idx]);
    $("#rail").innerHTML = vs.map((s, i) => `<i class="${i < cur ? "done" : i === cur ? "now" : ""}" title="${esc(s.title)}"></i>`).join("");
    $("#stepname").textContent = `${cur + 1} of ${vs.length} · ${STEPS[W.idx].title}`;
    $("#where").textContent = STEPS[W.idx].required ? "" : "You can skip this and come back later.";
  }
  // "Need help?" under every step: that step's full walkthrough in the guide, in a new tab
  const GUIDE = { welcome: ["setup-wizard", "The guided setup"], you: ["setup-wizard/1-welcome-and-your-name", "About you"], ai: ["ai-providers", "Choosing an AI"],
    aikey: ["ai-providers", "Getting an AI key, step by step"], voice: ["voices", "Voices"], scheduler: ["setup-wizard/3-without-ai-scheduler-mode", "Scheduler mode"],
    week: ["schedule/routine-and-fixed-blocks", "Your usual week"], interests: ["discover/your-interests", "Interests and Discover"], permissions: ["permissions", "Permissions"],
    cli: ["claude-code", "AI coding tools"], apps: ["connections", "Connecting apps"], sound: ["audio-devices", "Speakers and microphones"],
    screen: ["display-setup", "Display setup"], done: ["tutorials", "Tutorials: how do I…?"] };
  const guideLink = (id) => { const g = GUIDE[id]; return g ? `<p class="guide-link" style="margin-top:1.4em;opacity:.85;font-size:.92em">❓ Need help? <a href="/help#${g[0]}" target="_blank" rel="noopener">Open the guide for this step: ${esc(g[1])}</a></p>` : ""; };
  async function show(i, { speak = true } = {}) {
    clearTimeout(W.sayT); W.sayT = 0;            // a step's delayed line never plays over a later step
    W.idx = i; W.aiOk = false;
    const s = STEPS[i];
    if (s.id === "done") W.setup = await Promise.race([api("/setup/state"), new Promise((ok) => setTimeout(ok, 4000))]).catch(() => null) ?? W.setup;   // the summary shows what was actually saved
    const card = $("#card");
    card.style.animation = "none"; void card.offsetWidth; card.style.animation = "";
    card.innerHTML = (s.render ? s.render() : "") + guideLink(s.id);
    $("#back").hidden = i === 0; $("#skip").hidden = Boolean(s.required) || s.id === "welcome" || s.id === "done";
    $("#next").textContent = s.nextLabel ?? "Next →"; $("#next").disabled = Boolean(s.blocked?.());
    paintRail();
    $("#main").scrollTop = 0;
    try { await s.mount?.(card); } catch (e) { console.error(e); }
    if (speak) say(typeof s.say === "function" ? s.say() : s.say);
    saveState();
  }
  function saveState(extra = {}) { W.state = { ...W.state, step: STEPS[W.idx].id, ai: W.ai, ...extra }; return api("/welcome/state", { step: STEPS[W.idx].id, ai: W.ai, ...extra }).catch(() => {}); }
  const nextIdx = (i) => { for (let j = i + 1; j < STEPS.length; j++) if (!STEPS[j].show || STEPS[j].show()) return j; return i; };
  const prevIdx = (i) => { for (let j = i - 1; j >= 0; j--) if (!STEPS[j].show || STEPS[j].show()) return j; return i; };
  let busy = false;
  async function go(dir, { skip = false } = {}) {
    if (busy) return; busy = true; $("#next").disabled = true;
    try {
      const s = STEPS[W.idx];
      if (dir > 0 && !skip && s.next) { const ok = await s.next().catch((e) => { const m = $("#m") ?? $("#am") ?? $("#vm"); msg(m, e.message, "bad"); toast(e.message); return false; }); if (ok === false) return; }
      if (dir > 0 && skip) s.skip?.();
      if (dir > 0) { await api("/welcome/state", { done: { [s.id]: !skip } }).catch(() => {}); W.state.done = { ...(W.state.done ?? {}), [s.id]: !skip }; }
      const j = dir > 0 ? nextIdx(W.idx) : prevIdx(W.idx);
      if (j !== W.idx) { stopTalking(); await show(j, { speak: !(dir > 0 && skip && s.skip) }); if (dir > 0 && skip && s.skip) { clearTimeout(W.sayT); W.sayT = setTimeout(() => { if (W.idx === j) say(STEPS[j].say?.()); }, 4200); } }
    } finally { busy = false; $("#next").disabled = Boolean(STEPS[W.idx].blocked?.()); }
  }
  $("#next").onclick = () => go(1);
  $("#back").onclick = () => go(-1);
  $("#skip").onclick = () => go(1, { skip: true });
  $("#restart").onclick = async () => { if (!confirm("Start the setup over? What you've saved stays; you'll just go through the steps again.")) return; await api("/welcome/restart", {}).catch(() => {}); W.state = {}; show(0); };
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") stopTalking();
    if (e.key === "Enter" && !e.shiftKey && !["TEXTAREA", "BUTTON", "A"].includes(document.activeElement?.tagName) && document.activeElement?.type !== "search") { e.preventDefault(); go(1); }
  });

  /* ================================================================ start ========================================== */
  // while the setup is open, Dayspring knows (starting it again then doesn't open a second setup page); closed at the end
  const PAGE_ID = (crypto.randomUUID?.() ?? String(Math.random()).slice(2)) + "";
  let presence = null; try { presence = new EventSource(`/api/events?page=welcome&id=${encodeURIComponent(PAGE_ID)}`); } catch { /* old browser: no matter */ }
  // the guide and Dayspring never talk over each other: when a Dayspring screen opens, the guide stops
  presence?.addEventListener("speaker", (e) => { try { const d = JSON.parse(e.data); G.quiet = Boolean(d.id && d.page === "display"); if (G.quiet) stopTalking(); } catch { /* bad event */ } });
  (async () => {
    try { W.setup = await api("/setup/state", undefined, "GET"); } catch { W.setup = { owner: {}, ai: {} }; }
    try { W.state = await api("/welcome/state", undefined, "GET"); } catch { W.state = {}; }
    W.name = W.setup?.owner?.name ?? "";
    W.ai = W.state.ai || (W.setup?.ai?.ready ? W.setup.ai.provider : "anthropic");
    // /welcome?step=apps (from Settings → Apps or the guide) opens that step directly, quietly
    const want = STEPS.findIndex((s) => s.id === new URLSearchParams(location.search).get("step") && (!s.show || s.show()));
    if (want >= 0) { await show(want, { speak: false }); return; }
    const at = STEPS.findIndex((s) => s.id === W.state.step);
    await show(at > 0 && !W.state.finished ? at : 0);
    if (at > 0 && !W.state.finished) toast("Welcome back! Picking up where you left off.");
  })();
})();
