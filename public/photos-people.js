// Settings → Photos & people: face recognition in the owner's own photos (off by default, stays on this computer),
// "Who's in this picture?" questions, describing pictures with the AI (asks once), saving texts and calls to people's
// profiles (off by default, encrypted), and deleting it all. Everything saves as you go (data/vision.json).
(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (path, body) => {
    const r = await fetch("/api" + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "That didn't work. Try again.");
    return j;
  };
  let root = null, opts = {}, S = null, timer = null;
  const $ = (s) => root?.querySelector(s);
  const $$ = (s) => [...(root?.querySelectorAll(s) ?? [])];
  const tog = (key, title, desc) => `<div class="toggle"><div class="txt"><b id="pp-${key}-l">${esc(title)}</b><div>${desc}</div></div><button type="button" class="sw" role="switch" id="pp-${key}" data-key="${key}" aria-labelledby="pp-${key}-l" aria-checked="false"></button></div>`;

  function html() {
    return `<h1>Photos &amp; people</h1>
      <p class="lead">Dayspring can describe pictures, read the text in them, and, if you want, recognise the people in your own photos so it can say "Sarah and Tom at the lake" and keep a page about each person.</p>
      <div id="pp-status" class="note" aria-live="polite">Loading…</div>

      <h2>Faces</h2>
      ${tog("faces", "Recognise faces in my photos", "Off until you turn it on. Only your own photo folders, never pictures from the web.")}
      <div id="pp-explain" class="note" hidden>
        <b>Before you turn this on</b>
        <ul style="margin:.4em 0 .2em 1.1em;padding:0">
          <li><b>It stays on this computer.</b> Faces are found and compared here. Nothing about a face is ever uploaded, and nobody is ever looked up online.</li>
          <li><b>What's stored:</b> for each face in your photos, where it is and a "fingerprint" (128 numbers), plus a small thumbnail for each person. It's encrypted with your Windows account, in Dayspring's data folder, and never exported.</li>
          <li><b>How to delete it:</b> "Delete all face data" below removes all of it. Deleting one person on the People page removes their faces too.</li>
          <li><b>Ask first.</b> Please get people's OK before you name and catalogue them.</li>
          <li>It needs a one-time download of the face models (<span id="pp-size">about 72 MB</span>, from OpenCV and Microsoft's ONNX Runtime; each file is checked before it's used). Then it looks through your photos slowly in the background.</li>
        </ul>
        <div class="row" style="gap:.6em;flex-wrap:wrap"><button type="button" class="btn small" id="pp-yes">I understand, turn it on</button><button type="button" class="btn small ghost" id="pp-no">Not now</button></div>
      </div>
      <div id="pp-models" class="hint"></div>
      <div id="pp-index" class="hint"></div>
      ${tog("askWho", "Ask who's in pictures", "Now and then, when a photo with people you haven't named is on the screen, Dayspring asks \"Who's in this picture?\" Only at relaxed times, never in Quiet or Off, meetings or calls.")}
      <div class="field"><label for="pp-per">Questions about photos and people, at most</label><select id="pp-per"><option value="1">Once a day</option><option value="2">Twice a day</option></select><div class="hint">Shared with "What's this one?" and "Is this the same person?" questions. Both at once are one question.</div></div>

      <h2>Describing pictures</h2>
      ${tog("aiDescribe", "Describe images with AI", "Sends the picture to your AI provider for a much richer description. Without it, Dayspring describes pictures from what it can work out on this computer (text, date, faces, your own words).")}
      ${tog("aiMessages", "Let the AI read saved messages when I ask about someone", "Only when you ask something that needs them, like \"what did Sarah say about Friday?\". Off: message words never go to the AI.")}

      <h2>Texts and calls</h2>
      ${tog("saveTexts", "Save my text messages to people's profiles", "Texts Dayspring sees (Phone Link) and sends go on the person's page. Encrypted on this computer. Off: nothing is written.")}
      ${tog("saveCalls", "Save call history to people's profiles", "Who, when, how long and which app (phone, Discord). Encrypted on this computer.")}
      <div class="field"><label for="pp-keep">Keep saved messages and calls</label><select id="pp-keep"><option value="0">Keep them</option><option value="30">30 days</option><option value="90">90 days</option><option value="365">A year</option></select></div>

      <h2>People</h2>
      <p><a href="/people.html" target="_blank" rel="noopener" id="pp-people">Open the People page ↗</a> <span class="hint">everyone Dayspring knows, their photos, prayer requests, goals, plans, messages and calls.</span></p>
      <div class="row" style="gap:.6em;flex-wrap:wrap;margin-top:1em"><button type="button" class="btn small danger" id="pp-delfaces">Delete all face data</button><button type="button" class="btn small danger" id="pp-delmsgs">Delete all saved messages</button></div>
      <div class="msg" id="m"></div>`;
  }

  function paint(st) {
    if (!root?.isConnected || !$("#pp-status")) return;
    S = st;
    const s = st.settings;
    $$(".sw[data-key]").forEach((b) => b.setAttribute("aria-checked", String(Boolean(s[b.dataset.key]))));
    $("#pp-askWho").disabled = !s.faces; $("#pp-askWho").closest(".toggle").style.opacity = s.faces ? "" : ".55";
    $("#pp-per").value = String(s.askPerDay); $("#pp-keep").value = String(s.keepDays);
    $("#pp-aiDescribe").disabled = !st.ai?.canSee && !s.aiDescribe;
    const h = st.helper ?? {};
    $("#pp-status").innerHTML = [h.ok ? `Reading text in pictures: ${h.ocr ? `on (Windows, ${esc(h.lang ?? "")})` : "not available (add a language with text recognition in Windows Settings)"}.` : `Windows' picture tools aren't available: ${esc(h.error ?? "")}`,
      st.ai?.canSee ? `Your AI (${esc(st.ai.provider)}) can look at pictures${s.aiDescribe ? "" : " if you allow it below"}.` : "Your AI can't look at pictures (or there's no AI), so descriptions are made on this computer.",
      st.messages ? `Saved: ${st.messages.texts} text${st.messages.texts === 1 ? "" : "s"}, ${st.messages.calls} call${st.messages.calls === 1 ? "" : "s"}.` : ""].filter(Boolean).join(" ");
    const md = st.models ?? {};
    $("#pp-size").textContent = `about ${md.size?.downloadMB ?? 72} MB to download, ${md.size?.diskMB ?? 54} MB on disk`;
    $("#pp-models").innerHTML = !s.faces ? "" : md.installed ? "Face models: installed." : md.installing ? `Downloading the face models… ${md.progress?.total ? Math.round((md.progress.done / md.progress.total) * 100) : 0}%` : `Face models: not downloaded yet. <button type="button" class="btn small" id="pp-dl">Download (${md.size?.downloadMB ?? 72} MB)</button>`;
    const ix = st.index ?? {};
    $("#pp-index").innerHTML = !s.faces || !md.installed ? "" : `${ix.running ? `Looking through your photos: ${ix.done} of ${ix.total}.` : ix.total ? `Looked through ${ix.done} of ${ix.total} photos.` : "Waiting to look through your photos."}${ix.lastError ? ` <span class="bad">Last problem: ${esc(ix.lastError)}</span>` : ""} ${s.indexPaused ? '<button type="button" class="btn small" id="pp-resume">Resume</button>' : '<button type="button" class="btn small ghost" id="pp-pause">Pause</button>'}`;
    const dl = $("#pp-dl"); if (dl) dl.onclick = () => run(() => api("/vision/models/install", {}));
    const pa = $("#pp-pause"); if (pa) pa.onclick = () => run(() => api("/vision/index/pause", {}));
    const re = $("#pp-resume"); if (re) re.onclick = () => run(() => api("/vision/index/resume", {}));
    clearTimeout(timer);
    if (md.installing || ix.running) timer = setTimeout(refresh, 2000);
  }
  const msg = (t, kind = "") => { const m = $("#m"); if (m) { m.textContent = t; m.className = `msg ${kind}`; } };
  async function run(fn) { try { paint(await fn()); msg(""); } catch (e) { msg(e.message, "bad"); } }
  const refresh = () => run(() => api("/vision/settings"));
  const save = (patch) => run(() => api("/vision/settings", patch));

  async function mount(el, o = {}) {
    root = el; opts = o;
    $$(".sw[data-key]").forEach((b) => b.onclick = () => {
      if (b.disabled) return;
      const on = b.getAttribute("aria-checked") !== "true", key = b.dataset.key;
      if (key === "faces" && on) { $("#pp-explain").hidden = false; $("#pp-yes").focus(); return; }
      if (key === "aiDescribe" && on && !confirm(`Pictures you ask about will be sent to ${S?.ai?.provider ?? "your AI provider"} to describe them. Pictures from your own photos only go when you ask. Allow this?`)) return;
      if (key === "aiMessages" && on && !confirm("When you ask about someone, the AI may read your saved messages with them to answer. Allow this?")) return;
      save({ [key]: on });
    });
    $("#pp-yes").onclick = () => { $("#pp-explain").hidden = true; save({ faces: true, askWho: true }); };
    $("#pp-no").onclick = () => { $("#pp-explain").hidden = true; };
    $("#pp-per").onchange = (e) => save({ askPerDay: Number(e.target.value) });
    $("#pp-keep").onchange = (e) => save({ keepDays: Number(e.target.value) });
    $("#pp-delfaces").onclick = () => { if (confirm("Delete every face fingerprint and thumbnail, and the face models? People's names and notes stay. Face recognition turns off.")) run(() => api("/vision/faces/delete-all", {})).then(() => opts.toast?.("Face data deleted")); };
    $("#pp-delmsgs").onclick = () => { if (confirm("Delete every saved text message and call from people's profiles?")) run(() => api("/vision/messages/delete-all", {})).then(() => opts.toast?.("Saved messages deleted")); };
    await refresh();
    opts.onLeave?.(() => clearTimeout(timer));
  }
  window.DayspringPhotosPeople = { html, mount };
})();
