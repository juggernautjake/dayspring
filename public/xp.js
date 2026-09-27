// XP on the Dayspring screen: a small badge (level, a ring to the next level, the balance) that sparkles when XP is
// earned, and the Progress page (/progress). XP is earned only by checking in on real tasks (see docs/xp.md).
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = (p, body) => fetch("/api" + p, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}).then((r) => r.json());
  const LABEL = { workout: "Workout", study: "Study", reading: "Reading", work: "Work / focus", chore: "Chore", prayer: "Prayer", call: "Called someone", writing: "Writing", practice: "Practice", outdoors: "Outdoors", cooking: "Cooking", sleep: "Bed on time",
    sports: "Sports", eating: "Healthy meal", worship: "Worship", volunteer: "Service", art: "Art", mindfulness: "Mindfulness" };

  const PAGE = "xp-" + (crypto.randomUUID?.() ?? String(Math.random()).slice(2));      // when tv.js hasn't given one
  // ---------------------------------------------------------------------------------------------- the badge (display)
  function ring(p) { const r = 15, c = 2 * Math.PI * r; return `<svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="${r}" class="xpr-bg"/><circle cx="18" cy="18" r="${r}" class="xpr-fg" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - p)).toFixed(1)}"/></svg>`; }
  function badge() {
    if ($("#xpPage") || $("#xpBadge")) return;
    const b = document.createElement("button");
    b.id = "xpBadge"; b.type = "button"; b.className = "xp-badge"; b.hidden = true;
    b.title = "Your XP: check in on real tasks to earn it";
    b.onclick = () => (window.dsOpenPage ? window.dsOpenPage("/progress?embed=1") : (location.href = "/progress"));
    document.body.appendChild(b);
    let last = null;
    const paint = (v) => {
      if (!v || v.enabled === false) { b.hidden = true; return; }
      b.hidden = false;
      const pins = v.badges?.pins ?? [];
      b.innerHTML = `${ring(v.level.progress)}<span class="xpb-lv">${v.level.level}</span><span class="xpb-xp">${v.balance} XP</span>${pins.length ? `<span class="xpb-case">${pins.map((k) => { const [c, t] = k.split(":"); return `<img src="/api/xp/badge.svg?cat=${encodeURIComponent(c)}&tier=${t}&mode=static&size=48" alt="" width="24" height="24">`; }).join("")}</span>` : ""}`;
      b.setAttribute("aria-label", `Level ${v.level.level}, ${v.level.title}. ${v.balance} XP.`);
      if (last !== null && v.balance > last) { b.classList.remove("xp-spark"); void b.offsetWidth; b.classList.add("xp-spark"); }
      last = v.balance;
    };
    const load = () => api("/xp").then(paint).catch(() => {});
    load();
    const hook = (es) => {
      es.addEventListener("xp", (e) => {
        let d = {}; try { d = JSON.parse(e.data); } catch { /* fine */ }
        if (d.view) paint(d.view); else load();
        const ds = window.dayspring;
        if (d.kind === "award" && ds?.toast) ds.toast(`+${d.amount} XP`, `${LABEL[d.category] ?? "Check-in"}${d.evidence ? ": " + String(d.evidence).slice(0, 80) : ""}`, "", "star");
        if (d.kind === "levelup" && ds) { ds.toast?.(`Level ${d.level.level}!`, `You're now a ${d.level.title}. 🎉`, "", "star"); ds.burst?.(220, 60); }
        if (d.kind === "badge") window.dsBadges?.reveal(d);             // the coin-flip reveal (one after another)
        // a visual-only badge nudge (silent or chime mode): shown as a toast; only once it's shown does it count as sent
        if (d.kind === "badge-nudge" && d.ack && ds?.toast && document.visibilityState === "visible") { ds.toast("Badge", String(d.text ?? ""), "", "star"); api("/xp/badges/nudged", { cat: d.cat }).catch(() => {}); }
      });
    };
    if (window.dsEvents) hook(window.dsEvents); else window.addEventListener("ds-events", (e) => hook(e.detail), { once: true });
    setInterval(load, 5 * 60_000);
    // "stop listening" lives on the screen: tell the server, so it never asks a check-in question then
    // per page (the page that speaks is the one that counts)
    const report = () => api("/xp/presence", { stopped: document.documentElement.hasAttribute("data-stopped"), page: window.dsPageId || PAGE }).catch(() => {});
    new MutationObserver(report).observe(document.documentElement, { attributes: true, attributeFilter: ["data-stopped"] });
    report();
  }

  // ---------------------------------------------------------------------------------------------- the Progress page
  // XP added to the balance each day (at most 80: the daily limit line), check-ins and learning stacked
  function chart(days) {
    const spend = (d) => d.spend ?? d.xp, max = Math.max(80, ...days.map(spend)), w = 14 * 22, px = (n) => Math.round((n / max) * 90);
    const bars = days.map((d, i) => {
      const c = d.checkins ?? spend(d), l = d.learning ?? 0, hc = px(c), hl = px(l), x = i * 22 + 3;
      const tip = `${esc(d.day)}: ${spend(d)} XP to spend (check-ins ${c}, learning ${l})${d.xp > spend(d) ? ` · ${d.xp} earned in all` : ""}`;
      const parts = spend(d) ? `${hc ? `<rect x="${x}" y="${100 - hc}" width="16" height="${hc}" rx="3" class="xpc-bar"/>` : ""}${hl ? `<rect x="${x}" y="${100 - hc - hl}" width="16" height="${hl}" rx="3" class="xpc-learn"/>` : ""}` : `<rect x="${x}" y="99" width="16" height="1" rx="1" class="xpc-zero"/>`;
      return `<g><title>${tip}</title>${parts}<text x="${i * 22 + 11}" y="114" class="xpc-lbl">${esc(d.day.slice(8))}</text></g>`;
    }).join("");
    const cap = 100 - px(80);
    const legend = `<p class="xpc-legend"><span><i class="xpc-key xpc-bar"></i>Check-ins</span><span><i class="xpc-key xpc-learn"></i>Learning (Lantern)</span><span class="xp-muted">XP added to spend each day</span></p>`;
    return `<svg class="xp-chart" viewBox="0 0 ${w} 118" role="img" aria-label="XP added to your balance each day for the last 14 days, check-ins and learning"><line x1="0" x2="${w}" y1="${cap}" y2="${cap}" class="xpc-cap"/><text x="${w - 2}" y="${cap - 3}" class="xpc-caplbl">daily limit 80</text>${bars}</svg>${legend}`;
  }
  async function page(root) {
    const v = await api("/xp").catch(() => null);
    if (!v) { root.innerHTML = `<p class="xp-err">XP couldn't load. Is Dayspring running?</p>`; return; }
    const lv = v.level, st = v.streak, r = v.rules;
    const unl = v.unlockables ?? [];
    root.innerHTML = `<nav class="xp-tabs" role="tablist"><button type="button" role="tab" data-tab="overview">Overview</button><button type="button" role="tab" data-tab="badges">Badges</button><button type="button" role="tab" data-tab="learning">Learning</button></nav>
      <div id="xpTabBadges" role="tabpanel" hidden></div><div id="xpTabLearning" role="tabpanel" hidden></div><div id="xpTabOverview" role="tabpanel">
      <section class="xp-hero">
        <div class="xp-lvring">${ring(lv.progress)}<span>${lv.level}</span></div>
        <div><h1>${esc(lv.title)}</h1><p>${v.balance} XP to spend · ${v.lifetime} earned in all · ${lv.next - lv.into} XP to level ${lv.level + 1}</p>
          <p class="xp-streak">${st.days ? `🔥 ${st.days}-day streak${st.doneToday ? "" : " · check in today to keep it"}` : "No streak yet: check in on a task today to start one."}</p></div>
      </section>
      ${v.enabled ? "" : `<p class="xp-off">XP is turned off. Turn it on below.</p>`}
      <section><h2>Last 14 days</h2>${chart(v.daily)}</section>
      <section><h2>Check in</h2>
        <form id="xpCheck" class="xp-check"><label for="xpText">Tell Dayspring what you finished</label>
          <div class="xp-row"><input id="xpText" autocomplete="off" placeholder="I studied for an hour · I did the dishes · I went for a run"><button type="submit">Check in</button></div>
          <p id="xpReply" class="xp-reply" aria-live="polite"></p></form></section>
      <section><h2>Secret characters</h2>
        ${unl.length ? `<ul class="xp-unl">${unl.map((u) => `<li class="${u.unlocked ? "done" : u.found ? "ready" : "hidden"}">${u.unlocked ? `${esc(u.icon ?? "✨")} ${esc(u.name)} <em>unlocked</em>` : u.found ? `${esc(u.icon ?? "✨")} ${esc(u.name)} <button data-unlock="${esc(u.id)}" ${v.balance >= (u.price ?? 1e9) ? "" : "disabled"}>Unlock · ${u.price} XP</button>` : `??? <span class="xp-hint">${esc(u.hint ?? "Still hidden")}</span>`}</li>`).join("")}</ul>` : `<p class="xp-muted">Secret characters appear here once the Personality feature is set up.</p>`}
        <p class="xp-muted">Find a secret character first (say or do the right thing), then unlock it with XP. The first costs ${r.characterFirst} XP, and each one after costs ${r.characterStep} more.</p></section>
      <section><h2>Recent check-ins</h2>${v.recent.length ? `<ul class="xp-recent">${v.recent.map((e) => `<li class="${e.reversed ? "rev" : ""}"><b>${e.type === "spend" ? "−" + e.amount : e.type === "reversal" ? "undo " + e.amount : "+" + e.amount}</b> ${esc(e.type === "spend" ? "Unlock" : LABEL[e.category] ?? e.category ?? "")} ${e.title ? `<span class="xp-muted">(${esc(e.title)})</span>` : ""}${e.evidence ? `<div class="xp-ev">${esc(e.evidence)}</div>` : ""}<time>${esc(e.day)}</time></li>`).join("")}</ul><button id="xpUndo" type="button" class="xp-link">Undo my last check-in</button>` : `<p class="xp-muted">Nothing yet. Finish something, then tell Dayspring about it.</p>`}</section>
      <section><h2>How to earn XP</h2>
        <ul class="xp-rules">${Object.entries(r.categories).map(([id, c]) => `<li><b>${esc(c.label)}</b> ${c.perHour ? `${c.perHour} per hour (up to ${c.maxHours} h)` : `${c.base}`}${c.bonus ? ` · +${c.bonus} for a great takeaway` : ""} <span class="xp-muted">up to ${c.max}× a day${c.proof === "learned" ? " · tell Dayspring what you learned" : c.proof === "honour" ? " · no proof needed" : ""}</span></li>`).join("")}</ul>
        <p class="xp-muted">At most ${r.dailyCap} XP a day. Check-ins you start yourself count ${Math.round(r.selfReport * 100)}%; checking in when a scheduled block ends (or a Dayspring timer finishes) counts in full. Partly done counts in part. Today or yesterday only, ${r.minGapHours} hours apart for the same kind of task. XP stays on this computer.</p></section>
      <section><h2>Settings</h2>
        <label class="xp-sw"><input type="checkbox" id="xpOn" ${v.enabled ? "checked" : ""}> Earn XP</label>
        ${v.enabled ? "" : `<label class="xp-sw"><input type="checkbox" id="xpQuiet" ${v.settings.trackHidden ? "checked" : ""}> Keep tracking quietly while hidden <span class="xp-muted">(Lantern learning is still recorded, with nothing shown or said)</span></label>`}
        <fieldset class="xp-rem"><legend>Ask me to check in when these end</legend>${Object.entries(r.categories).map(([id, c]) => `<label><input type="checkbox" data-rem="${esc(id)}" ${v.settings.reminders[id] !== false ? "checked" : ""}> ${esc(c.label)}</label>`).join("")}</fieldset></section></div>`;
    tabs(root);
    let session = null;
    $("#xpCheck", root).onsubmit = async (e) => {
      e.preventDefault(); const t = $("#xpText", root).value.trim(); if (!t) return;
      // answers go only to this page's own typed check-in (its session id); a new sentence starts a new one
      let out = session ? await api("/xp/answer", { text: t, id: session }).catch(() => null) : null;
      if (!out || out.expired) out = await api("/xp/checkin", { text: t }).catch(() => ({ reply: "Something went wrong. Try again." }));
      session = out.awaiting && out.session ? out.session : null;
      $("#xpReply", root).textContent = out.reply ?? "I didn't recognise a finished task there. Try “I studied” or “I did the dishes”.";
      $("#xpText", root).value = "";
      if (out.xp?.ok) setTimeout(() => page(root), 900); else $("#xpText", root).focus();
    };
    for (const btn of root.querySelectorAll("[data-unlock]")) btn.onclick = async () => { btn.disabled = true; const r2 = await api("/xp/unlock", { id: btn.dataset.unlock }); alertLine(root, r2.message); setTimeout(() => page(root), 1200); };
    const undo = $("#xpUndo", root); if (undo) undo.onclick = async () => { const r2 = await api("/xp/undo", {}); alertLine(root, r2.message); setTimeout(() => page(root), 800); };
    $("#xpOn", root).onchange = (e) => api("/xp/settings", { enabled: e.target.checked }).then(() => page(root));
    const quiet = $("#xpQuiet", root); if (quiet) quiet.onchange = (e) => api("/xp/settings", { trackHidden: e.target.checked });
    for (const c of root.querySelectorAll("[data-rem]")) c.onchange = () => api("/xp/settings", { reminders: { [c.dataset.rem]: c.checked } });
  }
  // Overview · Badges · Learning (the address says which: /progress#badges)
  function tabs(root) {
    const show = (name) => {
      for (const b of root.querySelectorAll("[data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === name));
      $("#xpTabOverview", root).hidden = name !== "overview"; $("#xpTabBadges", root).hidden = name !== "badges"; $("#xpTabLearning", root).hidden = name !== "learning";
      if (name === "badges" && !$("#xpTabBadges", root).dataset.on) { $("#xpTabBadges", root).dataset.on = "1"; window.dsBadges?.gallery($("#xpTabBadges", root)); }
      if (name === "learning" && !$("#xpTabLearning", root).dataset.on) { $("#xpTabLearning", root).dataset.on = "1"; window.dsLearning?.panel($("#xpTabLearning", root)); }
    };
    for (const b of root.querySelectorAll("[data-tab]")) b.onclick = () => { history.replaceState(null, "", "#" + b.dataset.tab); show(b.dataset.tab); };
    const want = (location.hash || "").slice(1);
    show(["badges", "learning"].includes(want) ? want : "overview");
    window.onhashchange = () => { const h = location.hash.slice(1); if (["overview", "badges", "learning"].includes(h)) show(h); };
  }
  function alertLine(root, text) { const p = $("#xpReply", root) ?? root; p.textContent = text ?? ""; }

  const start = () => { const pg = $("#xpPage"); if (pg) page(pg); else badge(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  window.dsXP = { refresh: () => { const pg = $("#xpPage"); if (pg) page(pg); } };
})();
