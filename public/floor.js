// The conversation floor, on the Dayspring screen (the server half is lib/floor.mjs).
// The owner's requests come first: this page tells the server the moment he starts talking (the wake word, 🎙 Talk,
// typing) and when the screen is idle again, and it reports each announcement it presented. An announcement that was
// only just starting (its chime playing, or its first ~300 ms of words) when he started talking is called back and
// goes back in the server's line, to be said after his request is done. Alarms and timers still ring on time; only
// their words wait for the reply to finish (at most 20 s). A small sign shows what's waiting ("1 thing to tell you
// after this"); tapping it, or asking "what were you going to say?", brings it out now.
//   window.dsFloor: present(item) · tokFor(text) · gate(tok, stage) · done(item) · owner(source) · replyActive()
//                   afterReply(maxMs) · busy() · held() · recall() · repaint() · _state()
// "Busy" also covers the moments the screen knows he's still talking to it (tv.js talkActive: his words being gathered,
// a sentence still finishing after the listening window closed, "Dayspring" just heard), so the server never decides
// he's done while he's mid-sentence.
(() => {
  const LEAD_CANCEL_MS = 300, RING_SPEECH_MAX_MS = 20_000, GRACE_MS = 4000, TYPING_MS = 15_000, OWNER_HOLD_MS = 2500;
  const core = () => window.dsCore;
  const speakerHere = () => window.dsIsSpeaker !== false;
  const toks = new Map();                       // fid → { item, text, cls, speechAt, cancelled, finished }
  let ownerAt = 0, ownerSent = 0, reported = "idle", lastBeat = 0, typedAt = 0, server = { held: 0, next: null, items: [] };
  const log = [];                               // tests: what happened here
  const note = (what, x = {}) => { log.push({ what, at: Date.now(), ...x }); if (log.length > 60) log.shift(); };
  let seq = 0;                                   // in order: an "idle" can't overtake the "owner" before it
  function send(body) {
    if (!speakerHere()) return;
    try { fetch("/api/floor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, seq: ++seq, page: window.dsPageId ?? null }), keepalive: true }).catch(() => {}); } catch { /* the server is restarting */ }
  }
  const cancel = Object.assign(new Error("called back: the owner started talking"), { floorCancel: true });

  // the screen right now: anything going on (talking, thinking, listening for an answer, ringing, him typing) is "busy"
  function stateNow() {
    const c = core(); if (!c) return "idle";
    const typing = Date.now() - typedAt < TYPING_MS && document.activeElement?.id === "typeBox" && String(document.activeElement.value ?? "").trim() !== "";
    // (he just started: "busy" for a moment even before the recognizer has his first full words)
    return c.mode !== "idle" || c.speaking || c.utter || c.talkActive || c.alarmOn || typing || Date.now() - ownerAt < OWNER_HOLD_MS ? "busy" : "idle";
  }
  setInterval(() => {
    if (!speakerHere()) return;
    const s = stateNow(), t = Date.now();
    if (s !== reported || (s === "busy" && t - lastBeat > 20_000)) { if (s !== reported) note("tv", { state: s }); reported = s; lastBeat = t; send({ type: "tv", state: s }); }
  }, 250);

  const F = {
    // an announcement arrived: a token that says whether it has been called back
    present(item) {
      if (!item) return null;
      const tok = { fid: item.fid ?? null, item, text: String(item.text ?? ""), cls: item.floor ?? "hold", speechAt: 0, cancelled: false, finished: false, at: Date.now() };
      if (tok.fid) toks.set(tok.fid, tok);
      if (tok.cls === "emergency") { try { core()?.stopSpeaking(); } catch { /* nothing to stop */ } }
      note("present", { kind: item.kind, cls: tok.cls });
      return tok;
    },
    tokFor(text) { let best = null; for (const t of toks.values()) if (!t.finished && t.text === text && (!best || t.at > best.at)) best = t; return best; },
    // notify() calls this before the chime ("chime"), just before the words ("speech") and after them ("after");
    // a called-back announcement stops there (the rest of its handler is skipped: no answer window)
    gate(tok, stage) {
      if (!tok) return;
      if (tok.cancelled) { note("stopped", { kind: tok.item.kind, stage }); throw cancel; }
      if (stage === "speech") tok.speechAt = Date.now();
    },
    done(item) {
      const tok = item?.fid ? toks.get(item.fid) : null;
      if (tok) { tok.finished = true; toks.delete(tok.fid); }
      if (!item?.fid) return;
      const outcome = tok?.cancelled ? "cancelled" : "spoken";
      note("done", { kind: item.kind, outcome });
      send({ type: "done", fid: item.fid, outcome, tv: stateNow() });
    },
    // he started talking: tell the server; anything only just starting is called back
    owner(source = "voice") {
      const t = Date.now();
      ownerAt = t;
      for (const tok of toks.values()) {
        if (tok.finished || tok.cancelled || tok.cls !== "hold") continue;
        if (!tok.speechAt || t - tok.speechAt <= LEAD_CANCEL_MS) {
          tok.cancelled = true;
          if (tok.speechAt) { try { core()?.stopSpeaking(); } catch { /* nothing to stop */ } }
          note("callback", { kind: tok.item.kind, during: tok.speechAt ? "first words" : "lead-in" });
        }
      }
      reported = "busy"; lastBeat = t;               // the next idle is reported, which ends his turn
      if (t - ownerSent > 1000) { ownerSent = t; send({ type: "owner", source }); }
    },
    // he said "Dayspring" over a notification being said: it stops and goes back in the server's line (said later)
    recall() {
      let n = 0;
      for (const tok of toks.values()) {
        if (tok.finished || tok.cancelled || tok.cls !== "hold") continue;
        tok.cancelled = true; n++;
        note("callback", { kind: tok.item.kind, during: tok.speechAt ? "words" : "lead-in" });
      }
      ownerAt = Date.now(); reported = "busy"; lastBeat = ownerAt; send({ type: "owner", source: "voice" });
      return n;
    },
    repaint() { paint(); },
    // his answer is on its way or being said (not the follow-up window after it)
    replyActive() { const c = core(); return Boolean(c && (c.mode === "thinking" || c.mode === "replying" || c.utter)); },
    // for an alarm's or a timer's words: wait until the reply is said, at most 20 s
    async afterReply(maxMs = RING_SPEECH_MAX_MS) {
      const t0 = Date.now();
      while (F.replyActive() && Date.now() - t0 < maxMs) await new Promise((r) => setTimeout(r, 200));
      const capped = F.replyActive();
      note("ring-words", { waited: Date.now() - t0, capped });
      return { waited: Date.now() - t0, capped };
    },
    // not the moment for something of Dayspring's own (the photo question): he's talking, or it's holding things
    busy() { return stateNow() === "busy" || Date.now() - ownerAt < GRACE_MS || server.held > 0 || Boolean(server.turn) || Boolean(server.presenting); },
    held() { return { ...server }; },
    release() { send({ type: "release" }); },
    _state: () => ({ reported, ownerAt, server: { ...server }, toks: [...toks.values()].map((t) => ({ kind: t.item.kind, cancelled: t.cancelled, speechAt: t.speechAt })), log: log.slice() }),
  };
  window.dsFloor = F;

  // 🎙 Talk and typing count as him starting to talk (capture: before the button's own handler stops anything)
  document.addEventListener("click", (e) => { if (e.target.closest?.("#pttBtn")) F.owner("talk button"); }, true);
  document.addEventListener("input", (e) => { if (e.target?.id === "typeBox" && String(e.target.value ?? "").trim()) { typedAt = Date.now(); if (Date.now() - ownerAt > 2000) F.owner("typing"); } }, true);

  // ---- the "after this" sign ----
  const css = document.createElement("style");
  css.textContent = `#dsFloorPill{display:inline-flex;align-items:center;gap:.35em;margin-left:.4em;padding:.15em .65em;border-radius:1em;font:inherit;font-size:.72em;line-height:1.5;border:1px solid rgba(255,210,122,.45);background:rgba(255,210,122,.12);color:#ffe2a8;cursor:pointer;white-space:nowrap;max-width:22em;overflow:hidden;text-overflow:ellipsis}
  #dsFloorPill:hover,#dsFloorPill:focus-visible{background:rgba(255,210,122,.24);outline:none}
  #dsFloorPill[hidden]{display:none}
  html.mini #dsFloorPill{max-width:12em}`;
  document.head.appendChild(css);
  const pill = document.createElement("button");
  pill.id = "dsFloorPill"; pill.type = "button"; pill.hidden = true;
  pill.title = "Tap to hear it now (or say “what were you going to say?”)";
  pill.onclick = (e) => { e.stopPropagation(); try { core()?.talkReleased?.(); } catch { /* an older screen */ } F.release(); pill.textContent = "Okay, telling you now"; };
  const place = () => { const st = document.getElementById("talkStatus"); if (st && !pill.isConnected) st.insertAdjacentElement("afterend", pill); else if (!st && !pill.isConnected) document.body.appendChild(pill); };
  function paint() {
    place();
    const n = (Number(server.held) || 0) + (Number(core()?.talkHeld) || 0);   // (+ what the screen itself is holding)
    pill.hidden = n < 1;
    if (n < 1) return;
    pill.textContent = n === 1 ? "1 thing to tell you after this" : `${n} things to tell you after this`;
    pill.setAttribute("aria-label", `${pill.textContent}: ${(server.items ?? []).join(", ") || "a notification"}. Tap to hear it now.`);
    pill.title = `Waiting: ${(server.items ?? []).join(" · ")}\nTap to hear it now (or say “what were you going to say?”)`;
  }
  const hook = (es) => {
    // something Dayspring will say after he's done: a quiet card now (tv.js talkCard), so nothing is lost
    es.addEventListener("floor-card", (e) => { try { const c = JSON.parse(e.data); if (speakerHere()) core()?.talkCard?.(c.title, c.text); } catch { /* bad event */ } });
    es.addEventListener("floor", (e) => { try { server = JSON.parse(e.data) ?? server; paint(); } catch { /* bad event */ } });
    es.addEventListener("hello", (e) => { try { const d = JSON.parse(e.data); if (d.floor) { server = { ...server, ...d.floor }; paint(); } } catch { /* bad event */ } });
  };
  if (window.dsEvents) hook(window.dsEvents); else addEventListener("ds-events", (e) => hook(e.detail), { once: true });
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", place, { once: true }); else place();
})();
