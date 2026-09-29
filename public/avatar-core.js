// Dayspring's avatars: five animated faces drawn on a canvas, plus "your picture" (public/avatar.js puts one on the
// Dayspring screen; Settings → Look & feel shows them all as live previews). All original, drawn here in code.
//
//   DsAvatarCore.STYLES                       { aurora, sunring, blob, halo, pixel }: each { name, draw(ctx, W, H, t, S, P, mem) }
//   DsAvatarCore.mount(host, { style, signal, size, fps })  → { setStyle, destroy, canvas, stats }
//        signal() → { state, level 0..1, wave (Uint8Array | null) } read every frame
//   DsAvatarCore.palette()                    the colours now: the theme's accent and secondary (or Dayspring's own)
//   DsAvatarCore.STATES                       idle · listen · think · speak · muted · stopped · error · sleep
//
// Every style answers every state:
//   idle: breathes · listen: leans in and brightens (mint) · think: something orbits · speak: moves with the voice
//   muted (Off / deafened): closed off (earmuffs, an eclipse, a flat line) · stopped: paused · error: sputters · sleep: Zzz
(function (root) {
  "use strict";
  const TAU = Math.PI * 2;
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const lerp = (a, b, k) => a + (b - a) * k;
  const hex = (h) => { h = String(h).replace("#", ""); if (h.length === 3) h = h.split("").map((c) => c + c).join(""); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
  const rgba = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
  const mix = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
  const noise = (t, s) => Math.sin(t * 1.7 + s) * 0.5 + Math.sin(t * 2.9 + s * 1.3) * 0.3 + Math.sin(t * 5.3 + s * 2.1) * 0.2;
  const STATES = ["idle", "listen", "think", "speak", "muted", "stopped", "error", "sleep"];

  function palette() {
    const tk = root.dsTheme?.tokens, parse = (s) => { const c = root.DsThemeCore?.parse?.(s); return c ? c.slice(0, 3) : null; };
    const a = (tk && parse(tk.accent)) || hex("#7c8cff"), b = (tk && parse(tk.secondary)) || hex("#a78bfa");
    const light = root.dsTheme?.mode === "light";
    return { a, b, c: mix(a, hex("#67e8f9"), 0.5), mint: hex("#7ee3b0"), gold: hex("#ffd27a"), rose: hex("#ff8fa3"), warn: hex("#ffb35c"), ink: light ? hex("#141833") : hex("#eef0ff"), dark: light ? hex("#dfe4f5") : hex("#0b0e22"), light };
  }

  // little shared marks
  function zzz(x, W, cx, cy, t, col) {
    x.save(); x.fillStyle = rgba(col, 0.85); x.textAlign = "center";
    for (let i = 0; i < 3; i++) {
      const ph = ((t / 2400) + i / 3) % 1;
      x.globalAlpha = Math.sin(ph * Math.PI);
      x.font = `600 ${Math.round(W * (0.05 + i * 0.012))}px Outfit, system-ui, sans-serif`;
      x.fillText("z", cx + W * (0.02 + ph * 0.12), cy - W * (0.02 + ph * 0.16));
    }
    x.restore();
  }
  function badge(x, W, kind, P, t) {
    // a small round sign at the top right: "muted" (a slashed ear-wave), "stopped" (pause), "error" (!)
    const r = W * 0.075, bx = W * 0.8, by = W * 0.2;
    x.save();
    x.fillStyle = rgba(P.dark, 0.82); x.strokeStyle = rgba(kind === "error" ? P.warn : P.ink, 0.9); x.lineWidth = W / 160;
    x.beginPath(); x.arc(bx, by, r, 0, TAU); x.fill(); x.stroke();
    x.strokeStyle = rgba(kind === "error" ? P.warn : P.ink, 0.95); x.fillStyle = x.strokeStyle; x.lineCap = "round"; x.lineWidth = W / 90;
    if (kind === "stopped") { for (const dx of [-0.28, 0.28]) { x.beginPath(); x.moveTo(bx + dx * r, by - r * 0.4); x.lineTo(bx + dx * r, by + r * 0.4); x.stroke(); } }
    else if (kind === "error") { x.beginPath(); x.moveTo(bx, by - r * 0.45); x.lineTo(bx, by + r * 0.1); x.stroke(); x.beginPath(); x.arc(bx, by + r * 0.4, W / 180, 0, TAU); x.fill(); }
    else { x.beginPath(); x.arc(bx - r * 0.12, by, r * 0.38, -Math.PI * 0.6, Math.PI * 0.6); x.stroke(); x.beginPath(); x.moveTo(bx - r * 0.55, by + r * 0.55); x.lineTo(bx + r * 0.55, by - r * 0.55); x.stroke(); }
    x.restore(); void t;
  }

  // ---------------------------------------------------------------------------------------------------- 1. aurora flame
  const aurora = {
    name: "Aurora flame",
    draw(x, W, H, t, S, P, m) {
      const cx = W / 2, base = H * 0.78, st = S.state, L = S.level;
      m.sparks ??= Array.from({ length: 40 }, () => ({ x: 0, y: 0, v: 0, life: 0 }));
      const small = st === "muted" || st === "stopped" || st === "sleep";
      const scale = small ? (st === "sleep" ? 0.38 : 0.5) : st === "listen" ? 1.08 : 1;
      const lean = st === "listen" ? -0.06 : 0;
      const col = st === "error" ? [P.warn, P.rose, P.gold] : st === "muted" ? [mix(P.a, [120, 130, 160], 0.6), mix(P.b, [120, 130, 160], 0.6), [170, 180, 210]] : st === "listen" ? [P.a, P.mint, mix(P.mint, [255, 255, 255], 0.4)] : [P.a, P.b, P.c];
      const dim = st === "stopped" ? 0.55 : st === "sleep" ? 0.6 : 1;
      // the glow on the ground
      const g0 = x.createRadialGradient(cx, base, 0, cx, base, W * 0.42 * scale);
      g0.addColorStop(0, rgba(col[0], 0.45 * dim + L * 0.3)); g0.addColorStop(1, rgba(col[0], 0));
      x.fillStyle = g0; x.beginPath(); x.ellipse(cx, base, W * 0.42 * scale, H * 0.12 * scale, 0, 0, TAU); x.fill();
      x.save(); x.globalCompositeOperation = "lighter";
      const ts = t / 1000, sp = st === "think" ? 1.6 : st === "speak" ? 1.4 + L : st === "error" ? 3 : 1;
      const N = 6;
      for (let k = 0; k < N; k++) {
        const off = (k - (N - 1) / 2) / N;
        let h = H * 0.52 * scale * (0.55 + 0.45 * Math.cos(off * 2.6)) * (1 + 0.14 * noise(ts * sp, k * 1.7));
        if (st === "speak") h *= 1 + L * (0.55 + 0.35 * noise(ts * 4, k));
        if (st === "error") h *= 0.6 + 0.5 * Math.abs(noise(ts * 6, k));
        const w = W * 0.2 * scale * (1 - Math.abs(off) * 0.9);
        const swirl = st === "think" ? Math.sin(ts * 2.2 + k) * W * 0.06 : 0;
        const bx = cx + off * W * 0.34 * scale, tipX = bx + (noise(ts * sp * 0.8, k * 3) * W * 0.05 + lean * W + swirl) * scale, tipY = base - h;
        const g = x.createLinearGradient(0, base, 0, tipY);
        g.addColorStop(0, rgba(col[0], 0.4 * dim)); g.addColorStop(0.45, rgba(col[1], 0.3 * dim)); g.addColorStop(1, rgba(col[2], 0));
        x.fillStyle = g;
        x.beginPath(); x.moveTo(bx - w, base);
        x.bezierCurveTo(bx - w * 1.1, base - h * 0.45, tipX - w * 0.35, tipY + h * 0.25, tipX, tipY);
        x.bezierCurveTo(tipX + w * 0.35, tipY + h * 0.25, bx + w * 1.1, base - h * 0.45, bx + w, base);
        x.closePath(); x.fill();
      }
      // the bright heart of the flame
      const hh = H * 0.2 * scale * (1 + (st === "speak" ? L * 0.6 : 0.05 * Math.sin(ts * 3)));
      const g2 = x.createRadialGradient(cx, base - hh * 0.4, 0, cx, base - hh * 0.4, hh);
      g2.addColorStop(0, rgba(mix(col[2], [255, 255, 255], 0.6), 0.4 * dim)); g2.addColorStop(0.4, rgba(col[2], 0.25 * dim)); g2.addColorStop(1, rgba(col[1], 0));
      x.fillStyle = g2; x.beginPath(); x.ellipse(cx, base - hh * 0.4, hh * 0.55, hh, 0, 0, TAU); x.fill();
      // sparks rising (more when talking), drifting inward while listening
      const rate = st === "speak" ? 0.5 + L * 2 : st === "listen" ? 0.35 : st === "idle" ? 0.12 : st === "error" ? 0.5 : 0.04;
      for (const p of m.sparks) {
        if (p.life <= 0 && Math.random() < rate * 0.12) { p.x = cx + (Math.random() - 0.5) * W * 0.3 * scale; p.y = base - H * 0.1; p.v = 0.6 + Math.random() * 1.2; p.life = 1; p.dx = (Math.random() - 0.5) * 0.6; }
        if (p.life > 0) {
          p.y -= p.v * H / 260 * (1 + L); p.x += (st === "listen" ? (cx - p.x) * 0.02 : p.dx) + Math.sin(ts * 3 + p.v * 9) * 0.3; p.life -= 0.012;
          x.fillStyle = rgba(mix(col[1], [255, 255, 255], 0.5), p.life * 0.9 * dim);
          x.beginPath(); x.arc(p.x, p.y, W / 260 * (1 + p.v), 0, TAU); x.fill();
        }
      }
      // thinking: embers orbit the flame
      if (st === "think") for (let k = 0; k < 3; k++) { const a = ts * 2.4 + k * TAU / 3; x.fillStyle = rgba(col[2], 0.9); x.beginPath(); x.arc(cx + Math.cos(a) * W * 0.3, base - H * 0.28 + Math.sin(a) * H * 0.08, W / 70, 0, TAU); x.fill(); }
      x.restore();
      if (st === "sleep") zzz(x, W, cx + W * 0.08, base - H * 0.3, t, P.ink);
      if (st === "muted" || st === "stopped" || st === "error") badge(x, W, st, P, t);
    },
  };

  // ---------------------------------------------------------------------------------------------------- 2. sun ring
  const sunring = {
    name: "Sun ring",
    draw(x, W, H, t, S, P, m) {
      const cx = W / 2, cy = H / 2, st = S.state, L = S.level, ts = t / 1000;
      m.lv ??= 0;
      const grow = st === "listen" ? 1.07 : st === "sleep" ? 0.9 : 1;
      const R = W * 0.25 * grow * (1 + (st === "speak" ? L * 0.08 : 0.012 * Math.sin(ts * 1.4)));
      const warm = st === "error" ? P.warn : P.gold;
      const A = st === "listen" ? P.mint : P.a, B = P.b;
      if (st === "sleep") {
        // the sun has set: a crescent moon and a few stars
        x.fillStyle = rgba(mix(P.ink, P.a, 0.25), 0.9); x.beginPath(); x.arc(cx, cy, R * 0.7, 0, TAU); x.fill();
        x.globalCompositeOperation = "destination-out"; x.beginPath(); x.arc(cx + R * 0.32, cy - R * 0.18, R * 0.62, 0, TAU); x.fill(); x.globalCompositeOperation = "source-over";
        for (let i = 0; i < 6; i++) { const a = i * 1.1 + 0.4, rr = R * (1.25 + (i % 3) * 0.18); x.fillStyle = rgba(P.ink, 0.4 + 0.4 * Math.sin(ts * 1.5 + i)); x.beginPath(); x.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, W / 220, 0, TAU); x.fill(); }
        zzz(x, W, cx + R * 0.7, cy - R * 0.6, t, P.ink); return;
      }
      // the glow
      const g = x.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 2);
      g.addColorStop(0, rgba(warm, st === "muted" ? 0.12 : 0.35 + L * 0.35)); g.addColorStop(0.5, rgba(A, 0.14 + L * 0.2)); g.addColorStop(1, rgba(B, 0));
      x.fillStyle = g; x.beginPath(); x.arc(cx, cy, R * 2, 0, TAU); x.fill();
      // the rays: they reach out with the voice
      const N = 60, rot = ts * (st === "think" ? 0.9 : 0.12);
      x.lineCap = "round";
      for (let i = 0; i < N; i++) {
        const a = (i / N) * TAU + rot;
        let v = S.freq ? S.freq[(i * 3) % 80 + 2] / 255 : 0.3 + 0.3 * Math.sin(ts * 3 + i * 0.7);
        if (st !== "speak") v = st === "listen" ? 0.25 + 0.2 * Math.sin(ts * 4 + i) : 0.15 + 0.08 * Math.sin(ts * 1.2 + i * 0.5);
        if (st === "muted" || st === "stopped") v *= 0.3;
        const r1 = R * 1.18, r2 = r1 + W * (0.02 + (i % 2 ? 0 : 0.012)) + v * W * (st === "speak" ? 0.16 * (0.5 + L) : 0.05);
        x.strokeStyle = rgba(mix(warm, i % 2 ? B : A, 0.45), 0.35 + v * 0.55); x.lineWidth = W / (i % 2 ? 260 : 170);
        x.beginPath(); x.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); x.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); x.stroke();
      }
      // the ring itself
      const ring = x.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
      ring.addColorStop(0, rgba(A, 1)); ring.addColorStop(0.5, rgba(warm, 1)); ring.addColorStop(1, rgba(B, 1));
      x.strokeStyle = ring; x.lineWidth = W * (0.028 + (st === "speak" ? L * 0.03 : 0.004 * Math.sin(ts * 2)));
      x.shadowColor = rgba(warm, 0.8); x.shadowBlur = W * 0.04;
      if (st === "error") { const gap = 0.5 + 0.3 * Math.sin(ts * 9); x.beginPath(); x.arc(cx, cy, R, gap, TAU - 0.3); x.stroke(); }
      else if (st === "think") { x.setLineDash([W * 0.05, W * 0.03]); x.lineDashOffset = -ts * W * 0.2; x.beginPath(); x.arc(cx, cy, R, 0, TAU); x.stroke(); x.setLineDash([]); }
      else { x.beginPath(); x.arc(cx, cy, R, 0, TAU); x.stroke(); }
      x.shadowBlur = 0;
      // the sun inside, or an eclipse when it isn't listening
      if (st === "muted" || st === "stopped") {
        x.fillStyle = rgba(P.dark, 0.96); x.beginPath(); x.arc(cx + (st === "muted" ? R * 0.05 : 0), cy, R * 0.9, 0, TAU); x.fill();
        x.strokeStyle = rgba(warm, 0.5); x.lineWidth = W / 200; x.beginPath(); x.arc(cx, cy, R * 0.93, 0, TAU); x.stroke();
      } else {
        const core = x.createRadialGradient(cx - R * 0.2, cy - R * 0.25, 0, cx, cy, R * 0.9);
        core.addColorStop(0, rgba([255, 250, 235], 0.95)); core.addColorStop(0.35, rgba(warm, 0.85)); core.addColorStop(1, rgba(mix(warm, B, 0.6), 0.25));
        x.fillStyle = core; x.beginPath(); x.arc(cx, cy, R * (0.78 + (st === "speak" ? L * 0.1 : 0)), 0, TAU); x.fill();
      }
      // listening: rings drawing in
      if (st === "listen") for (let k = 0; k < 3; k++) { const ph = ((ts / 1.4) + k / 3) % 1; x.strokeStyle = rgba(P.mint, Math.sin(ph * Math.PI) * 0.5); x.lineWidth = W / 220; x.beginPath(); x.arc(cx, cy, R * (2.1 - ph), 0, TAU); x.stroke(); }
      if (st === "muted" || st === "stopped" || st === "error") badge(x, W, st, P, t);
      void m;
    },
  };

  // ---------------------------------------------------------------------------------------------------- 3. blob buddy
  const blob = {
    name: "Blob buddy",
    draw(x, W, H, t, S, P, m) {
      const cx = W / 2, st = S.state, L = S.level, ts = t / 1000;
      m.blinkAt ??= t + 2500; m.lv ??= 0; m.look ??= [0, 0];
      m.lv += (L - m.lv) * 0.35;
      const lv = m.lv;
      // squash and stretch with the voice; a little hop while listening
      const bounce = st === "speak" ? lv * 0.08 : st === "listen" ? 0.03 * Math.abs(Math.sin(ts * 3)) : 0.015 * Math.sin(ts * 1.6);
      const R = W * 0.28 * (st === "listen" ? 1.06 : st === "sleep" ? 0.95 : 1);
      const cy = H * 0.54 - bounce * H * 0.6;
      const sx = 1 + bounce * 0.6, sy = 1 - bounce * 0.4 + (st === "speak" ? lv * 0.05 : 0);
      const body = st === "error" ? mix(P.a, P.warn, 0.6) : st === "muted" || st === "stopped" ? mix(P.a, [130, 140, 170], 0.45) : P.a;
      // shadow
      x.fillStyle = rgba([0, 0, 0], 0.22); x.beginPath(); x.ellipse(cx, H * 0.86, R * 0.8 * sx, R * 0.13, 0, 0, TAU); x.fill();
      // the body: a soft wobbly blob
      x.save(); x.translate(cx, cy); x.scale(sx, sy);
      x.beginPath();
      for (let i = 0; i <= 90; i++) {
        const a = (i / 90) * TAU, wob = 1 + 0.035 * Math.sin(a * 3 + ts * 1.8) + 0.025 * Math.sin(a * 5 - ts * 2.3) + (st === "speak" ? lv * 0.04 * Math.sin(a * 4 + ts * 9) : 0);
        const r = R * wob * (a > 0.15 * Math.PI && a < 0.85 * Math.PI ? 1.02 : 1);
        i ? x.lineTo(Math.cos(a) * r, Math.sin(a) * r) : x.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      x.closePath();
      const g = x.createRadialGradient(-R * 0.35, -R * 0.45, R * 0.1, 0, 0, R * 1.1);
      g.addColorStop(0, rgba(mix(body, [255, 255, 255], 0.55), 1)); g.addColorStop(0.45, rgba(body, 1)); g.addColorStop(1, rgba(mix(body, P.b, 0.7), 1));
      x.fillStyle = g; x.shadowColor = rgba(body, 0.6); x.shadowBlur = W * 0.05; x.fill(); x.shadowBlur = 0;
      // a shine
      x.fillStyle = rgba([255, 255, 255], 0.35); x.beginPath(); x.ellipse(-R * 0.42, -R * 0.52, R * 0.18, R * 0.1, -0.6, 0, TAU); x.fill();
      // cheeks
      if (st === "speak" || st === "idle" || st === "listen") { x.fillStyle = rgba(P.rose, 0.35 + lv * 0.2); for (const s of [-1, 1]) { x.beginPath(); x.ellipse(s * R * 0.5, R * 0.18, R * 0.12, R * 0.07, 0, 0, TAU); x.fill(); } }
      // the eyes: they blink, look around, look at you when listening, look up when thinking
      if (t > m.blinkAt) { m.blinkStart = t; m.blinkAt = t + 2200 + Math.random() * 3800; }
      const blink = m.blinkStart && t - m.blinkStart < 160 ? 1 - Math.abs((t - m.blinkStart) / 80 - 1) : 0;
      const target = st === "think" ? [0.45, -0.55] : st === "listen" || st === "speak" ? [0, 0] : [Math.sin(ts * 0.5) * 0.5, Math.sin(ts * 0.37) * 0.25];
      m.look = [lerp(m.look[0], target[0], 0.06), lerp(m.look[1], target[1], 0.06)];
      const ew = R * 0.17, eh = R * (st === "listen" ? 0.27 : 0.23), ey = -R * 0.12;
      for (const s of [-1, 1]) {
        const ex = s * R * 0.32;
        if (st === "sleep" || st === "muted") {       // content, closed eyes
          x.strokeStyle = rgba(P.dark, 0.9); x.lineWidth = W / 110; x.lineCap = "round";
          x.beginPath(); x.arc(ex, ey, ew * 0.8, 0.15 * Math.PI, 0.85 * Math.PI); x.stroke();
          continue;
        }
        if (st === "error") {                           // dizzy spirals
          x.strokeStyle = rgba(P.dark, 0.9); x.lineWidth = W / 140; x.beginPath();
          for (let i = 0; i < 40; i++) { const a = i * 0.45 + ts * 6 * s, r = (i / 40) * ew; i ? x.lineTo(ex + Math.cos(a) * r, ey + Math.sin(a) * r) : x.moveTo(ex, ey); }
          x.stroke(); continue;
        }
        x.fillStyle = "#fff"; x.beginPath(); x.ellipse(ex, ey, ew, Math.max(1, eh * (1 - blink)), 0, 0, TAU); x.fill();
        if (blink < 0.7) {
          x.fillStyle = rgba(P.dark, 1); x.beginPath(); x.arc(ex + m.look[0] * ew * 0.45, ey + m.look[1] * eh * 0.45, ew * 0.52, 0, TAU); x.fill();
          x.fillStyle = "#fff"; x.beginPath(); x.arc(ex + m.look[0] * ew * 0.45 - ew * 0.18, ey + m.look[1] * eh * 0.45 - ew * 0.2, ew * 0.16, 0, TAU); x.fill();
        }
      }
      // eyebrows up while listening
      if (st === "listen" || st === "think") { x.strokeStyle = rgba(P.dark, 0.7); x.lineWidth = W / 150; x.lineCap = "round"; for (const s of [-1, 1]) { x.beginPath(); x.moveTo(s * R * 0.2, -R * (st === "listen" ? 0.47 : 0.42)); x.quadraticCurveTo(s * R * 0.32, -R * (st === "listen" ? 0.56 : 0.46 - (s > 0 ? 0.08 : 0)), s * R * 0.44, -R * 0.47); x.stroke(); } }
      // the mouth: it moves with the words (the voice's own waveform shapes it)
      const my = R * 0.32;
      x.lineCap = "round"; x.lineJoin = "round";
      if (st === "speak") {
        const open = R * (0.04 + lv * 0.32), wid = R * (0.22 + lv * 0.1 + (S.wave ? Math.abs(S.wave[128] - 128) / 128 * 0.08 : 0));
        x.fillStyle = rgba([70, 20, 40], 0.95); x.beginPath(); x.ellipse(0, my + open * 0.3, wid, Math.max(R * 0.03, open), 0, 0, TAU); x.fill();
        if (open > R * 0.12) { x.fillStyle = rgba(P.rose, 0.95); x.beginPath(); x.ellipse(0, my + open * 0.75, wid * 0.55, open * 0.35, 0, 0, TAU); x.fill(); }
      } else if (st === "listen") { x.fillStyle = rgba([70, 20, 40], 0.9); x.beginPath(); x.ellipse(0, my, R * 0.06, R * 0.07, 0, 0, TAU); x.fill(); }
      else if (st === "think") { x.strokeStyle = rgba(P.dark, 0.85); x.lineWidth = W / 110; x.beginPath(); x.moveTo(-R * 0.05, my + R * 0.02); x.lineTo(R * 0.16, my - R * 0.02); x.stroke(); }
      else if (st === "error") { x.strokeStyle = rgba(P.dark, 0.85); x.lineWidth = W / 120; x.beginPath(); for (let i = 0; i <= 12; i++) { const px = -R * 0.18 + (i / 12) * R * 0.36, py = my + Math.sin(i * 1.6 + ts * 8) * R * 0.03; i ? x.lineTo(px, py) : x.moveTo(px, py); } x.stroke(); }
      else if (st === "stopped") { x.strokeStyle = rgba(P.dark, 0.85); x.lineWidth = W / 110; x.beginPath(); x.moveTo(-R * 0.16, my); x.lineTo(R * 0.16, my); x.stroke(); for (let i = -2; i <= 2; i++) { x.beginPath(); x.moveTo(i * R * 0.06, my - R * 0.03); x.lineTo(i * R * 0.06, my + R * 0.03); x.stroke(); } }
      else { x.strokeStyle = rgba(P.dark, 0.85); x.lineWidth = W / 110; x.beginPath(); x.arc(0, my - R * 0.1, R * 0.16, 0.2 * Math.PI, 0.8 * Math.PI); x.stroke(); }
      // earmuffs when it's off (deafened)
      if (st === "muted") {
        x.strokeStyle = rgba(P.b, 0.95); x.lineWidth = W / 45; x.beginPath(); x.arc(0, -R * 0.1, R * 1.02, 1.08 * Math.PI, 1.92 * Math.PI); x.stroke();
        for (const s of [-1, 1]) { const gg = x.createRadialGradient(s * R * 0.98, 0, 0, s * R * 0.98, 0, R * 0.26); gg.addColorStop(0, rgba(mix(P.b, [255, 255, 255], 0.5), 1)); gg.addColorStop(1, rgba(P.b, 1)); x.fillStyle = gg; x.beginPath(); x.arc(s * R * 0.98, -R * 0.02, R * 0.24, 0, TAU); x.fill(); }
      }
      x.restore();
      // thinking: dots above the head
      if (st === "think") for (let i = 0; i < 3; i++) { const on = Math.floor(ts * 3) % 3 >= i; x.fillStyle = rgba(P.ink, on ? 0.95 : 0.3); x.beginPath(); x.arc(cx + R * (0.55 + i * 0.22), cy - R * (1.05 + i * 0.12), W / (80 - i * 12), 0, TAU); x.fill(); }
      if (st === "sleep") zzz(x, W, cx + R * 0.6, cy - R * 0.8, t, P.ink);
      if (st === "stopped" || st === "error") badge(x, W, st, P, t);
    },
  };

  // ---------------------------------------------------------------------------------------------------- 4. waveform halo
  const halo = {
    name: "Waveform halo",
    draw(x, W, H, t, S, P, m) {
      const cx = W / 2, cy = H / 2, st = S.state, L = S.level, ts = t / 1000;
      const R = W * 0.27 * (st === "listen" ? 1.05 : 1) * (1 + 0.015 * Math.sin(ts * 1.3));
      const A = st === "listen" ? P.mint : st === "error" ? P.warn : P.a, B = st === "error" ? P.rose : P.b;
      const dim = st === "muted" ? 0.35 : st === "stopped" ? 0.5 : st === "sleep" ? 0.45 : 1;
      // inner glow
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, R * 1.3);
      g.addColorStop(0, rgba(A, 0.18 * dim + L * 0.25)); g.addColorStop(0.7, rgba(B, 0.06 * dim)); g.addColorStop(1, rgba(B, 0));
      x.fillStyle = g; x.beginPath(); x.arc(cx, cy, R * 1.3, 0, TAU); x.fill();
      // three halos drawn by the voice
      const N = 200;
      for (let k = 2; k >= 0; k--) {
        x.beginPath();
        for (let i = 0; i <= N; i++) {
          const a = (i / N) * TAU;
          let d = 0;
          if (st === "speak") {
            const w = S.wave ? (S.wave[(i * 2 + k * 40) % 512] - 128) / 128 : 0;
            d = (S.wave ? w * 0.9 : 0) + Math.sin(a * (5 + k * 2) + ts * (6 + k)) * (0.35 + L) * 0.5 + Math.sin(a * 3 - ts * 4) * L * 0.4;
            d *= R * (0.1 + L * 0.35);
          } else if (st === "listen") d = Math.sin(a * 6 + ts * 5 + k) * R * (0.03 + 0.03 * Math.sin(ts * 3));
          else if (st === "error") d = (Math.random() - 0.5) * R * 0.06 + Math.sin(a * 12 + ts * 20) * R * 0.02;
          else if (st === "muted" || st === "stopped") d = 0;
          else d = Math.sin(a * (3 + k) + ts * (1 + k * 0.3)) * R * 0.02;
          const r = R * (1 + k * 0.07) + d * (1 - k * 0.25);
          const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
          i ? x.lineTo(px, py) : x.moveTo(px, py);
        }
        x.closePath();
        x.strokeStyle = rgba(mix(A, B, k / 2), (0.85 - k * 0.25) * dim); x.lineWidth = W / (k ? 300 : 150);
        if (st === "stopped") x.setLineDash([W * 0.02, W * 0.02]);
        if (!k) { x.shadowColor = rgba(A, 0.9); x.shadowBlur = W * 0.03 * dim; }
        x.stroke(); x.shadowBlur = 0; x.setLineDash([]);
      }
      // listening: ripples drawing in · thinking: a comet chasing round
      if (st === "listen") for (let k = 0; k < 3; k++) { const ph = ((ts / 1.3) + k / 3) % 1; x.strokeStyle = rgba(P.mint, Math.sin(ph * Math.PI) * 0.45); x.lineWidth = W / 250; x.beginPath(); x.arc(cx, cy, R * (1.9 - ph * 0.8), 0, TAU); x.stroke(); }
      if (st === "think") {
        for (let i = 0; i < 18; i++) { const a = ts * 3.2 - i * 0.07; x.fillStyle = rgba(mix(P.a, P.b, i / 18), (1 - i / 18) * 0.95); x.beginPath(); x.arc(cx + Math.cos(a) * R * 1.12, cy + Math.sin(a) * R * 1.12, W / 90 * (1 - i / 22), 0, TAU); x.fill(); }
      }
      // the centre: a small light that swells with the voice (a flat line when it isn't listening)
      if (st === "muted") { x.strokeStyle = rgba(P.ink, 0.7); x.lineWidth = W / 140; x.beginPath(); x.moveTo(cx - R * 0.45, cy); x.lineTo(cx + R * 0.45, cy); x.stroke(); }
      else { const cr = W * (0.03 + (st === "speak" ? L * 0.05 : 0.004 * Math.sin(ts * 2))); const cg = x.createRadialGradient(cx, cy, 0, cx, cy, cr * 3); cg.addColorStop(0, rgba([255, 255, 255], 0.9 * dim)); cg.addColorStop(0.3, rgba(A, 0.6 * dim)); cg.addColorStop(1, rgba(B, 0)); x.fillStyle = cg; x.beginPath(); x.arc(cx, cy, cr * 3, 0, TAU); x.fill(); }
      if (st === "sleep") zzz(x, W, cx + R * 0.5, cy - R * 0.5, t, P.ink);
      if (st === "muted" || st === "stopped" || st === "error") badge(x, W, st, P, t);
      void m;
    },
  };

  // ---------------------------------------------------------------------------------------------------- 5. pixel pal
  // A 16×16 sprite. Letters: . empty, o outline, b body, h highlight, s shade, e eye, w eye shine, m mouth, t tongue,
  // a antenna, l the antenna's light, k cheek
  const SPRITE = [
    "......al........",
    ".......a........",
    ".....oooooo.....",
    "...oobbhhbboo...",
    "..obbhhbbbbbbo..",
    ".obbhbbbbbbbbbo.",
    ".obbbbbbbbbbbbo.",
    "obbbwebbbbwebbbo",
    "obbbeebbbbeebbbo",
    "obkkbbbbbbbbkkbo",
    "obbbbbbbbbbbbbbo",
    ".obbbbbbbbbbbbo.",
    ".obsbbbbbbbbsbo.",
    "..obssbbbbssbo..",
    "...oosssssssoo..",
    ".....oooooo.....",
  ];
  const MOUTHS = {        // rows 10–11, columns 6–9
    closed: [[10, 6, "m"], [10, 7, "m"], [10, 8, "m"], [10, 9, "m"]],
    smile: [[10, 5, "m"], [11, 6, "m"], [11, 7, "m"], [11, 8, "m"], [11, 9, "m"], [10, 10, "m"]],
    half: [[10, 6, "m"], [10, 7, "m"], [10, 8, "m"], [10, 9, "m"], [11, 7, "t"], [11, 8, "t"]],
    open: [[10, 6, "m"], [10, 7, "m"], [10, 8, "m"], [10, 9, "m"], [11, 6, "m"], [11, 7, "t"], [11, 8, "t"], [11, 9, "m"], [12, 7, "m"], [12, 8, "m"]],
    o: [[10, 7, "m"], [10, 8, "m"], [11, 7, "m"], [11, 8, "m"]],
    flat: [[11, 6, "m"], [11, 7, "m"], [11, 8, "m"], [11, 9, "m"]],
    wavy: [[11, 5, "m"], [10, 6, "m"], [11, 7, "m"], [10, 8, "m"], [11, 9, "m"], [10, 10, "m"]],
  };
  const pixel = {
    name: "Pixel pal",
    draw(x, W, H, t, S, P, m) {
      const st = S.state, L = S.level, ts = t / 1000;
      const px = Math.max(2, Math.floor((Math.min(W, H) * 0.62) / 16));
      const step = Math.floor(t / 125);          // 8 steps a second: the 8-bit feel
      m.blinkAt ??= step + 20;
      const hop = st === "speak" ? (L > 0.25 && step % 2 ? 1 : 0) : st === "listen" ? (step % 6 < 3 ? 1 : 0) : st === "idle" ? (step % 8 < 4 ? 0 : 1) : 0;
      const ox = Math.round(W / 2 - px * 8), oy = Math.round(H / 2 - px * 8 - hop * px + px);
      const body = st === "error" ? mix(P.a, P.warn, 0.6) : st === "muted" || st === "stopped" ? mix(P.a, [130, 140, 170], 0.5) : P.a;
      const C = {
        o: mix(body, [10, 10, 30], 0.62), b: body, h: mix(body, [255, 255, 255], 0.45), s: mix(body, P.b, 0.6), e: [20, 22, 40], w: [255, 255, 255], m: [70, 20, 40], t: P.rose, k: P.rose, a: mix(body, [10, 10, 30], 0.4),
        l: st === "listen" ? (step % 4 < 2 ? P.mint : mix(P.mint, [255, 255, 255], 0.5)) : st === "think" ? [P.a, P.b, P.gold, P.mint][step % 4] : st === "speak" ? mix(P.gold, [255, 255, 255], L) : st === "error" ? (step % 2 ? P.warn : P.rose) : st === "sleep" || st === "muted" ? [90, 95, 120] : P.gold,
      };
      if (t > (m.blinkT ?? 0) && step >= m.blinkAt) { m.blinkT = t + 140; m.blinkAt = step + 18 + Math.floor(Math.random() * 30); }
      const blinking = t < (m.blinkT ?? 0);
      const g = SPRITE.map((row) => row.split(""));
      // eyes: blinking, sleeping or off (closed lines), error (x)
      const closedEyes = blinking || st === "sleep" || st === "muted";
      if (closedEyes) for (const [r, c] of [[7, 4], [7, 5], [7, 10], [7, 11]]) g[r][c] = "b";
      if (closedEyes) for (const c of [4, 5, 10, 11]) g[8][c] = "e";
      if (st === "error") { for (const [r, c] of [[7, 4], [8, 5], [7, 11], [8, 10]]) g[r][c] = "e"; for (const [r, c] of [[7, 5], [8, 4], [7, 10], [8, 11]]) g[r][c] = "b"; }
      if (st === "think" && !closedEyes) { for (const [r, c] of [[8, 4], [8, 5], [8, 10], [8, 11]]) g[r][c] = "b"; g[7][5] = "e"; g[7][11] = "e"; }
      const mouth = st === "speak" ? (L > 0.45 ? "open" : L > 0.18 ? "half" : step % 3 ? "closed" : "half") : st === "listen" ? "o" : st === "think" || st === "stopped" ? "flat" : st === "error" ? "wavy" : st === "sleep" || st === "muted" ? "closed" : "smile";
      for (const [r, c, ch] of MOUTHS[mouth]) g[r][c] = ch;
      // glow behind
      const gl = x.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, px * 12);
      gl.addColorStop(0, rgba(C.l, 0.18 + L * 0.2)); gl.addColorStop(1, rgba(C.l, 0));
      x.fillStyle = gl; x.fillRect(0, 0, W, H);
      for (let r = 0; r < 16; r++) for (let c = 0; c < 16; c++) {
        const ch = g[r][c]; if (ch === ".") continue;
        x.fillStyle = rgba(C[ch] ?? C.b, 1);
        x.fillRect(ox + c * px, oy + r * px, px, px);
      }
      // the antenna light glows
      if (st !== "sleep") { x.fillStyle = rgba(C.l, 0.35); x.fillRect(ox + 6 * px - px / 2, oy - px / 2, px * 2, px * 2); }
      // earmuffs (off / deafened)
      if (st === "muted") { x.fillStyle = rgba(P.b, 1); for (const c of [-1, 15]) x.fillRect(ox + c * px, oy + 6 * px, px * 2, px * 4); x.fillRect(ox + 1 * px, oy + 1 * px, px * 14, px); }
      // a pixel speech bubble while thinking: "?"
      if (st === "think") {
        const bx = ox + 13 * px, by = oy - 2 * px, Q = ["xxx.", "...x", ".xx.", "....", ".x.."];
        x.fillStyle = rgba(P.ink, 0.95);
        Q.forEach((row, r) => row.split("").forEach((ch, c) => { if (ch === "x" && (step % 4 !== 3)) x.fillRect(bx + c * px * 0.6, by + r * px * 0.6, px * 0.6, px * 0.6); }));
      }
      // pixel Zs while sleeping
      if (st === "sleep") { x.fillStyle = rgba(P.ink, 0.9); const zx = ox + 14 * px, zy = oy - px * (step % 8) * 0.25; for (const [r, c] of [[0, 0], [0, 1], [0, 2], [1, 1], [2, 0], [2, 1], [2, 2]]) x.fillRect(zx + c * px * 0.5, zy + r * px * 0.5, px * 0.5, px * 0.5); }
      if (st === "stopped" || st === "error") badge(x, W, st, P, t);
      void ts;
    },
  };

  const STYLES = { aurora, sunring, blob, halo, pixel };

  // ---------------------------------------------------------------------------------------------------- mounting one
  function mount(host, { style = "blob", signal = () => ({ state: "idle", level: 0 }), fps = 60, square = true } = {}) {
    const cv = document.createElement("canvas");
    cv.className = "dsav-canvas"; cv.setAttribute("aria-hidden", "true");
    cv.style.cssText = "width:100%;height:100%;display:block";
    host.append(cv);
    const x = cv.getContext("2d");
    let cur = style, raf = 0, last = 0, frames = 0, dead = false, mem = {}, P = palette(), lv = 0;
    const onTheme = () => { P = palette(); };
    root.addEventListener?.("ds-theme", onTheme);
    const reduced = () => root.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches || document.documentElement.dataset.motion === "reduced";
    function frame(t) {
      raf = 0; if (dead) return;
      const S = signal() || { state: "idle", level: 0 };
      const busy = S.state === "speak" || S.state === "listen" || S.state === "think";
      const gap = busy ? 1000 / fps : 1000 / 30;
      if (t - last < gap - 2 || document.visibilityState === "hidden") { raf = requestAnimationFrame(frame); return; }
      last = t; frames++;
      const r = cv.getBoundingClientRect(), dpr = Math.min(2, root.devicePixelRatio || 1);
      const w = Math.max(40, Math.round(r.width * dpr)), h = Math.max(40, Math.round(r.height * dpr));
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      lv += ((S.level || 0) - lv) * 0.3;
      const W = square ? Math.min(w, h) : w, H = square ? Math.min(w, h) : h;
      x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, w, h);
      x.save(); x.translate((w - W) / 2, (h - H) / 2);
      try { (STYLES[cur] ?? STYLES.blob).draw(x, W, H, reduced() ? 0 : t, { ...S, level: clamp01(lv) }, P, mem); } catch (e) { if (!mount.warned) { mount.warned = true; console.warn("avatar:", e); } }
      x.restore();
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return {
      canvas: cv,
      setStyle(s) { if (STYLES[s] && s !== cur) { cur = s; mem = {}; } },
      get style() { return cur; },
      stats: () => ({ frames, style: cur, running: Boolean(raf) }),
      destroy() { dead = true; cancelAnimationFrame(raf); root.removeEventListener?.("ds-theme", onTheme); cv.remove(); },
    };
  }

  // a talking voice without sound, for previews and "Test talking": syllables, words and pauses
  function fakeVoice(t) {
    const word = Math.max(0, Math.sin(t / 95) * 0.6 + Math.sin(t / 37) * 0.4), phrase = Math.sin(t / 1300) > -0.6 ? 1 : 0.1;
    return clamp01(word * phrase * 0.95);
  }

  root.DsAvatarCore = { STYLES, STATES, mount, palette, fakeVoice };
})(typeof window !== "undefined" ? window : globalThis);
