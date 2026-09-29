// The screen's ⋯ More → 🧠 AI brain: Claude · Ollama · No AI (only the ones that are set up), the model, and "Pick for
// me". One tap switches, right away (no restart), with a toast. layout.js keeps the button in the clock row's ⋯ menu.
(() => {
  const host = document.querySelector(".calbtns .util");
  if (!host) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (path, body) => { const r = await fetch("/api" + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "That didn't work."); return j; };
  const NICE = { "claude-sonnet-5": "Sonnet 5", "claude-opus-5-5": "Opus 5.5 (most capable)", "claude-haiku-4-5-20251001": "Haiku 4.5 (fastest)" };
  const btn = document.createElement("button");
  btn.id = "aiBtn"; btn.type = "button"; btn.title = "AI brain: Claude, Ollama or no AI";
  btn.innerHTML = '<i aria-hidden="true">🧠</i><span class="lbl">AI brain</span>';
  host.appendChild(btn);
  const pop = document.createElement("div");
  pop.id = "aiPop"; pop.className = "morebox aipop"; pop.hidden = true; pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", "AI brain");
  document.body.appendChild(pop);
  const st = document.createElement("style");
  st.textContent = "#aiPop{position:fixed;z-index:60;min-width:15em;max-width:22em;display:flex;flex-direction:column;gap:.35em;padding:.6em}#aiPop .aih{font-weight:600;margin-bottom:.2em}#aiPop button.aiopt{text-align:left}#aiPop button.aiopt.on{outline:2px solid currentColor}#aiPop .aisub{opacity:.75;font-size:.85em}#aiPop select{width:100%}#aiToast{position:fixed;left:50%;bottom:8%;transform:translateX(-50%);z-index:80;padding:.6em 1.1em;border-radius:.8em;background:rgba(20,24,32,.92);color:#fff;font-size:1.05em;box-shadow:0 6px 24px rgba(0,0,0,.35)}";
  document.head.appendChild(st);
  const toast = (t) => { let el = document.getElementById("aiToast"); if (!el) { el = document.createElement("div"); el.id = "aiToast"; el.setAttribute("role", "status"); document.body.appendChild(el); } el.textContent = t; el.hidden = false; clearTimeout(el._h); el._h = setTimeout(() => { el.hidden = true; }, 3200); };
  async function draw() {
    pop.innerHTML = '<div class="aih">AI brain</div><div class="aisub">Checking…</div>';
    let o; try { o = await api("/ai/switch?fresh=1"); } catch (e) { pop.innerHTML = `<div class="aih">AI brain</div><div>${esc(e.message)}</div>`; return; }
    const cur = o.options.find((x) => x.id === o.current);
    const avail = o.options.filter((x) => x.available);
    pop.innerHTML = `<div class="aih">AI brain</div><div class="aisub">Now: ${esc(cur?.label ?? "No AI")}${o.model ? " · " + esc(NICE[o.model] ?? o.model) : ""}</div>
      ${avail.map((x) => `<button type="button" class="aiopt${x.id === o.current ? " on" : ""}" data-ai="${esc(x.id)}" aria-pressed="${x.id === o.current}">${esc(x.label)}</button>`).join("")}
      ${cur?.models?.length ? `<label class="aisub" for="aiPopModel">Model</label><select id="aiPopModel">${cur.models.map((m) => `<option value="${esc(m.id)}" ${m.id === o.model ? "selected" : ""}>${esc(NICE[m.id] ?? m.label ?? m.id)}</option>`).join("")}</select>` : ""}
      ${o.current !== "none" ? `<label class="aisub"><input type="checkbox" id="aiPopAuto" ${o.auto ? "checked" : ""}> Pick for me (quick commands use the fast model)</label>` : ""}`;
  }
  const place = () => { const anchor = btn.isConnected && btn.offsetParent ? btn : document.querySelector(".calbtns .util .morebtn") ?? host; const r = anchor.getBoundingClientRect(); pop.style.top = Math.min(window.innerHeight - pop.offsetHeight - 8, r.bottom + 6) + "px"; pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.right - pop.offsetWidth)) + "px"; };
  const open = async () => { pop.hidden = false; await draw(); place(); pop.querySelector("button, select")?.focus(); };
  const close = () => { pop.hidden = true; };
  btn.addEventListener("click", (e) => { e.stopPropagation(); pop.hidden ? setTimeout(open, 0) : close(); });
  pop.addEventListener("click", async (e) => {
    e.stopPropagation();
    const b = e.target.closest("[data-ai]"); if (!b) return;
    try { const r = await api("/ai/switch", { provider: b.dataset.ai }); toast("🧠 " + r.message); close(); } catch (err) { toast(err.message); }
  });
  pop.addEventListener("change", async (e) => {
    try {
      if (e.target.id === "aiPopModel") { const cur = (await api("/ai/switch")).current; const r = await api("/ai/switch", { provider: cur, model: e.target.value }); toast("🧠 " + r.message); close(); }
      if (e.target.id === "aiPopAuto") { await api("/ai/switch", { auto: e.target.checked }); toast(e.target.checked ? "🧠 Pick for me is on" : "🧠 Pick for me is off"); }
    } catch (err) { toast(err.message); }
  });
  document.addEventListener("pointerdown", (e) => { if (!pop.hidden && !pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !pop.hidden) { e.stopPropagation(); close(); } }, true);
  window.DayspringAISwitch = { open, close };
})();
