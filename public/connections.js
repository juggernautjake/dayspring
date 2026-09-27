// Settings → Apps & connections: every app Dayspring can connect to, on one page. Each card shows whether it's connected
// (and as whom), with Set up / Manage (a drawer with the step-by-step walkthrough, the fields, and the app's items) and
// Disconnect. setup.js calls DayspringApps.html() and DayspringApps.mount(el, { toast, openLink, keys, owner }).
// The connector apps come from /api/connect (lib/connector-routes.mjs); Spotify, YouTube, Phone Link, Discord, Tune in,
// Claude Code and Codex use their own older endpoints (see CUSTOM below).
// Hook: window.DayspringCalendarSync(el, ctx), if it exists, fills the "Calendar sync" box (the unified calendar owns it).
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const friendly = (e) => { const m = String(e?.message ?? e ?? ""); return /failed to fetch|networkerror|load failed/i.test(m) ? "Dayspring isn't answering. Is it still running? Try again in a moment." : m || "Something went wrong. Try again."; };
  const api = async (path, opts = {}) => {
    const r = await fetch("/api" + path, { ...opts, headers: { "content-type": "application/json", ...(opts.headers ?? {}) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw new Error(j.error || "Dayspring couldn't do that just now. Try again in a moment, or restart Dayspring if it keeps happening.");
    return j;
  };
  const post = (path, body) => api(path, { method: "POST", body: JSON.stringify(body ?? {}) });
  const anchor = (t) => t.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s/g, "-");   // same as help.js
  const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

  const GROUPS = [
    { id: "calendars", title: "Calendars & tasks", apps: ["google", "microsoft", "ics", "todoist"] },
    { id: "notes", title: "Notes & docs", apps: ["notion"] },
    { id: "media", title: "Music & video", apps: ["spotify", "youtube"] },
    { id: "talk", title: "Messages & calls", apps: ["phone", "discord", "tunein"] },
    { id: "home", title: "Smart home & automation", apps: ["homeassistant", "webhooks"] },
    { id: "news", title: "News & weather", apps: ["feeds", "weatheralerts"] },
    { id: "ai", title: "AI tools", apps: ["claude", "codex"] },
  ];
  const SHORT = {   // the one-line description on the card (the drawer has the full "what")
    google: "Google Calendar, Gmail and Drive, for one or several Google accounts.", microsoft: "Outlook calendar and mail, and Microsoft To Do lists.",
    ics: "Subscribe to iCloud, school, team or holiday calendars by link.", todoist: "Your Todoist tasks in the day plan; add tasks by voice.",
    notion: "Search and read your Notion pages; save notes to them.", homeassistant: "Lights, plugs and scenes by voice.",
    webhooks: "IFTTT, Zapier, Make or n8n: say a phrase, run an action.", feeds: "Headlines from topics and sites you choose.",
    weatheralerts: "Severe weather warnings for your town, announced right away.",
  };
  const MULTI = { ics: "calendars", feeds: "feeds", webhooks: "outgoing" };
  const OAUTH = ["google", "microsoft"];
  const REQUIRED = { notion: ["token"], todoist: ["token"], homeassistant: ["url", "token"], google: ["clientId", "clientSecret"], microsoft: ["clientId"] };

  // Spotify, YouTube, Phone Link, Discord, Tune in, Claude Code, Codex: { load() → status, pill(s), drawer parts, connect, disconnect }
  const CUSTOM = {
    spotify: { name: "Spotify", icon: "🎵", what: "Play your music, playlists and podcasts by voice.", guide: "/help#music",
      load: async () => (await api("/player/status")).spotify,
      pill: (s) => (s.signedIn ? ["on", `Connected${s.name ? " as " + s.name : ""}`] : s.configured ? ["warn", "Sign-in not finished"] : ["off", "Not connected"]),
      steps: (s) => [
        { text: "Open Spotify's developer dashboard and sign in with your Spotify account.", link: "https://developer.spotify.com/dashboard", linkLabel: "Open the Spotify dashboard" },
        { text: "Click Create app. Any name works (e.g. Dayspring). Tick Web API and Web Playback SDK." },
        { text: "Paste this as the Redirect URI, then Save:", copy: s.redirectUri || `http://127.0.0.1:${location.port || 4747}/spotify/callback` },
        { text: "Open the app's Settings, copy its Client ID and paste it below. Then click Connect and approve in the browser." },
      ],
      fields: [{ key: "clientId", label: "Client ID", placeholder: "32 letters and numbers" }],
      notes: ["Playing full songs needs Spotify Premium. Free accounts can still browse and control Spotify on another device."],
      connect: async (v, s) => { if (v.clientId) await post("/setup/key", { name: "SPOTIFY", value: v.clientId.trim() }); else if (!s.configured) throw new Error("Paste the Client ID from your Spotify app first."); await post("/player/spotify/login", {}); return { wait: "The Spotify sign-in opened in your browser. Approve it there and this card updates by itself." }; },
      disconnect: () => post("/player/spotify/logout", {}),
    },
    youtube: { name: "YouTube", icon: "▶️", what: "Play videos and music videos on the screen; optional search key for better results.", guide: "/help#music",
      load: async (ctx) => ({ key: Boolean(ctx.keys?.YOUTUBE_API_KEY?.set) }),
      pill: (s) => (s.key ? ["on", "Connected (search key)"] : ["off", "Not connected"]),
      steps: () => [
        { text: "Optional: sign in to YouTube in the display's browser, so Premium (no ads) and your playlists work.", action: "ytLogin", actionLabel: "Open the YouTube sign-in" },
        { text: "Optional: for better search, make a free YouTube Data API key in Google Cloud and paste it below.", link: "https://console.cloud.google.com/apis/library/youtube.googleapis.com", linkLabel: "Open Google Cloud" },
      ],
      fields: [{ key: "key", label: "YouTube Data API key (optional)", secret: true, placeholder: "AIza…" }],
      notes: ["YouTube plays without either step. They just make it better."],
      connect: async (v, s, ctx) => { if (!v.key) throw new Error("Paste the API key first, or use the sign-in button above."); ctx.keys = (await post("/setup/key", { name: "YOUTUBE", value: v.key.trim() })).keys; },
      disconnect: async (ctx) => { ctx.keys = (await post("/setup/key", { name: "YOUTUBE", value: "" })).keys; },
      actions: { ytLogin: () => post("/media/login", { service: "youtube" }) },
    },
    phone: { name: "Phone Link", icon: "📱", what: "Hear who's texting and calling, from your phone through Windows Phone Link.", guide: "/help#phone",
      load: async (ctx) => ({ on: Boolean(ctx.owner?.features?.phone) }),
      pill: (s) => (s.on ? ["on", "Turned on"] : ["off", "Not connected"]),
      steps: () => [
        { text: "Open Phone Link on this computer (search for it in the Start menu; it comes with Windows) and pair your phone. It shows a QR code to scan." },
        { text: "In Phone Link's settings, turn on notifications for messages and calls." },
        { text: "Click Turn on below. New texts are announced, and they're only read out when you say yes." },
      ],
      fields: [], connectLabel: "Turn on",
      connect: async (v, s, ctx) => { const r = await post("/setup/features", { features: { phone: true } }); ctx.owner = r.owner; },
      disconnect: async (ctx) => { const r = await post("/setup/features", { features: { phone: false } }); ctx.owner = r.owner; },
    },
    discord: { name: "Discord bot", icon: "🎮", what: "Dayspring joins your Discord server as its own bot, for voice and chat.", guide: "/help#discord-bot",
      load: async () => { const d = await api("/setup/discord"); return { ...d.bot, tokenSet: Boolean(d.keys?.DISCORD_BOT_TOKEN?.set), ownerId: d.keys?.DISCORD_OWNER_ID?.value ?? "", textChannelId: d.keys?.DISCORD_TEXT_CHANNEL_ID?.value ?? "" }; },
      pill: (s) => (s.status === "online" ? ["on", `Connected${s.user ? " as " + s.user : ""}`] : s.tokenSet ? ["warn", s.lastError ? "Needs attention" : "Not online"] : ["off", "Not connected"]),
      steps: () => [
        { text: "Open Discord's developer portal, click New Application and give it a name.", link: "https://discord.com/developers/applications", linkLabel: "Open the Discord developer portal" },
        { text: "Under Bot: Reset Token, copy it and paste it below. Turn on Message Content Intent and Server Members Intent." },
        { text: "Under OAuth2 → URL Generator: tick bot, then Connect, Speak, Send Messages and Read Message History. Open the link it makes and add the bot to your server." },
        { text: "In Discord: Settings → Advanced → Developer Mode on. Right-click your name → Copy User ID and paste it below (so it knows you're the owner)." },
      ],
      fields: [{ key: "token", label: "Bot token", secret: true, placeholder: "MTA…" }, { key: "ownerId", label: "Your Discord user ID", placeholder: "123456789012345678" }, { key: "textChannelId", label: "Text channel ID (optional)", placeholder: "123456789012345678" }],
      fill: (s) => ({ ownerId: s.ownerId, textChannelId: s.textChannelId }),
      connect: async (v, s) => {
        if (!v.token && !s.tokenSet) throw new Error("Paste the bot token first (Bot → Reset Token on Discord's site).");
        const body = { ownerId: v.ownerId ?? "", textChannelId: v.textChannelId ?? "" }; if (v.token) body.token = v.token.trim();
        const r = await post("/setup/discord", body);
        if (r.bot?.status !== "online") throw new Error(r.bot?.lastError ? `Discord said: ${r.bot.lastError}` : "Saved, but the bot isn't online yet. Check the token and the intents, then try again.");
      },
      disconnect: () => post("/setup/discord", { clearToken: true }),
      extra: (s) => (s.lastError ? `<div class="note warn">Last problem: ${esc(s.lastError)}</div>` : s.guilds?.length ? `<p class="hint">In ${s.guilds.map((g) => esc(g.name)).join(", ")}</p>` : ""),
    },
    tunein: { name: "Tune in", icon: "🎧", what: "Listen to what's playing in your headset (calls, videos) and answer when asked.", guide: "/help#discord-calls",
      load: () => api("/tunein"),
      pill: (s) => (s.on ? ["on", `On${s.device ? " · " + s.device : ""}`] : s.error ? ["warn", "Needs attention"] : ["off", "Off"]),
      steps: (s) => [
        { text: "Tune in listens to the sound going to your headset, on this computer only. Nothing is recorded or sent anywhere." },
        { text: s.stt?.ok ? "Speech-to-text is ready." : "It needs the free local speech-to-text first (about 150 MB). Turning it on asks to download it.", action: s.stt?.ok ? null : "install", actionLabel: "Download speech-to-text" },
        { text: "Click Turn on. Say “Dayspring, stop listening” any time." },
      ],
      fields: [], connectLabel: "Turn on", disconnectLabel: "Turn off",
      connect: async () => { const r = await post("/tunein", { on: true }); if (r.needsInstall) throw new Error("Download the speech-to-text first (the button in step 2)."); if (r.ok === false) throw new Error(r.error || r.why || "It couldn't start."); },
      disconnect: () => post("/tunein", { on: false }),
      actions: { install: () => post("/tunein/install", {}) },
      extra: (s) => (s.error ? `<div class="note warn">${esc(s.error)}</div>` : ""),
    },
  };
  for (const id of ["claude", "codex"]) CUSTOM[id] = {
    name: id === "claude" ? "Claude Code" : "Codex", icon: id === "claude" ? "✳️" : "⌘", what: `Voice coding: "Dayspring, add a button that…" and ${id === "claude" ? "Claude Code" : "Codex"} changes Dayspring for you.`, guide: "/help#claude-code", cli: true,
    load: async () => { const [st, g] = await Promise.all([api("/cli/status"), api("/cli/guide?tool=" + id).catch(() => null)]); return { ...(st.tools ?? []).find((t) => t.id === id), guideSteps: g?.steps ?? [] }; },
    pill: (s) => (s.installed && s.signedIn ? ["on", `Connected${s.version ? " · v" + s.version : ""}`] : s.installed ? ["warn", "Sign-in needed"] : ["off", "Not installed"]),
    steps: (s) => (s.guideSteps.length ? s.guideSteps.map((x, i) => ({ text: `${x.title ? x.title + ": " : ""}${x.text}`, action: i === 0 && !s.installed ? "install" : i === 1 && s.installed && !s.signedIn ? "login" : null, actionLabel: i === 0 ? "Install" : "Sign in" })) : [{ text: "Install it, then sign in." }]),
    fields: [], connectLabel: "Check again",
    connect: async () => {},
    actions: {
      install: async (s, say) => {
        let j = await post("/cli/install", { tool: id });
        for (let i = 0; i < 200 && j.state === "running"; i++) { say(`Installing… ${j.log?.at(-1) ?? ""}`); await sleep(1500); j = await api("/cli/job?id=" + encodeURIComponent(j.id)); }
        if (j.state === "failed") throw new Error(j.error || "The installer stopped.");
        return j.state === "done-restart" ? "Installed. Restart Dayspring so Windows finds it." : "Installed ✓ Now sign in.";
      },
      login: async () => { const r = await post("/cli/login", { tool: id }); if (r.ok === false) throw new Error(r.text); return "A sign-in window opened. Follow the steps there, then click Check again."; },
    },
    notes: ["To sign out, run its logout command in a terminal (for example `claude /logout`). Dayspring doesn't keep its sign-in."],
  };

  // ---------------------------------------------------------------------------------------------------------- state
  let ctx = {}, root = null, apps = {}, es = null, openId = null, lastFocus = null;
  const connectorPill = (a) => {
    const s = a.status ?? {};
    if (a.id === "weatheralerts") return s.who === "off" ? ["off", "Off"] : /set your town/i.test(s.who ?? "") ? ["warn", "Set your town first"] : ["on", `On${s.who ? " for " + s.who : ""}${s.active ? ` · ${s.active} alert${s.active > 1 ? "s" : ""} now` : ""}`];
    if (s.error) return ["warn", "Needs attention"];
    if (OAUTH.includes(a.id) && s.configured && !s.connected) return ["warn", "Sign-in not finished"];
    if (a.id === "webhooks" && !s.outgoing?.length) return s.connected ? ["on", "Incoming link used"] : ["off", "Not connected"];
    return s.connected ? ["on", MULTI[a.id] ? `Connected · ${s.who}` : `Connected${s.who ? " as " + s.who : ""}`] : ["off", "Not connected"];
  };
  const pillOf = (id) => { const a = apps[id]; if (!a) return ["off", "…"]; if (a.loadError) return ["warn", "Couldn't check"]; return a.custom ? CUSTOM[id].pill(a.status ?? {}) : connectorPill(a); };
  const guideUrl = (id) => (CUSTOM[id] ? CUSTOM[id].guide : id === "google" ? "/help#google-drive" : `/help#connections/${anchor(apps[id]?.name ?? id)}`);

  async function loadAll() {
    const [conn] = await Promise.all([
      api("/connect").then((r) => { for (const a of r.apps ?? []) apps[a.id] = { ...a, custom: false }; }).catch((e) => { for (const g of GROUPS) for (const id of g.apps) if (!CUSTOM[id]) apps[id] = { id, name: id, icon: "🔌", loadError: friendly(e), custom: false }; }),
      ...Object.keys(CUSTOM).map((id) => loadCustom(id)),
    ]);
    return conn;
  }
  async function loadCustom(id) {
    const c = CUSTOM[id];
    try { apps[id] = { id, name: c.name, icon: c.icon, what: c.what, custom: true, status: await c.load(ctx) }; }
    catch (e) { apps[id] = { id, name: c.name, icon: c.icon, what: c.what, custom: true, status: {}, loadError: friendly(e) }; }
  }
  async function refresh(id) {
    if (CUSTOM[id]) await loadCustom(id);
    else { try { const s = await api(`/connect/${id}/status`); apps[id] = { ...apps[id], status: s }; delete apps[id].loadError; } catch (e) { apps[id] = { ...apps[id], loadError: friendly(e) }; } }
    paintCard(id);
    if (openId === id) paintDrawer();
  }

  // ---------------------------------------------------------------------------------------------------------- the page
  function html() {
    return `
      <h1>Apps &amp; connections</h1>
      <p class="lead">Everything Dayspring can connect to, in one place. Connect, check, change or disconnect any of them at any time. Whatever you paste stays on this computer.</p>
      <div id="appsRoot" class="apps-root"><p class="hint">Checking your connections…</p></div>
      <p class="hint">Nothing you connect can send email, post or buy anything without asking you first. The <a href="/help#connections" target="_blank" rel="noopener">Connecting apps guide</a> covers every app in detail.</p>
      <div class="apps-shade" id="appsShade" hidden></div>
      <aside class="apps-drawer" id="appsDrawer" role="dialog" aria-modal="true" aria-labelledby="adTitle" hidden></aside>`;
  }
  function card(id) {
    const a = apps[id]; if (!a) return "";
    const [kind, text] = pillOf(id), on = kind === "on", c = CUSTOM[id];
    const what = c ? c.what : SHORT[id] ?? a.what ?? "";
    const canOff = on || (kind === "warn" && !a.loadError);
    const offLabel = c?.disconnectLabel ?? (id === "weatheralerts" ? "Turn off" : "Disconnect");
    return `<article class="app-card ${kind}" data-id="${id}" aria-labelledby="ac-${id}">
      <div class="app-hd"><span class="app-ic" aria-hidden="true">${a.icon ?? "🔌"}</span><h3 id="ac-${id}">${esc(c ? c.name : a.name)}</h3></div>
      <p class="app-what">${esc(what)}</p>
      <span class="pill ${kind}" role="status"><i aria-hidden="true"></i>${esc(text)}</span>
      <div class="app-acts">
        ${on ? `<button type="button" class="btn small" data-act="manage">Manage</button>` : `<button type="button" class="btn small primary" data-act="setup">${kind === "warn" ? "Fix" : c?.cli && !a.status?.installed ? "Set up" : c?.connectLabel === "Turn on" ? "Turn on…" : "Connect"}</button>`}
        ${canOff && !c?.cli ? `<button type="button" class="btn small ghost danger" data-act="off">${esc(offLabel)}</button>` : ""}
      </div>
    </article>`;
  }
  function paint() {
    root.innerHTML = GROUPS.map((g) => `<section class="app-group" aria-labelledby="ag-${g.id}"><h2 id="ag-${g.id}">${esc(g.title)}</h2>
      <div class="app-grid">${g.apps.map(card).join("")}</div>
      ${g.id === "calendars" ? `<div class="app-sync" id="calendarSync" data-hook="calendar-sync"><h3>🔄 Calendar sync</h3><p class="hint">Events from the calendars you connect show on Dayspring's calendar next to your own. Settings for how they're merged will appear here.</p></div>` : ""}
    </section>`).join("");
    wireCards(root);
    const sync = $("#calendarSync", root);
    try { if (typeof window.DayspringCalendarSync === "function") window.DayspringCalendarSync(sync, ctx); } catch (e) { console.error(e); }
    document.dispatchEvent(new CustomEvent("dayspring:calendar-sync", { detail: { el: sync } }));
  }
  function paintCard(id) {
    const old = root && $(`.app-card[data-id="${id}"]`, root); if (!old) return;
    const had = old.contains(document.activeElement) ? document.activeElement.dataset.act : null;
    old.outerHTML = card(id);
    const fresh = $(`.app-card[data-id="${id}"]`, root); wireCards(fresh.parentElement, fresh);
    if (had) ($(`[data-act="${had}"]`, fresh) ?? $("button", fresh))?.focus();
  }
  function wireCards(scope, only = null) {
    for (const cardEl of only ? [only] : $$(".app-card", scope)) {
      const id = cardEl.dataset.id;
      for (const b of $$("[data-act]", cardEl)) b.onclick = () => (b.dataset.act === "off" ? confirmOff(b, id) : openDrawer(id, b));
    }
  }
  // Disconnect asks once, in place (no pop-up): "Disconnect?" → "Yes, disconnect" for a few seconds
  function confirmOff(b, id) {
    if (!b.dataset.sure) {
      b.dataset.sure = "1"; const was = b.textContent; b.textContent = "Yes, " + was.toLowerCase(); b.classList.add("sure");
      clearTimeout(b._t); b._t = setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = was; b.classList.remove("sure"); } }, 4000);
      return;
    }
    disconnect(id, b);
  }
  async function disconnect(id, b) {
    if (b) b.disabled = true;
    try {
      if (CUSTOM[id]) await CUSTOM[id].disconnect(ctx); else await post(`/connect/${id}/disconnect`, {});
      ctx.toast?.(`${CUSTOM[id]?.name ?? apps[id]?.name ?? id}: disconnected`);
    } catch (e) { ctx.toast?.(friendly(e)); }
    await refresh(id);
  }

  // ---------------------------------------------------------------------------------------------------------- the drawer
  const values = {};   // what's typed in the drawer, kept while it re-renders (never shown in the page's markup)
  function openDrawer(id, from) {
    openId = id; lastFocus = from ?? document.activeElement;
    for (const k of Object.keys(values)) delete values[k];
    const fill = CUSTOM[id]?.fill?.(apps[id]?.status ?? {}); if (fill) Object.assign(values, fill);
    $("#appsShade").hidden = false; $("#appsDrawer").hidden = false; document.body.classList.add("drawer-open");
    paintDrawer();
    $("#adClose")?.focus();
  }
  function closeDrawer() {
    if (!openId) return;
    openId = null; stopPoll();
    $("#appsShade").hidden = true; const d = $("#appsDrawer"); d.hidden = true; d.innerHTML = ""; document.body.classList.remove("drawer-open");
    for (const k of Object.keys(values)) delete values[k];
    if (lastFocus?.isConnected) lastFocus.focus(); else $(".app-card button", root)?.focus();
  }
  const stepHtml = (s, i) => `<li><div>${esc(s.text)}</div>${s.link || s.copy || s.action ? `<div class="step-acts">
      ${s.link ? `<button type="button" class="btn small" data-link="${esc(s.link)}">${esc(s.linkLabel || "Open")} ↗</button>` : ""}
      ${s.copy ? `<code class="copyval">${esc(s.copy)}</code><button type="button" class="btn small" data-copy="${esc(s.copy)}" aria-label="Copy ${esc(s.copy)}">Copy</button>` : ""}
      ${s.action ? `<button type="button" class="btn small" data-action="${esc(s.action)}">${esc(s.actionLabel || "Do it")}</button>` : ""}</div>` : ""}</li>`;
  function fieldHtml(f, id, opts) {
    const fid = `af-${id}-${f.key}`;
    const list = opts?.length ? ` list="${fid}-list"` : "";
    return `<div class="field"><label for="${fid}">${esc(f.label)}</label>
      <div class="secret-row"><input type="${f.secret ? "password" : "text"}" id="${fid}" data-key="${esc(f.key)}" value="" placeholder="${esc(f.placeholder ?? "")}" autocomplete="off" spellcheck="false"${list}>
      ${f.secret ? `<button type="button" class="btn small ghost" data-show="${fid}" aria-pressed="false" aria-label="Show ${esc(f.label)}">Show</button>` : ""}</div>
      ${opts?.length ? `<datalist id="${fid}-list">${opts.map((o) => `<option value="${esc(o)}">`).join("")}</datalist>` : ""}
      ${f.secret ? `<div class="hint">Hidden as you type. It's saved on this computer only.</div>` : ""}</div>`;
  }
  function itemsHtml(id, s) {
    const key = MULTI[id]; if (!key) return "";
    const items = s[key] ?? [];
    const label = { ics: "Your calendars", feeds: "Your feeds", webhooks: "Your actions" }[id];
    const line = (x) => id === "webhooks" ? `<div class="t">${esc(x.name)}</div><div class="s">Say “${esc(x.phrase)}” · ${esc(x.host)}</div>` : `<div class="t">${esc(x.name)}</div><div class="s">${esc([x.topic, x.host].filter(Boolean).join(" · "))}</div>`;
    const incoming = id === "webhooks" && s.incoming ? `<h3>Incoming link</h3><p class="hint">Other services can make Dayspring speak or set a reminder by sending to this link. It works on this computer only. Keep it private: anyone with it can make Dayspring talk.</p>
      <div class="secret-row"><code class="copyval masked" id="adIncoming" data-real="${esc(s.incoming)}">${esc(s.incoming.replace(/[^/]+$/, "••••••••"))}</code>
      <button type="button" class="btn small ghost" data-reveal="adIncoming" aria-pressed="false">Show</button><button type="button" class="btn small" data-copy="${esc(s.incoming)}" aria-label="Copy the incoming link">Copy</button></div>` : "";
    return `<h3>${label}</h3>${items.length ? `<div class="list" role="list">${items.map((x) => `<div class="item" role="listitem"><div class="grow">${line(x)}</div><button type="button" class="btn small ghost danger" data-remove="${esc(x.id)}" aria-label="Remove ${esc(x.name)}">Remove</button></div>`).join("")}</div>` : `<p class="hint">None yet. Add one below.</p>`}${incoming}`;
  }
  function paintDrawer() {
    const id = openId, a = apps[id], d = $("#appsDrawer"); if (!id || !a) return;
    const c = CUSTOM[id], s = a.status ?? {}, [kind, text] = pillOf(id);
    const steps = c ? c.steps(s) : a.steps ?? [], fields = c ? c.fields : a.fields ?? [], notes = c ? c.notes ?? [] : a.notes ?? [];
    const multi = Boolean(MULTI[id]), oauth = OAUTH.includes(id);
    const go = c?.connectLabel ?? (multi ? (s[MULTI[id]]?.length ? "Add" : "Connect") : oauth ? (id === "google" && s.accounts?.length ? "Add another Google account" : kind === "on" ? "Sign in again" : `Sign in with ${id === "google" ? "Google" : "Microsoft"}`) : id === "weatheralerts" ? "Turn on" : kind === "on" ? "Save and test" : "Connect");
    const focusKey = d.contains(document.activeElement) ? (document.activeElement.id || document.activeElement.dataset.act) : null;
    d.innerHTML = `
      <header class="ad-hd"><span class="app-ic" aria-hidden="true">${a.icon ?? "🔌"}</span><div class="grow"><h2 id="adTitle">${esc(c ? c.name : a.name)}</h2><span class="pill ${kind}"><i aria-hidden="true"></i>${esc(text)}</span></div>
        <button type="button" class="btn small ghost" id="adClose" aria-label="Close">✕</button></header>
      <div class="ad-body">
        <p>${esc(c ? c.what : a.what)}</p>
        ${!c && (a.needs || a.time) ? `<p class="hint">${a.needs ? `You'll need: ${esc(a.needs)}. ` : ""}${a.time ? `About ${esc(a.time)}.` : ""}</p>` : ""}
        ${a.loadError ? `<div class="note warn">${esc(a.loadError)}</div>` : ""}
        ${c?.extra ? c.extra(s) : ""}
        ${itemsHtml(id, s)}
        ${id === "google" ? googleHtml(s) : ""}
        ${steps.length ? `<h3>${kind === "on" && !multi ? "How it was set up" : "Step by step"}</h3><ol class="steps">${steps.map(stepHtml).join("")}</ol>` : ""}
        ${fields.length ? `<form class="ad-form" id="adForm" novalidate>${fields.map((f) => fieldHtml(f, id, id === "feeds" && f.key === "topic" ? [...(s.topics ?? []), "local"] : null)).join("")}</form>` : ""}
        <div class="ad-acts"><button type="button" class="btn primary" data-act="go" id="adGo">${esc(go)}</button>
          ${(kind === "on" || kind === "warn") && !c?.cli ? `<button type="button" class="btn ghost danger" data-act="off">${esc(c?.disconnectLabel ?? (id === "weatheralerts" ? "Turn off" : "Disconnect"))}</button>` : ""}</div>
        <div class="msg" id="adMsg" role="status" aria-live="polite"></div>
        ${notes.length ? `<ul class="ad-notes">${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
        <p><a class="btn small ghost" href="${esc(guideUrl(id))}" target="_blank" rel="noopener">📖 Open the full guide ↗</a></p>
      </div>`;
    wireDrawer(d, id);
    if (focusKey) (d.querySelector("#" + CSS.escape(focusKey)) ?? $(`[data-act="${focusKey}"]`, d))?.focus();
  }
  const say = (t, k = "") => { const m = $("#adMsg"); if (m) { m.className = "msg " + k; m.textContent = t; } };
  function wireDrawer(d, id) {
    $("#adClose", d).onclick = closeDrawer;
    for (const i of $$("input[data-key]", d)) { if (values[i.dataset.key]) i.value = values[i.dataset.key]; i.oninput = () => { values[i.dataset.key] = i.value; }; }
    $("#adForm", d)?.addEventListener("submit", (e) => { e.preventDefault(); $("#adGo", d).click(); });
    for (const i of $$("#adForm input", d)) i.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("#adGo", d).click(); } });
    for (const b of $$("[data-show]", d)) b.onclick = () => { const i = $("#" + CSS.escape(b.dataset.show), d), show = i.type === "password"; i.type = show ? "text" : "password"; b.textContent = show ? "Hide" : "Show"; b.setAttribute("aria-pressed", String(show)); };
    for (const b of $$("[data-reveal]", d)) b.onclick = () => { const el = $("#" + b.dataset.reveal, d), show = el.classList.contains("masked"); el.textContent = show ? el.dataset.real : el.dataset.real.replace(/[^/]+$/, "••••••••"); el.classList.toggle("masked", !show); b.textContent = show ? "Hide" : "Show"; b.setAttribute("aria-pressed", String(show)); };
    for (const b of $$("[data-link]", d)) b.onclick = () => ctx.openLink?.(b.dataset.link);
    for (const b of $$("[data-copy]", d)) b.onclick = () => copy(b.dataset.copy, b);
    for (const b of $$("[data-remove]", d)) b.onclick = async () => {
      b.disabled = true;
      try { apps[id] = { ...apps[id], status: await post(`/connect/${id}/remove`, { id: b.dataset.remove }) }; say("Removed ✓", "ok"); paintCard(id); paintDrawer(); say("Removed ✓", "ok"); }
      catch (e) { b.disabled = false; say(friendly(e), "bad"); }
    };
    for (const b of $$("[data-action]", d)) b.onclick = async () => {
      const fn = CUSTOM[id]?.actions?.[b.dataset.action]; if (!fn) return;
      b.disabled = true; say("Working on it…");
      try { const r = await fn(apps[id]?.status ?? {}, (t) => say(t)); say(typeof r === "string" ? r : "Done ✓", "ok"); await refresh(id); say(typeof r === "string" ? r : "Done ✓", "ok"); }
      catch (e) { say(friendly(e), "bad"); b.disabled = false; }
    };
    $('[data-act="go"]', d).onclick = () => connect(id);
    if (id === "google") wireGoogle(d);
    const off = $('[data-act="off"]', d); if (off) off.onclick = () => confirmOff(off, id);
  }
  // ---- Google: several accounts, each with its own services and Drive write switch (only emails are ever shown) ----
  const GSVC = [["calendar", "Calendar"], ["gmail", "Gmail"], ["drive", "Drive"]];
  function googleHtml(s) {
    const list = s.accounts ?? [];
    if (!list.length) return "";
    return `<h3>Your Google accounts</h3><div class="list" role="list">${list.map((a) => `<div class="item gacct" role="listitem" data-gid="${esc(a.id)}"><div class="grow">
      <div class="t">${esc(a.nickname ? `${a.nickname} · ${a.email ?? ""}` : a.email ?? "Google account")}${a.primary ? ` <span class="pill on"><i aria-hidden="true"></i>Primary</span>` : ""}</div>
      <div class="s" style="display:flex;flex-wrap:wrap;gap:.2em 1em;margin:.35em 0">${GSVC.map(([k, label]) => `<label><input type="checkbox" data-gsvc="${k}"${a.services?.[k] ? " checked" : ""}> ${label}${a.services?.[k] && !a.ready?.[k] ? " (sign-in needed)" : ""}</label>`).join("")}</div>
      <div class="s"><label><input type="checkbox" data-gwrite${a.driveWriteOn ? " checked" : ""}${a.services?.drive ? "" : " disabled"}> Let Dayspring add and change files in this Drive${a.driveWriteOn && !a.driveWrite ? " (sign-in needed)" : ""}</label></div>
      <div class="secret-row" style="margin-top:.4em"><input type="text" data-gnick value="${esc(a.nickname ?? "")}" placeholder="Nickname (Work, Personal)" aria-label="Nickname for ${esc(a.email ?? "this account")}" maxlength="40"><button type="button" class="btn small ghost" data-gact="nick">Save name</button></div>
      ${a.needsSignIn?.length ? `<div class="note warn">Google still needs to allow: ${esc(a.needsSignIn.join(", "))}. <button type="button" class="btn small" data-gact="signin">Sign in again</button></div>` : ""}
      </div><div class="app-acts" style="flex-direction:column">${a.primary ? "" : `<button type="button" class="btn small ghost" data-gact="primary">Make primary</button>`}<button type="button" class="btn small ghost danger" data-gact="remove">Remove</button></div></div>`).join("")}</div>
      <p class="hint">Calendar and Gmail use the primary account unless you name another (“check my work email”). Drive searches look in every account with Drive on. Changing Drive files always asks you first, and deleting only moves things to Drive's trash.</p>`;
  }
  function wireGoogle(d) {
    const upd = async (gid, patch, what) => {
      say("Saving…");
      try {
        const r = await post("/connect/google/account", { action: "update", id: gid, ...patch });
        apps.google = { ...apps.google, status: { ...(apps.google.status ?? {}), ...r } };
        if (r.needsSignIn) { say(`Google needs your OK for ${r.what?.join(" and ") || "that"}. The sign-in opened in your browser; this updates by itself.`, "ok"); poll("google"); }
        else say(`${what} ✓`, "ok");
        paintCard("google"); paintDrawer(); if (!r.needsSignIn) say(`${what} ✓`, "ok");
      } catch (e) { say(friendly(e), "bad"); }
    };
    for (const row of $$(".gacct", d)) {
      const gid = row.dataset.gid;
      for (const cb of $$("[data-gsvc]", row)) cb.onchange = () => upd(gid, { services: { [cb.dataset.gsvc]: cb.checked } }, `${cb.checked ? "Turned on" : "Turned off"} ${cb.parentElement.textContent.trim().replace(/ \(.*$/, "")}`);
      const w = $("[data-gwrite]", row); if (w) w.onchange = () => upd(gid, { driveWrite: w.checked }, w.checked ? "Dayspring may add and change files in this Drive (asking first each time)" : "This Drive is look-only again");
      for (const b of $$("[data-gact]", row)) b.onclick = async () => {
        const a = b.dataset.gact;
        if (a === "nick") return upd(gid, { nickname: $("[data-gnick]", row).value }, "Name saved");
        if (a === "primary") return upd(gid, { primary: true }, "Primary account changed");
        if (a === "signin") { try { const acc = (apps.google.status?.accounts ?? []).find((x) => x.id === gid); await upd(gid, { services: { ...acc?.services }, driveWrite: Boolean(acc?.driveWriteOn) }, "Checked"); } catch (e) { say(friendly(e), "bad"); } return; }
        if (a === "remove") {
          if (!b.dataset.sure) { b.dataset.sure = "1"; b.textContent = "Yes, remove"; b.classList.add("sure"); setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = "Remove"; b.classList.remove("sure"); } }, 4000); return; }
          b.disabled = true;
          try { const r = await post("/connect/google/account", { action: "remove", id: gid }); apps.google = { ...apps.google, status: { ...(apps.google.status ?? {}), ...r } }; paintCard("google"); paintDrawer(); say("Removed ✓ The other accounts stay connected.", "ok"); }
          catch (e) { b.disabled = false; say(friendly(e), "bad"); }
        }
      };
    }
  }
  async function copy(text, b) {
    try { await navigator.clipboard.writeText(text); }
    catch { const t = document.createElement("textarea"); t.value = text; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0"; document.body.append(t); t.select(); try { document.execCommand("copy"); } catch { /* nothing more to try */ } t.remove(); }
    const was = b.textContent; b.textContent = "Copied ✓"; setTimeout(() => { if (b.isConnected) b.textContent = was; }, 1600);
  }
  async function connect(id) {
    const b = $("#adGo"), c = CUSTOM[id], a = apps[id];
    const v = {}; for (const i of $$("#adForm input[data-key]")) { const t = i.value.trim(); if (t) v[i.dataset.key] = t; }
    b.disabled = true; say(OAUTH.includes(id) ? "Opening the sign-in…" : "Connecting…");
    try {
      if (c) {
        const r = await c.connect(v, a.status ?? {}, ctx);
        await refresh(id);
        if (r?.wait) { say(r.wait, "ok"); poll(id); }
        else { const [k, t] = pillOf(id); say(k === "on" ? `✓ ${t}` : c.cli ? (k === "warn" ? "Installed, but not signed in yet. Use Sign in above." : "Not installed yet. Use Install above.") : t, k === "on" ? "ok" : "bad"); }
        return;
      }
      const body = { ...v };
      if (id === "feeds" && /^local$/i.test(body.topic ?? "")) { delete body.topic; body.local = true; }
      if (id === "feeds" && !body.topic && !body.url && !body.local) throw new Error("Type a topic (like tech or sports) or paste a feed link.");
      if (id === "ics" && !body.url) throw new Error("Paste the calendar link first (it starts with webcal:// or https://).");
      if (id === "webhooks" && (!body.url || !body.phrase)) throw new Error("Give it a phrase to say and paste the webhook link.");
      const need = (REQUIRED[id] ?? []).filter((k) => !body[k]).map((k) => (a.fields ?? []).find((f) => f.key === k)?.label ?? k);
      if (need.length && !(OAUTH.includes(id) && a.status?.configured && !Object.keys(body).length)) throw new Error(`Fill in ${need.join(" and ")} first.`);
      const r = await post(`/connect/${id}/start`, body);
      if (r.url) {
        say(r.opened ? "The sign-in opened in your browser. Approve it there; this updates by itself." : "Open the sign-in to finish:", "ok");
        const m = $("#adMsg"); const link = document.createElement("button"); link.type = "button"; link.className = "btn small"; link.textContent = "Open the sign-in again ↗"; link.onclick = () => ctx.openLink?.(r.url); m?.after(link);
        poll(id);
      } else {
        apps[id] = { ...apps[id], status: { ...apps[id].status, ...r } }; delete apps[id].loadError;
        if (MULTI[id]) for (const k of Object.keys(values)) delete values[k];
        paintCard(id); paintDrawer();
        say(MULTI[id] ? "Added ✓" : `✓ ${pillOf(id)[1]}`, "ok");
      }
    } catch (e) { say(friendly(e), "bad"); }
    finally { const g = $("#adGo"); if (g) g.disabled = false; }
  }
  // after a browser sign-in (Google, Microsoft, Spotify): check every 3 seconds for up to 3 minutes
  let pollT = null;
  const stopPoll = () => { clearInterval(pollT); pollT = null; };
  function poll(id) {
    stopPoll(); const until = Date.now() + 180_000;
    pollT = setInterval(async () => {
      if (Date.now() > until || openId !== id) return stopPoll();
      await refresh(id).catch(() => {});
      if (pillOf(id)[0] === "on") { stopPoll(); say(`✓ ${pillOf(id)[1]}`, "ok"); ctx.toast?.(`${CUSTOM[id]?.name ?? apps[id]?.name}: connected ✓`); }
    }, 3000);
  }

  // ---------------------------------------------------------------------------------------------------------- mount
  async function mount(el, c = {}) {
    ctx = c; root = $("#appsRoot", el) ?? el; openId = null;
    // the drawer lives on <body>: the page's card animates with a transform, which would pin "fixed" to the card
    for (const id of ["appsShade", "appsDrawer"]) { const mine = $("#" + id, el); if (!mine) continue; for (const old of $$("#" + id)) if (old !== mine) old.remove(); document.body.append(mine); }
    document.body.classList.remove("drawer-open");
    await loadAll();
    if (!root.isConnected) return;
    paint();
    const want = new URLSearchParams(location.search).get("app");
    if (want && apps[want]) openDrawer(want, $(`.app-card[data-id="${want}"] button`, root));
    // live: the server says when a connection changes (a browser sign-in finishing, a voice command)
    try { es?.close(); es = new EventSource("/api/events"); es.addEventListener("connections", async () => { if (!root?.isConnected) { es.close(); return; } for (const id of Object.keys(apps)) if (!CUSTOM[id]) await refresh(id); }); } catch { /* fine without */ }
  }
  document.addEventListener("keydown", (e) => {
    if (!openId) return;
    const d = $("#appsDrawer");
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeDrawer(); return; }
    if (e.key === "Tab" && d) {   // keep Tab inside the drawer while it's open
      const f = $$("button:not([disabled]), a[href], input, [tabindex]:not([tabindex='-1'])", d).filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
      else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
      else if (!d.contains(document.activeElement)) { e.preventDefault(); f[0].focus(); }
    }
  }, true);
  document.addEventListener("click", (e) => { if (e.target?.id === "appsShade") closeDrawer(); });

  window.DayspringApps = { html, mount, close: closeDrawer, refresh };
})();
