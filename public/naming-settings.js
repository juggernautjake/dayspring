// Settings → Your assistant (and the same step of the setup wizard): the assistant's name, how to say it, and up to three
// wake words, with live checks as you type (the same rules the server uses: public/wakeword.js), "Try it", sensitivity,
// "also accept" words and "Train my wake word" (it runs on the Dayspring screen, which has the microphone).
//   window.dsNaming.html(owner) → the fields · .mount(root) · .save() → throws a friendly Error when something's wrong
(() => {
  const W = () => window.dsWake;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (p, body) => {
    const r = await fetch("/api" + p, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || "That didn't save. Try again in a moment."), { field: j.field });
    return j;
  };
  const MAX = 19, MAXW = 3;
  let root = null, view = null, trainPoll = null;
  const $ = (s) => root?.querySelector(s);
  const $$ = (s) => [...(root?.querySelectorAll(s) ?? [])];
  const SENS = [["strict", "Strict", "Only the wake word itself and what training taught it. Fewest accidents."], ["normal", "Normal", "Also words that sound close, at the start of what you say."], ["relaxed", "Relaxed", "Wakes more easily. Try it if it often misses you."]];

  const row = (w = {}, i = 0) => `<div class="wkrow" role="group" aria-label="Wake word ${i + 1}" style="border:1px solid var(--line,rgba(170,180,255,.25));border-radius:.7em;padding:.6em .7em;margin:.4em 0">
      <div class="row" style="gap:.5em;align-items:flex-end;flex-wrap:wrap">
        <div class="field" style="flex:2 1 12em;margin:0"><label>Wake word ${i + 1}</label><input type="text" class="wk" maxlength="${MAX}" value="${esc(w.text ?? "")}" placeholder="like Hey Nova, or Computer" autocomplete="off" spellcheck="false" aria-label="Wake word ${i + 1}"></div>
        <div class="field" style="flex:1 1 9em;margin:0"><label>Sounds like <span class="hint">(optional)</span></label><input type="text" class="wksay" maxlength="40" value="${esc(w.say ?? "")}" placeholder="compootah" autocomplete="off" spellcheck="false" aria-label="How wake word ${i + 1} sounds"></div>
        <button type="button" class="btn wkrm" title="Remove this wake word" aria-label="Remove wake word ${i + 1}">✕</button>
      </div>
      <div class="field" style="margin:.4em 0 0"><label>Also accept <span class="hint">(what the recognizer writes instead, separated by commas)</span></label><input type="text" class="wkalso" value="${esc((w.also ?? []).join(", "))}" placeholder="computer, compute a" autocomplete="off" spellcheck="false" aria-label="Also accept for wake word ${i + 1}"></div>
      ${(w.trained ?? []).length ? `<div class="hint wktrained">Learned in training: ${w.trained.map((t) => `<span class="chip" style="cursor:default">${esc(t)} <button type="button" class="wkforget" data-w="${esc(w.text)}" data-v="${esc(t)}" title="Forget this one" aria-label="Forget ${esc(t)}" style="border:0;background:none;color:inherit;cursor:pointer">✕</button></span>`).join(" ")}</div>` : ""}
      <div class="hint wkmsg" aria-live="polite"></div>
    </div>`;

  function html(o = {}) {
    const name = o.assistantName || "Dayspring";
    const words = (o.wakeWords ?? [name.toLowerCase()]).map((t) => ({ text: t, say: o.wakeSay?.[t] ?? "", also: o.wakeAlso?.[t] ?? [], trained: o.wakeTrained?.[t] ?? [] }));
    const follows = o.wakeFollowsName !== false, sens = o.wakeSensitivity || "normal";
    return `<div id="namingBox">
      <div class="row">
        <div class="field"><label for="aname">Assistant's name <span class="hint" id="anameCount"></span></label><input type="text" id="aname" maxlength="${MAX + 5}" value="${esc(name)}" placeholder="Dayspring" autocomplete="off" spellcheck="false" aria-describedby="anameMsg"><div class="hint" id="anameMsg" aria-live="polite">Up to ${MAX} letters, numbers, spaces, apostrophes and hyphens.</div></div>
        <div class="field"><label for="asay">How to say it <span class="hint">(optional)</span></label><div class="row" style="gap:.4em"><input type="text" id="asay" maxlength="40" value="${esc(o.assistantSay ?? "")}" placeholder="like Ee-fa, for Aoife" autocomplete="off" spellcheck="false"><button type="button" class="btn" id="asayHear" title="Hear how it sounds">▶ Hear it</button></div><div class="hint" id="asayMsg">For the voice, and for hearing the name when you say it.</div></div>
      </div>
      <p class="hint">Dayspring stays the app's name (in About, Help and Updates); your assistant is <b id="anameShown">${esc(name)}</b>.</p>
      <h2 style="margin-top:1em">Wake words</h2>
      <label class="scshow"><input type="checkbox" id="wkFollow" ${follows ? "checked" : ""}> Wake up to its name (and follow it when the name changes)</label>
      <div id="wkWrap" ${follows ? "hidden" : ""}>
        <div id="wkList">${words.map(row).join("")}</div>
        <div class="row" style="gap:.4em;flex-wrap:wrap;margin:.3em 0"><button type="button" class="btn" id="wkAdd">+ Add a wake word</button><span class="hint" style="align-self:center">Quick picks:</span><span id="wkPicks"></span></div>
      </div>
      <p class="hint">“Hey”, “Okay” or “Yo” in front of a wake word always works. It only counts at the start of what you say (or after a pause), so “my computer is slow” never wakes it. Never “Lantern”: that's the learning app's.</p>
      <div class="field"><span class="lbl" id="wkSensL">How easily it wakes</span><div class="chips" role="radiogroup" aria-labelledby="wkSensL" id="wkSens">${SENS.map(([v, t, d]) => `<button type="button" class="chip${v === sens ? " on" : ""}" role="radio" aria-checked="${v === sens}" data-v="${v}" title="${esc(d)}">${t}</button>`).join("")}</div><div class="hint" id="wkSensHint">${esc(SENS.find((x) => x[0] === sens)[2])}</div></div>
      <div class="field"><label for="wkTry">Try it: type what the speech recognizer might write</label><div class="row" style="gap:.4em"><input type="text" id="wkTry" placeholder="computer, what time is it?" autocomplete="off" spellcheck="false"></div><div class="hint" id="wkTryOut" aria-live="polite"></div></div>
      <div class="field"><span class="lbl">Train my wake word</span><div class="row" style="gap:.4em;flex-wrap:wrap"><select id="wkTrainWord" aria-label="Which wake word to train"></select><button type="button" class="btn" id="wkTrain">🎙 Train on the Dayspring screen</button></div><div class="hint" id="wkTrainOut" aria-live="polite">Say it 5 times on the Dayspring screen: what its microphone hears each time is kept as accepted spellings. Save first if you just changed the wake words.</div></div>
    </div>`;
  }

  // ---- reading the form -------------------------------------------------------------------------------------------------
  const nameNow = () => ($("#aname")?.value ?? "").replace(/\s+/g, " ").trim();
  function wordsNow() {
    if ($("#wkFollow")?.checked) return [{ text: nameNow().toLowerCase(), say: $("#asay")?.value.trim() ?? "", also: [], trained: [] }];
    return $$(".wkrow").map((r) => ({ text: r.querySelector(".wk").value.replace(/\s+/g, " ").trim().toLowerCase(), say: r.querySelector(".wksay").value.trim(), also: r.querySelector(".wkalso").value.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean), trained: [...r.querySelectorAll(".wkforget")].map((b) => b.dataset.v) })).filter((w) => w.text);
  }
  const sensNow = () => $("#wkSens .chip.on")?.dataset.v ?? "normal";
  const matcher = () => W()?.createMatcher({ name: nameNow(), words: wordsNow().map((w) => ({ ...w, say: w.say || sayFromName(w.text) })), sensitivity: sensNow() });
  function sayFromName(text) { const n = (nameNow() || "").toLowerCase(), s = ($("#asay")?.value ?? "").trim(); return s && n && text.includes(n) ? text.replace(n, s.toLowerCase()) : ""; }

  // ---- live checks ------------------------------------------------------------------------------------------------------
  function checkName() {
    const v = nameNow(), n = [...v].length, r = W()?.validateName(v) ?? { ok: true };
    $("#anameCount").textContent = n ? `${n}/${MAX}` : "";
    const msg = $("#anameMsg");
    msg.textContent = r.ok ? `Up to ${MAX} letters, numbers, spaces, apostrophes and hyphens.` : r.error;
    msg.classList.toggle("bad", !r.ok); $("#aname").setAttribute("aria-invalid", String(!r.ok));
    $("#anameShown").textContent = r.ok ? r.value : v || "Dayspring";
    picks();
    return r;
  }
  function checkRows() {
    let bad = null;
    for (const r of $$(".wkrow")) {
      const v = r.querySelector(".wk").value, out = r.querySelector(".wkmsg");
      if (!v.trim()) { out.textContent = ""; continue; }
      const c = W()?.validateWake(v, { name: nameNow() }) ?? { ok: true, warnings: [] };
      out.innerHTML = c.ok ? [...c.warnings.map((w) => `⚠ ${esc(w)}`), ...(c.tips ?? []).map((t) => `Easier to hear: “${esc(t)}”`)].join("<br>") || "✓ Sounds distinct." : `<span class="bad">${esc(c.error)}</span>`;
      r.querySelector(".wk").setAttribute("aria-invalid", String(!c.ok));
      if (!c.ok && !bad) bad = c.error;
    }
    const n = $$(".wkrow").length;
    $("#wkAdd").disabled = n >= MAXW; $("#wkAdd").title = n >= MAXW ? `Up to ${MAXW} wake words` : "";
    trainChoices(); tryIt();
    return bad;
  }
  function picks() {
    const n = nameNow() || "Dayspring", el = $("#wkPicks"); if (!el) return;
    el.innerHTML = [`Hey ${n}`, n, "Computer", "Jarvis"].map((p) => `<button type="button" class="chip" data-pick="${esc(p)}">${esc(p)}</button>`).join(" ");
  }
  function tryIt() {
    const t = $("#wkTry")?.value ?? "", out = $("#wkTryOut"); if (!out) return;
    if (!t.trim()) { out.textContent = "Type a sentence to see whether it would wake up."; return; }
    const m = matcher()?.match(t);
    out.innerHTML = m ? `✓ Wakes up (heard “${esc(m.wake)}”${m.how === "exact" ? "" : `, ${esc({ sound: "sounds like it", lookalike: "an everyday word that sounds like it, at the start", taught: "an accepted spelling", clipped: "the end of it" }[m.how] ?? m.how)}`})${m.rest ? `, and the request is “${esc(m.rest)}”` : ", and waits for the request"}.` : "✗ Wouldn't wake up. (A wake word counts at the start of what you say, or after a pause.)";
  }
  function trainChoices() {
    const sel = $("#wkTrainWord"); if (!sel) return;
    const ws = (view?.wake?.words ?? []).map((w) => w.text), cur = sel.value;
    sel.innerHTML = ws.map((w) => `<option value="${esc(w)}">${esc(W()?.cap(w) ?? w)}</option>`).join("");
    if (ws.includes(cur)) sel.value = cur;
  }
  function addRow(text = "") {
    const list = $("#wkList"); if ($$(".wkrow").length >= MAXW) return;
    list.insertAdjacentHTML("beforeend", row({ text }, $$(".wkrow").length));
    checkRows();
  }

  // ---- training (the Dayspring screen listens; this page shows how it's going) ----------------------------------------
  function showTrain(st) {
    const out = $("#wkTrainOut"); if (!out || !st) return;
    if (st.report) {
      const r = st.report;
      out.innerHTML = `Recognized <b>${r.recognized} of ${r.samples}</b> (${r.successRate}%). ${r.learned.length ? `Now also accepts ${r.learned.map((x) => `“${esc(x)}”`).join(", ")}.` : "Nothing new to learn."}${r.warnings.map((w) => `<br>⚠ ${esc(w)}`).join("")}${r.suggestions.length ? `<br>Easier to hear: ${r.suggestions.map((x) => `“${esc(W()?.cap(x) ?? x)}”`).join(", ")}.` : ""}`;
      clearInterval(trainPoll); trainPoll = null; $("#wkTrain").disabled = false;
      api("/assistant").then((v) => { view = v; }).catch(() => {});
      return;
    }
    if (st.cancelled || st.done) { out.textContent = `Training stopped. ${st.why ?? ""}`; clearInterval(trainPoll); trainPoll = null; $("#wkTrain").disabled = false; return; }
    out.textContent = `On the Dayspring screen: say “${st.shown}” when it says “now”. ${st.got} of ${st.want} so far${st.heard?.length ? ` (heard: ${st.heard.map((h) => `“${h}”`).join(", ")})` : ""}.`;
  }
  async function startTrain() {
    const word = $("#wkTrainWord").value;
    try {
      const st = await api("/wake/train/start", { word, from: "settings" });
      $("#wkTrain").disabled = true; showTrain(st);
      clearInterval(trainPoll); trainPoll = setInterval(() => api("/wake/train").then(showTrain).catch(() => {}), 1000);
    } catch (e) { $("#wkTrainOut").textContent = e.message; }
  }

  // ---- mounting and saving ----------------------------------------------------------------------------------------------
  async function mount(el) {
    root = el;
    try { view = await api("/assistant"); } catch { view = null; }
    const on = (sel, ev, fn) => root.addEventListener(ev, (e) => { const t = e.target.closest(sel); if (t && root.contains(t)) fn(e, t); });
    on("#aname", "input", () => { checkName(); checkRows(); });
    on("#asay", "input", () => { const r = ($("#asay").value.trim() && !/^[\p{L}\p{M}' -]+$/u.test($("#asay").value.trim())) ? "Write how it sounds with letters, spaces and hyphens, like “Ee-fa”." : "For the voice, and for hearing the name when you say it."; $("#asayMsg").textContent = r; tryIt(); });
    on("#asayHear", "click", () => { const s = $("#asay").value.trim() || nameNow(); try { const u = new SpeechSynthesisUtterance(`Hi, I'm ${s}.`); speechSynthesis.cancel(); speechSynthesis.speak(u); } catch { /* no voice here */ } });
    on("#wkFollow", "change", () => { $("#wkWrap").hidden = $("#wkFollow").checked; if (!$("#wkFollow").checked && !$$(".wkrow").length) addRow(nameNow().toLowerCase()); checkRows(); });
    on(".wk", "input", () => checkRows());
    on(".wkrm", "click", (e, b) => { b.closest(".wkrow").remove(); if (!$$(".wkrow").length) addRow(""); checkRows(); });
    on("#wkAdd", "click", () => addRow(""));
    on("[data-pick]", "click", (e, b) => { const p = b.dataset.pick.toLowerCase(); const empty = $$(".wkrow").find((r) => !r.querySelector(".wk").value.trim()); if (empty) empty.querySelector(".wk").value = p; else if ($$(".wkrow").length < MAXW) addRow(p); else $$(".wkrow").at(-1).querySelector(".wk").value = p; checkRows(); });
    on("#wkSens .chip", "click", (e, b) => { $$("#wkSens .chip").forEach((c) => { c.classList.toggle("on", c === b); c.setAttribute("aria-checked", String(c === b)); }); $("#wkSensHint").textContent = SENS.find((x) => x[0] === b.dataset.v)[2]; tryIt(); });
    on("#wkTry", "input", () => tryIt());
    on("#wkTrain", "click", () => startTrain());
    on(".wkforget", "click", async (e, b) => { try { await api("/wake/trained/forget", { word: b.dataset.w, variant: b.dataset.v }); b.closest(".chip").remove(); } catch { /* stays */ } });
    checkName(); checkRows();
    api("/wake/train").then((st) => { if (st?.id && !st.done) { $("#wkTrain").disabled = true; showTrain(st); trainPoll = setInterval(() => api("/wake/train").then(showTrain).catch(() => {}), 1000); } }).catch(() => {});
  }
  async function save() {
    const n = checkName();
    if (!n.ok) { $("#aname")?.focus(); throw new Error(n.error); }
    const bad = checkRows();
    if (bad) throw new Error(bad);
    const follows = $("#wkFollow").checked, words = wordsNow();
    if (!follows && !words.length) throw new Error("Keep at least one wake word, or turn on “Wake up to its name”.");
    const body = { name: n.value, say: $("#asay").value.trim(), followsName: follows, sensitivity: sensNow() };
    if (!follows) { body.wakeWords = words.map((w) => w.text); body.wakeSay = Object.fromEntries(words.filter((w) => w.say).map((w) => [w.text, w.say])); body.wakeAlso = Object.fromEntries(words.map((w) => [w.text, w.also])); }
    view = await api("/assistant", body);
    trainChoices();
    return view;
  }
  window.dsNaming = { html, mount, save, get view() { return view; } };
})();
