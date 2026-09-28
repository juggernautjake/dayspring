// A secret personality was found (lib/persona): confetti and a small card on the Dayspring screen and the mini.
// The spoken line and the desktop card come through the normal notification path (kind "discovery").
(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  function confetti() {
    if (reduced()) return;
    const c = document.createElement("canvas");
    c.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483000";
    document.body.appendChild(c);
    const ctx = c.getContext("2d"), dpr = window.devicePixelRatio || 1;
    const W = (c.width = innerWidth * dpr), H = (c.height = innerHeight * dpr);
    const colors = ["#ffd27a", "#a78bfa", "#6ea8fe", "#ff8fa3", "#7ee3b0", "#67e8f9"];
    const bits = Array.from({ length: 140 }, () => ({ x: W / 2 + (Math.random() - 0.5) * W * 0.3, y: H * 0.35, vx: (Math.random() - 0.5) * 14 * dpr, vy: (-6 - Math.random() * 10) * dpr, r: (3 + Math.random() * 4) * dpr, c: colors[(Math.random() * colors.length) | 0], a: Math.random() * 6, s: Math.random() < 0.3 }));
    const t0 = performance.now();
    const step = (t) => {
      ctx.clearRect(0, 0, W, H);
      for (const b of bits) { b.vy += 0.35 * dpr; b.x += b.vx; b.y += b.vy; b.vx *= 0.99; b.a += 0.2; ctx.fillStyle = b.c; ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a); if (b.s) { ctx.beginPath(); ctx.arc(0, 0, b.r, 0, 7); ctx.fill(); } else ctx.fillRect(-b.r, -b.r / 2, b.r * 2, b.r); ctx.restore(); }
      if (t - t0 < 3200) requestAnimationFrame(step); else c.remove();
    };
    requestAnimationFrame(step);
  }
  function card(d) {
    const el = document.createElement("div");
    el.setAttribute("role", "status"); el.className = "sfx-card";   // top right, inside the screen margins: safe-area.css
    el.style.cssText = "position:fixed;z-index:2147483001;display:flex;gap:.7em;align-items:center;padding:.8em 1em;border-radius:.9em;background:rgba(20,24,50,.96);color:#eef0ff;border:1px solid #ffd27a;box-shadow:0 14px 44px rgba(0,0,0,.55),0 0 30px rgba(255,210,122,.3);font:inherit";
    el.innerHTML = `<span style="font-size:1.8em;line-height:1">${esc(d.icon)}</span><div>${d.unlockedNow ? `<b>🔓 Unlocked: ${esc(d.name)}!</b><br>${esc(d.reveal)}` : `<b>✨ Secret character discovered</b><br>${esc(d.name)}: ${esc(d.reveal)}<br><small style="opacity:.75">${esc(d.found)} of ${esc(d.total)} found · Settings → Personality</small>`}</div><button type="button" aria-label="Close" style="background:none;border:0;color:inherit;font-size:1.2em;cursor:pointer">✕</button>`;
    el.querySelector("button").onclick = () => el.remove();
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 9000);
  }
  function hook(es) {
    if (!es || es.__dsSecrets) return;
    es.__dsSecrets = true;
    es.addEventListener("persona-discovered", (e) => { try { const d = JSON.parse(e.data); confetti(); card(d); } catch { /* bad event */ } });
  }
  hook(window.dsEvents);
  window.addEventListener("ds-events", (e) => hook(e.detail));
  window.dsSecretsFx = { confetti, card };
})();
