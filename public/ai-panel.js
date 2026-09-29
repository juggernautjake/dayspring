// Settings → AI brain: the quick switch at the top (Claude · Ollama · No AI, the model, "Pick for me"), the Claude key
// check, and the Ollama panel (is it installed and running, its models, this computer's recommendations with a Pull
// button, the tool-use self-test, the options, and how fast answers are). Used by setup.js:
//   DayspringAI.topHtml() / mountTop(onSwitch)     DayspringAI.ollamaHtml() / mountOllama()     DayspringAI.claudeHtml() / mountClaude()
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (path, opts = {}) => { const r = await fetch("/api" + path, { ...opts, headers: { "content-type": "application/json" } }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `failed (${r.status})`); return j; };
  const post = (path, body) => api(path, { method: "POST", body: JSON.stringify(body ?? {}) });
  const ms = (x) => (x == null ? "–" : x < 1000 ? `${x} ms` : `${(x / 1000).toFixed(1)} s`);
  { const css = document.createElement("style"); css.textContent = ".aiactive{font-size:1.05em;margin:.3em 0 .6em}.aicheck{list-style:none;padding-left:0;margin:.4em 0}.aicheck li{margin:.15em 0}.oltable{width:100%;border-collapse:collapse;font-size:.9em;margin:.5em 0}.oltable th,.oltable td{text-align:left;padding:.25em .4em;border-bottom:1px solid rgba(127,127,127,.25);vertical-align:top}#olPull progress{height:.9em}"; document.head.appendChild(css); }
  const NICE = { "claude-sonnet-5": "Sonnet 5 (recommended)", "claude-opus-5-5": "Opus 5.5 (most capable)", "claude-haiku-4-5-20251001": "Haiku 4.5 (fastest)" };

  // ---------------------------------------------------------------- the quick switch
  const topHtml = () => `<div class="aitop" id="aiTop" aria-live="polite">
      <div class="aiactive" id="aiActive">Loading…</div>
      <div class="choices" role="radiogroup" aria-label="AI brain" id="aiQuick"></div>
      <div class="row" style="gap:.6em;align-items:center;flex-wrap:wrap;margin-top:.5em">
        <label for="aiModelQuick">Model</label><select id="aiModelQuick" style="flex:1 1 14em"></select>
        <label style="display:flex;gap:.35em;align-items:center"><input type="checkbox" id="aiAuto"> Pick for me <span class="hint">(quick commands use the fast model)</span></label>
      </div>
      <div class="hint" id="aiQuickMsg"></div>
    </div>`;
  async function mountTop(onSwitch) {
    const draw = async (fresh) => {
      let o; try { o = await api("/ai/switch" + (fresh ? "?fresh=1" : "")); } catch (e) { $("#aiActive").textContent = e.message; return; }
      const cur = o.options.find((x) => x.id === o.current);
      $("#aiActive").innerHTML = `Active now: <b>${esc(cur?.label ?? "No AI")}</b>${o.model ? ` · ${esc(NICE[o.model] ?? o.model)}` : ""}${o.auto ? " · Pick for me" : ""}`;
      $("#aiQuick").innerHTML = o.options.filter((x) => ["anthropic", "ollama", "none"].includes(x.id) || x.available).map((x) => `<button type="button" class="choice${x.id === o.current ? " on" : ""}" role="radio" aria-checked="${x.id === o.current}" data-ai="${esc(x.id)}" ${x.available ? "" : "disabled"} title="${esc(x.why || "")}"><b>${esc(x.label)}</b><small>${esc(x.available ? (x.id === o.current ? "In use" : "One click to switch") : x.why || "Not set up")}</small></button>`).join("");
      const models = cur?.models ?? [];
      $("#aiModelQuick").innerHTML = models.length ? models.map((m) => `<option value="${esc(m.id)}" ${m.id === o.model ? "selected" : ""}>${esc(NICE[m.id] ?? m.label ?? m.id)}${m.tools === false ? " (can't use tools)" : ""}</option>`).join("") : `<option value="">${o.current === "none" ? "No AI" : esc(o.model ?? "")}</option>`;
      $("#aiModelQuick").disabled = !models.length;
      $("#aiAuto").checked = Boolean(o.auto); $("#aiAuto").disabled = o.current === "none";
    };
    $("#aiQuick").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-ai]"); if (!b || b.disabled) return;
      e.stopPropagation();
      try { const r = await post("/ai/switch", { provider: b.dataset.ai }); $("#aiQuickMsg").textContent = "✓ " + r.message; await draw(); onSwitch?.(r); } catch (err) { $("#aiQuickMsg").textContent = "✗ " + err.message; }
    }, true);
    $("#aiModelQuick").onchange = async () => { try { const cur = (await api("/ai/switch")).current; const r = await post("/ai/switch", { provider: cur, model: $("#aiModelQuick").value }); $("#aiQuickMsg").textContent = "✓ " + r.message; await draw(); onSwitch?.(r); } catch (err) { $("#aiQuickMsg").textContent = "✗ " + err.message; } };
    $("#aiAuto").onchange = async () => { await post("/ai/switch", { auto: $("#aiAuto").checked }).catch(() => {}); draw(); };
    await draw(true);
    return { redraw: draw };
  }

  // ---------------------------------------------------------------- Claude: the key check
  const claudeHtml = () => `<div class="field" id="claudeCheckBox"><button type="button" class="btn small" id="claudeCheck">Check my Claude connection</button> <span class="hint">Uses the saved key; nothing to paste.</span><div id="claudeCheckOut" class="hint" aria-live="polite"></div></div><div id="aiUpdateNote"></div>`;
  function mountClaude() {
    const b = $("#claudeCheck"); if (!b) return;
    b.onclick = async () => {
      b.disabled = true; $("#claudeCheckOut").textContent = "Checking…";
      try {
        const r = await post("/setup/ai/check");
        const tick = (ok, t) => `<li>${ok ? "✓" : "✗"} ${t}</li>`;
        $("#claudeCheckOut").innerHTML = `<ul class="aicheck">${tick(r.present, r.present ? `Key saved (ends in ${esc(r.last4 || "…")})` : "No key saved")}${r.present ? tick(r.formatOk, "Looks like a Claude key") + tick(r.reachable, "Anthropic reachable") + tick(r.creditOk, "Account has credit") + tick(r.modelOk, `Model works${r.model ? ` (${esc(r.model)})` : ""}`) : ""}${r.ms != null ? `<li>Took ${ms(r.ms)}</li>` : ""}</ul><div class="${r.ok ? "status ok" : "status bad"}">${esc(r.text)}</div>`;
      } catch (e) { $("#claudeCheckOut").textContent = "✗ " + e.message; }
      b.disabled = false;
    };
    // an older Dayspring had key bugs: say when there's an update
    api("/update/status").then((s) => { if (s?.latest?.available) $("#aiUpdateNote").innerHTML = `<div class="note">Dayspring ${esc(s.latest.latest)} is available (you have ${esc(s.version)}). Older versions had problems with keys, so it's worth updating: <a href="/setup?s=updates">Settings → Updates</a>.</div>`; }).catch(() => {});
  }

  // ---------------------------------------------------------------- Ollama
  const ollamaHtml = () => `<div id="olPanel" class="olpanel">
      <div class="field"><label for="ollamaUrl">Ollama address</label><div class="row" style="gap:.5em;align-items:center"><input type="url" id="ollamaUrl" placeholder="http://127.0.0.1:11434" autocomplete="off" spellcheck="false" style="flex:1 1 16em"><button type="button" class="btn small" id="olCheck">Check</button></div>
        <div class="hint">On this computer, or a home server later (like http://192.168.1.20:11434).</div></div>
      <div id="olState" class="note" aria-live="polite">Checking for Ollama…</div>
      <div id="olBody" hidden>
        <div class="field"><label for="model">Model for commands</label><select id="model" style="width:100%"></select><div class="hint" id="olModelHint"></div></div>
        <div class="row">
          <div class="field"><label for="olChat">Model for conversation (optional)</label><select id="olChat"></select></div>
          <div class="field"><label for="olVision">Model for pictures (optional)</label><select id="olVision"></select></div>
        </div>
        <div class="row" style="gap:.5em;align-items:center;flex-wrap:wrap"><button type="button" class="btn" id="test">Test tool use</button><span id="testOut" class="hint">Checks that "set a timer for 1 minute" becomes the timer tool, and two more.</span></div>
        <div id="olSelf" aria-live="polite"></div>
        <h3>Your computer</h3><div id="olHw" class="hint"></div>
        <div id="olRec"></div>
        <div class="row" style="gap:.5em;align-items:center"><input type="text" id="olPullName" placeholder="or any model name, like qwen2.5:7b" style="flex:1 1 14em" autocomplete="off" spellcheck="false"><button type="button" class="btn small" id="olPullBtn">Pull</button></div>
        <div id="olPull" hidden><progress id="olPullBar" max="100" value="0" style="width:100%"></progress><div class="hint" id="olPullText"></div></div>
        <h3>Options</h3>
        <div class="row">
          <div class="field"><label for="olCtx">Context size</label><select id="olCtx"><option value="2048">2,048 (fastest)</option><option value="4096">4,096 (recommended)</option><option value="8192">8,192</option><option value="16384">16,384 (slow on a laptop)</option></select></div>
          <div class="field"><label for="olTools">Tools per request</label><input type="number" id="olTools" min="3" max="40" step="1"><div class="hint">Fewer is faster; 8–12 suits small models.</div></div>
        </div>
        <div class="row">
          <div class="field"><label for="olKeep">Keep the model loaded</label><select id="olKeep"><option value="5m">5 minutes</option><option value="30m">30 minutes</option><option value="2h">2 hours</option><option value="always">Always, while Dayspring runs</option></select></div>
          <div class="field"><label for="olFirst">Give up if no answer starts within (seconds)</label><input type="number" id="olFirst" min="2" max="120" step="1"></div>
        </div>
        <div class="field"><label for="olFallback">If Ollama fails or is too slow</label><select id="olFallback"><option value="offline">Use the built-in commands</option><option value="claude">Ask Claude (if a Claude key is saved)</option></select></div>
        <p><button type="button" class="btn small" id="olSave">Save options</button> <span class="hint" id="olSaved"></span></p>
        <h3 id="olSpeedH">Speed</h3><div id="olSpeed" class="hint">No answers yet.</div>
      </div>
    </div>`;
  let olState = null;
  async function mountOllama({ savedUrl = "", currentModel = "" } = {}) {
    if (!$("#olPanel")) return;
    const url = $("#ollamaUrl"); url.value = savedUrl || "http://127.0.0.1:11434";
    const opt = (v, t, sel) => `<option value="${esc(v)}" ${sel ? "selected" : ""}>${esc(t)}</option>`;
    const draw = async (fresh = true) => {
      let s;
      try { s = await api(`/setup/ollama/status?fresh=${fresh ? 1 : 0}${url.value && url.value !== savedUrl ? "&url=" + encodeURIComponent(url.value) : ""}`); } catch (e) { $("#olState").textContent = e.message; return; }
      olState = s;
      const st = s.status;
      const box = $("#olState");
      box.dataset.state = st.state;
      if (st.state === "running") box.innerHTML = `✓ ${esc(st.text)} ${s.models.length ? `Models: ${s.models.map((m) => esc(m.name)).join(", ")}.` : "No models yet: pull one below."}`;
      else if (st.state === "not-running") box.innerHTML = `${esc(st.text)} <button type="button" class="btn small" id="olStart">Start Ollama</button>`;
      else if (st.state === "unreachable") box.innerHTML = `${esc(st.text)} Check that the other computer is on and Ollama is running there.`;
      else box.innerHTML = `${esc(st.text)} To use a free local AI:<br>1. Download and install Ollama from <b>ollama.com/download</b> <button type="button" class="btn small" id="olGet">Open ↗</button><br>2. Come back here and press <b>Check</b>.<br><span class="hint">Dayspring never installs it for you.</span>`;
      $("#olStart") && ($("#olStart").onclick = async () => { $("#olStart").disabled = true; $("#olStart").textContent = "Starting…"; const r = await post("/setup/ollama/start").catch((e) => ({ ok: false, error: e.message })); if (!r.ok) box.insertAdjacentHTML("beforeend", ` <span class="status bad">${esc(r.error)}</span>`); draw(true); });
      $("#olGet") && ($("#olGet").onclick = () => post("/open", { url: "https://ollama.com/download" }).catch(() => window.open("https://ollama.com/download", "_blank", "noopener")));
      $("#olBody").hidden = st.state !== "running";
      if (st.state !== "running") return;
      const chat = s.models.filter((m) => !m.embed), tools = chat.filter((m) => m.tools), vision = chat.filter((m) => m.vision);
      const want = currentModel || s.options.model;
      $("#model").innerHTML = (tools.length ? tools : chat).map((m) => opt(m.name, `${m.name} · ${m.sizeGB} GB${m.tools ? "" : " (can't use tools)"}${m.name === s.recommend.defaults.model ? " · recommended" : ""}`, m.name === want)).join("") || opt("", "No models yet: pull one below", true);
      $("#olModelHint").textContent = tools.length ? "Only models that can use tools are listed (they can do everything Dayspring does)." : "None of the installed models can use tools; pull one of the recommended ones below.";
      $("#olChat").innerHTML = opt("", "Same as for commands", !s.options.chatModel) + chat.map((m) => opt(m.name, `${m.name} · ${m.sizeGB} GB`, m.name === s.options.chatModel)).join("");
      $("#olVision").innerHTML = opt("", vision.length ? "Pick one…" : "None installed (pull llava or qwen2.5vl)", !s.options.visionModel) + vision.map((m) => opt(m.name, `${m.name} · ${m.sizeGB} GB`, m.name === s.options.visionModel)).join("");
      const hw = s.hardware, R = s.recommend;
      $("#olHw").textContent = `${hw.ramGB} GB memory${hw.gpuName ? ` · ${hw.gpuName}` : ""}${hw.cpu ? ` · ${hw.cpu}` : ""}. ${R.summary}`;
      const row = (m) => `<tr><td><b>${esc(m.name)}</b>${m.installed ? " ✓" : ""}</td><td>${m.sizeGB} GB</td><td>${esc(m.speed)}${m.wordsPerSec ? ` (~${m.wordsPerSec} words/s)` : ""}</td><td>${esc(m.note)}</td><td>${m.installed ? "" : `<button type="button" class="btn small" data-pull="${esc(m.name)}" ${m.fits ? "" : "title=\"Probably too big for this computer\""}>Pull</button>`}</td></tr>`;
      $("#olRec").innerHTML = `<table class="oltable"><thead><tr><th>For commands</th><th>Size</th><th>Speed here</th><th></th><th></th></tr></thead><tbody>${R.commands.map(row).join("")}</tbody>
        <thead><tr><th>For conversation</th><th></th><th></th><th></th><th></th></tr></thead><tbody>${R.chat.filter((m) => m.fits).map(row).join("")}</tbody>
        <thead><tr><th>For pictures</th><th></th><th></th><th></th><th></th></tr></thead><tbody>${R.vision.filter((m) => m.fits).map(row).join("")}</tbody></table>`;
      $("#olCtx").value = String(s.options.numCtx); $("#olTools").value = s.options.toolsN; $("#olFirst").value = Math.round(s.options.firstTokenMs / 1000);
      $("#olKeep").value = s.options.keepAlive === -1 ? "always" : ["5m", "30m", "2h"].includes(s.options.keepAlive) ? s.options.keepAlive : "30m";
      $("#olFallback").value = s.options.fallback; $("#olFallback").querySelector('[value="claude"]').disabled = !s.claudeKey;
      const sp = s.speed;
      $("#olSpeed").innerHTML = sp.count ? `Last ${sp.count} answers: first word after <b>${ms(sp.ttftMs)}</b>, first sentence after <b>${ms(sp.firstSentenceMs)}</b>, whole answer <b>${ms(sp.totalMs)}</b>${sp.tokensPerSec ? ` · ${sp.tokensPerSec} tokens a second` : ""}.${s.warm?.ms ? ` Loaded in ${ms(s.warm.ms)}.` : ""}` : "No answers yet. Ask Dayspring something, then look again.";
      if (s.pull && !s.pull.done) watchPull();
    };
    const watchPull = async () => {
      $("#olPull").hidden = false;
      for (let i = 0; i < 20000; i++) {
        const { pull } = await api("/setup/ollama/pull").catch(() => ({ pull: null }));
        if (!pull) break;
        $("#olPullBar").value = pull.percent ?? 0;
        $("#olPullText").textContent = pull.error ? `✗ ${pull.error}` : pull.done ? `✓ ${pull.name} is ready.` : `${pull.name}: ${pull.status}${pull.total ? ` · ${Math.round(pull.completed / 1e6)} of ${Math.round(pull.total / 1e6)} MB` : ""}`;
        if (pull.done) { draw(true); break; }
        await new Promise((r) => setTimeout(r, 700));
      }
    };
    const pullIt = async (name) => { try { await post("/setup/ollama/pull", { name }); watchPull(); } catch (e) { $("#olPull").hidden = false; $("#olPullText").textContent = "✗ " + e.message; } };
    $("#olPanel").addEventListener("click", (e) => { const b = e.target.closest("[data-pull]"); if (b) { b.disabled = true; pullIt(b.dataset.pull); } });
    $("#olPullBtn").onclick = () => { const n = $("#olPullName").value.trim(); if (n) pullIt(n); };
    $("#olCheck").onclick = () => draw(true);
    $("#olSave").onclick = async () => {
      try { await post("/setup/ollama/options", { numCtx: Number($("#olCtx").value), toolsN: Number($("#olTools").value), firstTokenS: Number($("#olFirst").value), keepAlive: $("#olKeep").value, fallback: $("#olFallback").value, chatModel: $("#olChat").value, visionModel: $("#olVision").value, url: url.value.trim(), model: $("#model").value }); $("#olSaved").textContent = "✓ Saved"; }
      catch (e) { $("#olSaved").textContent = "✗ " + e.message; }
    };
    $("#test").onclick = async () => {
      $("#test").disabled = true; $("#testOut").textContent = "Testing (a model that isn't loaded yet can take a minute)…"; $("#olSelf").innerHTML = "";
      try {
        const r = await post("/setup/ollama/selftest", { model: $("#model").value });
        if (r.error) { $("#testOut").textContent = "✗ " + r.error; }
        else {
          $("#testOut").className = r.ok ? "status ok" : "status bad"; $("#testOut").textContent = r.ok ? `✓ ${r.model} used the right tools` : `✗ ${r.model} got some wrong`;
          $("#olSelf").innerHTML = `<ul class="aicheck">${r.results.map((x) => `<li>${x.ok ? "✓" : "✗"} “${esc(x.say)}” → ${esc(x.got.join(", ") || "no tool")}${x.args ? ` <code>${esc(JSON.stringify(x.args))}</code>` : ""} · ${ms(x.ms)}${x.error ? ` · ${esc(x.error)}` : ""}</li>`).join("")}</ul>`;
        }
      } catch (e) { $("#testOut").textContent = "✗ " + e.message; }
      $("#test").disabled = false;
    };
    await draw(true);
  }
  window.DayspringAI = { topHtml, mountTop, claudeHtml, mountClaude, ollamaHtml, mountOllama, state: () => olState };
})();
