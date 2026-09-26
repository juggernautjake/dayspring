// Dayspring on the TV: the day at a glance over a living aurora, spoken check-ins and announcements,
// a wake-phrase listener, music and video, sound bites, Claude Code alerts, and notification modes
// (voice / chime / silent). Everything here works without Claude.
(() => {
  const $ = (s) => document.querySelector(s);
  const api = (path, opts) => fetch("/api" + path, opts).then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Dayspring couldn't do that just now. Try again in a moment, or restart Dayspring if it keeps happening."); return r; });
  const json = (path, opts) => api(path, opts).then((r) => r.json());
  const post = (path, body) => json(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* private window */ } } };
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const CAT = { faith: "--faith", body: "--body", work: "--work", study: "--study", meal: "--meal", home: "--home", rest: "--rest", flex: "--flex" };
  const catVar = (c) => `var(${CAT[c] ?? "--indigo"})`;
  // Line icons for each kind of block.
  const ICON = {
    faith: '<path d="M12 3v18M7 8h10"/>',
    body: '<path d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10"/>',
    work: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18"/>',
    study: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 0 4 20.5zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5a1.5 1.5 0 0 1 1.5 1.5z"/>',
    meal: '<path d="M7 3v8a2 2 0 0 0 2 2v8M5 3v5M9 3v5M17 3c-1.7 1-3 3.2-3 6v4h3v8"/>',
    home: '<path d="M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6"/>',
    rest: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    flex: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0"/>',
    code: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13 5l-2 14"/>',
    warn: '<path d="M12 3L2 20h20zM12 10v4M12 17v.5"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  };
  const icon = (k) => `<svg class="ic" viewBox="0 0 24 24">${ICON[k] ?? ICON.flex}</svg>`;
  const hm12 = (t) => { const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`; };
  const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const cap = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
  const fmtIn = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? (m % 60) + " min" : ""}` : `${m} min`).trim();
  // Text in a few lengths, longest first: layout.js shows the longest that fits its box (layout.css ".fitv")
  const V = (...vs) => vs.filter((v, i, a) => v && a.indexOf(v) === i).map((v, i) => `<span class="v" data-v="${i}">${v}</span>`).join("");
  const setV = (el, html) => { if (el && el.dataset.vhtml !== html) { el.dataset.vhtml = html; el.innerHTML = html; } };
  const hmS = (t) => { const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""}`; };
  const apOf = (t) => (Number(t.split(":")[0]) >= 12 ? "PM" : "AM");
  const fmtInS = (m) => fmtIn(m).replace(/ h (\d)/, "h $1").replace(/ h$/, "h").replace(/ min$/, "m");
  // tests and previews: /display?os=10 shows a margin without changing the owner's saved setting
  const OS_TEST = (() => { const v = new URLSearchParams(location.search).get("os"); return v !== null && v !== "" && isFinite(v) ? Number(v) : null; })();

  let blocks = [], config = { wakePhrases: ["dayspring"] }, prefs = { mode: "voice", alarm: true };
  // Developer log: what the TV heard and did, batched to /api/devlog (data/devlog/YYYY-MM-DD.jsonl, local only)
  const dlogQ = [];
  function dlog(type, data = {}) { dlogQ.push({ type, at: new Date().toISOString(), ...data }); if (dlogQ.length > 40) flushDlog(); }
  function flushDlog() { if (!dlogQ.length) return; const events = dlogQ.splice(0); fetch("/api/devlog", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events }), keepalive: true }).catch(() => {}); }
  setInterval(flushDlog, 4000);
  window.addEventListener("error", (e) => dlog("error", { where: "page", error: String(e.message).slice(0, 300), line: e.lineno }));
  window.addEventListener("unhandledrejection", (e) => dlog("error", { where: "promise", error: String(e.reason?.message ?? e.reason).slice(0, 300) }));
  // who's who (from the owner profile; filled in at start-up)
  let ownerName = "", assistantName = "Dayspring";
  // Text only (for calls): no mic, no voice; remembered on this TV
  let textOnly = false;
  try { textOnly = localStorage.getItem("ds-text-only") === "1"; } catch { /* private mode */ }

  /* ================================================================ living background */
  // Drifting glows, aurora ribbons, rising dust, a shooting star now and then, and bursts when
  // something happens. The palette follows the time of day.
  const bg = $("#bg"), bgx = bg.getContext("2d");
  let bgW = 0, bgH = 0, energy = 0;
  const BLOBS = [
    { h: 228, s: 85, l: 52, r: 0.55, x: 0.18, y: 0.25, sx: 0.00007, sy: 0.00005, p: 0 },
    { h: 262, s: 80, l: 55, r: 0.5, x: 0.78, y: 0.2, sx: 0.00005, sy: 0.00008, p: 1.7 },
    { h: 285, s: 72, l: 50, r: 0.45, x: 0.62, y: 0.82, sx: 0.00006, sy: 0.00004, p: 3.1 },
    { h: 205, s: 90, l: 50, r: 0.42, x: 0.3, y: 0.78, sx: 0.00004, sy: 0.00007, p: 4.4 },
    { h: 245, s: 70, l: 60, r: 0.35, x: 0.5, y: 0.45, sx: 0.00008, sy: 0.00006, p: 5.6 },
  ];
  const DUST = Array.from({ length: 80 }, () => ({ x: Math.random(), y: Math.random(), z: 0.3 + Math.random() * 0.7, tw: Math.random() * 6.28 }));
  const bursts = [];
  let star = null, nextStar = performance.now() + 8000;
  function burst(hue = 260, n = 60) {
    if (reduced) return;
    const cx = 0.5 + (Math.random() - 0.5) * 0.2, cy = 0.45;
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = 0.004 + Math.random() * 0.012; bursts.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, h: hue + Math.random() * 60 - 30 }); }
    energy = 1;
  }
  // Time-of-day tint: a warmer violet at dawn, clear blues by day, deep indigo at night.
  function tint() {
    const h = new Date().getHours() + new Date().getMinutes() / 60;
    if (h >= 5 && h < 9) return { shift: 18, bright: 1.05 };
    if (h >= 9 && h < 17) return { shift: -8, bright: 1.1 };
    if (h >= 17 && h < 21) return { shift: 12, bright: 1 };
    return { shift: 4, bright: 0.8 };
  }
  function sizeBg() { const dpr = Math.min(window.devicePixelRatio || 1, 1.5); bgW = bg.width = Math.floor(innerWidth * dpr * 0.6); bgH = bg.height = Math.floor(innerHeight * dpr * 0.6); }
  addEventListener("resize", sizeBg); sizeBg();
  let lastBg = 0, tod = tint();
  setInterval(() => { tod = tint(); }, 60_000);
  function drawBg(t) {
    requestAnimationFrame(drawBg);
    if (t - lastBg < 33) return;                   // ~30 fps is plenty for drift
    lastBg = t;
    const W = bgW, H = bgH, M = Math.max(W, H);
    bgx.globalCompositeOperation = "source-over";
    // with the living sky (sky.js) underneath, this layer only adds its glows, softer the brighter the sky
    const S = window.dsSky?.on ? window.dsSky : null;
    if (S?.still && S.stillDrawn && t - S.stillDrawn < 60_000) return;   // "still": a paused painting, redrawn once a minute
    if (S?.still) S.stillDrawn = t;
    if (S) bgx.clearRect(0, 0, W, H); else { bgx.fillStyle = "#060812"; bgx.fillRect(0, 0, W, H); }
    const glow = S ? S.glow : 1;
    bgx.globalCompositeOperation = "lighter";
    for (const b of BLOBS) {
      const x = (b.x + Math.sin(t * b.sx + b.p) * 0.16) * W, y = (b.y + Math.cos(t * b.sy + b.p * 1.3) * 0.14) * H;
      const r = b.r * M * (1 + Math.sin(t * 0.0003 + b.p) * 0.08 + energy * 0.12);
      const g = bgx.createRadialGradient(x, y, 0, x, y, r);
      const a = (0.24 + energy * 0.12) * tod.bright * glow, hue = (S ? S.hue : b.h + tod.shift) + (S ? (b.h - 245) * 0.5 : 0) + Math.sin(t * 0.0001 + b.p) * 12;
      g.addColorStop(0, `hsla(${hue},${b.s}%,${b.l}%,${a})`);
      g.addColorStop(0.45, `hsla(${hue},${b.s}%,${b.l - 12}%,${a * 0.35})`);
      g.addColorStop(1, "hsla(240,60%,10%,0)");
      bgx.fillStyle = g; bgx.beginPath(); bgx.arc(x, y, r, 0, Math.PI * 2); bgx.fill();
    }
    // aurora ribbons
    for (let k = 0; k < 3; k++) {
      const baseY = H * (0.28 + k * 0.2), amp = H * (0.06 + k * 0.02), hue = 200 + k * 40 + tod.shift;
      bgx.beginPath();
      for (let i = 0; i <= 40; i++) {
        const x = (i / 40) * W;
        const y = baseY + Math.sin(i / 6 + t * 0.00025 * (k + 1) + k) * amp + Math.sin(i / 2.7 + t * 0.0004) * amp * 0.25;
        i ? bgx.lineTo(x, y) : bgx.moveTo(x, y);
      }
      bgx.strokeStyle = `hsla(${hue},90%,65%,${(0.05 + energy * 0.05) * tod.bright * (S ? S.aurora : 1)})`;
      bgx.lineWidth = H * 0.05; bgx.filter = "blur(18px)"; bgx.stroke(); bgx.filter = "none";
    }
    bgx.globalCompositeOperation = "source-over";
    for (const d of DUST) {
      d.y -= 0.00022 * d.z * (1 + energy * 3); d.x += Math.sin(t * 0.0004 + d.tw) * 0.00008;
      if (d.y < -0.02) { d.y = 1.02; d.x = Math.random(); }
      const a = (0.25 + 0.35 * Math.sin(t * 0.002 + d.tw) ** 2) * d.z * (S ? S.dust : 1);
      bgx.fillStyle = `rgba(205,212,255,${a})`;
      bgx.beginPath(); bgx.arc(d.x * W, d.y * H, 0.6 + d.z * 1.3, 0, Math.PI * 2); bgx.fill();
    }
    // a shooting star every half minute or so
    if (!star && t > nextStar && (!S || S.stars > 0.6)) { star = { x: Math.random() * 0.6 + 0.1, y: Math.random() * 0.3, vx: 0.012 + Math.random() * 0.006, vy: 0.005 + Math.random() * 0.004, life: 1 }; nextStar = t + 22000 + Math.random() * 30000; }
    if (star) {
      const x = star.x * W, y = star.y * H, tx = x - star.vx * W * 6, ty = y - star.vy * H * 6;
      const g = bgx.createLinearGradient(x, y, tx, ty);
      g.addColorStop(0, `rgba(235,240,255,${star.life})`); g.addColorStop(1, "rgba(235,240,255,0)");
      bgx.strokeStyle = g; bgx.lineWidth = 1.6; bgx.beginPath(); bgx.moveTo(x, y); bgx.lineTo(tx, ty); bgx.stroke();
      star.x += star.vx; star.y += star.vy; star.life -= 0.025;
      if (star.life <= 0) star = null;
    }
    // bursts
    bgx.globalCompositeOperation = "lighter";
    for (let i = bursts.length - 1; i >= 0; i--) {
      const p = bursts[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.00003; p.vx *= 0.975; p.vy *= 0.975; p.life -= 0.02 + (1 - p.life) * 0.02;
      if (p.life <= 0) { bursts.splice(i, 1); continue; }
      bgx.fillStyle = `hsla(${p.h},95%,72%,${p.life})`;
      bgx.beginPath(); bgx.arc(p.x * W, p.y * H, 1.2 + p.life * 2.2, 0, Math.PI * 2); bgx.fill();
    }
    bgx.globalCompositeOperation = "source-over";
    energy *= 0.965;
  }
  if (!reduced) requestAnimationFrame(drawBg); else { bgx.fillStyle = "#070a18"; bgx.fillRect(0, 0, bg.width, bg.height); }

  /* ================================================================ clock (digits roll over) */
  let lastClock = "";
  function renderClock() {
    const d = new Date();
    const s = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    if (s !== lastClock) {
      const [hm, ap] = s.split(" "), prev = lastClock.split(" ")[0] ?? "";
      $("#clock").innerHTML = [...hm].map((ch, i) => ch === ":" ? '<span class="colon">:</span>'
        : `<span class="${prev.length === hm.length && prev[i] !== ch && lastClock ? "roll" : ""}">${ch}</span>`).join("") + `<span class="ap">${ap}</span>`;
      lastClock = s;
    }
    const L = (o) => d.toLocaleDateString("en-US", o);
    setV($("#date"), V(`<b>${L({ weekday: "long" })}</b>, ${L({ month: "long", day: "numeric" })}`, `<b>${L({ weekday: "short" })}</b>, ${L({ month: "short", day: "numeric" })}`, L({ month: "short", day: "numeric" }), String(d.getDate())));
  }

  /* ================================================================ the day */
  async function loadDay() {
    try { blocks = (await json(`/agenda?from=${todayISO()}&to=${todayISO()}`)).blocks; } catch { /* keep the last copy */ }
    renderDay(true);
  }
  const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; };
  const currentBlock = () => { const nm = nowMin(); return blocks.find((b) => toMin(b.start) <= nm && nm < toMin(b.end)); };
  let lastNowId = "init", lastListKey = "";
  function renderDay(full) {
    const nm = Math.floor(nowMin());
    const cur = currentBlock();
    const next = blocks.find((b) => toMin(b.start) > nm);
    if ((cur?.id ?? null) !== lastNowId) {
      lastNowId = cur?.id ?? null;
      const body = $("#nowBody"); body.classList.remove("swap"); void body.offsetWidth; body.classList.add("swap");
      $("#nowIcon").innerHTML = icon(cur?.category ?? "rest");
      $("#nowTitle").textContent = cur ? cur.title : "Open time";
      $("#nowTitle").title = cur ? cur.title : "";
      $("#nowDesc").textContent = cur?.description ?? "";
      $("#nowLabel").textContent = cur ? "Now" : "Free";
      $("#now").style.setProperty("--cat", cur ? catVar(cur.category) : "var(--indigo)");
    }
    setV($("#nowTime"), cur ? V(`${hm12(cur.start)} – ${hm12(cur.end)}`, apOf(cur.start) === apOf(cur.end) ? `${hmS(cur.start)}–${hmS(cur.end)} ${apOf(cur.end)}` : `${hmS(cur.start)} ${apOf(cur.start)}–${hmS(cur.end)} ${apOf(cur.end)}`, `${hmS(cur.start)}–${hmS(cur.end)}`)
      : next ? V(`Until ${hm12(next.start)}`, `Until ${hmS(next.start)} ${apOf(next.start)}`, `→ ${hmS(next.start)}`) : V("Nothing else today", "Free"));
    const left = cur ? Math.ceil(toMin(cur.end) - nowMin()) : 0;
    $("#nowLeft").hidden = !cur; setV($("#nowLeft"), cur ? V(`${fmtIn(left)} left`, `${fmtInS(left)} left`, fmtInS(left)) : "");
    renderBar();
    // next, with a ring that fills over its last hour
    $("#nextTitle").textContent = next ? next.title : "Nothing else today";
    $("#nextTitle").title = next ? next.title : "";
    const inM = next ? toMin(next.start) - nm : 0;
    setV($("#nextWhen"), next ? V(`<b>${hm12(next.start)}</b>in ${fmtIn(inM)}`, `<b>${hmS(next.start)} ${apOf(next.start)}</b>in ${fmtInS(inM)}`, `<b>${hmS(next.start)}</b>${fmtInS(inM)}`) : "");
    $("#next").style.setProperty("--ncat", next ? catVar(next.category) : "var(--indigo)");
    const until = next ? toMin(next.start) - nowMin() : 60;
    $("#nextRing").style.strokeDashoffset = String(100.5 * Math.min(1, Math.max(0, until / 60)));
    // today's timeline (rebuilt only when it changes, so its entrance animation plays once)
    const list = blocks.filter((b) => toMin(b.end) > nm - 60).slice(0, 13);
    const key = JSON.stringify(list.map((b) => [b.id, b.done, b === cur, toMin(b.end) <= nm]));
    if (key !== lastListKey || full) {
      const first = lastListKey === "";
      lastListKey = key;
      $("#today").innerHTML = list.map((b, i) => {
        const cls = [toMin(b.end) <= nm ? "past" : "", b === cur ? "cur" : "", b.done ? "done" : ""].join(" ");
        const dur = toMin(b.end) - toMin(b.start);
        return `<li data-id="${esc(b.id)}" class="${cls}" style="--c:${catVar(b.category)};animation-delay:${first ? i * 0.05 : 0}s"><span class="hm">${hm12(b.start)}</span><span class="dot"></span><span class="tt">${esc(b.title)}</span><span class="dur">${dur >= 60 ? (dur / 60).toFixed(dur % 60 ? 1 : 0) + " h" : dur + " m"}</span></li>`;
      }).join("") || `<li><span></span><span></span><span class="tt">Nothing scheduled.</span></li>`;
      requestAnimationFrame(() => { if (calView === "day") fitBox($("#today")); });
    }
    nightCheck();
  }
  function renderBar() {
    const nm = nowMin(), cur = blocks.find((b) => toMin(b.start) <= nm && nm < toMin(b.end));
    $("#nowBar").style.width = cur ? `${Math.min(100, ((nm - toMin(cur.start)) / (toMin(cur.end) - toMin(cur.start))) * 100)}%` : "0";
  }


  /* ================================================================ calendar: day · week · month · year */
  // Day is the live timeline above. Week, month and year come from /api/calendar (stamped blocks plus projected routines,
  // and holidays, birthdays and occasions). "Show me my week" / "my month" / "my year" / "today" switch views by voice,
  // and after two quiet minutes it drifts back to today.
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const addDaysISO = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const dowOf = (iso) => new Date(iso + "T12:00:00").getDay();
  const SPECIAL_ICON = { birthday: "🎂", church: "✝", holiday: "★", milestone: "◆", occasion: "♥", fun: "✦", season: "❋", civic: "•" };
  let calView = "day", calBack = 0, calCache = {};
  function specialBadge(s, short = false) {
    return `<span class="sp ${s.kind}${s.big ? " major" : ""}" title="${esc(s.title)}">${SPECIAL_ICON[s.kind] ?? "•"}${short ? "" : " " + esc(s.title.replace(/\. He is risen!$/, ""))}</span>`;
  }
  async function loadSpecial() {
    try {
      const r = await json("/special");
      $("#specialToday").innerHTML = r.today.map((s) => specialBadge(s)).join("");
      const up = r.upcoming.slice(0, 1)[0];
      if (!r.today.length && up) $("#specialToday").innerHTML = `<span class="sp soon">Next: ${esc(up.title.replace(/\. He is risen!$/, ""))} · ${new Date(up.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span>`;
    } catch { /* keep what's there */ }
  }
  async function calData(from, to, summary = false) {
    const k = `${from}|${to}|${summary}`;
    if (calCache[k] && Date.now() - calCache[k].at < 5 * 60_000) return calCache[k].data;
    const data = await json(`/calendar?from=${from}&to=${to}${summary ? "&summary=1" : ""}`);
    calCache[k] = { at: Date.now(), data };
    return data;
  }
  async function renderCal() {
    const t = todayISO();
    if (calView === "week") {
      const from = addDaysISO(t, -dowOf(t)), to = addDaysISO(from, 6);
      const { days } = await calData(from, to);
      $("#calWeek").innerHTML = days.map((d) => {
        const n = new Date(d.date + "T12:00:00"), past = d.date < t;
        const items = d.blocks.filter((b) => !/^(breakfast|lunch|dinner|snack)/i.test(b.title));
        // the six that matter most (one-off events, then study, work, the gym, church…), shown in time order
        const rank = (b) => (b.projected ? 1 : 0) + ({ study: 0, work: 1, body: 2, faith: 3 }[b.category] ?? 4) * 0.1 + (/quiet time|morning|wake|nightly|bed|your time/i.test(b.title) ? 1 : 0);
        const shown = [...items].sort((x, y) => rank(x) - rank(y)).slice(0, window.innerHeight < 760 ? 4 : 6).sort((x, y) => x.start.localeCompare(y.start));
        return `<div data-date="${d.date}" class="wd${d.date === t ? " now" : ""}${past ? " past" : ""}">
          <div class="wh"><b>${DOW[n.getDay()]}</b><span>${n.getDate()}</span></div>
          <div class="wsp">${d.special.map((s) => specialBadge(s, true)).join("")}</div>
          ${shown.map((b) => `<div class="wb${b.done ? " done" : ""}" style="--c:${catVar(b.category)}"><i>${hm12(b.start).replace(":00", "").replace(" ", "").toLowerCase()}</i><span>${esc(b.title)}</span></div>`).join("")}
          ${items.length > shown.length ? `<div class="more">+${items.length - shown.length} more</div>` : ""}
        </div>`;
      }).join("");
    } else if (calView === "month") {
      const d0 = new Date(), first = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, "0")}-01`;
      const last = addDaysISO(`${d0.getMonth() === 11 ? d0.getFullYear() + 1 : d0.getFullYear()}-${String(d0.getMonth() === 11 ? 1 : d0.getMonth() + 2).padStart(2, "0")}-01`, -1);
      const from = addDaysISO(first, -dowOf(first)), to = addDaysISO(last, 6 - dowOf(last));
      const { days } = await calData(from, to);
      $("#calMonth").innerHTML = DOW.map((w) => `<div class="mh">${w}</div>`).join("") + days.map((d) => {
        const n = new Date(d.date + "T12:00:00"), out = d.date < first || d.date > last;
        const study = d.blocks.filter((b) => b.category === "study").map((b) => b.title.replace(/ exam study| study/i, "").trim());
        const key = d.blocks.filter((b) => ["work", "faith", "body"].includes(b.category) && !/prayer|devotion|quiet/i.test(b.title)).slice(0, 2);
        return `<div data-date="${d.date}" class="md${d.date === t ? " now" : ""}${out ? " out" : ""}${d.date < t ? " past" : ""}${d.special.some((s) => s.big) ? " big" : ""}">
          <b>${n.getDate()}</b>
          ${d.special.slice(0, 2).map((s) => `<div class="msp ${s.kind}">${SPECIAL_ICON[s.kind] ?? "•"} ${esc(s.title.replace(/\. He is risen!$/, "").replace(/^the /, ""))}</div>`).join("")}
          ${[...new Set(study)].slice(0, 2).map((s) => `<div class="mb" style="--c:var(--study)">${esc(s)}</div>`).join("")}
          ${key.map((b) => `<div class="mb" style="--c:${catVar(b.category)}">${esc(b.title)}</div>`).join("")}
        </div>`;
      }).join("");
    } else if (calView === "year") {
      const y = new Date().getFullYear();
      const { days } = await calData(`${y}-01-01`, `${y}-12-31`, true);
      const byDate = new Map(days.map((d) => [d.date, d]));
      $("#calYear").innerHTML = MON.map((name, m) => {
        const first = `${y}-${String(m + 1).padStart(2, "0")}-01`, lead = dowOf(first), len = new Date(y, m + 1, 0).getDate();
        let cells = "";
        for (let i = 0; i < lead; i++) cells += "<i></i>";
        for (let dd = 1; dd <= len; dd++) {
          const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")}`, d = byDate.get(iso);
          const sp = d?.special ?? [], kind = sp.find((s) => s.kind === "birthday") ? "birthday" : sp.find((s) => s.kind === "milestone") ? "milestone" : sp.find((s) => s.big) ? "big" : sp.length ? "some" : "";
          cells += `<i data-date="${iso}" class="${iso === t ? "now " : ""}${iso < t ? "past " : ""}${kind}" title="${esc(sp.map((s) => s.title).join(", "))}">${dd}</i>`;
        }
        return `<div class="ym${m === new Date().getMonth() ? " cur" : ""}"><b data-month="${m}">${name}</b><div class="yg">${cells}</div></div>`;
      }).join("") + `<div class="ylegend"><span class="k birthday"></span>birthday <span class="k milestone"></span>milestone <span class="k big"></span>holiday</div>`;
    }
  }

  /* ================================================================ the showcase: a big panel that changes now and then */
  // It drifts through the day's schedule (most often), the week, the prayer list, the memory verses, the weather,
  // a recommended video and an encouraging quote. "Show me the weather / my week / the prayer list" jumps there and holds
  // for two minutes. It stays still during the morning alarm and at night.
  const VIEWS = {
    day: { title: "Today", el: "#today" }, week: { title: "This week", el: "#calWeek" }, month: { title: () => MON[new Date().getMonth()], el: "#calMonth" },
    year: { title: () => String(new Date().getFullYear()), el: "#calYear" }, prayer: { title: "Praying for", el: "#vPrayer" }, prayerChurch: { title: "Church prayer list", el: "#vPrayerChurch" }, memory: { title: "Memory verses", el: "#vMemory" },
    weather: { title: "Weather", el: "#vWeather" }, video: { title: "Worth a watch", el: "#vVideo" }, quote: { title: "Encouragement", el: "#vQuote" }, photo: { title: "From your photos", el: "#vPhoto" },
    // Discover (public/discover.js): popular videos, short clips and articles about the owner's interests
    forYou: { title: "For you", el: "#vForYou" },
  };
  const ROTATION = ["day", "weather", "photo", "week", "memory", "day", "quote", "forYou", "prayer", "prayerChurch", "day", "photo", "video", "week", "forYou", "day", "month"];
  // slides that belong to a feature only show when the owner turned it on (Settings → Features & apps)
  const VIEW_FEATURE = { memory: "memoryVerses", prayer: "faith", prayerChurch: "church", photo: "photos", weather: "weather" };
  const viewOn = (v) => { const f = VIEW_FEATURE[v], fs = (typeof config !== "undefined" && config?.features) || null; return !f || !fs || fs[f] !== false; };
  const ROTATE_MS = 40_000;
  let rotI = 0, pinnedUntil = 0, show = { devotion: null, quote: null, weather: null, video: null };
  async function loadShowcase() {
    try { Object.assign(show, await json("/showcase")); } catch { /* keep the last */ }
    json("/showcase?part=video").then((r) => { if (r.video) show.video = r.video; }).catch(() => {});
  }
  // The trail: what the panel has shown, newest last, so "go back" finds the photo or video he just missed.
  const trail = []; let trailPos = -1, showPaused = false;
  function remember(v) {
    const snap = { view: v, photo: v === "photo" ? show.photo : null, video: v === "video" ? show.video : null, quote: v === "quote" ? show.quote : null };
    const last = trail[trail.length - 1];
    if (last && last.view === snap.view && last.photo?.id === snap.photo?.id && last.video?.videoId === snap.video?.videoId && last.quote?.text === snap.quote?.text) { trailPos = trail.length - 1; return; }
    trail.push(snap); if (trail.length > 40) trail.shift();
    trailPos = trail.length - 1;
  }
  function renderPhoto(p) {
    const when = new Date(p.taken + "T12:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
    show.photo = p;
    $("#vPhoto").innerHTML = `<div class="photo"><img src="/api/photos/img/${p.id}" alt=""><div class="pcap">${p.description ? `<b>${esc(p.category ?? "")}</b>${esc(p.description)}` : `<span>${esc(p.folder)} · ${esc(when)}</span>`}</div></div>`;
  }
  // Step through the trail: -1 back, +1 forward (past the newest it moves the rotation on).
  function stepShow(delta) {
    if (delta > 0 && trailPos >= trail.length - 1) { rotate(true); holdShow(); return; }
    trailPos = Math.max(0, Math.min(trail.length - 1, trailPos + delta));
    const e = trail[trailPos];
    if (!e) return;
    if (e.photo) renderPhoto(e.photo);
    if (e.video) show.video = e.video;
    if (e.quote) show.quote = e.quote;
    setCalView(e.view, { fromTrail: true });
    holdShow();
  }
  // Looking back holds the panel still for a couple of minutes (or until he presses play, if he paused it)
  function holdShow(ms = 150_000) { pinnedUntil = Math.max(pinnedUntil, Date.now() + ms); renderShowNav(); }
  function setPaused(on) { showPaused = on; if (!on) pinnedUntil = Date.now() + 8000; renderShowNav(); }
  function renderShowNav() {
    const pb = $("#showPause"); if (!pb) return;
    pb.textContent = showPaused ? "▶" : "⏸"; pb.title = showPaused ? "Keep rotating" : "Hold this one";
    $("#showPrev").disabled = trailPos <= 0;
  }
  // add-ons (Discover) can bring a slide up: window.dsShowcase.show("forYou", { pin: true })
  window.dsShowcase = { show: (v, o = {}) => setCalView(v, o), current: () => calView };
  function setCalView(v, { pin = false, fromTrail = false } = {}) {
    if (!VIEWS[v]) return;
    calView = v;
    if (!fromTrail) remember(v);
    for (const k of Object.keys(VIEWS)) $(VIEWS[k].el).hidden = k !== v;
    const t = VIEWS[v].title; $("#calTitle").textContent = typeof t === "function" ? t() : t;
    const el = $(VIEWS[v].el); el.classList.remove("enter"); void el.offsetWidth; el.classList.add("enter");
    $("#showDots").innerHTML = ["day", "week", "weather", "memory", "prayer", "quote", "photo", "video", "forYou"].filter((k) => viewOn(k) && (k !== "forYou" || window.dsDiscover?.has?.())).map((k) => `<i data-jump="${k}" title="${k}" class="${k === v ? "on" : ""}"></i>`).join("");
    renderShowNav();
    if (pin) pinnedUntil = Date.now() + 120_000;
    renderShow().then(() => { requestAnimationFrame(fitShow); setTimeout(() => reportSlide(v), 400); }).catch(() => {});
  }
  // ---- what's on the screen, for the assistant ("read me that proverb", "what was that video?") ----
  const txt = (sel) => { const el = typeof sel === "string" ? $(sel) : sel; return el && !el.hidden ? el.innerText.replace(/\s+/g, " ").trim() : ""; };
  const viewTitle = (v) => { const t = VIEWS[v]?.title; return typeof t === "function" ? t() : t ?? v; };
  // the words a slide will show, from what's already loaded (for "coming up next")
  function textFor(v) {
    const dv = show.devotion;
    if (v === "quote") return show.quote ? `${show.quote.text} — ${show.quote.by ?? ""}` : "";
    if (v === "forYou") return window.dsDiscover?.text?.() ?? "";
    if (v === "video") return show.video ? `${show.video.title}${show.video.channel ? " · " + show.video.channel : ""}` : "";
    if (v === "weather") return show.weather ? `${show.weather.now.text}, ${show.weather.now.temp}°; high ${show.weather.today.hi}°, low ${show.weather.today.lo}°` : "";
    if (v === "memory") return dv?.memory?.length ? `${dv.memoryRef ?? dv.reference ?? ""}: ${dv.memory.map((x) => x.text).join(" ")}` : "";
    if (v === "prayer") return (dv?.prayerItems ?? []).map((p) => p.title).join("; ");
    if (v === "prayerChurch") return (dv?.prayerChurch ?? []).map((p) => `${p.who}: ${p.request}`).join("; ");
    if (v === "photo") return "a photo from the owner's folders";
    return "";
  }
  let lastSlideKey = "";
  function reportSlide(v) {
    if (v !== calView) return;
    const text = txt(VIEWS[v]?.el) || textFor(v), title = viewTitle(v);
    const key = v + "|" + text.slice(0, 200);
    if (key !== lastSlideKey) { lastSlideKey = key; post("/screen/shown", { kind: "slide", view: v, title, text }).catch(() => {}); }
    reportScreen();
  }
  let screenTimer = 0;
  function reportScreen() {
    clearTimeout(screenTimer);
    screenTimer = setTimeout(() => {
      const up = [];
      for (let i = 1; up.length < 4 && i <= ROTATION.length; i++) { const v = ROTATION[(rotI + i) % ROTATION.length]; if (viewOn(v) && v !== calView && !up.some((u) => u.view === v)) up.push({ view: v, title: viewTitle(v), text: textFor(v) }); }
      const panels = [];
      if (!$("#calwrap")?.hidden) panels.push(`Schedule app (${($("#calframe")?.getAttribute("src") ?? "").replace(/.*view=(\w+).*date=([\d-]+).*/, "$1 view, $2")})`);
      if ($("#detail") && !$("#detail").hidden) panels.push(`${$("#dTitle")?.textContent ?? "Details"}: ${txt("#dBody").slice(0, 500)}`);
      if (alarmOn) panels.push("The alarm is ringing");
      const lib = document.querySelector(".library:not([hidden]), #library:not([hidden])"); if (lib) panels.push("The music Library panel");
      post("/screen/state", {
        slide: VIEWS[calView] ? { view: calView, title: viewTitle(calView), text: txt(VIEWS[calView].el) || textFor(calView) } : null,
        cards: [txt("#now"), txt("#next"), txt("#examCard"), txt("#courses")].filter(Boolean),
        playing: P.source && P.title ? `${P.video ? "Video" : "Music"}: ${P.title}${P.artist ? " · " + P.artist : ""}${P.playing ? "" : " (paused)"}` : "",
        panels, queue: up,
      }).catch(() => {});
    }, 1200);
  }
  setInterval(reportScreen, 60_000);
  // Guard rail: nothing ever spills out of its box. If a panel's content is taller (or wider) than the panel,
  // the text shrinks step by step until it all fits (down to half size).
  function fitBox(el, min = 0.7) {
    if (!el || el.hidden) return;
    el.style.fontSize = "";
    let s = 1;
    const over = () => el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2;
    while (over() && s > min) { s = Math.round((s - 0.04) * 100) / 100; el.style.fontSize = s + "em"; }
  }
  const fitShow = () => { const v = VIEWS[calView]; if (v) fitBox($(v.el)); fitBox($("#nowTitle"), 0.6); };
  window.addEventListener("resize", () => setTimeout(fitShow, 150));
  async function renderShow() {
    if (["week", "month", "year"].includes(calView)) return renderCal();
    const dv = show.devotion;
    if (calView === "prayer") {
      const today = dv?.prayerToday ?? [], all = dv?.prayerAll ?? [];
      const ch = dv?.prayerChurch ?? [];
      const mine = dv?.prayerItems?.length ? dv.prayerItems : today.map((p) => ({ title: p }));
      $("#vPrayer").innerHTML = mine.length ? `<ul class="pray">${mine.map((p) => `<li><span class="pdot"></span><div><b>${esc(p.title.charAt(0).toUpperCase() + p.title.slice(1))}</b>${p.detail ? `<small>${esc(p.detail)}</small>` : ""}</div></li>`).join("")}</ul>` : `<div class="empty">No prayer list yet. Tell me who to pray for.</div>`;
    } else if (calView === "prayerChurch") {
      const ch = dv?.prayerChurch ?? [];
      $("#vPrayerChurch").innerHTML = ch.length ? `<div class="pchurch">${ch.map((p) => `<div class="pc${p.friend ? " friend" : ""}"><b>${esc(p.who)}</b><span>${esc(p.request)}</span>${p.note ? `<small>${esc(p.note)}</small>` : ""}</div>`).join("")}</div>` : `<div class="empty">No church prayer list yet.</div>`;
    } else if (calView === "memory") {
      $("#vMemory").innerHTML = dv?.memory?.length ? `<div class="mref">${esc(dv.memoryRef ?? dv.reference)} <small>${esc(dv.translation)} · ${esc({ learn: "new verses", reinforce: "lock them in", together: "put it together", review: "review day" }[dv.memoryKind] ?? "")}</small></div>
        ${dv.memory.map((v) => `<p class="verse"><sup>${v.n}</sup>${esc(v.text)}</p>`).join("")}${dv.reading ? `<div class="mread">Reading today: <b>${esc(dv.reading)}</b></div>` : ""}` : `<div class="empty">No memory verses set.</div>`;
    } else if (calView === "weather") {
      const w = show.weather;
      $("#vWeather").innerHTML = !w ? `<div class="empty">The weather is out of reach right now.</div>` : `
        <div class="wnow"><span class="wico">${w.now.icon}</span><span class="wtemp">${w.now.temp}°</span>
          <div class="wtxt"><b>${esc(w.now.text)}</b><span>Feels like ${w.now.feels}° · High ${w.today.hi}° · Low ${w.today.lo}°${w.today.rain >= 10 ? ` · ${w.today.rain}% rain` : ""}</span><span>${esc(w.place)} · wind ${w.now.wind} mph · sunset ${hm12(w.today.sunset)}</span></div></div>
        <div class="whours">${w.hours.map((h) => `<div><small>${hm12(h.t.slice(11, 16)).replace(":00", "")}</small><span>${h.icon}</span><b>${h.temp}°</b>${h.rain >= 20 ? `<em>${h.rain}%</em>` : ""}</div>`).join("")}</div>
        <div class="wweek">${w.week.map((d, i) => `<div class="${i === 0 ? "now" : ""}"><small>${i === 0 ? "Today" : DOW[dowOf(d.date)]}</small><span>${d.icon}</span><b>${d.hi}°</b><i>${d.lo}°</i></div>`).join("")}</div>`;
    } else if (calView === "video") {
      const v = show.video;
      $("#vVideo").innerHTML = !v ? `<div class="empty">Looking for something good to watch…</div>` : `
        <div class="vid"><div class="thumb" data-video="${esc(v.videoId)}" style="background-image:url('${esc(v.thumb)}')"><span class="play">▶</span>${v.length ? `<em>${esc(v.length)}</em>` : ""}</div>
        <div class="vmeta"><b>${esc(v.title)}</b><span>${esc(v.channel ?? "")}${v.views ? " · " + esc(v.views) : ""}${v.age ? " · " + esc(v.age) : ""}</span><small>Say “Dayspring, play that video.”</small></div></div>`;
    } else if (calView === "forYou") {
      window.dsDiscover?.render?.($("#vForYou"));
    } else if (calView === "quote") {
      const qq = show.quote;
      $("#vQuote").innerHTML = qq ? `<blockquote>${esc(qq.text)}</blockquote><cite>— ${esc(qq.by)}</cite>` : "";
    }
  }
  // A photo from his computer. About once a day, at a relaxed time, Dayspring asks what it is and listens for the answer
  // without needing the wake word; the server files his words with the photo.
  const PHOTO_ASKS = ["Hey, I found this one in your photos. What's the story behind it?", "Quick question about this photo. What's it of, and does it matter to you?",
    "I don't have eyes, but I've got your photos. What's this one? Tell me about it.", "This one popped up from your pictures. Where was this, and what was going on?",
    "Help me out. What's this photo? Family, a trip, a project? I'll remember it."];
  async function showPhoto({ ask = false, pin = false } = {}) {
    let r;
    try { r = await json(`/photos/next${ask ? "?ask=1" : ""}`); } catch { return false; }
    if (!r.photo) return false;
    const p = r.photo;
    renderPhoto(p);
    setCalView("photo", { pin });
    const asking = r.ask && !speaking && mode === "idle" && prefs.mode === "voice";
    post("/photos/showing", { id: p.id, asked: asking }).catch(() => {});
    if (asking) {
      pinnedUntil = Date.now() + 180_000;
      const qx = PHOTO_ASKS[Math.floor(Math.random() * PHOTO_ASKS.length)];
      push("ai", qx);
      await speak(qx, { title: "From your photos", category: "home" });
      openCommandWindow(60_000);
    }
    return true;
  }
  /* ================================================================ the Schedule app */
  // Full-screen day / week / month / year schedule with editing (calendar.html). Buttons by the clock, the showcase's
  // schedule slides, and "open my schedule" / "show me my month on the calendar" open it; ✕, Esc or "close the schedule" close it.
  function openCalendar(v = "week", date = todayISO()) {
    const w = $("#calwrap"), f = $("#calframe");
    const url = `/calendar.html?embed=1&view=${v}&date=${date}`;
    if (w.hidden || !/calendar\.html/.test(f.src)) f.src = url;
    else f.contentWindow?.postMessage({ type: "dayspring-calendar-goto", view: v, date }, "*");
    w.hidden = false; pinnedUntil = Date.now() + 10 * 60_000; wake(10 * 60_000);
    setTimeout(() => f.contentWindow?.focus(), 300);
  }
  // A date and a view from how people say it. Weekdays mean the coming one ("Saturday" = this coming Saturday, or today
  // if it's Saturday); "next Saturday" skips today; "last Tuesday" goes back.
  function whenFrom(q) {
    // "this week's schedule", "the weekly schedule", "monthly", "yearly", "daily" all say which view is wanted
    q = q.replace(/\bweek(?:ly|'?s)\b/g, "week").replace(/\bmonth(?:ly|'?s)\b/g, "month").replace(/\byear(?:ly|'?s)\b/g, "year").replace(/\b(\w+) \1\b/g, "$1");
    const daily = /\bdaily\b|\bday view\b|\bsingle day\b/.test(q);
    const t = todayISO(), now = new Date();
    const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    const monthIdx = (w) => MONTHS.findIndex((m) => m.startsWith(w.slice(0, 3)));
    const pad = (n) => String(n).padStart(2, "0");
    const ord = (n) => n + (["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");
    const fmtDay = (iso) => { const d = new Date(iso + "T12:00:00"); return `${d.toLocaleDateString("en-US", { weekday: "long" })}, ${d.toLocaleDateString("en-US", { month: "long" })} ${ord(d.getDate())}${d.getFullYear() !== now.getFullYear() ? ", " + d.getFullYear() : ""}`; };
    const forced = /\byear\b/.test(q) ? "year" : /\bmonth\b/.test(q) ? "month" : /\bweek\b/.test(q) ? "week" : daily ? "day" : null;
    const out = (view, date, label) => ({ view: forced ?? view, date, label: forced && forced !== view ? `the ${forced} of ${label}` : label });
    let m;
    if (/\bday after tomorrow\b/.test(q)) { const d = addDaysISO(t, 2); return out("day", d, fmtDay(d)); }
    if (/\btomorrow\b/.test(q)) { const d = addDaysISO(t, 1); return out("day", d, "tomorrow, " + fmtDay(d)); }
    if (/\byesterday\b/.test(q)) { const d = addDaysISO(t, -1); return out("day", d, "yesterday, " + fmtDay(d)); }
    if ((m = /\b(next|last|this|coming)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?\b/.exec(q))) {
      const target = DAYS.indexOf(m[2]), cur = now.getDay();
      let diff = (target - cur + 7) % 7;
      if (m[1] === "next" && diff === 0) diff = 7;
      if (m[1] === "last") diff = diff === 0 ? -7 : diff - 7;
      const d = addDaysISO(t, diff);
      return out("day", d, fmtDay(d));
    }
    if ((m = /\b(?:(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?)\b/.exec(q))) {
      const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : now.getFullYear();
      const d = `${y}-${pad(m[1])}-${pad(m[2])}`; return out("day", d, fmtDay(d));
    }
    const ofMonth = /\b(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+of\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:,?\s+(\d{4}))?\b/.exec(q);
    if (ofMonth) m = [ofMonth[0], ofMonth[2], ofMonth[1], ofMonth[3]];
    if (m || (m = /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\.?\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/.exec(q))) {
      const mi = monthIdx(m[1]); let y = m[3] ? Number(m[3]) : now.getFullYear();
      if (!m[3] && mi < now.getMonth() - 1) y++;                   // "March 3rd" in October means next March
      const d = `${y}-${pad(mi + 1)}-${pad(m[2])}`; return out(forced === "week" ? "week" : "day", d, forced === "week" ? "the week of " + fmtDay(d) : fmtDay(d));
    }
    if ((m = /\bthe (\d{1,2})(?:st|nd|rd|th)\b/.exec(q))) {
      const d = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(m[1])}`; return out(forced === "week" ? "week" : "day", d, forced === "week" ? "the week of " + fmtDay(d) : fmtDay(d));
    }
    if (/\bnext week\b/.test(q)) return out("week", addDaysISO(t, 7), "next week");
    if (/\blast week\b/.test(q)) return out("week", addDaysISO(t, -7), "last week");
    if (/\b(this|my) week\b|\bthe week\b/.test(q)) return out("week", t, "this week");
    if (/\bnext month\b/.test(q)) { const d = `${now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear()}-${pad((now.getMonth() + 1) % 12 + 1)}-01`; return out("month", d, MONTHS[(now.getMonth() + 1) % 12].replace(/^./, (c) => c.toUpperCase())); }
    if (/\blast month\b/.test(q)) { const x = new Date(now.getFullYear(), now.getMonth() - 1, 1); return out("month", `${x.getFullYear()}-${pad(x.getMonth() + 1)}-01`, MONTHS[x.getMonth()].replace(/^./, (c) => c.toUpperCase())); }
    if ((m = /\b(january|february|march|april|june|july|august|september|october|november|december|may)\b(?:\s+(\d{4}))?/.exec(q)) && !/\bmay i\b/.test(q)) {
      const mi = monthIdx(m[1]); let y = m[2] ? Number(m[2]) : now.getFullYear(); if (!m[2] && mi < now.getMonth() - 1) y++;
      return out("month", `${y}-${pad(mi + 1)}-01`, `${MONTHS[mi].replace(/^./, (c) => c.toUpperCase())}${m[2] ? " " + m[2] : ""}`);
    }
    if (/\b(this|my) month\b|\bthe month\b/.test(q)) return out("month", t, MONTHS[now.getMonth()].replace(/^./, (c) => c.toUpperCase()));
    if (/\bnext year\b/.test(q)) return out("year", `${now.getFullYear() + 1}-01-01`, String(now.getFullYear() + 1));
    if (/\blast year\b/.test(q)) return out("year", `${now.getFullYear() - 1}-01-01`, String(now.getFullYear() - 1));
    if ((m = /\b(20\d{2})\b/.exec(q))) return out("year", `${m[1]}-01-01`, m[1]);
    if (/\b(this|my) year\b|\bthe year\b/.test(q)) return out("year", t, String(now.getFullYear()));
    if (/\btoday\b|\bmy day\b/.test(q) || daily) return out("day", t, "today, " + fmtDay(t));
    return null;
  }
  function closeCalendar() { const w = $("#calwrap"); if (w.hidden) return false; w.hidden = true; $("#calframe").src = "about:blank"; pinnedUntil = Date.now() + 20_000; return true; }
  const calendarOpen = () => !$("#calwrap").hidden;
  /* ================================================================ Settings and Help */
  // ⚙ and ? by the clock, or "open settings" / "open help" / "how do I change your voice?" — shown over everything; ✕ or Esc closes.
  function openPage(path) {
    const w = $("#pagewrap"), f = $("#pageframe");
    f.src = path; w.hidden = false; pinnedUntil = Date.now() + 15 * 60_000; wake(15 * 60_000);
    setTimeout(() => f.contentWindow?.focus(), 300);
  }
  function closePage() { const w = $("#pagewrap"); if (w.hidden) return false; w.hidden = true; $("#pageframe").src = "about:blank"; pinnedUntil = Date.now() + 20_000; return true; }
  const pageOpen = () => !$("#pagewrap").hidden;
  $("#setBtn").onclick = () => openPage("/setup?embed=1");
  window.dsOpenPage = openPage;          // for add-ons (the living sky's 🎨 button)
  // for add-ons (the document reader): speak with Dayspring's voice (resolves when done) and stop it
  window.dsSpeak = (text, v = {}) => speak(text, null, "general", v);
  window.dsStopSpeaking = () => stopSpeaking();
  $("#helpBtn").onclick = () => openPage("/help?embed=1");
  // a how-to question about Dayspring → { say, url } from the guide, or null (then it goes on as usual)
  const HOW_Q = /^(?:(?:hey|ok|okay)\s+)?(?:dayspring[,\s]+)?(?:how (?:do|can|should|would) (?:i|we)|how to|where (?:do|can) i|show me how|can you show me how|teach me how|walk me through|is there a (?:guide|tutorial)|open the (?:guide|help|tutorial|instructions) (?:for|on|about)|what (?:does|do) (?:the )?.+ (?:setting|settings|option|switch|toggle|button) do)\b/i;
  async function helpAnswer(text) {
    if (!HOW_Q.test(String(text).trim())) return null;
    try { const r = await json("/help/find?ask=1&q=" + encodeURIComponent(text)); return r.found ? { say: r.say, url: r.url } : null; } catch { return null; }
  }
  $("#pageClose").onclick = closePage;
  $("#pageApps").onclick = () => openPage("/setup?embed=1&s=apps");   // Settings → Apps & connections
  // if Settings finishes by going to the Dayspring screen, close the overlay and reload so the changes show
  $("#pageframe").addEventListener("load", () => {
    try {
      const w = $("#pageframe").contentWindow, p = w.location.pathname;
      if (p === "/display" || p === "/tv") { closePage(); location.reload(); return; }
      w.addEventListener("keydown", (e) => { if (e.key === "Escape") closePage(); });   // Esc works while the page has focus too
    } catch { /* another origin */ }
  });
  window.addEventListener("message", (e) => { if (e.data?.type === "dayspring-page-close") closePage(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && pageOpen()) closePage(); });
  window.addEventListener("message", (e) => { if (e.data?.type === "dayspring-calendar-close") closeCalendar(); });
  document.querySelectorAll("#calBtns [data-cal]").forEach((b) => (b.onclick = () => openCalendar(b.dataset.cal)));

  /* ================================================================ the detail viewer */
  // Click anything in the big panel (or Now / Next) for the full breakdown: a day, a week, a month, the weather,
  // a photo (full screen, or open the file), a video (play it big, or open it on YouTube), a verse in context, the
  // prayer lists, the memory chapter, and the voices. ✕, Esc, a click outside, or "close that" closes it.
  let detailTimer = 0, detailBack = null;
  function openDetail(title, html, { wide = false, back = null } = {}) {
    const d = $("#detail");
    $("#dTitle").textContent = title;
    $("#dBody").innerHTML = html;
    setTimeout(() => { post("/screen/shown", { kind: "panel", title, text: txt("#dBody") }).catch(() => {}); reportScreen(); }, 300);
    $("#dBack").hidden = !back; detailBack = back;
    d.classList.toggle("wide", wide);
    d.hidden = false; d.classList.remove("in"); void d.offsetWidth; d.classList.add("in");
    $("#dBody").scrollTop = 0;
    pinnedUntil = Date.now() + 10 * 60_000;
    clearTimeout(detailTimer); detailTimer = setTimeout(closeDetail, 4 * 60_000);   // nobody closed it: tidy up
    wake();
  }
  function closeDetail() {
    const d = $("#detail");
    if (d.hidden) return false;
    d.hidden = true; $("#dBody").innerHTML = "";        // stops any video in it
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    pinnedUntil = Date.now() + 30_000;
    return true;
  }
  const detailOpen = () => !$("#detail").hidden;
  $("#dClose").onclick = closeDetail;
  $("#dBack").onclick = () => detailBack?.();
  $("#dFull").onclick = () => { const el = $("#detail"); document.fullscreenElement ? document.exitFullscreen().catch(() => {}) : el.requestFullscreen?.().catch(() => {}); };
  $("#detail").addEventListener("click", (e) => { if (e.target.id === "detail") closeDetail(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { if (!closeDetail()) closeCalendar(); } });
  const longDate = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const dur = (b) => { const m = toMin(b.end) - toMin(b.start); return m >= 60 ? `${(m / 60).toFixed(m % 60 ? 1 : 0)} h` : `${m} m`; };

  // ---- a day, in full ----
  async function dayDetail(date) {
    const { days } = await json(`/calendar?from=${date}&to=${date}`);
    const d = days[0] ?? { blocks: [], special: [] };
    const html = `${d.special.length ? `<div class="dspecial">${d.special.map((s) => specialBadge(s)).join("")}</div>` : ""}
      <div class="dnav"><button data-day="${addDaysISO(date, -1)}">‹ ${esc(new Date(addDaysISO(date, -1) + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }))}</button>
        <button data-day="${addDaysISO(date, 1)}">${esc(new Date(addDaysISO(date, 1) + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }))} ›</button></div>
      <ol class="dday">${d.blocks.map((b) => `<li style="--c:${catVar(b.category)}" class="${b.done ? "done" : ""}"><span class="hm">${hm12(b.start)}<small>${hm12(b.end)}</small></span><span class="dot"></span>
        <div><b>${esc(b.title)}</b>${b.description ? `<p>${esc(b.description)}</p>` : ""}<small>${esc(b.category)} · ${dur(b)}${b.projected ? " · from your routine" : ""}</small></div></li>`).join("") || `<li><div><b>Nothing scheduled.</b></div></li>`}</ol>`;
    openDetail(longDate(date), html);
  }
  // ---- one block ----
  function blockDetail(b) {
    if (!b) return;
    openDetail(b.title, `<div class="dblock" style="--c:${catVar(b.category)}"><div class="bt">${hm12(b.start)} – ${hm12(b.end)} · ${dur(b)} · ${esc(b.category)}</div>
      ${b.description ? `<p>${esc(b.description)}</p>` : `<p class="muted">No notes on this one.</p>`}</div>
      <div class="dnav"><button data-day="${b.date ?? todayISO()}">The whole day ›</button></div>`);
  }
  // ---- a month (from the year view, or the month view) ----
  async function monthDetail(y, m) {
    const first = `${y}-${String(m + 1).padStart(2, "0")}-01`, last = `${y}-${String(m + 1).padStart(2, "0")}-${String(new Date(y, m + 1, 0).getDate()).padStart(2, "0")}`;
    const { days } = await json(`/calendar?from=${addDaysISO(first, -dowOf(first))}&to=${addDaysISO(last, 6 - dowOf(last))}`);
    const t = todayISO();
    const html = `<div class="dmonth">${DOW.map((w) => `<div class="mh">${w}</div>`).join("")}${days.map((d) => {
      const out = d.date < first || d.date > last, key = d.blocks.filter((b) => ["study", "work", "faith"].includes(b.category) && !/quiet time|nightly|morning routine/i.test(b.title)).slice(0, 3);
      return `<div data-day="${d.date}" class="md${d.date === t ? " now" : ""}${out ? " out" : ""}"><b>${Number(d.date.slice(8))}</b>
        ${d.special.slice(0, 2).map((s) => `<div class="msp ${s.kind}">${SPECIAL_ICON[s.kind] ?? "•"} ${esc(s.title.replace(/\. He is risen!$/, "").replace(/^the /, ""))}</div>`).join("")}
        ${key.map((b) => `<div class="mb" style="--c:${catVar(b.category)}">${esc(b.title)}</div>`).join("")}</div>`;
    }).join("")}</div>
      <div class="dnav"><button data-month="${m === 0 ? y - 1 : y}-${m === 0 ? 11 : m - 1}">‹ ${MON[m === 0 ? 11 : m - 1]}</button><button data-month="${m === 11 ? y + 1 : y}-${m === 11 ? 0 : m + 1}">${MON[m === 11 ? 0 : m + 1]} ›</button></div>`;
    openDetail(`${MON[m]} ${y}`, html, { wide: true });
  }
  // ---- the week ----
  async function weekDetail() {
    const t = todayISO(), from = addDaysISO(t, -dowOf(t));
    const { days } = await json(`/calendar?from=${from}&to=${addDaysISO(from, 6)}`);
    openDetail("This week", `<div class="dweek">${days.map((d) => `<div data-day="${d.date}" class="dwd${d.date === t ? " now" : ""}"><b>${DOW[dowOf(d.date)]} ${Number(d.date.slice(8))}</b>
      ${d.special.map((s) => specialBadge(s)).join("")}${d.blocks.map((b) => `<div class="wb" style="--c:${catVar(b.category)}"><i>${hm12(b.start)}</i><span>${esc(b.title)}</span></div>`).join("")}</div>`).join("")}</div>`, { wide: true });
  }
  // ---- the weather ----
  function weatherDetail() {
    const w = show.weather;
    if (!w) return;
    openDetail(`Weather · ${w.place}`, `<div class="wnow"><span class="wico">${w.now.icon}</span><span class="wtemp">${w.now.temp}°</span>
        <div class="wtxt"><b>${esc(w.now.text)}</b><span>Feels like ${w.now.feels}° · humidity ${w.now.humidity}% · wind ${w.now.wind} mph</span><span>High ${w.today.hi}° · Low ${w.today.lo}° · sunrise ${hm12(w.today.sunrise)} · sunset ${hm12(w.today.sunset)}</span></div></div>
      <h4>Next 24 hours</h4><div class="d24">${(w.day24 ?? w.hours).map((h) => `<div><small>${hm12(h.t.slice(11, 16)).replace(":00", "")}</small><span>${h.icon}</span><b>${h.temp}°</b><em>${h.rain ?? 0}%</em></div>`).join("")}</div>
      <h4>This week</h4><div class="dwk">${w.week.map((d, i) => `<div><b>${i === 0 ? "Today" : new Date(d.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" })}</b><span>${d.icon} ${esc(d.text)}</span><span>${d.hi}° / ${d.lo}°</span><em>${d.rain}% rain</em></div>`).join("")}</div>
      ${w.link ? `<div class="dnav"><a class="btn" href="${esc(w.link)}">Full forecast (National Weather Service) ↗</a></div>` : ""}`, { wide: true });
  }
  // ---- a photo: full size, full screen if he likes, or the original in the Photos app ----
  function photoDetail() {
    const p = show.photo;
    if (!p) return;
    openDetail(p.description ? (p.category ?? "Photo") : `${p.folder} · ${new Date(p.taken + "T12:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" })}`,
      `<div class="dphoto"><img src="/api/photos/img/${p.id}" alt=""></div>${p.description ? `<p class="dcap">“${esc(p.description)}”</p>` : `<p class="dcap muted">Not catalogued yet. Tell me about it: say “Dayspring, what's this photo?”</p>`}
      <div class="dnav"><button data-photo-open="${p.id}">Open the original on the laptop ↗</button><button data-photo-next="1">Show another ›</button></div>`, { wide: true });
  }
  // ---- a video: play it big right here, or open it on YouTube ----
  function videoDetail() {
    const v = show.video;
    if (!v?.videoId) return;
    openDetail(v.title, `<div class="dvideo"><iframe src="https://www.youtube.com/embed/${esc(v.videoId)}?autoplay=1&rel=0&modestbranding=1" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe></div>
      <p class="dcap">${esc(v.channel ?? "")}${v.views ? " · " + esc(v.views) : ""}${v.age ? " · " + esc(v.age) : ""}</p>
      <div class="dnav"><a class="btn" href="https://www.youtube.com/watch?v=${esc(v.videoId)}">Open on YouTube ↗</a></div>`, { wide: true });
  }
  // ---- a quote: a verse in its chapter, or who said it ----
  async function quoteDetail() {
    const qq = show.quote;
    if (!qq) return;
    const isRef = /^(\d )?[A-Z][a-z]+ \d+:\d+/.test(qq.by);
    if (!isRef) {
      openDetail(qq.by, `<blockquote class="dq">${esc(qq.text)}</blockquote><div class="dnav"><a class="btn" href="https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(qq.by.replace(/,.*$/, ""))}">About ${esc(qq.by.replace(/,.*$/, ""))} ↗</a></div>`);
      return;
    }
    const [, from, to] = /:(\d+)(?:[–-](\d+))?/.exec(qq.by) ?? [];
    try {
      const p = await json(`/detail/bible?ref=${encodeURIComponent(qq.by)}`);
      openDetail(`${qq.by.replace(/:.*/, "")} (KJV)`, `<div class="dchapter">${p.verses.map((v) => `<p class="${v.n >= Number(from) && v.n <= Number(to ?? from) ? "hl" : ""}"><sup>${v.n}</sup>${esc(v.text)}</p>`).join("")}</div>`, { wide: true });
      setTimeout(() => $("#dBody .hl")?.scrollIntoView({ block: "center" }), 60);
    } catch { openDetail(qq.by, `<blockquote class="dq">${esc(qq.text)}</blockquote>`); }
  }
  // ---- the memory chapter ----
  async function memoryDetail() {
    const r = await json("/detail/memory");
    const pct = Math.round((r.progress.versesDone / r.progress.versesTotal) * 1000) / 10;
    openDetail(`${r.chapterRef ?? r.ref} · memorizing`, `<p class="dfocus">${esc(r.focus)}</p>
      <div class="dchapter">${r.chapter.map((v) => `<p class="${r.from && v.n >= r.from && v.n <= r.to ? "hl" : ""}"><sup>${v.n}</sup>${esc(v.text)}</p>`).join("")}</div>
      <h4>Progress</h4><p>Chunk ${r.progress.chunk} of ${r.progress.chunks} in ${esc(r.progress.chapter)} · ${r.progress.chaptersDone} chapters finished · ${pct}% of the whole list · on pace to finish ${r.finishing ? new Date(r.finishing + "T12:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "—"}</p>
      <h4>Coming up</h4><p>${r.next.slice(1, 7).map((c) => `${esc(c.ref)} (${new Date(c.done + "T12:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" })})`).join(" · ")}</p>
      <p class="muted">Say “quiz me” to recite, “I've got it” to move on, or “I need more time”.</p>`, { wide: true });
    setTimeout(() => $("#dBody .hl")?.scrollIntoView({ block: "center" }), 60);
  }
  // ---- the prayer lists ----
  async function prayerDetail(which = "mine") {
    const r = await json("/detail/prayer");
    if (which === "church") {
      openDetail(`Church prayer list · ${r.bulletin ? new Date(r.bulletin + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}`,
        `<div class="pchurch">${r.church.map((p) => `<div class="pc${p.friend ? " friend" : ""}"><b>${esc(p.who)}</b><span>${esc(p.request)}</span>${p.note ? `<small>${esc(p.note)}</small>` : ""}</div>`).join("")}</div>
        <div class="dnav"><a class="btn" href="${esc(r.website)}">Church website ↗</a><a class="btn" href="${esc(r.youtube)}">Church YouTube ↗</a></div>`, { wide: true });
      return;
    }
    openDetail("Your prayer list", `<ul class="pray dpray">${r.mine.map((p) => `<li class="${r.today.includes(p.title) ? "today" : ""}"><span class="pdot"></span><div><b>${esc(p.title.charAt(0).toUpperCase() + p.title.slice(1))}${r.today.includes(p.title) ? " <em>today</em>" : ""}</b>${p.detail ? `<small>${esc(p.detail)}</small>` : p.private ? `<small>(private)</small>` : ""}</div></li>`).join("")}</ul>`, { wide: true });
  }
  // ---- audio devices: what's plugged in, what kind, nicknames, and what Dayspring uses ----
  const DEV_ICON = { headset: "🎧", headphones: "🎧", earbuds: "🎧", tv: "📺", "laptop-speaker": "💻", "laptop-mic": "💻", speaker: "🔊", microphone: "🎙️", other: "🔈" };
  async function devicesDetail() {
    const { devices } = await json("/devices?fresh=1");
    openDetail("Audio devices", `<p class="muted">Say “use the … for both”, “the screen for sound and the laptop mic”, or “call the Logitech headset my blue headset”. Other apps (like Discord) aren't changed by these speaker choices.</p>
      <div class="ddev">${devices.map((g) => `<div class="dd${g.inUse.sound || g.inUse.mic ? " cur" : ""}">
        <div class="ddh"><span class="ddi">${DEV_ICON[g.type] ?? "🔈"}</span><div><b>${esc(g.nickname ?? g.name)}</b><small>${esc(g.typeWord)}${g.outputs.length && g.inputs.length ? " · speaker + mic" : g.inputs.length ? " · mic" : " · speaker"}${g.nickname ? " · " + esc(g.name) : ""}</small></div></div>
        <div class="ddu">${g.inUse.sound ? '<em>🔊 Dayspring plays here</em>' : ""}${g.inUse.mic ? '<em>🎙️ Dayspring listens here</em>' : ""}</div>
        <div class="ddb">${g.outputs.length ? `<button data-duse="${esc(g.key)}" data-as="sound">Use for sound</button>` : ""}${g.inputs.length ? `<button data-duse="${esc(g.key)}" data-as="mic">Use as mic</button>` : ""}${g.outputs.length && g.inputs.length ? `<button data-duse="${esc(g.key)}" data-as="both">Both</button>` : ""}</div>
        <div class="ddn"><input data-nick="${esc(g.key)}" placeholder="Nickname (e.g. blue headset)" value="${esc(g.nickname ?? "")}"><button data-nicksave="${esc(g.key)}">Save</button></div>
      </div>`).join("")}</div>`, { wide: true });
  }
  // ---- the voices: hear each one, pick one ----
  const VOICE_LINE = (n) => `Hi${ownerName ? " " + ownerName : ""}, I'm ${n}. This is how I'd sound reading your day to you.`;
  let voiceProvider = "browser";
  // every voice the current provider offers: free ones from this computer (natural first), OpenAI's, or ElevenLabs'
  async function voiceList() {
    const v = await json("/voices");
    voiceProvider = v.provider;
    if (v.provider !== "browser") return { provider: v.provider, list: v.voices.map((n) => ({ id: n, name: n, describe: v.describe?.[n] ?? "" })), cur: v.chosen ?? v.current?.voiceName };
    const vs = loadVoices().filter((x) => /^en/i.test(x.lang));
    const sorted = [...vs.filter(isNatural), ...vs.filter((x) => !isNatural(x))];
    return { provider: "browser", list: sorted.map((x) => ({ id: x.name, name: x.name.replace(/^Microsoft |^Google /, "").replace(/ Online \(Natural\)| - English.*$/, ""), describe: `${isNatural(x) ? "✨ natural · " : ""}${x.lang}` })), cur: prefs.browserVoice ?? pickSysVoice()?.name };
  }
  async function voicesDetail() {
    const v = await voiceList();
    const note = { browser: "These are the free voices built into this computer's browser. Voices marked ✨ sound the most natural (Microsoft Edge has the best free ones). For studio-quality voices, add ElevenLabs in Settings.",
      openai: "OpenAI's voices. They follow your mood and time of day.", elevenlabs: "Your ElevenLabs voices, including any you've added or cloned in your ElevenLabs Voice Library." }[v.provider] ?? "";
    openDetail("Voices", `<p class="muted">${note} Say “${assistantName}, switch your voice to …” any name.</p>
      ${v.list.length ? `<div class="dvoices">${v.list.map((x) => `<div class="dv${x.id === v.cur || x.name === v.cur ? " cur" : ""}"><b>${esc(x.name)}</b><small>${esc(x.describe)}</small>
        <span><button data-vplay="${esc(x.id)}">▶ Hear</button><button data-vuse="${esc(x.id)}">${x.id === v.cur || x.name === v.cur ? "In use" : "Use this voice"}</button></span></div>`).join("")}</div>
      <div class="dnav"><button data-vall="1">▶ Play them all</button></div>` : '<p class="muted">No voices found yet. Give it a few seconds and open this again.</p>'}`, { wide: true });
  }
  async function useVoice(id) {
    const patch = voiceProvider === "browser" ? { browserVoice: id } : voiceProvider === "openai" ? { openaiVoice: id } : { voice: id };
    const r = await post("/settings", patch); prefs = r.settings;
    const shown = String(id).replace(/^Microsoft |^Google /, "").replace(/ Online \(Natural\)| - English.*$/, "");
    speak(`Okay, this is my ${shown} voice now.`);
    return shown;
  }
  let demoStop = false;
  async function playVoice(n) {
    if (voiceProvider === "browser") return browserSpeak(VOICE_LINE(String(n).replace(/^Microsoft |^Google /, "").replace(/ Online \(Natural\)| - English.*$/, "")), {}, { voiceName: n });
    try { const r = await api("/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: VOICE_LINE(n), voice: n }) }); const url = URL.createObjectURL(await r.blob()); const a = new Audio(url); try { audioCtx().createMediaElementSource(a).connect(CH.general.voice); } catch { /* plays direct */ } await a.play(); await new Promise((res) => { a.onended = res; a.onerror = res; }); URL.revokeObjectURL(url); } catch { /* skip that one */ }
  }
  // clicks inside the viewer
  $("#dBody").addEventListener("click", async (e) => {
    const dev = e.target.closest("[data-duse],[data-nicksave]");
    if (dev?.dataset.duse) { const r = await post("/devices/use", { key: dev.dataset.duse, as: dev.dataset.as }); prefs = (await json("/settings")).settings; await routeAudio(); toast("Audio devices", r.said.join(", "), "", "bell"); devicesDetail(); return; }
    if (dev?.dataset.nicksave) { const inp = [...document.querySelectorAll("#dBody [data-nick]")].find((x) => x.dataset.nick === dev.dataset.nicksave); await post("/devices/nickname", { key: dev.dataset.nicksave, nickname: inp?.value ?? "" }); devicesDetail(); return; }
    const el = e.target.closest("[data-day],[data-month],[data-photo-open],[data-photo-next],[data-vplay],[data-vuse],[data-vall]");
    if (!el) return;
    if (el.dataset.day) dayDetail(el.dataset.day);
    else if (el.dataset.month) { const [y, m] = el.dataset.month.split("-").map(Number); monthDetail(y, m); }
    else if (el.dataset.photoOpen) post(`/photos/open/${el.dataset.photoOpen}`).then(() => toast("Opened on the laptop", "", "", "bell")).catch(() => {});
    else if (el.dataset.photoNext) { await showPhoto({ pin: true }); photoDetail(); }
    else if (el.dataset.vplay) { demoStop = true; await playVoice(el.dataset.vplay); }
    else if (el.dataset.vuse) { await useVoice(el.dataset.vuse); voicesDetail(); }
    else if (el.dataset.vall) { demoStop = false; for (const n of (await voiceList()).list.map((x) => x.id)) { if (demoStop || !detailOpen()) break; document.querySelectorAll("#dBody .dv").forEach((d) => d.classList.toggle("playing", d.querySelector("[data-vplay]")?.dataset.vplay === n)); await playVoice(n); } document.querySelectorAll("#dBody .dv").forEach((d) => d.classList.remove("playing")); }
  });
  // clicks on the big panel and the Now / Next cards open the right view
  $("#show").addEventListener("click", (e) => {
    if (e.target.closest("#showPrev")) return stepShow(-1);
    if (e.target.closest("#showNext")) return stepShow(1);
    if (e.target.closest("#showPause")) return setPaused(!showPaused);
    const jump = e.target.closest("[data-jump]");
    if (jump) { const v = jump.dataset.jump; if (v === "photo") showPhoto({ pin: true }); else setCalView(v, { pin: true }); holdShow(); return; }
    if (e.target.closest(".showhead")) return;
    const day = e.target.closest("[data-date]"), mon = e.target.closest("[data-month]"), li = e.target.closest("#today li[data-id]");
    if (mon && calView === "year") return openCalendar("month", `${new Date().getFullYear()}-${String(Number(mon.dataset.month) + 1).padStart(2, "0")}-01`);
    if (day) return openCalendar("day", day.dataset.date);
    if (li) return blockDetail(blocks.find((b) => b.id === li.dataset.id));
    ({ day: () => openCalendar("day"), week: () => openCalendar("week"), month: () => openCalendar("month"), year: () => openCalendar("year"),
      weather: weatherDetail, photo: photoDetail, video: videoDetail, quote: quoteDetail, memory: memoryDetail, prayer: () => prayerDetail("mine"), prayerChurch: () => prayerDetail("church") })[calView]?.();
  });
  $("#now").addEventListener("click", () => { const nm = nowMin(); blockDetail(blocks.find((b) => toMin(b.start) <= nm && nm < toMin(b.end))); });
  $("#next").addEventListener("click", () => { const nm = nowMin(); blockDetail(blocks.find((b) => toMin(b.start) > nm)); });

  document.addEventListener("keydown", (e) => {
    if (detailOpen() || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName ?? "")) return;
    if (e.key === "ArrowLeft") stepShow(-1); else if (e.key === "ArrowRight") stepShow(1); else if (e.key === " ") { e.preventDefault(); setPaused(!showPaused); }
  });
  let wheelAt = 0;
  $("#show").addEventListener("wheel", (e) => { if (Date.now() - wheelAt < 500) return; wheelAt = Date.now(); stepShow(e.deltaY > 0 || e.deltaX > 0 ? 1 : -1); }, { passive: true });
  function rotate(force = false) {
    if (!force && (showPaused || Date.now() < pinnedUntil || alarmOn || document.body.classList.contains("night"))) return;
    for (let tries = 0; tries < ROTATION.length; tries++) {
      const v = ROTATION[++rotI % ROTATION.length];
      if (!viewOn(v)) continue;
      if (v === "video" && !show.video) continue;
      if (v === "forYou" && !window.dsDiscover?.has?.()) continue;
      if (v === "weather" && !show.weather) continue;
      if (v === "photo") { showPhoto({ ask: true }).then((ok) => { if (!ok) setCalView("day"); }); return; }
      return setCalView(v);
    }
  }
  // the panel's pace: Settings → Screen "carousel speed" (seconds per slide; 0 = it stays put)
  let lastRotate = Date.now();
  setInterval(() => {
    const sec = typeof prefs.carouselSeconds === "number" ? prefs.carouselSeconds : ROTATE_MS / 1000;
    if (sec > 0 && Date.now() - lastRotate >= sec * 1000) { lastRotate = Date.now(); rotate(); }
  }, 2000);
  setInterval(() => { loadShowcase(); loadSpecial(); calCache = {}; }, 15 * 60_000);
  // for the automated screen checks: switch the panel the way a spoken command would (page-local only)
  window.addEventListener("ds-test-say", (e) => { calCommand(String(e.detail ?? "")); });
  window.addEventListener("ds-test-ask", (e) => { ask(String(e.detail ?? "")); });
  window.addEventListener("ds-test-final", (e) => { handleFinal(String(e.detail ?? "")); });
  // spoken: "show me my week", "what's the weather", "show the prayer list", "pull up my memory verses", "back to today"
  function calCommand(text) {
    const q = String(text).toLowerCase().replace(/[.!?,]+$/, "").trim();
    if (/^(repeat( that| it| yourself)?( please)?|say (that|it) again|what did you (just )?say|come again|pardon( me)?|sorry,? what( was that)?|one more time)$/.test(q)) return { repeat: true };
    if (/\b(show|open)( me)? (the |our )?(chat|conversation|transcript)\b/.test(q)) { chatDetail(); return { say: "Here's our conversation." }; }
    if (/^(stop listening|never ?mind|cancel( that)?|forget it|stop)$/.test(q)) { stopListeningNow(); return { say: "Okay." }; }
    if (/\b(text only|typing only|type only|quiet mode|i'?m on a call|silent chat)\b/.test(q) && !/\b(off|stop|end)\b/.test(q)) { setTextOnly(true); return { say: "Okay, text only. Type to me below; I won't talk or listen." }; }
    const vto = /\b(?:switch|change|set)(?: your)? voice to ([a-z][a-z' -]*)$|^(?:use|try) ([a-z]+)'?s voice$|^(?:switch|change) to ([a-z]+)$/.exec(q);
    if (vto && voiceProvider !== "elevenlabs") {
      const want = (vto[1] ?? vto[2] ?? vto[3]).trim();
      const hit = voiceProvider === "browser" ? loadVoices().find((x) => x.name.toLowerCase().includes(want)) : (["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"].includes(want) ? { name: want } : null);
      if (hit) { useVoice(hit.name); return { say: "" }; }
      if (vto[1]) return { say: `I don't have a voice called ${want}. Say "show me the voices" to see the ones I have.` };
    }
    if (/\b(show|list|what are)( me)?( the| your| all)? voices\b|\bdemo (the )?voices\b/.test(q)) { voicesDetail(); return { say: "Here are my voices." }; }
    // Settings and the guide
    if (pageOpen() && /\b(close|exit|hide)( the)? (settings|help|guide)\b/.test(q)) { closePage(); return { say: "Okay." }; }
    if (/\b(open|show|go to|pull up)( me)?( the| my| your)? (settings|preferences|setup( wizard)?|permissions)\b/.test(q)) { openPage("/setup?embed=1"); return { say: "Here are the settings." }; }
    if (/\b(open|show|pull up)( me)?( the| your)? (help|guide|instructions|manual|user guide)\b|^help$/.test(q)) { openPage("/help?embed=1"); return { say: "Here's the guide." }; }
    {
      const how = /^(?:how (?:do|can) i|how to|where do i|can you show me how to) (.+)$/.exec(q);
      if (how && /\b(dayspring|you|your|voice|voices|settings?|key|api|spotify|youtube|phone|text|update|install|screen|display|monitor|tv|mic|microphone|speakers?|headset|headphones|permissions?|elevenlabs|claude|chatgpt|openai|grok|ollama|wake|photos?|music|connect|link|sign in|set up|setup|files?|folders?|programs?|browser|schedule|calendar|remind\w*)\b/.test(how[1])) {
        openPage("/help?embed=1&q=" + encodeURIComponent(how[1])); return { say: "Here's the part of the guide about that." };
      }
    }
    // the Schedule app: "open my schedule", "show me my month on the calendar", "open the calendar to next week", "close the schedule"
    if (calendarOpen() && /\b(close|exit|done with|hide)( the| my)? (schedule|calendar)\b|^(close( it| that)?|go back)$/.test(q)) { closeCalendar(); return { say: "Okay." }; }
    // "show me my schedule for Saturday" (the coming one), "open the calendar to next week", "pull up October",
    // "show me the 15th", "what does 2027 look like on the calendar"
    const showing = /\b(show|open|pull up|bring up|display|go to|jump to|let me see|take me to)\b/.test(q) || /\b(on|in) (the|my) (calendar|schedule)\b/.test(q);
    const aboutSchedule = /\b(schedule|calendar|planner|agenda)\b/.test(q);
    const when = whenFrom(q);
    if (showing && (aboutSchedule || (when && /\b(day|week|month|year)\b/.test(q)))) {
      const w = when ?? { view: "week", date: todayISO(), label: "this week" };
      openCalendar(w.view, w.date);
      return { say: `Here's your schedule for ${w.label}.` };
    }
    // the carousel by voice
    if (!detailOpen() && /^(wait,? )?(go back( one)?|back( one)?|previous( one)?|show (me )?(that|the last one) again|what was that|go back to (that|the last one))$/.test(q)) { stepShow(-1); return { say: "Here it is." }; }
    if (!detailOpen() && /^(next( one)?|skip( it)?|show me the next one|move on)$/.test(q)) { stepShow(1); return { say: "Okay." }; }
    if (/\b(pause|hold|stop) (the )?(slide ?show|carousel|rotation|slides)\b|\bkeep (that|this|it) (up|there|on screen)\b|^hold (that|this)( one)?$/.test(q)) { setPaused(true); return { say: "Okay, I'll hold this one." }; }
    if (/\b(resume|start|restart|continue) (the )?(slide ?show|carousel|rotation|slides)\b|\bkeep (rotating|going)\b/.test(q)) { setPaused(false); return { say: "Okay, rotating again." }; }
    // the detail viewer: "close that" / "go back", and "show me more" / "open that" for whatever the big panel is showing
    if (detailOpen() && /\b(close (that|it|this|the (window|viewer|panel))|go back|exit|that'?s enough|done)\b/.test(q)) { closeDetail(); return { say: "Okay." }; }
    if (/\b(show me more|more (detail|details|info)|open (that|it|this)( up)?|full breakdown|zoom in on that)\b/.test(q) && !/\bbrowser|laptop\b/.test(q)) { $("#show").click(); return { say: "Here you go." }; }
    if (/\bplay (that|the) video\b/.test(q) && show.video) return { play: show.video };
    if (/\bopen (that|the|this) (video|link)\b.*\b(browser|laptop|computer)\b/.test(q) && show.video) { post("/open", { url: `https://www.youtube.com/watch?v=${show.video.videoId}` }).catch(() => {}); return { say: "Opened it in your browser." }; }
    const asks = /\b(show|see|look|pull up|open|what does|what'?s|how does|go to|switch to|back to|display|put up)\b/.test(q);
    if (!asks) return null;
    const v = /\bweather|forecast|temperature\b/.test(q) ? "weather" : /\bchurch prayer\b/.test(q) ? "prayerChurch" : /\bprayer list|praying for|pray for today\b/.test(q) ? "prayer" : /\bmemory verse|memoriz|verses? for today\b/.test(q) ? "memory"
      : /\b(quote|encourag|inspir)/.test(q) ? "quote" : /\b(video|youtube)\b/.test(q) && !/\bplay\b/.test(q) ? "video" : /\b(year|yearly)\b/.test(q) ? "year" : /\b(month|monthly)\b/.test(q) ? "month"
      : /\b(week|weekly)\b/.test(q) ? "week" : /\b(today|daily|schedule)\b/.test(q) && /\b(show|back|go|switch|pull)\b/.test(q) ? "day" : null;
    if (!v || /\b(add|move|schedule (a|an|my|something)|cancel|remind|free|anything at)\b/.test(q)) return null;
    setCalView(v, { pin: v !== "day" });
    if (v === "weather" && show.weather) { const w = show.weather; return { say: `It's ${w.now.temp} and ${w.now.text.toLowerCase()} in ${w.place}. High of ${w.today.hi}, low of ${w.today.lo}${w.today.rain >= 20 ? `, ${w.today.rain} percent chance of rain` : ""}.` }; }
    if (v === "quote" && show.quote) return { say: `${show.quote.text} ${show.quote.by}.` };
    return { say: { day: "Here's today.", week: "Here's your week.", month: `Here's ${MON[new Date().getMonth()]}.`, year: `Here's ${new Date().getFullYear()} at a glance.`, prayer: "Here's your prayer list.", memory: "Here are your memory verses.", video: "Here's one I think you'd like." }[v] };
  }

  // Night: after the day's last block and before its first, the TV goes nearly black (or just dims),
  // with a faint clock that drifts around so nothing burns in. Anything that needs him brings it back.
  let wakeUntil = 0;
  function nightCheck() {
    if (!blocks.length) return;
    const nm = nowMin(), first = toMin(blocks[0].start) - 15, last = toMin(blocks[blocks.length - 1].end);
    const isNight = (prefs.night ?? "dark") !== "off" && (nm >= last || nm < first);
    const b = document.body.classList;
    b.toggle("night", isNight); b.toggle("dark", (prefs.night ?? "dark") === "dark"); b.toggle("dim", prefs.night === "dim");
    b.toggle("wake", Date.now() < wakeUntil);
  }
  function wake(ms = 45_000) { wakeUntil = Date.now() + ms; nightCheck(); }
  function driftNightClock() {
    const c = $("#nclock");
    const d = new Date(), first = blocks.find((b) => toMin(b.start) > nowMin()) ?? blocks[0];
    c.innerHTML = `${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}${first ? `<small>${esc(first.title)} · ${hm12(first.start)}</small>` : ""}`;
    c.style.left = `${8 + Math.random() * 62}%`; c.style.top = `${10 + Math.random() * 62}%`;
  }
  setInterval(driftNightClock, 60_000);

  async function loadLearning() {
    try {
      const p = await json("/learning");
      const ex = p.exam ?? {};
      $("#examCard").hidden = !ex.date;
      if (ex.date) {
        $("#examDays").textContent = ex.daysLeft >= 0 ? ex.daysLeft : "✓";
        $("#examWhat").textContent = `days to ${ex.spoken || ex.name || "the exam"}`;
        const d = new Date(ex.date + "T" + (ex.time || "12:00"));
        const et = ex.time ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "", place = String(ex.place ?? "");
        const placeS = place.split(/\s*[-–(,]\s*/)[0].split(/\s+/).slice(0, 3).join(" ");
        const full = [d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }), et, place].filter(Boolean).join(" · ");
        const shortD = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
        setV($("#examWhen"), V(esc(full), esc([shortD, et, placeS].filter(Boolean).join(" · ")), esc([shortD, et].filter(Boolean).join(" · ")), esc(d.toLocaleDateString("en-US", { month: "short", day: "numeric" }))));
        $("#examWhen").title = full;
      }
      const C = 2 * Math.PI * 42;
      const html = Object.entries(p.courses ?? {}).map(([k, c], i) => `
        <div class="course ${i % 2 ? "cf" : "fs"}">
          <div class="gauge"><svg viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="42"/><circle class="fill" cx="50" cy="50" r="42" stroke-dasharray="${C}" stroke-dashoffset="${C}" data-to="${C * (1 - c.percent / 100)}"/></svg><span class="pct">${c.percent}%</span></div>
          <div class="info"><div class="label">${esc(String(c.title ?? k).replace(/\s*\(.*$/, ""))}</div><b>${c.done}<span class="of"> of ${c.total}</span></b>
            <div class="nx">Next: ${esc(c.next ? c.next.title.split(" — ")[0] : "all done")}</div>
            ${c.behind ? `<div class="behind">${c.behind} to catch up</div>` : ""}</div>
        </div>`).join("");
      if ($("#courses").dataset.html !== html) {
        $("#courses").dataset.html = html; $("#courses").innerHTML = html;
        requestAnimationFrame(() => requestAnimationFrame(() => document.querySelectorAll(".gauge .fill").forEach((c) => { c.style.strokeDashoffset = c.dataset.to; })));
      }
    } catch { /* offline for a moment */ }
  }

  /* ================================================================ log, toasts, now playing */
  // Any web link clicked on the TV (a video card, a link in a reply) opens in his normal browser on the laptop,
  // never inside the TV screen.
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.("a[href^='http']");
    if (!a) return;
    e.preventDefault();
    post("/open", { url: a.href }).then(() => toast("Opened in your browser", a.href.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60), "", "bell")).catch(() => {});
  });
  function push(kind, text) {
    removeTyping();
    if (/^me/.test(kind)) { const y = $("#youSaid"); y.textContent = "You: " + text; y.classList.toggle("interim", /interim/.test(kind)); }
    else if ((kind === "ai" || kind === "sys") && !speaking) { const c = $("#cap"); c.className = "cap show" + (kind === "sys" ? " sys" : ""); c.innerHTML = String(text).split(/\s+/).map((w) => `<span class="on">${esc(w)}</span>`).join(" "); $("#transcript").scrollTop = 0; }
    const el = document.createElement("div");
    el.className = "msg " + kind;
    el.innerHTML = esc(text).replace(/https?:\/\/[^\s<>"]+/g, (u) => `<a href="${u}">${u.length > 48 ? u.slice(0, 45) + "…" : u}</a>`);
    $("#log").appendChild(el);
    while ($("#log").children.length > 80) $("#log").firstChild.remove();
    return el;
  }
  let typingEl = null;
  function showTyping() { removeTyping(); typingEl = document.createElement("div"); typingEl.className = "msg ai typing"; typingEl.innerHTML = "<i></i><i></i><i></i>"; $("#log").appendChild(typingEl); }
  function removeTyping() { if (typingEl) { typingEl.remove(); typingEl = null; } }
  // Pop-up notifications (top right): each has an ✕; with two or more, "Clear all". They also fade on their own after 40 s.
  function toast(title, detail, cls = "", ic = "bell", { snooze: snoozeItem = null } = {}) {
    const el = document.createElement("div");
    el.className = "toast " + cls;
    el.innerHTML = `<div class="row">${icon(ic)}<b>${esc(title)}</b></div>${detail ? `<span>${esc(detail)}</span>` : ""}${snoozeItem ? `<div class="snzrow"><button data-m="5">💤 5 min</button><button data-m="10">10</button><button data-m="15">15</button><button data-m="30">30</button><button data-m="60">1 hr</button></div>` : ""}<i class="timer"></i><button class="tx" title="Dismiss" aria-label="Dismiss">✕</button>`;
    el.querySelector(".tx").onclick = (e) => { e.stopPropagation(); dismissToast(el); };
    el.querySelectorAll(".snzrow button").forEach((b) => (b.onclick = async (e) => {
      e.stopPropagation(); stopSpeaking?.();
      const r = await post("/snooze", { item: snoozeItem, minutes: Number(b.dataset.m) }).catch(() => null);
      dismissToast(el); if (r?.text) { push("ai", r.text); toast("💤 Snoozed", r.text.replace(/^Snoozed /, ""), "", "bell"); }
    }));
    $("#toasts").insertBefore(el, $("#toastsClear"));
    post("/screen/shown", { kind: "toast", title, text: detail ?? "" }).catch(() => {});
    setTimeout(() => dismissToast(el), 40_000);
    let list; while ((list = $("#toasts").querySelectorAll(".toast")).length > 4) list[0].remove();
    syncToastClear();
    return el;
  }
  function dismissToast(el) {
    if (!el.isConnected || el.classList.contains("out")) return;
    el.classList.add("out"); setTimeout(() => { el.remove(); syncToastClear(); }, 450);
  }
  function clearToasts() { $("#toasts").querySelectorAll(".toast").forEach(dismissToast); }
  function syncToastClear() {
    let b = $("#toastsClear");
    if (!b) { b = document.createElement("button"); b.id = "toastsClear"; b.className = "clearall"; b.textContent = "Clear all"; b.onclick = clearToasts; $("#toasts").appendChild(b); }
    b.hidden = $("#toasts").querySelectorAll(".toast:not(.out)").length < 2;
  }
  // The older hidden-window Spotify reports what it's playing here (the server polls it). It never overrides YouTube or
  // Spotify playing inside Dayspring.
  function showNowPlaying(n) {
    if (P.source === "youtube" || P.source === "spotify") return;
    if (!n || (!n.title && !n.playing)) { if (P.source === "spotify-window") clearPlayer(); return; }
    Object.assign(P, { source: "spotify-window", title: n.title || "Spotify", artist: n.artist || "", art: n.art || "", playing: Boolean(n.playing), pos: 0, dur: 0, at: Date.now(), shuffle: false, repeat: "off", rate: 1, video: false, playlist: false, videoId: null });
    renderPlayer(); reportState();
  }

  /* ================================================================ audio: two chains */
  // Two separate outputs, each: voice → clarity EQ ─┐
  //                                sound bites ────────┼→ compressor → master → its devices (bites also feed a room and a stereo echo)
  //   general — replies, sound bites, anything the owner asked for: plays wherever they choose (the screen, headphones, both)
  //   notify  — schedule announcements, check-ins, chores and the alarm: always the TV AND the headphones
  let actx = null, analyser = null;
  const CH = {};
  let cur = null;                              // the chain the synth functions are writing into
  function makeChain(name) {
    const c = { name, sinks: new Map(), msDest: null, routedTo: [] };
    c.comp = actx.createDynamicsCompressor();
    c.comp.threshold.value = -18; c.comp.knee.value = 12; c.comp.ratio.value = 3.5; c.comp.attack.value = 0.004; c.comp.release.value = 0.22;
    c.master = actx.createGain(); c.master.gain.value = volGain();
    c.comp.connect(c.master).connect(actx.destination);
    // voice: trim the rumble, lift the presence a touch — clearer through TV speakers
    const hp = actx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 85;
    const pres = actx.createBiquadFilter(); pres.type = "peaking"; pres.frequency.value = 3200; pres.Q.value = 0.9; pres.gain.value = 2.5;
    const air = actx.createBiquadFilter(); air.type = "highshelf"; air.frequency.value = 9000; air.gain.value = 1.5;
    c.voice = actx.createGain(); c.voice.gain.value = 1.1;
    c.voiceLvl = actx.createGain(); c.voiceLvl.gain.value = lvlGain("volume");
    c.voice.connect(c.voiceLvl).connect(hp).connect(pres).connect(air); air.connect(c.comp); air.connect(analyser);
    // a small, bright room so bells ring instead of beep, and a light stereo echo (a long hall and heavy echoes
    // made the chimes sound hazy and eerie)
    const len = actx.sampleRate * 1.2, ir = actx.createBuffer(2, len, actx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
    const verb = actx.createConvolver(); verb.buffer = ir;
    const wet = actx.createGain(); wet.gain.value = 0.16;
    const dl = actx.createDelay(1), dr = actx.createDelay(1), fb = actx.createGain(), el = actx.createGain(), lp = actx.createBiquadFilter();
    dl.delayTime.value = 0.27; dr.delayTime.value = 0.41; fb.gain.value = 0.15; el.gain.value = 0.07; lp.type = "lowpass"; lp.frequency.value = 5000;
    const merge = actx.createChannelMerger(2);
    c.bites = actx.createGain();
    c.bites.connect(c.comp); c.bites.connect(verb); verb.connect(wet).connect(c.comp);
    // chimes and sound effects, and the alarm's ring, each through their own level into the same room
    c.sfx = actx.createGain(); c.sfx.gain.value = lvlGain("soundsVolume"); c.sfx.connect(c.bites);
    c.alarmIn = actx.createGain(); c.alarmIn.gain.value = lvlGain("alarmVolume"); c.alarmIn.connect(c.bites);
    c.bites.connect(el); el.connect(lp); lp.connect(dl); dl.connect(dr); dr.connect(fb); fb.connect(dl);
    dl.connect(merge, 0, 0); dr.connect(merge, 0, 1); merge.connect(c.comp);
    return c;
  }
  function audioCtx() {
    if (actx) return actx;
    actx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = actx.createAnalyser(); analyser.fftSize = 512; analyser.smoothingTimeConstant = 0.8;
    CH.general = makeChain("general");
    CH.notify = makeChain("notify");
    cur = CH.general;
    return actx;
  }
  // Run synth code into one chain: onBus("notify", () => SOUNDS.alarm())
  // { alarm: true }: the alarm's ring (its own volume, never silent)
  let curIn = null;
  function onBus(bus, fn, { alarm = false } = {}) { audioCtx(); const prev = cur, prevIn = curIn; cur = CH[bus] ?? CH.general; curIn = alarm ? cur.alarmIn : cur.sfx; try { return fn(); } finally { cur = prev; curIn = prevIn; } }
  const sfxIn = () => curIn ?? cur.sfx;

  /* ---------------- where the sound goes: the Dayspring screen, the headphones, both ---------------- */
  // Every output device gets a role from its name; a chain plays on every device in its roles at once.
  const classify = (label) => {
    const l = String(label || "").toLowerCase();
    // the owner's own hints first (data/devices.json "typeHints": { "<part of a name>": "headset" | "tv" | … })
    for (const [part, kind] of Object.entries(config.typeHints ?? {})) if (part && l.includes(part.toLowerCase())) return /head|ear|bud/.test(kind) ? "headphones" : kind === "tv" || kind === "display" ? "tv" : /speak/.test(kind) ? "speakers" : "other";
    if (/headphone|headset|buds|airpods|earphone/.test(l)) return "headphones";
    if (/display audio|hdmi|\btv\b|television|monitor|nvidia high definition|amd high definition/.test(l)) return "tv";
    if (/realtek|speaker/.test(l)) return "speakers";
    return "other";
  };
  const NOTIFY_ROLES = ["tv", "headphones"];       // schedule notifications: always both
  let routedTo = [];
  async function audioDevices() {
    let list = (await navigator.mediaDevices?.enumerateDevices?.().catch(() => [])) ?? [];
    if (list.some((d) => d.kind === "audiooutput" && !d.label)) {
      // names are hidden until the page has microphone permission; ask once, then look again
      try { const st = await navigator.mediaDevices.getUserMedia({ audio: true }); st.getTracks().forEach((t) => t.stop()); list = await navigator.mediaDevices.enumerateDevices(); } catch { /* no permission */ }
    }
    return list.filter((d) => d.kind === "audiooutput" && d.deviceId !== "default" && d.deviceId !== "communications")
      .map((d) => ({ id: d.deviceId, label: d.label, role: classify(d.label) }));
  }
  async function routeChain(c, roles, devs) {
    const pref = prefs.preferredOutputs ?? {};
    const chosen = roles.includes("default") ? [] : roles.map((r) => { const all = devs.filter((d) => d.role === r); return all.find((d) => pref[r] && d.label.includes(pref[r].replace(/^(Speakers?|Headphones?) \(|\)$/g, ""))) ?? all.find((d) => pref[r] && d.label === pref[r]) ?? all[0]; }).filter(Boolean);
    const useDefault = !chosen.length || typeof HTMLMediaElement.prototype.setSinkId !== "function";
    try { c.master.disconnect(); } catch { /* not connected */ }
    if (useDefault) {
      c.master.connect(actx.destination);
      for (const el of c.sinks.values()) { el.pause(); el.srcObject = null; }
      c.sinks.clear();
    } else {
      if (!c.msDest) c.msDest = actx.createMediaStreamDestination();
      c.master.connect(c.msDest);
      for (const [id, el] of c.sinks) if (!chosen.some((d) => d.id === id)) { el.pause(); el.srcObject = null; c.sinks.delete(id); }
      for (const d of chosen) {
        let el = c.sinks.get(d.id);
        if (!el) { el = new Audio(); el.autoplay = true; c.sinks.set(d.id, el); }
        try { await el.setSinkId(d.id); el.srcObject = c.msDest.stream; await el.play(); }
        catch { c.sinks.delete(d.id); }
      }
      if (!c.sinks.size) c.master.connect(actx.destination);   // nothing took it: never go silent
    }
    c.routedTo = useDefault ? ["default"] : chosen.map((d) => d.label);
    return roles.filter((r) => r !== "default" && !devs.some((d) => d.role === r));
  }
  async function routeAudio() {
    audioCtx();
    const devs = await audioDevices();
    const missing = await routeChain(CH.general, prefs.audioOutputs ?? ["default"], devs);
    await routeChain(CH.notify, prefs.audioOutputs?.length ? prefs.audioOutputs : NOTIFY_ROLES, devs);
    routedTo = CH.general.routedTo;
    if (missing.length && routedTo[0] !== "default") push("sys", `No ${missing.join(" or ")} found right now, so I'm playing on ${routedTo.join(" and ")}.`);
    renderAudioPanel(devs);
    return { routedTo, devices: devs };
  }
  navigator.mediaDevices?.addEventListener?.("devicechange", () => setTimeout(() => routeAudio().catch(() => {}), 800));

  const pan = (p) => { const ctx = audioCtx(), n = ctx.createStereoPanner(); n.pan.value = p; n.connect(sfxIn()); return n; };
  // A bell: a sine with a few inharmonic partials and a long soft tail, placed in the stereo field.
  function bell(freq, start, { dur = 1.6, vol = 0.18, bright = 1, p = 0 } = {}) {
    const ctx = audioCtx(), t = ctx.currentTime + start, out = pan(p);
    [[1, 1], [2, 0.28 * bright], [3, 0.1 * bright]].forEach(([mul, amp], i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = freq * mul;
      const d = dur / (1 + i * 0.6);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol * amp, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(out); o.start(t); o.stop(t + d + 0.05);
    });
  }
  // A soft pad chord that swells in and fades: warmth under an announcement.
  function pad(freqs, start, { dur = 2.8, vol = 0.05 } = {}) {
    const ctx = audioCtx(), t = ctx.currentTime + start, lpf = ctx.createBiquadFilter(), g = ctx.createGain();
    lpf.type = "lowpass"; lpf.frequency.setValueAtTime(600, t); lpf.frequency.linearRampToValueAtTime(1800, t + dur * 0.5); lpf.frequency.linearRampToValueAtTime(700, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + dur * 0.35); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    lpf.connect(g).connect(sfxIn());
    freqs.forEach((f, i) => [0].forEach((det) => {
      const o = ctx.createOscillator(); o.type = i % 2 ? "triangle" : "sine"; o.frequency.value = f; o.detune.value = det;
      const og = ctx.createGain(); og.gain.value = i % 2 ? 0.5 : 0.8;
      o.connect(og).connect(lpf); o.start(t); o.stop(t + dur + 0.1);
    }));
  }
  function tone(freq, start, dur, { type = "sine", vol = 0.2, slide = 0, attack = 0.02, p = 0 } = {}) {
    const ctx = audioCtx(), o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + start;
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(pan(p)); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(start, dur, { vol = 0.2, hp = 800, lp = 12000, fadeIn = false, p = 0 } = {}) {
    const ctx = audioCtx(), len = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (fadeIn ? Math.sin((i / len) * Math.PI) : 1 - i / len);
    const src = ctx.createBufferSource(), f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = buf; f1.type = "highpass"; f1.frequency.value = hp; f2.type = "lowpass"; f2.frequency.value = lp; g.gain.value = vol;
    src.connect(f1).connect(f2).connect(g).connect(pan(p)); src.start(ctx.currentTime + start);
  }
  const SOUNDS = {
    // the Dayspring motif: a bright, happy C-major "ding-ding-ding-DING" over a warm major chord (no dreamy 7ths)
    motif: () => { pad([261.6, 329.6, 392], 0, { dur: 1.6, vol: 0.04 }); [523.3, 659.3, 784, 1046.5].forEach((f, i) => bell(f, i * 0.1, { dur: i === 3 ? 1.3 : 0.8, vol: i === 3 ? 0.15 : 0.12, bright: 1.2, p: -0.45 + i * 0.3 })); },
    // opening Dayspring: a cheerful little "good to see you" flourish
    hello: () => { pad([261.6, 329.6, 392, 523.3], 0.05, { dur: 1.8, vol: 0.045 }); [[392, 0], [523.3, 0.09], [659.3, 0.18], [784, 0.27], [1046.5, 0.42]].forEach(([f, t], i) => bell(f, t, { dur: i === 4 ? 1.4 : 0.6, vol: i === 4 ? 0.16 : 0.11, bright: 1.3, p: -0.5 + i * 0.25 })); bell(1318.5, 0.5, { dur: 1.2, vol: 0.07, bright: 1.4, p: 0.4 }); },
    chime: () => { bell(784, 0, { vol: 0.15, p: -0.3 }); bell(1046.5, 0.13, { vol: 0.13, p: 0.3 }); },          // G → C, up to home
    wake: () => { bell(1046.5, 0, { dur: 0.6, vol: 0.1, bright: 0.5, p: -0.2 }); bell(1318.5, 0.07, { dur: 0.8, vol: 0.09, bright: 0.5, p: 0.2 }); },   // C → E: "I'm listening"
    ding: () => { bell(1318.5, 0, { dur: 1.2, vol: 0.12 }); bell(1568, 0.1, { dur: 1.6, vol: 0.12 }); },          // E → G, bright
    checkin: () => { pad([220, 277.2, 329.6], 0, { dur: 2.2, vol: 0.045 }); bell(659, 0.02, { vol: 0.13, p: -0.35 }); bell(831, 0.16, { vol: 0.11 }); bell(988, 0.3, { vol: 0.11, p: 0.35 }); },
    done: () => { bell(784, 0, { dur: 0.8, vol: 0.12, p: -0.2 }); bell(1046.5, 0.11, { dur: 1.3, vol: 0.13, p: 0.2 }); },   // G → C, finished
    alarm: () => [523.3, 659.3, 784, 1046.5, 784, 1046.5].forEach((f, i) => bell(f, i * 0.15, { dur: 1.1, vol: 0.24, p: (i % 2 ? 0.3 : -0.3) })),   // C major, rising
    levelup: () => { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => bell(f, i * 0.07, { dur: 0.9, vol: 0.12, p: -0.6 + i * 0.24 })); pad([523, 659, 784], 0.35, { dur: 1.8, vol: 0.04 }); },
    fanfare: () => { [[523, 0], [523, 0.13], [523, 0.26], [698, 0.4]].forEach(([f, t]) => tone(f, t, t > 0.3 ? 0.9 : 0.12, { type: "triangle", vol: 0.08 })); [698, 880, 1047].forEach((f, i) => bell(f, 0.4, { dur: 1.8, vol: 0.1, p: i - 1 })); pad([349, 440, 523], 0.4, { dur: 2, vol: 0.05 }); },
    drumroll: () => { for (let i = 0; i < 24; i++) noise(i * 0.045, 0.06, { vol: 0.08 + i * 0.005, hp: 250, lp: 3000, p: Math.random() - 0.5 }); noise(1.1, 0.7, { vol: 0.25, hp: 120, lp: 6000 }); tone(70, 1.1, 0.6, { vol: 0.35 }); },
    whoosh: () => noise(0, 0.9, { vol: 0.2, hp: 500, lp: 5000, fadeIn: true }),
    oops: () => { bell(698.5, 0, { dur: 0.5, vol: 0.1, bright: 0.4 }); bell(880, 0.12, { dur: 0.8, vol: 0.1, bright: 0.4 }); },   // a light "hm, okay" (F → A), never a sad slide
    applause: () => { for (let i = 0; i < 110; i++) noise(Math.random() * 2.4, 0.04, { vol: 0.03 + Math.random() * 0.05, hp: 1500, lp: 9000, p: Math.random() * 2 - 1 }); },
    soft: () => { bell(1046.5, 0, { dur: 1.2, vol: 0.07, bright: 0.3 }); bell(1318.5, 0.12, { dur: 1.3, vol: 0.06, bright: 0.3 }); },
  };
  const BURST_HUE = { levelup: 150, fanfare: 45, applause: 280, motif: 250, checkin: 230, hello: 45 };
  let soundFiles = {};
  function playSound(name, bus = "general") {
    const n = String(name || "").toLowerCase();
    try {
      if (SOUNDS[n]) { energy = Math.min(1, energy + 0.4); if (BURST_HUE[n] !== undefined) burst(BURST_HUE[n], n === "motif" || n === "checkin" ? 30 : 80); return onBus(bus, SOUNDS[n]); }
      const f = soundFiles[n];
      if (f) {
        const a = new Audio(f); a.volume = 0.85;
        try { onBus(bus, () => actx.createMediaElementSource(a).connect(sfxIn())); } catch { /* plays direct */ }
        a.play().catch(() => {}); return;
      }
      onBus(bus, SOUNDS.chime);
    } catch { /* audio not allowed yet */ }
  }

  /* ================================================================ voice presence */
  // Dayspring's "face": a living ring in the Dayspring panel, always on, so the rest of the screen stays visible.
  //   idle: it breathes and drifts · listen: it brightens and follows the room · think: arcs orbit · speak: it moves with the voice.
  // Its mood sets the colours, the shape and the pace, and every change glides: soothing mornings, chipper afternoons,
  // playful when it's joking, still and deep when things are serious, sharp and hot when it's sparring, gold when celebrating.
  const viz = $("#viz"), vx = viz.getContext("2d");
  let stageMode = "off", level = 0, vizRaf = 0, usingFallbackVoice = false, lastFrame = 0, capFade = 0;
  const MOODS = {
    calm:      { a: 228, b: 268, sat: 85, speed: 1.0, wobble: 0.07, lobes: 3, spike: 0,   spark: 1.0, glow: 1.0,  label: "" },
    soothing:  { a: 188, b: 252, sat: 68, speed: 0.5, wobble: 0.09, lobes: 2, spike: 0,   spark: 0.6, glow: 0.85, label: "soothing" },
    bright:    { a: 200, b: 280, sat: 90, speed: 1.2, wobble: 0.09, lobes: 4, spike: 0,   spark: 1.3, glow: 1.1,  label: "bright" },
    chipper:   { a: 182, b: 318, sat: 95, speed: 1.6, wobble: 0.13, lobes: 5, spike: 0,   spark: 1.7, glow: 1.2,  label: "chipper" },
    warm:      { a: 28,  b: 332, sat: 82, speed: 0.8, wobble: 0.09, lobes: 3, spike: 0,   spark: 0.9, glow: 0.95, label: "warm" },
    playful:   { a: 300, b: 165, sat: 92, speed: 1.9, wobble: 0.22, lobes: 6, spike: 0,   spark: 1.8, glow: 1.15, label: "playful" },
    serious:   { a: 234, b: 252, sat: 42, speed: 0.4, wobble: 0.025, lobes: 2, spike: 0,  spark: 0.25, glow: 0.75, label: "serious" },
    spar:      { a: 16,  b: 348, sat: 96, speed: 1.4, wobble: 0.1,  lobes: 7, spike: 1,   spark: 1.2, glow: 1.15, label: "sparring" },
    devil:     { a: 356, b: 282, sat: 90, speed: 1.2, wobble: 0.12, lobes: 5, spike: 0.7, spark: 1.0, glow: 1.05, label: "devil's advocate" },
    celebrate: { a: 44,  b: 305, sat: 100, speed: 1.9, wobble: 0.14, lobes: 5, spike: 0,  spark: 2.6, glow: 1.3,  label: "celebrating" },
    night:     { a: 236, b: 262, sat: 38, speed: 0.35, wobble: 0.05, lobes: 2, spike: 0,  spark: 0.3, glow: 0.45, label: "night" },
  };
  const M = { ...MOODS.calm };            // what's drawn now; glides toward target
  let target = MOODS.calm, moodName = "calm";
  // The mood when nobody is talking: the conversation mode, then the time of day.
  function baseMood() {
    const cm = prefs?.convMode;
    if (cm === "serious" || cm === "spar" || cm === "devil") return cm;
    const h = new Date().getHours();
    if (h >= 22 || h < 5) return "night";
    if (h < 9) return "soothing";
    if (h >= 12 && h < 17) return "chipper";
    if (h >= 18) return "warm";
    return "calm";
  }
  // The mood of something it's about to say: the mode first, then the words, then the voice tone.
  function moodFor(text, tone) {
    const cm = prefs?.convMode;
    if (cm === "serious" || cm === "spar" || cm === "devil") return cm;
    const t = String(text || "");
    if (/\b(congrat\w*|well done|nice work|crushed it|proud of you|let'?s go|streak|level(ed)? up|good luck|you did it|nailed it)\b/i.test(t)) return "celebrate";
    if (/\b(haha|kidding|eyes|whatever|disgusting|just saying|robot|no offense|dramatic|allegedly|honestly though)\b|\.\.\.|…/i.test(t)) return "playful";
    if (/\b(pray(ing|er)?|sorry|hard day|tough|grief|heavy|i'?m here|i'?m listening|take your time|lord|mercy|mercies|faithfulness)\b/i.test(t)) return tone === "soothing" ? "soothing" : "serious";
    if (tone && MOODS[tone]) return tone;
    return baseMood();
  }
  function setMood(name) {
    if (!MOODS[name] || name === moodName) return;
    moodName = name; target = MOODS[name];
    const tag = $("#moodTag");
    if (tag) { tag.textContent = target.label; tag.classList.toggle("on", Boolean(target.label)); }
  }
  const lerp = (a, b, k) => a + (b - a) * k;
  const lerpHue = (a, b, k) => { let d = ((b - a + 540) % 360) - 180; return (a + d * k + 360) % 360; };
  function glide() {
    const k = 0.035;
    M.a = lerpHue(M.a, target.a, k); M.b = lerpHue(M.b, target.b, k);
    for (const p of ["sat", "speed", "wobble", "lobes", "spike", "spark", "glow"]) M[p] = lerp(M[p], target[p], k);
  }

  const SPARKS = Array.from({ length: 70 }, (_, i) => ({ a: (i / 70) * Math.PI * 2, r: 0.25 + Math.random() * 0.5, s: 0.2 + Math.random() * 0.8, z: Math.random(), on: Math.random() }));
  function stage(mode, caption, chip) {
    stageMode = mode;
    const pr = $("#presence");
    pr.className = "presence " + (mode === "off" ? "idle" : mode);
    if (caption !== undefined) { clearTimeout(capFade); $("#cap").classList.add("show"); $("#cap").innerHTML = caption.split(/\s+/).map((w) => `<span>${esc(w)}</span>`).join(" "); }
    // the last reply stays readable (and scrollable) after it's spoken
    if (chip !== undefined) {
      const c = $("#chip");
      if (chip) { c.hidden = false; c.style.setProperty("--c", catVar(chip.category)); c.innerHTML = `${icon(chip.category)}${esc(chip.title)}${chip.start ? `<small>${hm12(chip.start)}${chip.end ? " – " + hm12(chip.end) : ""}</small>` : ""}`; c.style.animation = "none"; void c.offsetWidth; c.style.animation = ""; }
      else c.hidden = true;
    }
    if (mode !== "off") wake();
    if (!vizRaf) vizRaf = requestAnimationFrame(drawViz);
  }
  // Light the caption word by word as the voice goes.
  let capRaf = 0;
  function followCaption(audio) {
    clearTimeout(capRaf);
    const words = [...$("#cap").children];
    if (!words.length) return;
    const weights = words.map((w) => 1 + w.textContent.length * 0.12 + (/[.,;:!?]$/.test(w.textContent) ? 1.6 : 0));
    const total = weights.reduce((a, b) => a + b, 0);
    const step = () => {
      const dur = audio.duration && isFinite(audio.duration) ? audio.duration : 0;
      if (dur) {
        const target = (audio.currentTime / dur) * total * 1.04;
        let acc = 0;
        words.forEach((w, i) => { acc += weights[i]; w.classList.toggle("on", acc - weights[i] * 0.6 <= target); });
        const on = words.filter((w) => w.classList.contains("on")).pop();
        if (on) on.scrollIntoView?.({ block: "nearest" });
      }
      if (!audio.paused && !audio.ended) capRaf = setTimeout(step, 70);   // a timer, not animation frames: keeps pace even if the tab is hidden
      else words.forEach((w) => w.classList.add("on"));
    };
    capRaf = setTimeout(step, 30);
  }
  // How loud the room is right now (0–1), from the mic monitor, so the ring can follow him while listening.
  function roomLevel() {
    const l = levels[levels.length - 1];
    if (!l || Date.now() - l.t > 400) return 0;
    return Math.max(0, Math.min(1, (l.db - floorDb() - 4) / 30));
  }
  const freq = new Uint8Array(256), wave = new Uint8Array(512);
  function blob(cx, cy, R, t, phase, amp, voice) {
    vx.beginPath();
    const n = 180, sp = M.speed;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      let s = Math.sin(a * Math.round(M.lobes) + t * 0.0009 * sp + phase) * 0.5
            + Math.sin(a * (Math.round(M.lobes) + 2) - t * 0.0013 * sp + phase * 1.7) * 0.3
            + Math.sin(a * 2 + t * 0.0005 * sp + phase * 0.6) * 0.2;
      s *= M.wobble * amp;
      if (M.spike > 0.02) s += Math.pow(Math.abs(Math.sin(a * Math.round(M.lobes) * 1.5 + t * 0.002 * sp + phase)), 8) * M.spike * (0.06 + level * 0.25);
      if (voice) s += ((wave[(i * 3) % 512] - 128) / 128) * 0.2;
      const r = R * (1 + s), x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      i ? vx.lineTo(x, y) : vx.moveTo(x, y);
    }
    vx.closePath();
  }
  function drawViz(t) {
    // idle draws at ~30 fps to go easy on the laptop; talking, listening and thinking get every frame
    if (stageMode === "off" && t - lastFrame < 33) { vizRaf = requestAnimationFrame(drawViz); return; }
    lastFrame = t;
    if (stageMode !== "speak") setMood(speaking ? moodName : baseMood());
    glide();
    const W = viz.width, H = viz.height, cx = W / 2, cy = H / 2;
    vx.clearRect(0, 0, W, H);
    const live = analyser && stageMode === "speak" && !usingFallbackVoice;
    if (live) { analyser.getByteFrequencyData(freq); analyser.getByteTimeDomainData(wave); }
    else {
      const room = stageMode === "listen" ? roomLevel() : 0;
      for (let i = 0; i < 256; i++) freq[i] = stageMode === "speak" ? 110 + 80 * Math.sin(t / 130 + i / 5) * Math.sin(t / 410)
        : stageMode === "think" ? 60 + 40 * Math.sin(t / 90 + i) : stageMode === "listen" ? 40 + room * 180 * (0.6 + 0.4 * Math.sin(t / 70 + i / 3)) : 22 + 14 * Math.sin(t / 900 + i / 7);
      for (let i = 0; i < 512; i++) wave[i] = 128;
    }
    let avg = 0; for (let i = 2; i < 60; i++) avg += freq[i]; avg /= 58 * 255;
    level += (avg - level) * 0.22;
    energy = Math.max(energy, level * 0.6);
    const breathe = 1 + Math.sin(t / (1800 / Math.max(0.3, M.speed))) * 0.025;
    const R = W * 0.19 * breathe * (1 + level * 0.18);
    const A = M.a, B = M.b, S = M.sat, G = M.glow;

    // soft halo
    const halo = vx.createRadialGradient(cx, cy, R * 0.5, cx, cy, R * 2.5);
    halo.addColorStop(0, `hsla(${A},${S}%,62%,${(0.2 + level * 0.45) * G})`); halo.addColorStop(0.55, `hsla(${B},${S}%,52%,${(0.07 + level * 0.15) * G})`); halo.addColorStop(1, `hsla(${B},${S}%,40%,0)`);
    vx.fillStyle = halo; vx.beginPath(); vx.arc(cx, cy, R * 2.5, 0, Math.PI * 2); vx.fill();

    // a slow HUD of ticks: the "digital" edge. Ticks lengthen with the voice.
    vx.save(); vx.translate(cx, cy); vx.rotate(t / (26000 / M.speed));
    for (let i = 0; i < 72; i++) {
      const v = freq[(i * 5) % 100 + 3] / 255, a = (i / 72) * Math.PI * 2;
      const r1 = R * 1.72, r2 = r1 + W * (i % 6 === 0 ? 0.022 : 0.009) + v * W * 0.035 * (stageMode === "speak" ? 1 : 0.3);
      vx.strokeStyle = `hsla(${i % 6 === 0 ? A : B},${S}%,78%,${(0.16 + v * 0.5) * G})`; vx.lineWidth = W / (i % 6 === 0 ? 300 : 520);
      vx.beginPath(); vx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1); vx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2); vx.stroke();
    }
    vx.restore();

    // orbiting arcs: always turning, faster when thinking
    const spin = stageMode === "think" ? 3.2 : 1;
    [[1.42, 0.9, 0.55, A], [1.55, -0.65, 0.35, B], [1.3, 0.45, 0.22, (A + 40) % 360]].forEach(([rr, dir, len, h], k) => {
      const a0 = (t / 2600) * dir * M.speed * spin + k * 2.1;
      vx.strokeStyle = `hsla(${h},${S}%,74%,${(stageMode === "think" ? 0.85 : 0.4) * G})`; vx.lineWidth = W / (k === 0 ? 170 : 260); vx.lineCap = "round";
      vx.beginPath(); vx.arc(cx, cy, R * rr, a0, a0 + Math.PI * len); vx.stroke();
    });

    // listening: mint waves drawing in toward the ring, and the ring itself follows his voice
    if (stageMode === "listen") {
      const room = roomLevel();
      for (let k = 0; k < 3; k++) {
        const ph = ((t / 1400) + k / 3) % 1;                  // each wave travels inward from the outside
        const rr = R * (2.3 - ph * 1.15);
        vx.strokeStyle = `hsla(${155 + k * 12},85%,72%,${Math.sin(ph * Math.PI) * (0.35 + room * 0.5)})`;
        vx.lineWidth = W / (230 - room * 90);
        vx.beginPath(); vx.arc(cx, cy, rr, 0, Math.PI * 2); vx.stroke();
      }
      const g2 = vx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.6);
      g2.addColorStop(0, `hsla(160,90%,65%,${0.18 + room * 0.35})`); g2.addColorStop(1, "hsla(160,90%,60%,0)");
      vx.fillStyle = g2; vx.beginPath(); vx.arc(cx, cy, R * 1.6, 0, Math.PI * 2); vx.fill();
    }
    // the voice: bars around the ring while speaking (listening shows the room, gently)
    if (stageMode === "speak" || stageMode === "listen") {
      const N = 120;
      for (let i = 0; i < N; i++) {
        const half = i < N / 2 ? i : N - 1 - i;
        const v = freq[(half * 7) % 90 + 3] / 255 * (stageMode === "listen" ? 0.6 : 1);
        const a = (i / N) * Math.PI * 2 - Math.PI / 2 + t / 9000;
        const r1 = R * 1.13, r2 = r1 + W * 0.008 + v * W * 0.15;
        const g = vx.createLinearGradient(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        g.addColorStop(0, `hsla(${A + v * 40},${S}%,70%,${0.3 + v * 0.6})`); g.addColorStop(1, `hsla(${B},${S}%,75%,0)`);
        vx.strokeStyle = g; vx.lineWidth = W / 210;
        vx.beginPath(); vx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); vx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); vx.stroke();
      }
    }

    // the living ring: three layered, shifting outlines
    for (let k = 2; k >= 0; k--) {
      blob(cx, cy, R * (1.04 + k * 0.07), t, k * 1.9, 1 + k * 0.6, live && k === 0);
      vx.strokeStyle = `hsla(${lerpHue(A, B, k / 2)},${S}%,${80 - k * 8}%,${(0.62 - k * 0.17 + level * 0.3) * G})`;
      vx.lineWidth = W / (k === 0 ? 260 : 420);
      if (k === 0) { vx.shadowColor = `hsla(${A},${S}%,70%,.9)`; vx.shadowBlur = 16 * G; }
      vx.stroke(); vx.shadowBlur = 0;
    }

    // sparks drifting in orbit; more of them when the mood is lively
    const nS = Math.round(SPARKS.length * Math.min(1, M.spark / 2.6));
    for (let i = 0; i < nS; i++) {
      const s = SPARKS[i];
      s.a += 0.0016 * s.s * M.speed * (1 + level * 4);
      const r = R * (1.55 + s.r * (1 + level)), x = cx + Math.cos(s.a) * r, y = cy + Math.sin(s.a) * r * 0.92;
      const tw = 0.5 + 0.5 * Math.sin(t / 400 + s.on * 20);
      vx.fillStyle = `hsla(${lerpHue(A, B, s.z)},${S}%,82%,${(0.2 + s.z * 0.5) * tw * G})`;
      vx.beginPath(); vx.arc(x, y, W / 480 + s.z * W / 340, 0, Math.PI * 2); vx.fill();
    }

    // the core: a glassy orb with light swirling inside
    const rc = R * (0.9 + level * 0.1);
    blob(cx, cy, rc, t * 0.7, 4.2, 0.5, false);
    const core = vx.createRadialGradient(cx - rc * 0.35, cy - rc * 0.4, rc * 0.05, cx, cy, rc * 1.05);
    core.addColorStop(0, `hsl(${A - 25},100%,${88 * Math.min(1, 0.7 + G * 0.3)}%)`); core.addColorStop(0.35, `hsl(${A},${S}%,${60 * G}%)`); core.addColorStop(0.75, `hsl(${B},${S * 0.85}%,${38 * G}%)`); core.addColorStop(1, `hsl(${B + 10},${S * 0.8}%,16%)`);
    vx.fillStyle = core; vx.fill();
    vx.save(); blob(cx, cy, rc, t * 0.7, 4.2, 0.5, false); vx.clip();
    for (let k = 0; k < 3; k++) {
      const a = t / ((2600 + k * 700) / M.speed) + k * 2.1;
      const px = cx + Math.cos(a) * rc * 0.45, py = cy + Math.sin(a) * rc * 0.45;
      const g = vx.createRadialGradient(px, py, 0, px, py, rc * 0.7);
      g.addColorStop(0, `hsla(${(A + 40 + k * 25) % 360},95%,75%,${(0.16 + level * 0.3) * G})`); g.addColorStop(1, "hsla(0,0%,0%,0)");
      vx.fillStyle = g; vx.fillRect(cx - rc * 1.3, cy - rc * 1.3, rc * 2.6, rc * 2.6);
    }
    vx.restore();
    const sheen = vx.createLinearGradient(cx - rc, cy - rc, cx + rc, cy + rc);
    const sp = (Math.sin(t / 1400) + 1) / 2;
    sheen.addColorStop(Math.max(0, sp - 0.15), "rgba(255,255,255,0)"); sheen.addColorStop(sp, `rgba(255,255,255,${0.16 * G})`); sheen.addColorStop(Math.min(1, sp + 0.15), "rgba(255,255,255,0)");
    vx.fillStyle = sheen; vx.beginPath(); vx.arc(cx, cy, rc, 0, Math.PI * 2); vx.fill();

    vizRaf = requestAnimationFrame(drawViz);
  }
  vizRaf = requestAnimationFrame(drawViz);   // alive from the moment the page opens

  /* ================================================================ speaking (fetched ahead, played through the chain) */
  let speaking = false, speakQueue = Promise.resolve(), current = null;
  const pending = new Map();
  // voice opts: { speed, tone } — the morning asks for "soothing"; otherwise the server picks the tone of the hour
  const vkey = (text, v = {}) => `${v.speed ?? ""}|${v.tone ?? ""}|${text}`;
  function prefetch(text, v = {}) {
    const k = vkey(text, v);
    if (!pending.has(k)) pending.set(k, api("/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, speed: v.speed, tone: v.tone }), signal: AbortSignal.timeout(25_000) }).then((r) => r.blob()));
    return pending.get(k);
  }
  function speak(text, chip, bus = "general", v = {}) { prefetch(text, v).catch(() => {}); speakQueue = speakQueue.then(() => speakOne(text, chip, bus, v)).catch(() => {}); return speakQueue; }
  // Tune in (listening to calls in the headset) ignores Dayspring's own voice and music: tell it when they start and stop
  function tuneIn(on, ms, kind = "voice") { post("/tunein/speaking", { on, kind, ...(ms ? { ms: Math.round(ms) } : {}) }).catch(() => {}); }
  let lastSaid = null;      // { text, v } — "say that again"
  async function speakOne(text, chip, bus = "general", v = {}) {
    if (!text) return;
    lastSaid = { text, v };
    noteOwnSpeech(text);
    stateSince = Date.now();
    speaking = true; setMic("speak", "Speaking…"); pauseListening(); duck(true);
    tuneIn(true, 1500 + text.length * 75);
    setMood(moodFor(text, v.tone));
    stage("speak", text, chip ?? null);
    try {
      const blob = await prefetch(text, v);
      pending.delete(vkey(text, v));
      // an empty answer means "free voices": the page speaks for itself
      if (!blob.size) throw Object.assign(new Error("browser voice"), { browserVoice: true });
      const url = URL.createObjectURL(blob);
      usingFallbackVoice = false;
      await new Promise((resolve, reject) => {
        // never wait forever on a clip: its length plus 4 s (or ~70 ms a letter before it knows its length)
        let guard = setTimeout(() => { try { current?.pause(); } catch { /* gone */ } resolve(); }, Math.min(90_000, 8000 + text.length * 90));
        const done = () => { clearTimeout(guard); resolve(); };
        current = new Audio(url);
        current.onloadedmetadata = () => { if (isFinite(current.duration)) { tuneIn(true, current.duration * 1000 + 300); clearTimeout(guard); guard = setTimeout(() => { try { current?.pause(); } catch { /* gone */ } resolve(); }, current.duration * 1000 + 4000); } };
        try { const ctx = audioCtx(); ctx.createMediaElementSource(current).connect((CH[bus] ?? CH.general).voice); } catch { /* plays direct */ }
        current.onended = done; current.onerror = (e) => { clearTimeout(guard); reject(e); };
        current.onplay = () => followCaption(current);
        current.play().catch(reject);
      });
      URL.revokeObjectURL(url);
    } catch (e) {
      pending.delete(vkey(text, v));
      if (e && e.name === "NotAllowedError") { needStart(text); return; }
      usingFallbackVoice = true;
      if (!e?.browserVoice) dlog("error", { where: "tts", error: String(e?.message ?? e).slice(0, 200), fallback: "browser voice" });
      await browserSpeak(text, v);
    } finally {
      current = null; speaking = false;
      tuneIn(false);
      await sleep(250);
      stage(mode === "command" ? "listen" : "off");
      if (mode !== "command") duck(false);
      resumeListening();
    }
  }
  // ---- free voices: the ones built into the browser (Edge's "Online (Natural)" voices sound best) ----
  let sysVoices = [];
  function loadVoices() { sysVoices = window.speechSynthesis?.getVoices?.() ?? []; return sysVoices; }
  if (window.speechSynthesis) { loadVoices(); speechSynthesis.onvoiceschanged = () => { loadVoices(); dlog("voices", { count: sysVoices.length, english: sysVoices.filter((x) => /^en/i.test(x.lang)).length, natural: sysVoices.filter((x) => /natural|online|neural/i.test(x.name)).map((x) => x.name).slice(0, 12) }); }; }
  const isNatural = (v) => /natural|online|neural|google/i.test(v.name);
  // the voice he picked, else the best English one available (natural first)
  function pickSysVoice(name = prefs.browserVoice) {
    const vs = sysVoices.length ? sysVoices : loadVoices();
    if (name) { const exact = vs.find((x) => x.name === name) ?? vs.find((x) => x.name.toLowerCase().includes(String(name).toLowerCase())); if (exact) return exact; }
    const en = vs.filter((x) => /^en[-_]US/i.test(x.lang)).concat(vs.filter((x) => /^en/i.test(x.lang)));
    return en.find(isNatural) ?? en[0] ?? vs[0] ?? null;
  }
  // time-of-day tone → how fast and how high
  const TONE_VOICE = { soothing: { rate: 0.9, pitch: 0.95 }, bright: { rate: 1.0, pitch: 1.02 }, chipper: { rate: 1.06, pitch: 1.1 }, warm: { rate: 0.97, pitch: 1.0 } };
  function browserSpeak(text, v = {}, { voiceName } = {}) {
    return new Promise((resolve) => {
      if (!window.speechSynthesis) return resolve();
      speechSynthesis.cancel();
      const voiceObj = pickSysVoice(voiceName);
      const tone = TONE_VOICE[v.tone] ?? TONE_VOICE[prefs.timeTone === false ? "bright" : (new Date().getHours() < 9 ? "soothing" : new Date().getHours() < 12 ? "bright" : new Date().getHours() < 17 ? "chipper" : "warm")];
      const rate = Math.max(0.6, Math.min(1.6, tone.rate * (v.speed ? v.speed / 0.95 : 1) + (prefs.speedAdj ?? 0)));
      // sentence by sentence: Chrome silently stops long utterances, and short ones keep the captions in step
      const parts = String(text).match(/[^.!?…]+[.!?…]*["”’)]*\s*/g)?.map((x) => x.trim()).filter(Boolean) ?? [String(text)];
      const words = [...$("#cap").children];
      let wordBase = 0, i = 0;
      const guard = setTimeout(() => { speechSynthesis.cancel(); resolve(); }, Math.min(120_000, 6000 + text.length * 110));
      const next = () => {
        if (i >= parts.length) { clearTimeout(guard); words.forEach((w) => w.classList.add("on")); return resolve(); }
        const part = parts[i++], u = new SpeechSynthesisUtterance(part);
        if (voiceObj) u.voice = voiceObj;
        u.rate = rate; u.pitch = tone.pitch; u.volume = Math.min(1, (prefs.volume ?? 80) / 80);
        const base = wordBase; wordBase += part.split(/\s+/).length;
        // light the caption word by word as it's spoken
        u.onboundary = (ev) => { if (ev.name && ev.name !== "word") return; const n = base + part.slice(0, ev.charIndex).split(/\s+/).filter(Boolean).length; words.forEach((w, k) => w.classList.toggle("on", k <= n)); };
        u.onend = next; u.onerror = next;
        speechSynthesis.speak(u);
      };
      next();
    });
  }
  function stopSpeaking() { if (current) { current.pause(); current.onended?.(); } window.speechSynthesis?.cancel(); }

  // Deliver something the server wants said, the way notifications are set: voice, chime or silent.
  async function notify(text, { sound = "motif", chip = null, bus = "notify", polite = true, voice = {} } = {}) {
    const m = prefs.mode;
    if (m === "silent") return;
    // Text only (he's on a call): shown, never spoken
    if (typeof textOnly !== "undefined" && textOnly) { push("ai", text); toast(chip?.title ?? "Dayspring", text.length > 120 ? text.slice(0, 117) + "…" : text, "", "bell"); return; }
    // Listen before speaking: people talking → wait for a natural pause; too long → apologise and go ahead.
    let said = text;
    if (polite && m === "voice") {
      const moment = await politeMoment();
      if (moment.mode === "timeout") said = "Hey, don't mean to interrupt anything if I did, but I need to let you know: " + text.replace(new RegExp("^(hey|hi|alright)( " + (config.ownerName || "there").replace(/[^\w ]/g, "") + ")?[,!.]?\\s*", "i"), "").replace(/^./, (c) => c.toLowerCase());
    }
    if (m === "voice") prefetch(said, voice).catch(() => {});   // fetch the voice while the chime plays
    playSound(m === "chime" ? "soft" : sound, bus);
    if (m === "voice") { await sleep(700); await speak(said, chip, bus, voice); }
  }

  /* ---------------- listening before speaking ---------------- */
  // A level meter on the mic (separate from speech recognition). Sustained, even sound — or anything Dayspring itself is
  // playing — counts as recorded audio: speak right away. Speech-like sound with the ups, downs and gaps of a real
  // conversation (and words the recogniser is picking up) counts as people talking: wait for a pause.
  let micAn = null, levels = [], lastHeard = 0, waitingToast = null;
  let micStream = null, micTimer = 0;
  // After "use my headset mic": the Windows default mic changed, so listen again from the new one.
  function restartMic() {
    try { micStream?.getTracks().forEach((t) => t.stop()); } catch { /* gone */ }
    clearInterval(micTimer); micAn = null; micStream = null;
    startMicMonitor();
    if (rec) { try { rec.abort(); } catch { /* restarts by itself in onend */ } }
  }
  async function startMicMonitor() {
    if (micAn || !navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } });
      micStream = stream;
      const ctx = audioCtx(), src = ctx.createMediaStreamSource(stream);
      micAn = ctx.createAnalyser(); micAn.fftSize = 1024; src.connect(micAn);
      const buf = new Float32Array(micAn.fftSize);
      micTimer = setInterval(() => {
        micAn.getFloatTimeDomainData(buf);
        let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const db = 10 * Math.log10(sum / buf.length + 1e-10);
        levels.push({ t: Date.now(), db, own: speaking });
        if (levels.length > 600) levels.shift();          // one minute at 10 per second
      }, 100);
    } catch { micAn = null; }                               // no mic: never wait
  }
  const floorDb = () => { const a = levels.filter((x) => !x.own).map((x) => x.db).sort((p, q) => p - q); return a.length ? a[Math.floor(a.length * 0.1)] : -80; };
  function hearing(seconds = 4) {
    const since = Date.now() - seconds * 1000, win = levels.filter((x) => x.t >= since && !x.own);
    if (win.length < 10) return "quiet";
    if (nowPlaying || P.playing) return "recorded";     // it's our own music or video
    const floor = floorDb(), active = win.map((x) => x.db > floor + 9);
    const ratio = active.filter(Boolean).length / active.length;
    if (ratio < 0.15) return "quiet";
    let gaps = 0, run = 0;                                  // silences of 0.3 s or more between sounds
    for (const a of active) { if (!a) run++; else { if (run >= 3) gaps++; run = 0; } }
    const act = win.filter((_, i) => active[i]).map((x) => x.db), mean = act.reduce((p, q) => p + q, 0) / (act.length || 1);
    const sd = Math.sqrt(act.reduce((p, q) => p + (q - mean) ** 2, 0) / (act.length || 1));
    const wordsLately = Date.now() - lastHeard < 3000;
    if (ratio > 0.85 && gaps === 0 && sd < 6) return "recorded";                 // steady, continuous: music or TV
    if ((gaps >= 2 && sd >= 5) || (wordsLately && gaps >= 1)) return "conversation";
    return ratio > 0.7 ? "recorded" : "conversation";
  }
  const silentFor = (ms) => { const since = Date.now() - ms, w = levels.filter((x) => x.t >= since && !x.own), f = floorDb(); return w.length >= ms / 120 && w.every((x) => x.db < f + 6); };
  async function politeMoment(maxMs = 45_000) {
    if (!micAn) return { mode: "clear" };
    const h = hearing();
    if (h !== "conversation") return { mode: h === "quiet" ? "clear" : "recorded" };
    waitingToast = toast("Waiting for a pause…", "Someone's talking. I'll jump in at a natural gap.", "", "bell");
    const t0 = Date.now();
    try {
      while (Date.now() - t0 < maxMs) { await sleep(250); if (silentFor(1100)) return { mode: "pause" }; }
      return { mode: "timeout" };
    } finally { waitingToast?.remove(); waitingToast = null; }
  }

  /* ---------------- the morning ---------------- */
  // Song first; ~30 s in it dips and the greeting comes, slowly; the song fades; then each part of time with God,
  // with room between them; then he answers (soft music, quiet, worship later) without the wake phrase.
  async function startMorning(item) {
    alarmOn = true; alarmStart = Date.now(); alarmItem = item; const run = ++morningRun; $("#snzOpts").hidden = true;
    $("#alarmTime").textContent = hm12(item.hm || new Date().toTimeString().slice(0, 5));
    $("#alarmText").textContent = item.greeting;
    const ov = $("#alarm"); ov.hidden = false; ov.style.animation = "none"; void ov.offsetWidth; ov.style.animation = "";
    wake(60 * 60_000);
    const slow = { tone: "soothing", speed: item.speed ?? 0.9 };
    [item.greeting, item.wish, ...item.segments].filter(Boolean).forEach((t) => prefetch(t, slow).catch(() => {}));
    // the wake song: his curated Spotify track, or YouTube, or (if neither plays) the soft alarm chime
    let src = null;
    if (item.song) {
      try {
        const r = await post("/morning/music", {});
        if (r.provider === "spotify") { src = "spotify"; $("#alarmText").textContent = `♪ ${r.title}${r.artist ? " · " + r.artist : ""}`; }
        else if (r.provider === "youtube" && r.cmd) { src = "youtube"; playMedia(r.cmd); }
      } catch { /* no music: the chime below */ }
    }
    if (!src) { const ring = () => onBus("notify", () => SOUNDS.alarm(), { alarm: true }); ring(); alarmLoop = setInterval(() => { if (!speaking) ring(); }, 6000); }
    await sleep((item.lead ?? 20) * 1000);
    if (run !== morningRun) return;                      // snoozed
    clearInterval(alarmLoop);
    // the music dips, and the greeting and a good-day wish come in softly over it
    if (src) await fadeMusic(src, 0.2, 2500);
    if (run !== morningRun) return;
    $("#alarmText").textContent = item.greeting;
    const mcat = item.segmentTitle === "Your morning" ? "home" : "faith";
    await speak(item.greeting, { title: "Good morning", category: mcat }, "notify", slow);
    if (item.wish) { await sleep(500); await speak(item.wish, { title: "Good morning", category: mcat }, "notify", slow); }
    $("#alarm").hidden = true; alarmOn = false;
    if (src) {
      // back to full for a whole minute of the song, then it fades away
      await fadeMusic(src, 1, 3000);
      await sleep((item.hold ?? 60) * 1000);
      await fadeMusic(src, 0, 5000, { stop: true });
    }
    for (const sg of item.segments) { await sleep(900); await speak(sg, { title: item.segmentTitle ?? "Time with God", category: mcat }, "notify", slow); }
    openCommandWindow(60_000);
  }
  /* ================================================================ the player: YouTube and Spotify, one set of controls */
  // What's playing (P.source):
  //   "youtube"        — embedded right here (the video, or music with the picture hidden)
  //   "spotify"        — Spotify inside Dayspring: this page is a Spotify device called "Dayspring" (Web Playback SDK)
  //   "spotify-window" — the older fallback: Spotify's web player in the hidden media window (fewer controls)
  // The music card, the video's own controls, the keyboard, voice/typing and the AI all go through ctl().
  const P = { source: null, title: "", artist: "", art: "", playing: false, pos: 0, dur: 0, at: 0, shuffle: false, repeat: "off", rate: 1, rates: [1], video: false, playlist: false, videoId: null, lastVol: 60 };
  const volKey = () => (P.source === "youtube" && P.video ? "videoVolume" : "musicVolume");
  const levelOf = (k) => Math.max(0, Math.min(100, Number(prefs[k] ?? (k === "videoVolume" ? prefs.musicVolume : undefined) ?? 100)));
  const musicVol = () => levelOf(volKey());
  const ytFull = () => Math.round(85 * musicVol() / 100);
  const posNow = () => (P.source === "youtube" && yt?.getCurrentTime ? yt.getCurrentTime() || 0 : P.playing ? Math.min(P.dur || Infinity, P.pos + ((Date.now() - P.at) / 1000) * (P.rate || 1)) : P.pos);
  const mmss = (x) => { x = Math.max(0, Math.floor(x || 0)); const h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60), sec = String(x % 60).padStart(2, "0"); return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`; };
  const nearest = (arr, x) => arr.reduce((b, r) => (Math.abs(r - x) < Math.abs(b - x) ? r : b), arr[0]);
  const IC = {
    play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4.2" height="14" rx="1.2"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.2"/></svg>',
    prev: '<svg viewBox="0 0 24 24"><rect x="5" y="5" width="2.6" height="14" rx="1"/><path d="M19 6.2v11.6a1 1 0 0 1-1.55.83L9.2 12.83a1 1 0 0 1 0-1.66l8.25-5.8A1 1 0 0 1 19 6.2z"/></svg>',
    next: '<svg viewBox="0 0 24 24"><rect x="16.4" y="5" width="2.6" height="14" rx="1"/><path d="M5 6.2v11.6a1 1 0 0 0 1.55.83l8.25-5.8a1 1 0 0 0 0-1.66L6.55 5.37A1 1 0 0 0 5 6.2z"/></svg>',
    shuffle: '<svg viewBox="0 0 24 24"><path d="M17 3l4 4-4 4V8h-2.2c-1.4 0-2.3.6-3.1 1.8l-1.1 1.7-1.2-1.8.6-.9C11.2 7 12.7 6 14.8 6H17V3zM3 6h3.2c2 0 3.6 1 4.8 2.8l2.4 3.6c.8 1.2 1.7 1.6 3.1 1.6H17v-3l4 4-4 4v-3h-2.5c-2.1 0-3.6-.9-4.8-2.7l-2.4-3.6C6.5 8.6 5.6 8 4.2 8H3V6zm0 10h1.2c1.4 0 2.3-.6 3.1-1.8l.6-.9 1.2 1.8-.2.3C7.7 17.1 6.2 18 4.2 18H3v-2z"/></svg>',
    repeat: '<svg viewBox="0 0 24 24"><path d="M17 2l4 4-4 4V7H7a2 2 0 0 0-2 2v2H3V9a4 4 0 0 1 4-4h10V2zM7 22l-4-4 4-4v3h10a2 2 0 0 0 2-2v-2h2v2a4 4 0 0 1-4 4H7v3z"/></svg>',
    repeat1: '<svg viewBox="0 0 24 24"><path d="M17 2l4 4-4 4V7H7a2 2 0 0 0-2 2v2H3V9a4 4 0 0 1 4-4h10V2zM7 22l-4-4 4-4v3h10a2 2 0 0 0 2-2v-2h2v2a4 4 0 0 1-4 4H7v3z"/><path d="M11 10.3l1.8-1h1.2v5.8h-1.5v-4.1l-1.5.8z"/></svg>',
    vol: '<svg viewBox="0 0 24 24"><path d="M4 9h3.5L12 5v14l-4.5-4H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1zm11.5-.9a5 5 0 0 1 0 7.8l-1.3-1.5a3 3 0 0 0 0-4.8zm2.6-3a9 9 0 0 1 0 13.8l-1.3-1.5a7 7 0 0 0 0-10.8z"/></svg>',
    mute: '<svg viewBox="0 0 24 24"><path d="M4 9h3.5L12 5v14l-4.5-4H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1zm11.3.7 1.4-1.4 2.3 2.3 2.3-2.3 1.4 1.4-2.3 2.3 2.3 2.3-1.4 1.4-2.3-2.3-2.3 2.3-1.4-1.4 2.3-2.3z"/></svg>',
    video: '<svg viewBox="0 0 24 24"><rect x="2.5" y="5" width="14" height="14" rx="2.5"/><path d="M17.5 10.5 22 7.5v9l-4.5-3z"/></svg>',
    audio: '<svg viewBox="0 0 24 24"><path d="M9 17.5V6.3a1 1 0 0 1 .78-.98l9-2A1 1 0 0 1 20 4.3v11.2a3 3 0 1 1-2-2.83V7.55l-7 1.56v8.39a3 3 0 1 1-2-2.83z"/></svg>',
    full: '<svg viewBox="0 0 24 24"><path d="M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zM4 14h2v4h4v2H4v-6zm14 0h2v6h-6v-2h4v-4z"/></svg>',
    unfull: '<svg viewBox="0 0 24 24"><path d="M8 4h2v6H4V8h4V4zm6 0h2v4h4v2h-6V4zM4 14h6v6H8v-4H4v-2zm10 0h6v2h-4v4h-2v-6z"/></svg>',
    back10: '<svg viewBox="0 0 24 24"><path d="M12 4V1L7 5l5 4V6a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/><text x="12" y="15.6" font-size="6.4" text-anchor="middle" font-family="sans-serif" font-weight="700">10</text></svg>',
    fwd10: '<svg viewBox="0 0 24 24"><path d="M12 4V1l5 4-5 4V6a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z"/><text x="12" y="15.6" font-size="6.4" text-anchor="middle" font-family="sans-serif" font-weight="700">10</text></svg>',
    stop: '<svg viewBox="0 0 24 24"><path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z"/></svg>',
    library: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="3" height="16" rx="1"/><rect x="8" y="4" width="3" height="16" rx="1"/><path d="M13.6 5.1l2.9-.8 4.2 15.4-2.9.8z"/></svg>',
  };
  window.dsIcons = IC;
  const BTN_ICON = { previous: "prev", next: "next", shuffle: "shuffle", back10: "back10", fwd10: "fwd10", stop: "stop", library: "library" };
  document.querySelectorAll("#npCtl [data-p], #vCtl [data-p]").forEach((b) => { const k = BTN_ICON[b.dataset.p]; if (k) b.innerHTML = IC[k]; });

  function renderPlayer() {
    const card = $("#np"), on = Boolean(P.source);
    card.hidden = !on;
    if (!on) return;
    const title = P.title || (P.source === "youtube" ? "YouTube" : "Spotify");
    if ($("#npTitle").textContent !== title) { card.classList.remove("swap"); void card.offsetWidth; card.classList.add("swap"); }
    $("#npTitle").textContent = title;
    $("#npArtist").textContent = P.artist || (P.playing ? "Playing" : "Paused");
    $("#npSource").textContent = P.source === "youtube" ? (P.video ? "YouTube" : "YouTube · music") : P.source === "spotify" ? "Spotify · in Dayspring" : "Spotify";
    card.classList.toggle("playing", P.playing);
    const img = $("#npArt");
    img.onerror = () => { img.removeAttribute("src"); img.classList.add("none"); card.style.setProperty("--npbg", "none"); };
    if (P.art) { if (img.getAttribute("src") !== P.art) { img.classList.remove("none"); img.src = P.art; card.style.setProperty("--npbg", `url("${P.art}")`); } }
    else { img.removeAttribute("src"); img.classList.add("none"); card.style.setProperty("--npbg", "none"); }
    const win = P.source === "spotify-window";
    $("#npSeek").closest(".pbar").hidden = win;
    for (const id of ["#npPlay", "#vPlay"]) { const b = $(id); b.innerHTML = P.playing ? IC.pause : IC.play; b.title = P.playing ? "Pause (Space)" : "Play (Space)"; b.setAttribute("aria-label", P.playing ? "Pause" : "Play"); }
    const shufOk = P.source === "spotify" || (P.source === "youtube" && P.playlist);
    $("#npShuf").hidden = !shufOk; $("#npShuf").classList.toggle("on", P.shuffle); $("#npShuf").setAttribute("aria-pressed", String(P.shuffle)); $("#npShuf").title = P.shuffle ? "Shuffle: on" : "Shuffle: off";
    $("#npRep").hidden = win; $("#npRep").innerHTML = P.repeat === "track" ? IC.repeat1 : IC.repeat; $("#npRep").classList.toggle("on", P.repeat !== "off"); $("#npRep").setAttribute("aria-pressed", String(P.repeat !== "off"));
    $("#npRep").title = { off: "Repeat: off", context: "Repeat: all", track: "Repeat: this one" }[P.repeat] ?? "Repeat";
    const yt1 = P.source === "youtube";
    $("#npVid").hidden = !yt1; $("#npVid").innerHTML = P.video ? IC.audio : IC.video; $("#npVid").title = P.video ? "Music only: hide the picture" : "Show the video";
    $("#vAudio").innerHTML = P.video ? IC.audio : IC.video; $("#vAudio").title = P.video ? "Music only: hide the picture" : "Show the picture";
    const nx = yt1 ? videoNextInfo() : null;
    // "Next: …" — always visible on the card when something is lined up; click for the whole queue
    const upn = P.source === "spotify" ? P.upNext?.[0] : nx;
    $("#npNext").hidden = !upn;
    if (upn) $("#npNext").innerHTML = `<b>Next</b>${esc(upn.title || "Video")}${upn.artist ? " · " + esc(upn.artist) : upn.channel ? " · " + esc(upn.channel) : ""}`;
    $("#vNext").hidden = !(yt1 && (P.playlist || nx)); $("#vPrev").hidden = !(yt1 && (P.playlist || VH.i > 0));
    const v = musicVol();
    for (const id of ["#npVol", "#vVol"]) { const r = $(id); if (document.activeElement !== r) r.value = v; r.style.setProperty("--pct", v + "%"); }
    document.querySelectorAll(".pvol .vi").forEach((i) => (i.innerHTML = v === 0 ? IC.mute : IC.vol));
    const box = $("#media");
    $("#vFull").innerHTML = box.classList.contains("full") ? IC.unfull : IC.full;
    box.classList.toggle("paused", yt1 && !P.playing);
    $("#vTitle").textContent = yt1 ? P.title : "";
    if (yt1 && $("#vRate").dataset.for !== P.rates.join()) { $("#vRate").dataset.for = P.rates.join(); $("#vRate").innerHTML = P.rates.map((r) => `<option value="${r}">${r === 1 ? "Normal" : r + "×"}</option>`).join(""); }
    if (yt1) $("#vRate").value = String(nearest(P.rates, P.rate));
    renderTimes();
    window.dsLibrary?.onPlayer?.();
  }
  function renderTimes() {
    if (!P.source) return;
    const pos = posNow(), dur = P.dur || 0, pct = dur ? Math.min(100, (pos / dur) * 100) : 0;
    for (const [sk, a, b] of [["#npSeek", "#npPos", "#npDur"], ["#vSeek", "#vPos", "#vDur"]]) {
      const r = $(sk);
      if (!r.dataset.drag) { r.value = Math.round(pct * 10); r.style.setProperty("--pct", pct + "%"); }
      $(a).textContent = mmss(r.dataset.drag ? (r.value / 1000) * dur : pos);
      $(b).textContent = dur ? mmss(dur) : "–:––";
    }
  }
  setInterval(() => { if (P.source) { if (P.source === "youtube") ytTick(); renderTimes(); } }, 500);
  function clearPlayer() { P.source = null; P.playing = false; renderPlayer(); reportState(); }
  let lastReport = 0, reportTimer = 0, musicOn = false;
  function reportState() {
    clearTimeout(reportTimer);
    const on = Boolean(P.source && P.playing);
    if (on !== musicOn) { musicOn = on; tuneIn(on, 0, "music"); }       // Tune in's echo guard: our own music is playing (or stopped)
    const send = () => { lastReport = Date.now(); post("/player/state", P.source ? { source: P.source, title: P.title, artist: P.artist, playing: P.playing, position: Math.round(posNow()), duration: Math.round(P.dur), volume: musicVol(), shuffle: P.shuffle, repeat: P.repeat, rate: P.rate, video: P.video, videoId: P.videoId } : {}).catch(() => {}); };
    if (Date.now() - lastReport > 1500) send(); else reportTimer = setTimeout(send, 1500);
  }

  // ---- videos: a history to go back and forth through (resuming where you left off), and an up-next queue ----------
  // Each item: { videoId, playlistId, title, channel, audioOnly }. Kept in this browser (last 50), never on a server.
  const VH = { list: [], i: -1 }, VQ = [], VPOS = {};
  let vOthers = [];                                        // the next-best search results for what's playing now
  try { const h = JSON.parse(localStorage.getItem("ds-video-history") ?? "null"); if (h?.list) { VH.list = h.list.slice(-50); VH.i = VH.list.length - 1; Object.assign(VPOS, h.pos ?? {}); } } catch { /* private window */ }
  try { VQ.push(...(JSON.parse(localStorage.getItem("ds-video-queue") ?? "[]") ?? []).slice(0, 100)); } catch { /* none */ }
  let vSaveAt = 0;
  function saveVideos(now = false) {
    if (!now && Date.now() - vSaveAt < 4000) return;
    vSaveAt = Date.now();
    const keep = new Set(VH.list.map((x) => x.videoId)); for (const k of Object.keys(VPOS)) if (!keep.has(k)) delete VPOS[k];
    try { localStorage.setItem("ds-video-history", JSON.stringify({ list: VH.list.slice(-50), pos: VPOS })); localStorage.setItem("ds-video-queue", JSON.stringify(VQ)); } catch { /* storage off */ }
  }
  const vItem = (x) => ({ videoId: x.videoId ?? null, playlistId: x.playlistId ?? null, title: x.title ?? "", channel: x.channel ?? "", audioOnly: Boolean(x.audioOnly) });
  function videoNextInfo() { return VH.i < VH.list.length - 1 ? VH.list[VH.i + 1] : VQ[0] ?? vOthers[0] ?? null; }
  function videoHistoryPush(cmd) {
    const it = vItem(cmd);
    if (VH.list[VH.i]?.videoId === it.videoId && VH.list[VH.i]?.playlistId === it.playlistId) return;
    VH.list = VH.list.slice(0, VH.i + 1).filter((x) => !(x.videoId && x.videoId === it.videoId)); VH.list.push(it);
    if (VH.list.length > 50) VH.list = VH.list.slice(-50);
    VH.i = VH.list.length - 1; saveVideos(true);
  }
  function playHistory(i) {
    if (i < 0 || i >= VH.list.length) return false;
    VH.i = i; const it = VH.list[i];
    playMedia({ action: "play", provider: "youtube", ...it, audioOnly: P.source === "youtube" ? !P.video : it.audioOnly }, { fromHistory: true });
    return true;
  }
  function queueVideo(x, { next = false } = {}) { const it = vItem(x); if (!it.videoId && !it.playlistId) return false; if (next) VQ.unshift(it); else VQ.push(it); saveVideos(true); renderPlayer(); return true; }
  function playNextVideo() {
    if (VH.i < VH.list.length - 1) return playHistory(VH.i + 1);
    const q = VQ.shift() ?? vOthers.shift();
    saveVideos(true);
    if (!q) return false;
    playMedia({ action: "play", provider: "youtube", ...q, audioOnly: P.source === "youtube" ? !P.video : q.audioOnly });
    return true;
  }
  window.dsVideos = {
    history: () => VH.list.map((x, i) => ({ ...x, i, current: i === VH.i, at: VPOS[x.videoId] ?? 0 })).reverse(),
    queue: () => VQ.map((x, i) => ({ ...x, i })),
    others: () => vOthers.slice(),
    playHistory, queue: queueVideo, playNext: playNextVideo,
    play: (x, { audioOnly = false } = {}) => playMedia({ action: "play", provider: "youtube", ...vItem(x), audioOnly }),
    remove: (i) => { VQ.splice(i, 1); saveVideos(true); renderPlayer(); },
    move: (from, to) => { const [x] = VQ.splice(from, 1); if (x) VQ.splice(Math.max(0, Math.min(VQ.length, to)), 0, x); saveVideos(true); },
    clear: () => { VQ.length = 0; saveVideos(true); renderPlayer(); },
    current: () => (P.source === "youtube" ? vItem({ ...VH.list[VH.i], title: P.title || VH.list[VH.i]?.title, videoId: P.videoId ?? VH.list[VH.i]?.videoId }) : null),
  };
  // keep window.dsVideos.queue as the list getter; queueing is .add
  window.dsVideos.queue = () => VQ.map((x, i) => ({ ...x, i }));
  window.dsVideos.add = queueVideo;

  // ---- YouTube on the Dayspring screen --------------------------------------------------------------------------------
  let yt = null, ytReady = false, nowPlaying = null, pendingPlay = null, lastRecorded = null;
  window.onYouTubeIframeAPIReady = () => { ytReady = true; if (pendingPlay) { const p = pendingPlay; pendingPlay = null; playMedia(p); } };
  (() => { const sc = document.createElement("script"); sc.src = "https://www.youtube.com/iframe_api"; document.head.appendChild(sc); })();

  function playMedia(cmd, { fromHistory = false } = {}) {
    if (!ytReady) { pendingPlay = cmd; return; }
    if (P.source === "spotify") sp?.pause().catch(() => {});
    if (P.source === "spotify-window") post("/player/window", { action: "pause" }).catch(() => {});
    if (P.source === "youtube" && P.videoId) VPOS[P.videoId] = posNow();
    nowPlaying = cmd;
    if (!fromHistory) videoHistoryPush(cmd);
    if (Array.isArray(cmd.others)) vOthers = cmd.others.map(vItem).filter((x) => x.videoId || x.playlistId);
    else if (!fromHistory) vOthers = [];
    const box = $("#media");
    box.hidden = false; box.className = "media " + (cmd.audioOnly ? "audio" : "video");
    $("#np2").textContent = cmd.title ? `♪ ${cmd.title}` : "";
    Object.assign(P, { source: "youtube", title: cmd.title ?? "", artist: cmd.channel || "YouTube", art: cmd.videoId ? `https://i.ytimg.com/vi/${cmd.videoId}/mqdefault.jpg` : "", playing: false, pos: 0, dur: 0, at: Date.now(),
      shuffle: Boolean(cmd.shuffle), repeat: "off", rate: 1, rates: [1], video: !cmd.audioOnly, playlist: Boolean(cmd.playlistId), videoId: cmd.videoId ?? null });
    renderPlayer(); showCtl();
    const start = cmd.videoId && VPOS[cmd.videoId] > 15 && fromHistory ? Math.floor(VPOS[cmd.videoId]) : 0;   // going back: pick up where they left off
    const vars = { autoplay: 1, controls: 0, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3, disablekb: 1, fs: 0, ...(start ? { start } : {}) };
    if (cmd.playlistId) Object.assign(vars, { listType: "playlist", list: cmd.playlistId });
    if (yt) { try { yt.destroy(); } catch { /* gone */ } yt = null; }
    if (!$("#yt")) $("#media").insertAdjacentHTML("afterbegin", '<div id="yt"></div>');
    yt = new YT.Player("yt", {
      ...(cmd.videoId ? { videoId: cmd.videoId } : {}), playerVars: vars,   // a playlist has no videoId: leave the key out (the player rejects an empty one)
      events: {
        onReady: (e) => {
          if (cmd.shuffle && cmd.playlistId) e.target.setShuffle(true);
          e.target.setVolume(ducked ? Math.min(12, ytFull()) : ytFull()); e.target.playVideo();
          P.rates = e.target.getAvailablePlaybackRates?.() ?? [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
          ytTick(true);
        },
        onPlaybackRateChange: () => ytTick(true),
        onStateChange: (e) => {
          if (e.data === YT.PlayerState.PLAYING) {
            const d = e.target.getVideoData();
            if (d?.video_id && d.video_id !== lastRecorded) { lastRecorded = d.video_id; $("#np2").textContent = `♪ ${d.title}`; post("/media/played", { id: d.video_id, title: d.title }).catch(() => {}); }
          }
          if (e.data === YT.PlayerState.ENDED && !P.playlist) {
            if (P.videoId) delete VPOS[P.videoId];
            if (P.repeat !== "off") { e.target.seekTo(0, true); e.target.playVideo(); }
            else if (VQ.length || VH.i < VH.list.length - 1) playNextVideo();       // the up-next queue carries on
            else stopMedia(false);
          }
          ytTick(true);
        },
        onError: (e) => {
          if (e.data === 101 || e.data === 150) { push("sys", "That one can't play here, opening it on YouTube instead."); post("/media/fallback", { videoId: cmd.videoId, playlistId: cmd.playlistId }).catch(() => {}); }
          else push("sys", "That video couldn't be played.");
          stopMedia(false);
        },
      },
    });
  }
  function ytTick(force = false) {
    if (!yt?.getPlayerState) return;
    const st = yt.getPlayerState(), d = yt.getVideoData?.() ?? {};
    const was = JSON.stringify([P.playing, P.title, Math.round(P.dur), P.rate, P.videoId]);
    P.playing = st === 1 || st === 3; P.pos = yt.getCurrentTime?.() || 0; P.at = Date.now(); P.dur = yt.getDuration?.() || 0; P.rate = yt.getPlaybackRate?.() || 1;
    if (d.title) P.title = d.title;
    if (d.author) P.artist = d.author;
    if (d.video_id && d.video_id !== P.videoId) { P.videoId = d.video_id; P.art = `https://i.ytimg.com/vi/${d.video_id}/mqdefault.jpg`; }
    if (P.videoId && P.pos > 5) { VPOS[P.videoId] = P.pos; const h = VH.list[VH.i]; if (h && h.videoId === P.videoId && !h.title && P.title) h.title = P.title; saveVideos(); }
    if (force || was !== JSON.stringify([P.playing, P.title, Math.round(P.dur), P.rate, P.videoId])) { renderPlayer(); reportState(); }
  }
  // YouTube only (keeps what the card shows): used when Spotify starts playing here
  function stopYT() {
    if (P.source === "youtube" && P.videoId) { VPOS[P.videoId] = posNow(); saveVideos(true); }
    if (yt) { try { yt.stopVideo(); yt.destroy(); } catch { /* gone */ } yt = null; }
    if (!$("#yt")) $("#media").insertAdjacentHTML("afterbegin", '<div id="yt"></div>');
    const box = $("#media"); box.hidden = true; box.classList.remove("full", "showctl", "paused");
    nowPlaying = null;
  }
  function stopMedia(tell = true) {
    stopYT();
    if (P.source === "spotify") sp?.pause().catch(() => {});
    clearPlayer();
    if (tell) post("/media/stop").catch(() => {});
  }

  // ---- Spotify inside Dayspring (Web Playback SDK) ----------------------------------------------------------------------
  // Once the owner connects Spotify (Settings, or "sign in to Spotify"), this page registers as a Spotify device called
  // "Dayspring" and music plays right here. Spotify's own frame does the playing, so its sound follows the Windows default
  // output, not the speaker choice for Dayspring's voice.
  let sp = null, spDevice = null, spStarting = false;
  async function initSpotify() {
    if (sp || spStarting) return;
    if (navigator.webdriver && !window.Spotify) return;            // automated checks never touch the owner's Spotify
    let st; try { st = await json("/player/status"); } catch { return; }
    if (!st.spotify?.signedIn) return;
    spStarting = true;
    window.onSpotifyWebPlaybackSDKReady = () => {
      sp = new Spotify.Player({ name: "Dayspring", volume: (ducked ? 0.14 : 1) * musicVol() / 100,
        getOAuthToken: (cb) => { json("/player/spotify/token").then((r) => r.token && cb(r.token)).catch(() => {}); } });
      sp.addListener("ready", ({ device_id }) => { spDevice = device_id; post("/player/device", { deviceId: device_id }).catch(() => {}); dlog("spotify", { what: "ready" }); });
      sp.addListener("not_ready", () => { spDevice = null; post("/player/device", { deviceId: null }).catch(() => {}); });
      sp.addListener("player_state_changed", spState);
      sp.addListener("autoplay_failed", () => toast("Spotify", "Click anywhere on the screen once so music can play.", "wait"));
      for (const ev of ["initialization_error", "authentication_error", "account_error", "playback_error"]) sp.addListener(ev, ({ message }) => {
        dlog("spotify", { what: ev, message });
        if (ev === "account_error") toast("Spotify", "Playing inside Dayspring needs Spotify Premium.", "wait");
        else if (ev === "authentication_error") toast("Spotify", "Spotify needs you to sign in again. Say “sign in to Spotify”.", "wait");
        else if (ev === "initialization_error") toast("Spotify", "This browser can't play Spotify here. It needs Chrome or Edge.", "wait");
      });
      sp.connect();
    };
    if (window.Spotify) window.onSpotifyWebPlaybackSDKReady();
    else { const sc = document.createElement("script"); sc.src = "https://sdk.scdn.co/spotify-player.js"; document.head.appendChild(sc); }
  }
  function spState(st) {
    if (!st) { if (P.source === "spotify") { P.pos = posNow(); P.playing = false; renderPlayer(); reportState(); } return; }
    const t = st.track_window?.current_track;
    if (!st.paused && P.source === "youtube") stopYT();
    if (!st.paused && P.source === "spotify-window") post("/player/window", { action: "pause" }).catch(() => {});
    if (P.source && P.source !== "spotify" && st.paused) return;      // a paused Spotify doesn't take the card away from YouTube
    Object.assign(P, { source: "spotify", title: t?.name ?? "", artist: (t?.artists ?? []).map((a) => a.name).join(", ") || t?.show?.name || "", art: t?.album?.images?.[0]?.url ?? "",
      playing: !st.paused, pos: st.position / 1000, dur: st.duration / 1000, at: Date.now(), shuffle: Boolean(st.shuffle), repeat: ["off", "context", "track"][st.repeat_mode] ?? "off", rate: 1, video: false, playlist: false, videoId: null, uri: t?.uri ?? null });
    P.upNext = (st.track_window?.next_tracks ?? []).map((x) => ({ title: x.name, artist: (x.artists ?? []).map((a) => a.name).join(", "), uri: x.uri }));
    renderPlayer(); reportState();
  }

  // ---- controls ---------------------------------------------------------------------------------------------------------
  // Every control goes through here. Returns a short line to show (or "" when there's nothing to say).
  async function ctl(a, v) {
    const src = P.source;
    if (!src) return a === "stop" ? "" : "Nothing's playing right now.";
    const yt1 = src === "youtube" && yt, spot = src === "spotify" && sp, win = src === "spotify-window";
    const winCtl = (action, value) => post("/player/window", { action, value });
    switch (a) {
      case "toggle": return ctl(P.playing ? "pause" : "resume");
      case "pause":
        if (yt1) yt.pauseVideo(); else if (spot) await sp.pause(); else if (win) await winCtl("pause");
        P.pos = posNow(); P.playing = false; P.at = Date.now(); break;
      case "resume": case "play":
        if (yt1) yt.playVideo(); else if (spot) await sp.resume(); else if (win) await winCtl("resume");
        P.playing = true; P.at = Date.now(); break;
      case "next":
        if (yt1) { if (P.playlist) yt.nextVideo(); else if (!playNextVideo()) return "There's nothing lined up after this video."; }
        else if (spot) await sp.nextTrack(); else await winCtl("next");
        break;
      case "previous":
        if (yt1) { if (P.playlist) { if (posNow() > 5) yt.seekTo(0, true); else yt.previousVideo(); } else if (VH.i > 0) playHistory(VH.i - 1); else { yt.seekTo(0, true); return "That's the first video. Starting it over."; } }
        else if (spot) { if (posNow() > 5) await sp.seek(0); else await sp.previousTrack(); }
        else await winCtl("previous");
        break;
      case "historyBack": if (yt1 || VH.list.length) { if (!playHistory(VH.i - 1)) return "There's no earlier video."; } break;
      case "historyForward": if (!(VH.i < VH.list.length - 1 && playHistory(VH.i + 1))) return playNextVideo() ? "" : "There's nothing after this one."; break;
      case "restart": return ctl("seek", 0);
      case "seek": case "seekBy": case "back10": case "fwd10": {
        if (win) return "I can't jump around in that one. Connect Spotify in Settings for full control.";
        let tt = a === "seek" ? Number(v) : posNow() + (a === "back10" ? -10 : a === "fwd10" ? 10 : Number(v));
        tt = Math.max(0, P.dur ? Math.min(P.dur - 1, tt) : tt);
        if (yt1) yt.seekTo(tt, true); else if (spot) await sp.seek(Math.round(tt * 1000));
        P.pos = tt; P.at = Date.now(); renderTimes(); break;
      }
      case "volume": case "volumeBy": case "mute": case "unmute": {
        const cur = musicVol();
        const n = a === "volume" ? Number(v) : a === "volumeBy" ? cur + Number(v) : a === "mute" ? (cur > 0 ? 0 : P.lastVol || 60) : P.lastVol || 60;
        if (cur > 0) P.lastVol = cur;
        await setMusicVolume(n); break;
      }
      case "shuffle": {
        const want = v === undefined || v === null ? !P.shuffle : Boolean(v);
        if (yt1) { if (!P.playlist) return "Shuffle works on playlists."; yt.setShuffle(want); }
        else if (spot) await post("/player/spotify/api", { action: "shuffle", value: want });
        else return "I can't shuffle that one. Connect Spotify in Settings for full control.";
        P.shuffle = want; break;
      }
      case "repeat": {
        const order = ["off", "context", "track"];
        const mode = order.includes(v) ? v : v === true ? "context" : v === false ? "off" : order[(order.indexOf(P.repeat) + 1) % 3];
        if (yt1) { if (P.playlist) yt.setLoop(mode !== "off"); }            // a single video repeats by starting over at the end
        else if (spot) await post("/player/spotify/api", { action: "repeat", value: mode });
        else return "I can't set repeat on that one.";
        P.repeat = mode; break;
      }
      case "speed": case "speedBy": {
        if (!yt1) return "Speed only changes for YouTube videos.";
        const rates = P.rates.length > 1 ? P.rates : [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
        const r = a === "speed" ? nearest(rates, Number(v)) : rates[Math.max(0, Math.min(rates.length - 1, rates.indexOf(nearest(rates, P.rate)) + Math.sign(Number(v) || 1)))];
        yt.setPlaybackRate(r); P.rate = r; P.pos = posNow(); P.at = Date.now(); break;
      }
      case "video": case "audio": {
        if (!yt1) return "There's no video with this one.";
        const show = a === "audio" ? !P.video : v === undefined || v === null ? !P.video : Boolean(v);
        P.video = show; const box = $("#media");
        box.classList.toggle("video", show); box.classList.toggle("audio", !show); if (!show) box.classList.remove("full");
        if (!ducked) try { yt.setVolume(ytFull()); } catch { /* gone */ }
        break;
      }
      case "full": {
        if (!yt1) return "";
        const box = $("#media"), on = v === undefined || v === null ? !box.classList.contains("full") : Boolean(v);
        if (on) { P.video = true; box.classList.add("video"); box.classList.remove("audio"); }
        box.classList.toggle("full", on); break;
      }
      case "stop": stopMedia(true); return "";
      default: return "";
    }
    renderPlayer(); reportState();
    return "";
  }
  let volTimer = 0;
  async function setMusicVolume(n) {
    n = Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
    const key = volKey();
    prefs[key] = n;
    if (!ducked) { try { yt?.setVolume?.(ytFull()); } catch { /* gone */ } if (key === "musicVolume") sp?.setVolume(n / 100).catch(() => {}); }
    if (P.source === "spotify-window") post("/player/window", { action: "volume", value: n }).catch(() => {});
    clearTimeout(volTimer); volTimer = setTimeout(() => post("/settings", { [key]: n }).catch(() => {}), 400);
    renderPlayer(); renderMixer();
  }

  // ---- the music card and the video's controls: mouse, touch, keyboard ----------------------------------------------------
  let clickT = 0, ctlT = 0;
  function showCtl() {
    const box = $("#media"); if (box.hidden) return;
    box.classList.add("showctl"); clearTimeout(ctlT);
    ctlT = setTimeout(() => { if (!box.querySelector(".vctl:focus-within")) box.classList.remove("showctl"); }, 3000);
  }
  for (const id of ["#np", "#media"]) $(id).addEventListener("click", (e) => {
    const b = e.target.closest("[data-p]"); if (!b) return;
    e.stopPropagation();
    const a = b.dataset.p;
    if (a === "library") { window.dsLibrary?.open(b.closest("#media") || P.source === "youtube" ? "videos" : "music"); return; }
    const act = a === "previous" && P.source === "youtube" && !P.playlist ? "previous" : a;
    ctl(act).then((msg) => { if (msg) toast("Player", msg, "", "bell"); });
    showCtl();
  });
  $("#np").addEventListener("click", (e) => e.stopPropagation());       // the card isn't a showcase panel
  $("#npNext").addEventListener("click", (e) => { e.stopPropagation(); window.dsLibrary?.open("queue"); });
  for (const id of ["#npSeek", "#vSeek"]) {
    const r = $(id);
    r.addEventListener("input", () => { r.dataset.drag = "1"; r.style.setProperty("--pct", r.value / 10 + "%"); renderTimes(); showCtl(); });
    r.addEventListener("change", () => { delete r.dataset.drag; if (P.dur) ctl("seek", (r.value / 1000) * P.dur); });
  }
  for (const id of ["#npVol", "#vVol"]) { const r = $(id); r.addEventListener("input", () => { r.style.setProperty("--pct", r.value + "%"); setMusicVolume(Number(r.value)); showCtl(); }); }
  $("#vRate").addEventListener("change", (e) => { ctl("speed", Number(e.target.value)); showCtl(); });
  $("#vClose").addEventListener("click", (e) => { e.stopPropagation(); ctl("stop"); });
  $("#vLayer").addEventListener("click", () => { clearTimeout(clickT); clickT = setTimeout(() => ctl("toggle"), 230); showCtl(); });
  $("#vLayer").addEventListener("dblclick", () => { clearTimeout(clickT); ctl("full"); });
  $("#media").addEventListener("pointermove", showCtl);
  $("#media").addEventListener("pointerdown", showCtl);
  // keys while a video is showing: Space/K play-pause, ←/→ 5 s, ↑/↓ volume, < > speed, F full screen, M mute, N/P next/previous, Esc close
  document.addEventListener("keydown", (e) => {
    const box = $("#media");
    if (box.hidden || P.source !== "youtube" || !P.video) return;
    if (!$("#calwrap").hidden || !$("#pagewrap").hidden || detailOpen() || window.dsLibrary?.isOpen?.()) return;
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName ?? "") && e.key !== "Escape") return;
    const k = e.key; let done = true;
    if (k === " " || k === "k" || k === "K") ctl("toggle");
    else if (k === "ArrowLeft") ctl("seekBy", -5);
    else if (k === "ArrowRight") ctl("seekBy", 5);
    else if (k === "ArrowUp") ctl("volumeBy", 5);
    else if (k === "ArrowDown") ctl("volumeBy", -5);
    else if (k === "<" || (k === "," && e.shiftKey)) ctl("speedBy", -1);
    else if (k === ">" || (k === "." && e.shiftKey)) ctl("speedBy", 1);
    else if (k === "f" || k === "F") ctl("full");
    else if (k === "m" || k === "M") ctl("mute");
    else if (k === "N") ctl("next");
    else if (k === "P") ctl("previous");
    else if (k === "Escape") { if (box.classList.contains("full")) ctl("full", false); else ctl("stop"); }
    else done = false;
    if (done) { e.preventDefault(); e.stopImmediatePropagation(); showCtl(); }
  }, true);

  // Glide the morning music's volume (1 = normal, 0 = silent). stop: pause or stop it once it's silent.
  async function fadeMusic(src, level, ms, { stop = false } = {}) {
    if (src === "spotify" && P.source === "spotify" && sp) {
      const from = await sp.getVolume().catch(() => musicVol() / 100), to = (musicVol() / 100) * level, steps = Math.max(1, Math.round(ms / 80));
      for (let i = 1; i <= steps; i++) { await sp.setVolume(from + (to - from) * (i / steps)).catch(() => {}); await sleep(80); }
      if (stop) { await sp.pause().catch(() => {}); await sp.setVolume(musicVol() / 100).catch(() => {}); clearPlayer(); }
      return;
    }
    if (src === "spotify") { await post("/media/fade", { level, ms, pause: stop }).catch(() => {}); return; }
    if (!yt || !yt.setVolume) return;
    const from = yt.getVolume?.() ?? ytFull(), to = Math.round(ytFull() * level), steps = Math.max(1, Math.round(ms / 60));
    for (let i = 1; i <= steps; i++) { try { yt.setVolume(Math.round(from + (to - from) * (i / steps))); } catch { break; } await sleep(60); }
    if (stop) stopMedia(false);
  }
  // Media volume glides down under the voice and back up after.
  let ducked = false, duckTimer = 0;
  function duck(on) {
    if (ducked === on) return;
    ducked = on;
    clearInterval(duckTimer);
    const fullYt = ytFull(), fullSp = musicVol() / 100, target = on ? 0.14 : 1;
    let k = on ? 1 : 0.14, tick = 0;
    duckTimer = setInterval(() => {
      k += (target - k) * 0.35; if (Math.abs(target - k) < 0.02) { k = target; clearInterval(duckTimer); }
      try { if (yt?.setVolume) yt.setVolume(Math.round(fullYt * k)); } catch { /* gone */ }
      if (sp && P.source === "spotify" && (tick++ % 2 === 0 || k === target)) sp.setVolume(fullSp * k).catch(() => {});
    }, 60);
    if (P.source === "spotify-window" || !on) post("/media/duck", { on }).catch(() => {});
  }

  // ---- music and video by voice or typing, answered right here (no AI needed) ----------------------------------------
  const NUMW = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90 };
  const numOf = (w) => { w = String(w ?? "").trim(); if (/^\d+(\.\d+)?$/.test(w)) return Number(w); let n = 0; for (const p of w.split(/[\s-]+/)) { if (NUMW[p] === undefined) return NaN; n += NUMW[p]; } return n; };
  const NW = "(\\d+(?:\\.\\d+)?|(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|ninety)(?:[\\s-](?:one|two|three|four|five|six|seven|eight|nine))?)";
  // "30 seconds", "a minute", "2 minutes 15", "1:30", "2 minutes and 15 seconds", "half a minute", "90 seconds" → seconds
  function secondsIn(x) {
    x = String(x).replace(/\band\b/g, " ").replace(/\s+/g, " ").trim();
    let m;
    if ((m = /\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/.exec(x))) return m[3] ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2];
    if (/\bhalf (a|an) minute\b/.test(x)) return 30;
    if (/\b(beginning|start|top)\b/.test(x)) return 0;
    if ((m = new RegExp(`${NW} ?(?:hours?|hrs?)\\b(?: ?${NW} ?(?:minutes?|mins?))?`).exec(x))) return numOf(m[1]) * 3600 + (m[2] ? numOf(m[2]) * 60 : 0);
    if ((m = new RegExp(`${NW} ?(?:minutes?|mins?)\\b(?: ?${NW}(?: ?(?:seconds?|secs?))?)?`).exec(x))) return numOf(m[1]) * 60 + (m[2] ? numOf(m[2]) : 0);
    if ((m = new RegExp(`${NW} ?(?:seconds?|secs?)\\b`).exec(x))) return numOf(m[1]);
    if ((m = /^(\d{1,4})$/.exec(x))) return Number(m[1]);
    return NaN;
  }
  const spokenLen = (x) => (x >= 60 ? `${Math.floor(x / 60)} minute${x >= 120 ? "s" : ""}${x % 60 ? ` ${Math.round(x % 60)} seconds` : ""}` : `${Math.round(x)} seconds`);
  function musicCommand(text) {
    let t = String(text).toLowerCase().replace(/[!?,]/g, "").replace(/\.(?!\d)/g, "").replace(/\s+/g, " ").trim()
      .replace(/^(please |can you |could you |hey |dayspring )+/, "").replace(/ (please|for me|now)$/, "");
    if (!P.source) return null;
    const isVid = P.source === "youtube", r = (say, speak = false) => ({ say, speak });
    const run = (a, v, say = "") => { ctl(a, v).then((msg) => { if (msg) push("ai", msg); }).catch((e) => push("sys", e.message)); return r(say); };
    let m;
    // what's playing
    if (/^(what('?s| is) (this|playing|this song|the song|that song|this video|this one)|what song is (this|that|playing)|who (sings|is singing|is this|sang) (this|that|it)|what am i (listening to|watching)|what('?s| is) this (song|video) called)$/.test(t)) {
      return r(P.title ? `This is ${P.title}${P.artist && !/^youtube/i.test(P.artist) ? ", by " + P.artist : ""}.` : "I'm not sure what this one is called.", true);
    }
    if (/^what('?s| is) (next|up next|coming up|after this)$/.test(t)) {
      if (P.source === "spotify") return r(P.upNext?.length ? `Next is ${P.upNext[0].title}${P.upNext[0].artist ? " by " + P.upNext[0].artist : ""}.` : "Nothing's lined up after this.", true);
      if (isVid) { const n = videoNextInfo(); return r(n ? `Next is ${n.title || "another video"}.` : "Nothing's lined up after this video.", true); }
    }
    // close / stop the video; hide or show the picture; full screen
    if (isVid && /^(close|exit|stop|end|quit|turn off)( the| this)? (video|youtube)$|^(close|exit) (it|that|this)$/.test(t)) return run("stop", undefined, "Closed.");
    if (isVid && /^(hide the (video|picture)|music only|audio only|just (the )?(audio|sound|music)|minimi[sz]e( the video| it)?)$/.test(t)) return run("video", false, "Music only.");
    if (isVid && /^(exit|leave|get out of) full ?screen$|^(make it )?smaller$/.test(t)) return run("full", false, "");
    if (isVid && /^(make (it|the video) )?(bigger|full ?screen)$|^(go |put it |make it )?full ?screen$|^full ?screen (the )?video$/.test(t)) return run("full", true, "");
    if (isVid && /^(show|bring back|open)( me)? the (video|picture)$/.test(t)) return run("video", true, "");
    // back and forth between videos
    if (isVid && /^(previous video|go back to the (last|previous) video|(play )?the (last|previous) video|the one before (that|this)|play the one before (that|this)|back a video)$/.test(t)) return run(VH.i > 0 ? "historyBack" : "previous", undefined, "");
    if (isVid && /^(next video|play the next video|the next one|skip (this|the) video|skip to the next video)$/.test(t)) return run("next", undefined, "");
    if ((m = /^(?:go back to|play|put on|replay|rewatch)(?: the| that)? (.+?) video(?: again)?$/.exec(t)) && VH.list.length) {
      const words = m[1].replace(/\b(one|about|with|from)\b/g, " ").split(/\s+/).filter((w) => w.length > 2);
      const hit = [...VH.list.keys()].reverse().find((i) => { const ti = (VH.list[i].title || "").toLowerCase(); return words.length && words.every((w) => ti.includes(w)); });
      if (hit !== undefined) { playHistory(hit); return r(""); }
    }
    // pause / resume / next / previous / restart
    if (/^(pause|pause (it|this|that|the (music|song|video)|music|spotify|youtube)|hold on|hold it)$/.test(t)) return run("pause", undefined, "Paused.");
    if (/^(play|resume|unpause|keep (going|playing)|continue|resume (the )?(music|song|video)|play (it|the (music|song|video))|go on)$/.test(t)) return run("resume", undefined, "");
    if (/^(next|skip|next (song|track|one)|skip (this|it|that|this song|song|this one|track)|play the next (song|one)|skip to the next (song|one|track))$/.test(t)) return run("next", undefined, "");
    if (/^(previous|go back|back|previous (song|track|one)|last (song|track|one)|play the (previous|last) (song|one)|go back a song|go back one|go back to the last song)$/.test(t)) return run("previous", undefined, "");
    if (/^(restart|start (it |this )?over|start from the (beginning|top)|from the (beginning|top)|go (back )?to the (beginning|start)|restart (the |this )?(song|video|track)|play (it|this) from the (beginning|start))$/.test(t)) return run("restart", undefined, "");
    // jumping around: "skip ahead 30 seconds", "go back 10 seconds", "go to 2 minutes 15", "jump to 1:30"
    if ((m = /^(?:skip|jump|go|fast forward|forward|move)(?: it)?(?: ahead| forward| forwards)?(?: by)? (.+)$/.exec(t)) && /\b(ahead|forward|forwards)\b/.test(t) && !/\b(to|at)\b/.test(t)) { const x = secondsIn(m[1]); if (x > 0) return run("seekBy", x, `Forward ${spokenLen(x)}.`); }
    if ((m = /^(?:go back|rewind|back up|skip back|jump back|back|move back)(?: it)?(?: by)? (.+)$/.exec(t))) { const x = secondsIn(m[1]); if (x > 0) return run("seekBy", -x, `Back ${spokenLen(x)}.`); }
    if ((m = /^(?:go|jump|skip|seek|fast forward|move|take me|take it|start|play from|start from|start it)(?: ahead| forward)? (?:to|at|from)? ?(?:the )?(.+?)(?: mark| point| in)?$/.exec(t)) && /\d|minute|second|hour|half/.test(m[1])) { const x = secondsIn(m[1]); if (x >= 0) return run("seek", x, `Jumping to ${mmss(x)}.`); }
    // speed (YouTube): "play at 1.5 speed", "double speed", "speed it up", "slow it down", "normal speed".
    // "Talk slower / speak faster" stays with Dayspring's own voice; bare "slow down / speed up / normal speed" mean the video
    // while one is showing on screen.
    if (isVid && !/\b(talk|talking|speak|speaking|your voice|you talk|you speak)\b/.test(t)) {
      const tt = t.replace(/\bone and a half\b/g, "1.5").replace(/\bone point two five\b/g, "1.25").replace(/\bone point five\b/g, "1.5").replace(/\bone point seven five\b/g, "1.75").replace(/\b(zero )?point seven five\b/g, "0.75").replace(/\b(zero )?point five\b/g, "0.5");
      const aboutIt = /\b(video|it|this|playback|speed)\b/.test(tt) || P.video;
      if (aboutIt) {
        if ((m = /\b(\d(?:\.\d{1,2})?) ?(?:x|times)\b/.exec(tt)) || (m = /\bspeed (?:to |at |of )?(\d(?:\.\d{1,2})?)\b/.exec(tt)) || (m = /\b(\d(?:\.\d{1,2})?) speed\b/.exec(tt)) || (m = /\b(?:play|put|set) (?:it |this |the video )?(?:at|to) (\d(?:\.\d{1,2})?)(?: speed)?$/.exec(tt))) {
          const v = Number(m[1]); if (v >= 0.25 && v <= 2) return run("speed", v, `${v === 1 ? "Normal" : v + "×"} speed.`);
        }
        if (/\bdouble speed\b|\btwice as fast\b/.test(tt)) return run("speed", 2, "Double speed.");
        if (/\bhalf speed\b/.test(tt)) return run("speed", 0.5, "Half speed.");
        if (/^((play at |back to |set it to )?(normal|regular|usual) speed|reset (the )?speed)$/.test(tt) && (P.video || P.rate !== 1)) return run("speed", 1, "Normal speed.");
        if (/^(speed (it |this |the video |up the video )?up|faster|play (it )?faster|a (little|bit) faster|speed up( the video)?)$/.test(tt)) return run("speedBy", 1, "");
        if (/^(slow (it |this |the video )?down|slower|play (it )?slower|a (little|bit) slower|slow down( the video)?)$/.test(tt)) return run("speedBy", -1, "");
      }
    }
    // volume: while something plays, "turn it up" means the music or video ("your voice" means Dayspring's)
    if (!/\b(your voice|yourself|you talk|you speak|talking|speaking)\b/.test(t)) {
      if (/^mute( (it|the music|the video|that|this))?$/.test(t)) return run("mute", undefined, "");
      if (/^unmute( (it|the music|the video|that|this))?$/.test(t)) return run("unmute", undefined, "");
      if ((m = /^(?:set |turn |put )?(?:the )?(?:music |song |video |media )?volume (?:to |at )?(\d{1,3})(?: ?%| percent)?$|^(?:turn|set|put) (?:it|the music|the video|this|the volume) (?:to|at) (\d{1,3})(?: ?%| percent)?$/.exec(t))) { const n = Math.min(100, Number(m[1] ?? m[2])); return run("volume", n, `Volume ${n}.`); }
      if (/^(turn (it|this|that|the music|the song|the video|the volume) up( a (little|bit))?|turn up (the )?(music|volume|song|video)|louder|volume up|a (little|bit) louder|crank it( up)?)$/.test(t)) return run("volumeBy", /little|bit/.test(t) ? 8 : 15, "");
      if (/^(turn (it|this|that|the music|the song|the video|the volume) down( a (little|bit))?|turn down (the )?(music|volume|song|video)|quieter|softer|volume down|a (little|bit) quieter|too loud)$/.test(t)) return run("volumeBy", /little|bit/.test(t) ? -8 : -15, "");
    }
    if (/^(shuffle( on| it)?|turn on shuffle|shuffle (this|the playlist)|put it on shuffle)$/.test(t)) return run("shuffle", true, "Shuffle on.");
    if (/^(shuffle off|turn off shuffle|stop shuffling|no shuffle)$/.test(t)) return run("shuffle", false, "Shuffle off.");
    if (/^(repeat (this|this song|it|the song|this one|this video)|loop (this|it|the song|the video|this video))$/.test(t)) return run("repeat", "track", "Repeating this one.");
    if (/^(repeat( all| the playlist)?|repeat on|turn on repeat)$/.test(t)) return run("repeat", "context", "Repeat on.");
    if (/^(repeat off|stop repeating|turn off repeat|no repeat|stop looping)$/.test(t)) return run("repeat", "off", "Repeat off.");
    return null;
  }

  /* ================================================================ listening */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let micBlocked = false;
  let rec = null, mode = "idle", commandTimer = null, paused = false, interimEl = null, wakeRe = /\bdayspring\b[,.!?]?\s*(.*)$/i;
  function buildWake() {
    // speech recognition writes "Dayspring" many ways: "day spring", "daysprings", "day-spring"
    const phrases = [...new Set(config.wakePhrases.flatMap((p) => /^dayspring$/i.test(p) ? [p, "day spring", "day-spring", "daysprings", "day springs", "dayspring's"] : [p]))];
    const alts = phrases.sort((a, b) => b.length - a.length).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"));
    wakeRe = new RegExp(`\\b(?:${alts.join("|")})\\b[,.!?]?\\s*(.*)$`, "i");
  }
  function setMic(cls, text) {
    $("#mic").className = "mic " + cls; $("#micText").textContent = text;
    const st = $("#talkStatus");
    if (st) { st.className = "status " + (cls || "wait"); $("#talkStatusText").textContent = { listen: "Listening", think: "Thinking", speak: "Speaking" }[cls] ?? (micBlocked ? "Mic blocked" : "Ready"); }
  }
  const idleText = () => `Say “${cap(config.wakePhrases[0])}, …” to talk` + (prefs.mode !== "voice" ? ` · ${prefs.mode === "silent" ? "silent" : "chime only"}` : "");

  // Watchdog, every 4 s: listening comes back if anything left it off; "thinking" or "speaking" that's gone on far too long
  // is reset; and if Chrome's recognizer has gone quiet (it sometimes stops without saying so), it's restarted.
  let stateSince = Date.now(), lastRecEvent = Date.now();
  setInterval(() => {
    if (!SR || micBlocked) return;
    const now = Date.now();
    if (speaking && now - stateSince > 120_000) { dlog("watchdog", { what: "speaking too long, stopped" }); stopSpeaking(); speaking = false; }
    if (!speaking && paused && mode !== "thinking" && !textOnly) resumeListening();
    if ((mode === "thinking" || mode === "replying") && !speaking && now - stateSince > 100_000) { dlog("watchdog", { what: "stuck in " + mode + ", reset" }); backToIdle(); }
    if (!rec && !paused) startListening();
    if (rec && !paused && now - lastRecEvent > 4 * 60_000) { dlog("watchdog", { what: "recognizer quiet 4 min, restarted" }); lastRecEvent = now; try { rec.abort(); } catch { /* onend restarts it */ } }
  }, 4000);
  function startListening() {
    if (!SR) { setMic("", "This browser can't listen. Use Chrome."); return; }
    // an automated copy of this page (tests, screenshots) never listens: it would hear the real room
    if (navigator.webdriver) { setMic("", "Automated view: not listening."); return; }
    if (rec || paused) return;
    rec = new SR();
    rec.lang = "en-US"; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
    rec.onresult = (ev) => { lastRecEvent = Date.now(); onResult(ev); };
    rec.onaudiostart = rec.onsoundstart = () => { lastRecEvent = Date.now(); };
    rec.onerror = (e) => {
      dlog("rec-error", { error: e.error, mode });
      // A blocked mic must not block the TV: everything else keeps working, and it tries again later.
      if (e.error === "not-allowed" || e.error === "service-not-allowed") { micBlocked = true; setMic("", "Microphone blocked: allow it for localhost (the lock icon in the address bar)."); }
      else if (e.error === "network") setMic("", "Listening needs the internet. Retrying…");
    };
    rec.onend = () => { rec = null; if (!paused) setTimeout(() => { micBlocked = false; startListening(); }, micBlocked ? 30_000 : 300); };
    try { rec.start(); if (mode === "idle") setMic("wait", idleText()); } catch { rec = null; }
  }
  function pauseListening() { paused = true; if (rec) { try { rec.abort(); } catch { /* stopped */ } rec = null; } }
  function resumeListening() { if (typeof textOnly !== "undefined" && textOnly) return; paused = false; if (micBlocked) return; startListening(); if (mode === "idle") setMic("wait", idleText()); else if (mode === "command") setMic("listen", "Listening…"); }

  // A long instruction arrives in pieces (the recognizer finalizes at every little pause), so the pieces are gathered
  // into one message and sent only after he's really done: ~2 s of quiet (3.5 s if he trailed off on "and", "so", a comma…),
  // or right away on "that's it" / "send it". Talking again before then just keeps the message open.
  let utter = null;            // { text, timer }
  const PAUSE_MS = 2000, TRAIL_MS = 3500;
  const trailing = (t) => /(,|\b(and|so|but|or|then|because|also|plus|like|um|uh|with|to|the|a|my|for))\s*$/i.test(t);
  function collect(piece) {
    const clean = piece.replace(/\b(that'?s it|send it|go ahead and answer|that'?s all)\W*$/i, "").trim();
    const done = clean !== piece.trim();
    if (!utter) utter = { text: "", timer: 0 };
    if (clean) utter.text = (utter.text + " " + clean).trim();
    clearTimeout(commandTimer);                        // he's talking: the listening window stays open
    mode = "command"; setMic("listen", "Listening…"); if (!speaking) stage("listen");
    $("#youSaid").textContent = "You: " + utter.text; $("#youSaid").classList.add("interim");
    clearTimeout(utter.timer);
    if (done) return flushUtter();
    utter.timer = setTimeout(flushUtter, trailing(utter.text) ? TRAIL_MS : PAUSE_MS);
  }
  function flushUtter() {
    if (!utter) return;
    clearTimeout(utter.timer);
    const text = utter.text.trim(); utter = null;
    clearInterim();
    $("#youSaid").classList.remove("interim");
    if (text.length > 1) ask(text); else backToIdle();
  }
  // while he's mid-sentence, the timer waits for him (interim words keep coming in)
  function stillTalking() { if (utter) { clearTimeout(utter.timer); utter.timer = setTimeout(flushUtter, trailing(utter.text) ? TRAIL_MS : PAUSE_MS + 400); } }
  function onResult(ev) {
    if (!speaking) lastHeard = Date.now();
    let interim = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i], text = r[0].transcript.trim();
      if (!r.isFinal) { interim += text + " "; continue; }
      handleFinal(text);
    }
    interim = interim.trim();
    if (interim && wakeRe.test(interim) && mode === "idle") { duck(true); wake(); }
    if (interim && (mode === "command" || utter || wakeRe.test(interim))) {
      stillTalking();
      // he started talking after just "Dayspring": the window waits for him instead of closing mid-thought
      if (mode === "command" && !utter) { clearTimeout(commandTimer); commandTimer = setTimeout(() => { if (mode === "command" && !utter) backToIdle(); }, 9000); }
      const shown = ((utter?.text ?? "") + " " + interim.replace(wakeRe, "$1")).trim();
      if (!interimEl) interimEl = push("me interim", shown); else interimEl.textContent = shown;
      $("#youSaid").textContent = "You: " + shown; $("#youSaid").classList.add("interim");
    }
  }
  function clearInterim() { if (interimEl) { interimEl.remove(); interimEl = null; } }

  // Echo guard: on the computer's own speaker the mic hears Dayspring too. Words that match what it just said
  // ("…want me to read it to you?") are its own voice, not the owner answering, so they're dropped.
  const ownSpeech = [];
  function noteOwnSpeech(text) { ownSpeech.push({ w: words(text), at: Date.now() }); while (ownSpeech.length > 6) ownSpeech.shift(); }
  const words = (t) => String(t).toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
  function isOwnEcho(text) {
    const w = words(text); if (w.length < 2) return false;
    return ownSpeech.some((s) => Date.now() - s.at < 30_000 && w.filter((x) => s.w.includes(x)).length / w.length >= 0.75
      && s.w.join(" ").includes(w.slice(0, 2).join(" ")));        // same words, in the same order it said them
  }

  function handleFinal(text) {
    clearInterim();
    if (!text) return;
    if (isOwnEcho(text) && !wakeRe.test(text)) { dlog("ignored-echo", { words: text.split(/\s+/).length }); return; }
    const m = wakeRe.exec(text);
    // privacy: speech that isn't for Dayspring (room conversation) is logged only as a word count, never the words;
    // "nearWake" flags things that sounded close to the wake word, to catch missed "Dayspring"s
    if (m || mode === "command" || utter || alarmOn) dlog("heard", { how: "voice", text, mode, gathering: Boolean(utter), wake: Boolean(m), speaking });
    else dlog("ignored-speech", { words: text.split(/\s+/).length, nearWake: /\b(day|days|daisy|spring|springs)\b/i.test(text) });
    if (alarmOn && (m || /\b(i'?m up|awake|stop|okay|ok)\b/i.test(text))) {
      dismissAlarm(true);
      if (m && m[1] && !/^(i'?m up|i am up)\W*$/i.test(m[1])) ask(m[1]);
      return;
    }
    if (mode === "command" || utter) { collect(m ? m[1] || "" : text); return; }
    if (!m) { if (ducked && !speaking) duck(false); return; }   // everything else in the room is ignored
    const rest = (m[1] || "").trim();
    if (rest.length > 1) collect(rest);
    else { playSound("wake"); openCommandWindow(10000); }
  }
  function openCommandWindow(ms) {
    mode = "command"; setMic("listen", "Listening…"); duck(true); wake();
    if (!speaking) stage("listen");
    clearTimeout(commandTimer);
    commandTimer = setTimeout(() => { if (mode === "command") backToIdle(); }, ms);
  }
  // ⌨ Type: a typed conversation, no audio either way
  $("#typeBtn").onclick = () => { const f = $("#typeForm"); f.hidden = !f.hidden; $("#typeBtn").classList.toggle("on", !f.hidden); if (!f.hidden) $("#typeBox").focus(); };
  $("#typeForm").onsubmit = (e) => { e.preventDefault(); const t = $("#typeBox").value.trim(); if (!t) return; $("#typeBox").value = ""; stopListeningNow(); ask(t, { typed: true }); };
  // 🔇 Text only: no mic and no voice at all (for calls); stays that way until he turns it off
  function setTextOnly(on) {
    textOnly = on;
    try { localStorage.setItem("ds-text-only", on ? "1" : "0"); } catch { /* fine */ }
    $("#quietBtn").classList.toggle("on", on); $("#quietBtn").textContent = on ? "🔇 Text only" : "🔇";
    if (on) { stopListeningNow(); pauseListening(); $("#typeForm").hidden = false; $("#typeBtn").classList.add("on"); setMic("quiet", "Text only"); $("#talkStatusText").textContent = "Text only"; $("#talkStatus").className = "status quiet"; }
    else { resumeListening(); setMic("wait", idleText()); }
  }
  $("#quietBtn").onclick = () => setTextOnly(!textOnly);
  // ✋ Stop: stop talking and listening right now; only "Dayspring" starts it again
  function stopListeningNow() {
    if (utter) { clearTimeout(utter.timer); utter = null; }
    clearInterim(); clearTimeout(commandTimer);
    if (speaking) stopSpeaking();
    backToIdle();
  }
  $("#stopBtn").onclick = () => { stopListeningNow(); toast("Stopped", "Say “Dayspring” when you need me.", "", "bell"); };
  function repeatLast() { if (lastSaid) speak(lastSaid.text, null, "general", lastSaid.v); else speak("I haven't said anything yet."); }
  function chatDetail() {
    const msgs = [...$("#log").children].filter((m) => !m.classList.contains("interim") && !m.classList.contains("typing"));
    openDetail("Conversation", `<div class="dchat">${msgs.map((m) => `<div class="${m.className}">${m.innerHTML}</div>`).join("") || '<p class="muted">Nothing yet today. Say “Dayspring” and ask me anything.</p>'}</div>
      <div class="dnav"><a class="btn" href="http://localhost:4747/history.html">Older conversations ↗</a></div>`, { wide: true });
    setTimeout(() => { const b = $("#dBody"); b.scrollTop = b.scrollHeight; }, 60);
  }
  $("#repeatBtn").onclick = repeatLast;
  if (textOnly) setTimeout(() => setTextOnly(true), 1500);
  $("#chatBtn").onclick = chatDetail;
  function backToIdle() { mode = "idle"; stateSince = Date.now(); setMic("wait", idleText()); if (!speaking) stage("off"); duck(false); }

  // Instant, on the TV itself: stop, pause, skip, volume.
  function localCommand(text) {
    const t = text.toLowerCase().replace(/[.!?,]/g, "").trim();
    if (/^(stop|stop it|stop the (music|video|song)|stop playing.*|turn (it|that) off|shut it off)$/.test(t)) {
      stopSpeaking();
      if (nowPlaying) stopMedia(false);
      post("/media/stop").catch(() => {});
      push("ai", "Stopped."); showNowPlaying(null);
      return true;
    }
    if (/^(never ?mind|cancel|forget it|be quiet)$/.test(t)) { stopSpeaking(); return true; }
    if (alarmOn && /^(snooze|hit snooze|snooze it|snooze the alarm|(give me )?(five|ten|\d+|a few) more minutes|snooze (for )?(\d+|five|ten|fifteen|thirty) minutes)$/.test(t)) {
      const n = /(\d+|five|ten|fifteen|thirty)/.exec(t); const m = n ? Number({ five: 5, ten: 10, fifteen: 15, thirty: 30 }[n[1]] ?? n[1]) : /a few/.test(t) ? 5 : 9;
      snoozeAlarm(m); return true;
    }
    if (/^(please )?(clear|dismiss|close|hide|get rid of|remove)( all)?( of)?( the| my| those| these)? ?(notifications?|pop ?ups?|alerts?|messages on (the )?screen)( please)?$/.test(t)) { clearToasts(); push("ai", "Cleared."); return true; }
    if (/^(open |show )?(the |my )?(sound|audio|volume) (settings|options|panel|controls|mixer)$|^sound options$/.test(t)) { openSound(); push("ai", "Here are the sound settings."); return true; }
    for (const fn of window.dsLocal ?? []) { try { const r = fn(t, text); if (r) { if (typeof r === "string") push("ai", r); return true; } } catch { /* an add-on failed: let Dayspring answer */ } }
    return false;
  }

  // Schedule changes: say it's on the way, make it, show it, then confirm it.
  let liveEditAt = 0;
  const EDIT_WORDS = /\b(add|schedule|put|move|reschedule|push|shift|change|cancel|delete|remove|clear|rename|swap|bump|book|block (off|out)|make|mark|set|slide)\b/;
  const EDIT_WHAT = /\b(schedule|calendar|block|meeting|appointment|event|study|church|lunch|dinner|breakfast|workout|practice|class|call|today|tonight|tomorrow|morning|afternoon|evening|noon|(sun|mon|tues|wednes|thurs|fri|satur)day|\d{1,2}(:\d{2})?\s*(am|pm|o'?clock)|important|major|notable)\b/;
  const NOT_EDIT = /\b(volume|voice|speaker|speakers|mic|microphone|headset|music|song|playlist|spotify|youtube|video|alarm|timer|brightness|overscan|screen)\b|^(what|when|where|who|why|how|is|are|do|does|did|can you tell)\b/;
  const isScheduleEdit = (t) => { const q = t.toLowerCase(); return EDIT_WORDS.test(q) && EDIT_WHAT.test(q) && !NOT_EDIT.test(q); };
  const SCHED_CHANGES = new Set(["add", "update", "remove"]);
  function showEdit(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) date = null;
    if ($("#calwrap").hidden) openCalendar("day", date ?? todayISO());
    else if (date) openCalendar("day", date);             // already open: jump to the changed day; it re-renders itself
  }
  const settle = (ms) => new Promise((r) => setTimeout(r, ms));

  async function ask(text, { typed = false } = {}) {
    const silent = typed || textOnly;
    const say = (t, ...rest) => (silent ? Promise.resolve() : speak(t, ...rest));
    clearTimeout(commandTimer);
    if (utter) { clearTimeout(utter.timer); utter = null; }
    if (typed) dlog("heard", { how: "typed", text });
    push("me", text);
    if (localCommand(text)) { dlog("local-reply", { heard: text, said: "(local command)", handler: "localCommand" }); backToIdle(); return; }
    const mc = musicCommand(text);
    if (mc) { dlog("local-reply", { heard: text, said: mc.say || "(music control)", handler: "musicCommand" }); if (mc.say) push("ai", mc.say); if (mc.speak) await say(mc.say); backToIdle(); return; }
    const lc = window.dsLibrary?.command(text);
    if (lc) { dlog("local-reply", { heard: text, said: lc.say || "(library)", handler: "library" }); if (lc.say) push("ai", lc.say); if (lc.speak) await say(lc.say); backToIdle(); return; }
    // "how do I snooze?" / "how do I connect Spotify?": that part of the guide opens, and the first steps are said (no AI needed)
    const hg = await helpAnswer(text);
    if (hg) { dlog("local-reply", { heard: text, said: hg.say, handler: "help", page: hg.url }); push("ai", hg.say); openPage(hg.url); await say(hg.say); backToIdle(); return; }
    // the big panel: "show me my week / the weather / the prayer list", answered right here
    const cc = calCommand(text);
    if (cc?.repeat) { dlog("local-reply", { heard: text, said: lastSaid?.text ?? "", handler: "repeat" }); backToIdle(); repeatLast(); return; }
    if (cc?.play) { post("/media/play", { videoId: cc.play.videoId, title: cc.play.title }).catch(() => {}); push("ai", "Playing it now."); await say("Playing it now."); backToIdle(); return; }
    if (cc) { dlog("local-reply", { heard: text, said: cc.say, handler: "calCommand", view: calView }); push("ai", cc.say); await say(cc.say); backToIdle(); return; }
    const editing = isScheduleEdit(text);
    let ackP = Promise.resolve();
    const askedAt = Date.now();
    if (editing) {
      const ack = "Okay, I'll make that change.";
      push("ai", ack); dlog("local-reply", { heard: text, said: ack, handler: "edit-ack" });
      ackP = say(ack).catch(() => {});
    }
    mode = "thinking"; stateSince = Date.now(); setMic("think", editing ? "Making the change…" : "Thinking…"); stage("think"); showTyping();
    try {
      const ctl = new AbortController(), tmo = setTimeout(() => ctl.abort(), 75_000);
      const r = await json("/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: text, surface: "tv" }), signal: ctl.signal }).finally(() => clearTimeout(tmo));
      // "offline"/"done" are broad (any quick reply), so they count only when it was clearly a schedule edit
      const changedSchedule = r.changes?.some((c) => SCHED_CHANGES.has(c) || (editing && (c === "offline" || c === "done")));
      if (editing || changedSchedule) {
        await ackP;                                                   // "I'll make that change" finishes first
        if (changedSchedule) {
          loadDay();
          if (liveEditAt < askedAt) showEdit(null);                   // made without a live push: show today's schedule
          await settle(900);                                          // let the schedule redraw before confirming
        }
      }
      push("ai", r.reply);
      if (r.photo === "next") showPhoto({ pin: true }).catch(() => {});
      if (r.panel === "voices") voicesDetail().catch(() => {});
      if (r.panel === "devices") devicesDetail().catch(() => {});
      if (r.changes?.length) { loadDay(); loadLearning(); }
      mode = "replying";
      const rv = r.speed ? { speed: r.speed } : {};
      if (silent) { lastSaid = { text: r.reply, v: rv }; backToIdle(); if (typed) $("#typeBox").focus(); return; }   // typed: read, not heard
      if (r.quiet) {                       // "I'm ready, don't want to talk": two words, then quiet
        await speak(r.reply, null, "general", rv);
        backToIdle(); playSound("done");
        return;
      }
      await speak(r.reply, null, "general", rv);   // a direct answer is always spoken, whatever the notification mode
      // In a between-blocks conversation he just keeps talking — no wake phrase — until it wraps up.
      if (r.conversation) openCommandWindow(30000);
      else openCommandWindow(10000);       // a follow-up needs no wake phrase
      if (!r.conversation && /good luck,? [\w']+!|let'?s get to it/i.test(r.reply)) { burst(250, 70); playSound("levelup"); }
    } catch (e) {
      const msg = e.name === "AbortError" ? "Sorry, that took too long. Could you ask me again?" : "Sorry, I couldn't get an answer just then.";
      dlog("error", { where: "ask", heard: text, name: e.name, error: String(e.message).slice(0, 300), said: msg });
      push("sys", msg); mode = "replying"; await say(msg).catch(() => {});
      backToIdle();
    }
  }

  /* ================================================================ alarm: a sunrise that builds */
  let alarmOn = false, alarmLoop = null, alarmRepeat = null, alarmStop = null, alarmStart = 0, alarmItem = null, morningRun = 0;
  function startAlarm(item) {
    alarmOn = true; alarmStart = Date.now(); alarmItem = item; $("#snzOpts").hidden = true;
    $("#alarmTime").textContent = hm12(item.hm || item.started?.start || new Date().toTimeString().slice(0, 5));
    $("#alarmText").textContent = item.text;
    const ov = $("#alarm"); ov.hidden = false; ov.style.animation = "none"; void ov.offsetWidth; ov.style.animation = "";
    wake(30 * 60_000);
    // starts gentle and grows over the first minute and a half
    const ring = () => {
      if (speaking) return;
      const k = Math.min(1, (Date.now() - alarmStart) / 90_000);
      const notes = k < 0.3 ? [784, 988, 1175] : k < 0.7 ? [659, 784, 988, 1319] : [659, 784, 988, 1319, 988, 784];
      onBus("notify", () => {
        notes.forEach((f, i) => bell(f, i * 0.16, { dur: 1.2, vol: 0.1 + k * 0.2, p: i % 2 ? 0.35 : -0.35 }));
        if (k > 0.3) pad([329.6, 415.3, 493.9], 0, { dur: 3, vol: 0.02 + k * 0.04 });
      }, { alarm: true });
    };
    ring(); alarmLoop = setInterval(ring, 5200);
    setTimeout(() => speak(item.text, null, "notify"), 2500);
    alarmRepeat = setInterval(() => speak(item.text, null, "notify"), 180_000);
    alarmStop = setTimeout(() => dismissAlarm(false), 30 * 60_000);
  }
  function dismissAlarm(answered) {
    if (!alarmOn) return;
    alarmOn = false; $("#alarm").hidden = true;
    clearInterval(alarmLoop); clearInterval(alarmRepeat); clearTimeout(alarmStop);
    playSound("done", "notify"); burst(40, 70);
    if (answered !== false) speak("Good morning. Let's go.", null, "notify");
  }
  $("#alarmOff").onclick = () => { if (alarmLoop || !$("#alarm").hidden) { clearInterval(alarmLoop); } dismissAlarm(true); };
  async function snoozeAlarm(minutes = 9) {
    const item = alarmItem;
    morningRun++;                                        // a wake-up song in progress stops here
    clearInterval(alarmLoop); clearInterval(alarmRepeat); clearTimeout(alarmStop);
    alarmOn = false; $("#alarm").hidden = true; $("#snzOpts").hidden = true;
    stopSpeaking?.(); if (nowPlaying) stopMedia(false); post("/media/stop").catch(() => {});
    const r = await post("/snooze", { item, minutes }).catch(() => null);
    playSound("soft", "notify");
    toast("💤 Snoozed", r?.text?.replace(/^Snoozed /, "") ?? `${minutes} minutes`, "", "bell");
  }
  // a tap snoozes 9 minutes; holding the button (or right-clicking) offers 5 / 9 / 15 / 30 instead
  let snzHold = 0, snzOpened = false;
  $("#alarmSnooze").onpointerdown = () => { snzOpened = false; snzHold = setTimeout(() => { $("#snzOpts").hidden = false; snzOpened = true; }, 600); };
  $("#alarmSnooze").onpointerup = $("#alarmSnooze").onpointerleave = () => clearTimeout(snzHold);
  $("#alarmSnooze").oncontextmenu = (e) => { e.preventDefault(); $("#snzOpts").hidden = false; snzOpened = true; };
  $("#alarmSnooze").onclick = () => { if (snzOpened) { snzOpened = false; return; } snoozeAlarm(9); };
  // tests (headless, muted): show the alarm or a snoozable pop-up without a real one going off
  window.addEventListener("ds-test-alarm", (e) => startAlarm({ kind: "alarm", alarm: true, hm: "07:00", text: "Good morning. Time to get up.", ...(e.detail || {}) }));
  window.addEventListener("ds-test-alert", (e) => toast("Reminder", e.detail?.text ?? "Test reminder", "wait", "bell", { snooze: { kind: "reminder", text: e.detail?.text ?? "Test reminder" } }));
  $("#snzOpts").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) snoozeAlarm(Number(b.dataset.m)); });

  /* ================================================================ events from the server */
  function connectEvents() {
    const es = new EventSource("/api/events");
    // shared with the page's add-ons (the living sky) so they don't each open another connection
    window.dsEvents = es; window.dispatchEvent(new CustomEvent("ds-events", { detail: es }));
    // after Dayspring restarts (new code from Claude Code), reload so the new version shows
    let build0 = null;
    es.onopen = () => json("/build").then((r) => { if (build0 && r.build !== build0) location.reload(); build0 = r.build; }).catch(() => {});
    // Claude Code at work: a live status line in the Dayspring panel
    es.addEventListener("coder", (e) => {
      const c = JSON.parse(e.data), el = $("#coderStatus");
      if (c.kind === "done") { el.textContent = c.ok ? "✓ Claude Code finished" : "Claude Code stopped"; setTimeout(() => { el.hidden = true; }, 20_000); }
      else { el.hidden = false; el.textContent = `⚙ Claude Code · ${c.kind === "started" ? "starting…" : c.text}`; }
      fitBox(el, 0.8);
    });
    es.addEventListener("announce", async (e) => {
      const item = JSON.parse(e.data);
      push("ann", item.text);
      energy = 1; wake();
      loadDay(); loadLearning();
      if (item.started?.category === "study" && nowPlaying && !nowPlaying.audioOnly) stopMedia(true);   // study time: videos give way
      if (item.kind === "morning") { startMorning(item); return; }
      if (item.alarm) { startAlarm(item); return; }
      if (item.kind === "ready" || item.kind === "rundown") {
        await notify(item.text, { sound: "motif", chip: { title: item.kind === "ready" ? "Ready for the day?" : "Today", category: "faith" }, voice: { speed: item.speed, tone: item.kind === "ready" ? "soothing" : undefined }, polite: item.kind !== "ready" });
        if (prefs.mode === "voice" && item.kind === "ready") openCommandWindow(45_000);
        return;
      }
      if (item.kind === "coder") {
        // Claude Code finished: what changed, and "want me to restart?" — then listen for the answer
        await notify(item.text, { sound: "done", chip: { title: "Claude Code", category: "work" } });
        if (prefs.mode === "voice") openCommandWindow(30_000);
        return;
      }
      if (item.kind === "text") {
        // "Incoming text message from Alex. Do you want me to read it?" — it's only read on a yes
        if (prefs.mode !== "voice") toast(`Text from ${item.from ?? "someone"}`, "Say “Dayspring, read it” to hear it.", "", "bell");
        await notify(item.text, { sound: "ding", chip: { title: `Text from ${item.from ?? "someone"}`, category: "home" } });
        if (prefs.mode === "voice") openCommandWindow(25_000);
        return;
      }
      if (item.kind === "person") {
        // "How's Jordan doing lately?" — then listen for the answer (no wake word needed)
        await notify(item.text, { sound: "chime", chip: { title: item.person ?? "Someone on your list", category: "home" }, voice: { tone: "warm" } });
        if (prefs.mode === "voice") openCommandWindow(40_000);
        return;
      }
      if (item.kind === "church") {
        // "Can I help you get ready for worship?" / "Want to talk through tonight's study?" — then listen for the answer
        await notify(item.text, { sound: "motif", chip: { title: item.passage ?? "Church", category: "faith" }, voice: { tone: "warm" } });
        if (prefs.mode === "voice") openCommandWindow(45_000);
        return;
      }
      if (item.kind === "reminder") {
        toast(item.snoozed ? "Reminder (snoozed)" : "Reminder", item.reminder?.text ?? item.text, "wait", "bell", { snooze: item });
        await notify(item.text, { sound: "ding", chip: { title: "Reminder", category: "flex" } });
        if (prefs.mode === "voice") openCommandWindow(10_000);
        return;
      }
      if (item.kind === "weather") {
        // severe weather from Apps & connections → Severe weather alerts: ⚠ and the alert's name, the details underneath
        const t = String(item.title ?? "Weather alert").replace(/^⚠️?\s*/, "");
        toast(`⚠ ${t}`, item.text, "wait", "warn");
        await notify(item.text, { sound: "ding", chip: { title: `⚠ ${t}`, category: "flex" } });
        return;
      }
      if (item.kind === "hook") {
        // an incoming webhook (IFTTT, Zapier…): its title, then what it said
        toast(item.title || "Message", item.text, "", "link");
        await notify(item.text, { sound: "ding", chip: { title: item.title || "Message", category: "home" } });
        return;
      }
      const chip = item.started ?? (item.ended ? { title: `Time's up · ${item.ended.title}`, category: "flex" } : null);
      toast(item.kind === "checkin" ? `Time's up · ${item.ended?.title ?? ""}` : item.started?.title ?? "Dayspring", item.text, "", item.started?.category ?? "bell", { snooze: ["start", "checkin"].includes(item.kind) ? item : null });
      await notify(item.text, { sound: item.kind === "checkin" ? "checkin" : item.kind === "buffer" ? "soft" : "motif", chip: item.kind === "buffer" ? { title: "A few free minutes", category: "home" } : chip });
      if (prefs.mode === "voice") openCommandWindow(item.kind === "checkin" ? 30000 : 8000);   // he can just answer
    });
    es.addEventListener("media", (e) => { const c = JSON.parse(e.data); if (c.action === "play") playMedia(c); else stopMedia(false); });
    es.addEventListener("nowplaying", (e) => showNowPlaying(JSON.parse(e.data)));
    es.addEventListener("player", (e) => {
      const c = JSON.parse(e.data);
      if (c.only) { if (c.only === P.source) { if (c.only === "spotify") sp?.pause().catch(() => {}); clearPlayer(); } return; }
      ctl(c.action, c.value).then((msg) => { if (msg) push("sys", msg); }).catch(() => {});
    });
    // the AI asked for the Library: open a tab (with a search), play one of Dayspring's video playlists, or queue a video
    es.addEventListener("library", (e) => {
      const c = JSON.parse(e.data), L = window.dsLibrary;
      if (c.tab) L?.open(c.tab, c.q !== undefined ? { q: c.q } : {});
      if (c.playList) L?.playList(c.playList, { shuffle: c.shuffle });
      if (c.queue) { if (P.source) window.dsVideos.add(c.queue); else window.dsVideos.play(c.queue); }
    });
    es.addEventListener("spotify-auth", (e) => {
      const a = JSON.parse(e.data);
      if (a.signedIn) { spStarting = false; initSpotify(); toast("Spotify connected", "Music now plays right here on the screen.", "", "bell"); }
      else { try { sp?.disconnect(); } catch { /* gone */ } sp = null; spDevice = null; spStarting = false; if (P.source === "spotify") clearPlayer(); }
    });
    es.addEventListener("sound", (e) => { if (prefs.mode !== "silent") playSound(JSON.parse(e.data).name); });
    // the assistant's help_guide (or "how do I …" from the desk or phone): show that part of the guide here
    es.addEventListener("help", (e) => { const h = JSON.parse(e.data); if (/^\/help\b/.test(h.url ?? "")) openPage(h.url); });
    // a notification on his iPhone: a quiet toast with just the app/title (others may see the screen)
    es.addEventListener("calendar", (e) => { const c = JSON.parse(e.data); if (c.close) closeCalendar(); else openCalendar(c.view ?? "week", c.date ?? todayISO()); });
    es.addEventListener("phonenote", (e) => { const n = JSON.parse(e.data); if (prefs.mode !== "silent") toast("📱 " + (n.title || "Your phone"), "", "", "bell"); });
    es.addEventListener("mic", (e) => { const m = JSON.parse(e.data); setTimeout(restartMic, 400); toast("🎙️ " + (m.role === "headset" ? "Headset mic" : m.role === "laptop" ? "Laptop mic" : m.name), "Listening through it now", "", "bell"); });
    es.addEventListener("settings", (e) => {
      const before = JSON.stringify(prefs.audioOutputs);
      prefs = JSON.parse(e.data); renderBell(); nightCheck();
      if (JSON.stringify(prefs.audioOutputs) !== before) routeAudio().then(() => playSound("chime")).catch(() => {});
      if (mode === "idle") setMic("wait", idleText());
    });
    es.addEventListener("claude", (e) => {
      const c = JSON.parse(e.data);
      toast(c.event === "finished" ? `Claude finished · ${c.project}` : `Claude needs you · ${c.project}`, c.summary, c.event === "finished" ? "" : "wait", "code");
      if (c.quiet && prefs.mode === "voice") { playSound("ding", "general"); return; }
      notify(c.text, { sound: "ding", bus: "general", chip: { title: c.event === "finished" ? `Claude · ${c.project}` : `Claude needs you · ${c.project}`, category: "work" } });
    });
    es.addEventListener("refresh", (e) => {
      loadDay(); loadLearning();
      let r = {}; try { r = JSON.parse(e.data); } catch { /* no details */ }
      if (r.reason === "ai-edit") { liveEditAt = Date.now(); showEdit(r.date); }
    });
  }

  /* ================================================================ the Sound panel: where it plays, the mic, and every volume */
  // One panel for all of it (🔊 Sound, 🎚 Volume, the window bar's 🔊, or "open the sound settings"):
  //   Volume — voice, chimes, alarm (never below 20), music, videos, Tune in's call answers; each with mute and a number
  //   Plays on — every playback device (several at once), or the Windows default. Dayspring never changes the Windows default.
  //   Microphone — which mic Dayspring listens with. Calls — Tune in's listening device and "answer into the call".
  //   At night — go dark, just dim, or stay bright.
  const ROLE_NAME = { tv: "Dayspring screen", headphones: "Headphones", speakers: "Computer speakers", other: "Other", default: "Windows default" };
  const TYPE_ICON = { headset: "🎧", headphones: "🎧", earbuds: "🎧", tv: "📺", "laptop-speaker": "💻", "laptop-mic": "💻", speaker: "🔊", microphone: "🎙️", other: "🔈" };
  const LEVELS = [
    ["volume", "🗣", "Voice", "Dayspring talking", 5],
    ["soundsVolume", "🔔", "Sounds & chimes", "Dings, chimes and little sound effects", 0],
    ["alarmVolume", "⏰", "Alarm", "The wake-up ring (never below 20)", 20],
    ["musicVolume", "🎵", "Music", "Spotify, and YouTube playing music only", 0],
    ["videoVolume", "🎬", "Videos", "YouTube videos with the picture", 0],
    ["callVolume", "🎧", "Call answers", "Tune in's answers into a call", 0],
  ];
  const levelNow = (k) => k === "volume" ? Number(prefs.volume ?? 80) : k === "soundsVolume" ? Number(prefs.soundsVolume ?? prefs.volume ?? 80)
    : k === "alarmVolume" ? Number(prefs.alarmVolume ?? 100) : k === "callVolume" ? Number(prefs.callVolume ?? 100) : levelOf(k);
  // the gain each level gives its part of the sound (the master stays fixed). Plain function declarations that only read
  // prefs: the audio chains may be built before this part of the file has run.
  function lvlGain(k) {
    const v = k === "alarmVolume" ? Number(prefs.alarmVolume ?? 100) : k === "soundsVolume" ? Number(prefs.soundsVolume ?? prefs.volume ?? 80) : Number(prefs.volume ?? 80);
    return k === "alarmVolume" ? 1.25 * Math.max(20, v) / 100 : Math.min(1.3, v / 80);
  }
  function volGain() { return 0.95; }
  const gear = document.createElement("button");
  gear.textContent = "🔊 Sound"; gear.title = "Sound: where it plays, the microphone, and every volume";
  const BELL = { voice: "🔔 Voice", chime: "🔉 Chime", silent: "🔕 Silent" };
  const bellBtn = document.createElement("button");
  bellBtn.id = "bell"; bellBtn.title = "Notifications: voice → chime → silent";
  $(".tools").prepend(bellBtn);
  bellBtn.after(gear);
  const mixBtn = document.createElement("button");
  mixBtn.id = "mixBtn"; mixBtn.textContent = "🎚 Volume"; mixBtn.title = "Volume: voice, chimes, alarm, music and videos";
  gear.after(mixBtn);
  function applyVolume() {
    for (const c of Object.values(CH)) if (c?.master && actx) {
      c.master.gain.setTargetAtTime(volGain(), actx.currentTime, 0.08);
      c.voiceLvl?.gain.setTargetAtTime(lvlGain("volume"), actx.currentTime, 0.08);
      c.sfx?.gain.setTargetAtTime(lvlGain("soundsVolume"), actx.currentTime, 0.08);
      c.alarmIn?.gain.setTargetAtTime(lvlGain("alarmVolume"), actx.currentTime, 0.08);
    }
    window.dsCallVolume = levelNow("callVolume") / 100;          // callbridge.js plays Tune in's answers at this
    if (!ducked) { if (yt?.setVolume) try { yt.setVolume(ytFull()); } catch { /* player gone */ } if (P.source === "spotify") sp?.setVolume(levelOf("musicVolume") / 100).catch(() => {}); }
    renderMixer();
  }

  const snd = document.createElement("div");
  snd.id = "soundPanel"; snd.className = "sndpanel"; snd.hidden = true; snd.tabIndex = -1;
  snd.setAttribute("role", "dialog"); snd.setAttribute("aria-label", "Sound");
  snd.innerHTML = `<header><h3>Sound</h3><button class="x" data-act="close" aria-label="Close (Esc)" title="Close (Esc)">✕</button></header>
    <section class="sv" aria-label="Volume"><h4>Volume</h4>${LEVELS.map(([k, ic, name, hint, min]) => `
      <div class="lvl" data-k="${k}"><button class="mute" title="Mute ${name.toLowerCase()}" aria-label="Mute ${name}">${ic}</button>
        <label><span class="nm">${name}<small>${hint}</small></span><input type="range" min="${min}" max="100" step="1" aria-label="${name} volume"></label>
        <output>0</output>${["volume", "soundsVolume", "alarmVolume"].includes(k) ? `<button class="tst" data-test="${k}" title="Play a short test" aria-label="Test ${name}">▶</button>` : `<span></span>`}</div>`).join("")}</section>
    <section class="so" aria-label="Plays on"><h4>Dayspring plays on <button class="tst lbl" data-test="outputs">▶ Test</button></h4><div class="outs"><p class="hint">Looking for your speakers…</p></div>
      <p class="hint">Spotify inside Dayspring and YouTube always play on the <b>Windows default</b> output: a web page can't send them anywhere else.
      <button class="lnk" data-act="win">Open Windows sound settings</button> to change the default yourself.</p></section>
    <section class="si" aria-label="Microphone"><h4>Microphone</h4><div class="ins"></div></section>
    <section class="sc" aria-label="Calls"><h4>Calls (🎧 Tune in)</h4><div class="calls"></div></section>
    <section class="sn" aria-label="At night"><h4>At night</h4><div class="nights"><button data-n="dark">Go dark</button><button data-n="dim">Just dim</button><button data-n="off">Stay bright</button></div></section>`;
  document.body.appendChild(snd);
  let sndOpener = null, sndDevs = null, lastBrowserDevs = null;
  const lastLevel = {};
  function renderMixer() {
    const el = document.getElementById("soundPanel");
    if (!el || el.hidden) return;
    for (const [k, , , , min] of LEVELS) {
      const row = el.querySelector(`.lvl[data-k="${k}"]`), r = row.querySelector("input"), v = Math.max(min, levelNow(k));
      if (document.activeElement !== r) r.value = v;
      r.style.setProperty("--pct", v + "%"); row.querySelector("output").textContent = v;
      row.classList.toggle("muted", v <= min);
    }
    el.querySelectorAll(".nights button").forEach((b) => b.classList.toggle("on", b.dataset.n === (prefs.night ?? "dark")));
  }
  const mixTimer = {};
  function setLevel(k, n) {
    const min = LEVELS.find((m) => m[0] === k)[4];
    n = Math.max(min, Math.min(100, Math.round(Number(n) || 0)));
    prefs[k] = n;
    if (["volume", "soundsVolume", "alarmVolume", "callVolume"].includes(k)) applyVolume();
    else if (!ducked) { if (k === volKey() && yt?.setVolume) try { yt.setVolume(ytFull()); } catch { /* gone */ } if (k === "musicVolume" && P.source === "spotify") sp?.setVolume(n / 100).catch(() => {}); if (k === "musicVolume" && P.source === "spotify-window") post("/player/window", { action: "volume", value: n }).catch(() => {}); }
    renderMixer(); renderPlayer?.();
    clearTimeout(mixTimer[k]); mixTimer[k] = setTimeout(() => post("/settings", { [k]: n }).catch(() => {}), 350);
  }
  // a short chime on one exact device (only when the owner clicks ▶)
  async function testOn(label) {
    try {
      const ctx = new AudioContext(), dest = ctx.createMediaStreamDestination(), g = ctx.createGain();
      g.gain.value = 0.25; g.connect(dest);
      [784, 1046.5].forEach((f, i) => { const o = ctx.createOscillator(), e = ctx.createGain(); o.frequency.value = f; const t = ctx.currentTime + i * 0.14; e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(0.8, t + 0.01); e.gain.exponentialRampToValueAtTime(0.0001, t + 0.9); o.connect(e).connect(g); o.start(t); o.stop(t + 1); });
      const a = new Audio(); a.srcObject = dest.stream;
      const d = (lastBrowserDevs ?? await audioDevices()).find((x) => x.label && (x.label === label || x.label.includes(label) || label.includes(x.label)));
      if (d && a.setSinkId) await a.setSinkId(d.id);
      await a.play(); setTimeout(() => { a.pause(); ctx.close(); }, 1500);
    } catch { playSound("chime"); }
  }
  function renderOutputs() {
    const box = snd.querySelector(".outs");
    if (!sndDevs) return;
    const outs = sndDevs.filter((g) => g.outputs?.length);
    const def = (prefs.audioOutputs ?? ["default"]).includes("default");
    box.innerHTML = outs.map((g) => `<label class="dev"><input type="checkbox" data-key="${esc(g.key)}" ${!def && g.inUse?.sound ? "checked" : ""}>
        <span class="ic" aria-hidden="true">${TYPE_ICON[g.type] ?? "🔈"}</span><span class="nm">${esc(g.nickname || g.name)}<small>${esc(g.typeWord ?? "")}${g.nickname ? " · " + esc(g.name) : ""}</small></span>
        ${!def && g.inUse?.sound ? `<span class="st">in use</span>` : ""}<button class="tst" data-test-dev="${esc(g.outputs[0]?.name ?? "")}" title="Play a test chime on this one" aria-label="Test ${esc(g.nickname || g.name)}">▶</button></label>`).join("")
      + `<label class="dev"><input type="checkbox" data-key="default" ${def ? "checked" : ""}><span class="ic" aria-hidden="true">🖥</span><span class="nm">Windows default<small>Whatever Windows is set to use</small></span>${def ? `<span class="st">in use</span>` : ""}<span></span></label>`;
  }
  function renderInputs() {
    const box = snd.querySelector(".ins");
    if (!sndDevs) return;
    const ins = sndDevs.filter((g) => g.inputs?.length);
    box.innerHTML = ins.length ? ins.map((g) => `<label class="dev"><input type="radio" name="dsmic" data-key="${esc(g.key)}" ${g.inUse?.mic ? "checked" : ""}>
        <span class="ic" aria-hidden="true">${TYPE_ICON[g.type] ?? "🎙️"}</span><span class="nm">${esc(g.nickname || g.name)}<small>${esc(g.typeWord ?? "microphone")}</small></span>${g.inUse?.mic ? `<span class="st">listening</span>` : ""}<span></span></label>`).join("")
      : `<p class="hint">No microphones found.</p>`;
  }
  async function renderCalls() {
    const box = snd.querySelector(".calls");
    let st = null, devs = [];
    try { st = await json("/tunein"); } catch { box.innerHTML = `<p class="hint">Tune in isn't available here.</p>`; return; }
    try { devs = (await json("/tunein/devices")).devices ?? []; } catch { /* list unavailable */ }
    let saved = ""; try { saved = localStorage.getItem("ds-tune-device") ?? ""; } catch { /* no storage */ }
    const want = st.deviceWanted ?? saved ?? "";
    box.innerHTML = `<label class="row">Listen to <select aria-label="Tune in listens to"><option value="">What Windows plays on (default)</option>${devs.map((d) => `<option value="${esc(d.id)}" ${d.id === want ? "selected" : ""}>${esc(d.name)}${d.default ? " (default)" : ""}</option>`).join("")}</select></label>
      <label class="dev"><input type="checkbox" data-act="talk" ${st.talk?.talk ? "checked" : ""}><span class="ic" aria-hidden="true">🗣</span><span class="nm">Answer into the call<small>${st.talk?.talk ? (st.talk.voicemeeter?.running ? "On: friends hear me through your mic" : "On, but the call mixer isn't running") : "Off: answers play only for you"}</small></span><span></span><span></span></label>
      <p class="hint">Tune in is ${st.on ? `<b>on</b>${st.device ? " (" + esc(st.device) + ")" : ""}` : "off"}. The 🎧 button turns it on and off.</p>`;
    box.querySelector("select").onchange = async (e) => {
      const id = e.target.value; try { localStorage.setItem("ds-tune-device", id); } catch { /* no storage */ }
      if (st.on) await post("/tunein", { on: true, device: id || null }).catch(() => {});
    };
    box.querySelector('[data-act="talk"]').onchange = async (e) => { await post("/call/talk", { on: e.target.checked }).catch(() => {}); renderCalls(); };
  }
  async function loadSoundDevices(fresh = false) {
    try { sndDevs = (await json(`/devices${fresh ? "?fresh=1" : ""}`)).devices ?? []; } catch { sndDevs = []; }
    renderOutputs(); renderInputs();
  }
  function openSound(section) {
    sndOpener = document.activeElement;
    snd.hidden = false; renderMixer();
    loadSoundDevices(); renderCalls();
    const target = section === "volume" ? snd.querySelector(".sv input") : snd.querySelector(".x");
    setTimeout(() => (target ?? snd).focus(), 30);
  }
  function closeSound() { if (snd.hidden) return; snd.hidden = true; try { sndOpener?.focus?.(); } catch { /* gone */ } }
  const toggleSound = (section) => (snd.hidden ? openSound(section) : closeSound());
  window.dsSound = { open: openSound, close: closeSound, toggle: toggleSound };
  // routeAudio() calls this after the outputs change
  function renderAudioPanel(devs) { if (devs) lastBrowserDevs = devs; if (!snd.hidden) loadSoundDevices(true); }
  gear.onclick = () => toggleSound();
  mixBtn.onclick = () => toggleSound("volume");
  snd.addEventListener("input", (e) => { const row = e.target.closest(".lvl"); if (row && e.target.matches("input[type=range]")) setLevel(row.dataset.k, e.target.value); });
  snd.addEventListener("change", async (e) => {
    const inp = e.target;
    if (inp.matches('.outs input[type="checkbox"]')) {
      let keys = [...snd.querySelectorAll('.outs input:checked')].map((i) => i.dataset.key);
      if (inp.dataset.key === "default" && inp.checked) keys = ["default"]; else keys = keys.filter((k) => k !== "default");
      if (!keys.length) keys = ["default"];
      let r = await post("/sound/outputs", { keys }).catch(() => null);
      if (!r && keys.length === 1 && keys[0] !== "default") r = await post("/devices/use", { key: keys[0], as: "sound" }).catch(() => null);
      if (r?.devices) sndDevs = r.devices;
      try { prefs = (await json("/settings")).settings ?? prefs; } catch { /* keep */ }
      await routeAudio().catch(() => {}); renderOutputs();
    } else if (inp.matches('.ins input[type="radio"]')) {
      const r = await post("/devices/use", { key: inp.dataset.key, as: "mic" }).catch(() => null);
      if (r?.devices) sndDevs = r.devices; renderInputs();
    }
  });
  snd.addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.act === "close") return closeSound();
    if (b.dataset.act === "win") { post("/sound/windows", {}).catch(() => {}); return; }
    if (b.dataset.n) { try { const r = await post("/settings", { night: b.dataset.n }); prefs = r.settings ?? prefs; nightCheck(); renderMixer(); } catch (err) { push("sys", err.message); } return; }
    if (b.dataset.testDev !== undefined) { e.preventDefault(); return testOn(b.dataset.testDev); }
    if (b.dataset.test === "volume") return speak("This is how loud my voice is.");
    if (b.dataset.test === "soundsVolume") return playSound("chime");
    if (b.dataset.test === "alarmVolume") return onBus("notify", () => SOUNDS.alarm(), { alarm: true });
    if (b.dataset.test === "outputs") { playSound("motif"); setTimeout(() => speak("This is Dayspring, playing on " + (routedTo[0] === "default" ? "the default output." : routedTo.join(" and ") + ".")), 900); return; }
    const m = b.closest(".mute");
    if (m) {
      const k = m.closest(".lvl").dataset.k, min = LEVELS.find((x) => x[0] === k)[4], cur = levelNow(k);
      if (cur > min) { lastLevel[k] = cur; setLevel(k, min); } else setLevel(k, lastLevel[k] || 60);
    }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !snd.hidden) { e.stopPropagation(); closeSound(); } }, true);
  document.addEventListener("pointerdown", (e) => { if (!snd.hidden && !snd.contains(e.target) && !e.target.closest?.("#mixBtn, .wbar, .morebox") && e.target !== gear) closeSound(); });
  function renderBell() {
    applyVolume();
    bellBtn.textContent = BELL[prefs.mode] ?? BELL.voice;
    // the TV's safe area ("the screen is cut off" moves everything in from the edges)
    document.documentElement.style.setProperty("--os", String(OS_TEST ?? prefs.overscan ?? 5));
  }
  bellBtn.onclick = async () => {
    const order = ["voice", "chime", "silent"];
    const next = order[(order.indexOf(prefs.mode) + 1) % 3];
    try { const r = await post("/settings", { mode: next }); prefs = r.settings; renderBell(); push("sys", r.summary); } catch (e) { push("sys", e.message); }
  };

  let pendingSpeech = null;
  function needStart(text) { if (text) pendingSpeech = text; $("#start").hidden = false; }
  $("#startBtn").onclick = async () => {
    $("#start").hidden = true;
    try { await audioCtx().resume(); } catch { /* ignore */ }
    await routeAudio().catch(() => {});
    playSound("hello");
    startListening();
    startMicMonitor();
    if (pendingSpeech) { const t = pendingSpeech; pendingSpeech = null; speak(t); }
  };
  $("#sayNow").onclick = () => post("/announce/now").catch((e) => push("sys", e.message));
  $("#full").onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
  // the voice dropdown: every voice the current provider has (free ones come from this computer)
  $("#voice").onchange = async (e) => { try { await useVoice(e.target.value); } catch (err) { push("sys", err.message); } };
  async function fillVoiceDropdown() {
    try {
      const v = await voiceList();
      $("#voice").hidden = !v.list.length;
      $("#voice").innerHTML = v.list.map((x) => `<option value="${esc(x.id)}" ${x.id === v.cur || x.name === v.cur ? "selected" : ""}>${esc(x.name)}${/natural/.test(x.describe) ? " ✨" : ""}</option>`).join("");
    } catch { $("#voice").hidden = true; }
  }
  if (window.speechSynthesis) speechSynthesis.addEventListener?.("voiceschanged", () => { if (voiceProvider === "browser") fillVoiceDropdown(); });
  document.addEventListener("mousemove", () => wake(20_000));

  async function boot() {
    renderClock();
    try { config = await json("/tv/config"); } catch { /* defaults */ }
    if (config.setupDone === false) { location.href = "/setup"; return; }
    try { prefs = (await json("/settings")).settings; } catch { /* defaults */ }
    renderBell();
    buildWake();
    try {
      await fillVoiceDropdown();
    } catch { $("#voice").hidden = true; }
    try { const s = await json("/sounds"); s.files.forEach((f) => { soundFiles[f.name.toLowerCase()] = f.url; }); } catch { /* none */ }
    await loadDay(); await loadLearning();
    loadSpecial(); loadShowcase().then(() => setCalView("day"));
    setInterval(() => { renderClock(); if (new Date().getSeconds() % 15 === 0) renderDay(); else renderBar(); }, 1000);
    setInterval(() => { loadDay(); loadLearning(); }, 60_000);
    connectEvents();
    initSpotify();
    push("sys", `Say “${cap(config.wakePhrases[0])}” and ask anything. The bell sets how I notify you.`);
    const ctx = audioCtx();
    // resume() never settles in a tab that hasn't been clicked yet, so give it half a second
    if (ctx.state !== "running") { try { await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 500))]); } catch { /* needs a click */ } }
    driftNightClock();
    if (ctx.state !== "running") needStart(); else { await routeAudio().catch(() => {}); startListening(); startMicMonitor(); playSound("hello"); }
  }
  window.dayspring = { playSound, speak, playMedia, stopMedia, stage, ask, showNowPlaying, toast, burst, startAlarm, dismissAlarm, notify, startMorning, hearing, politeMoment, player: P, playerCtl: ctl, musicCommand, initSpotify };
  boot();
})();
