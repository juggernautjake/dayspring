// Where things are on a Google Meet page, and the small script that watches it from inside the page.
//
// Google changes Meet's markup often, so every part has a list of selectors tried in order: the accessible ones first
// (roles and aria-labels, which change least), then known class names, then plain structure. The self-check reports
// which one matched, so a broken selector shows up in the pre-flight check, not in the middle of a demo.
//
//   REGISTRY                          the selector lists (a copy can be passed in with extra entries at the front)
//   agentSource(registry)             → the in-page watcher as a string, for page.addInitScript / page.evaluate
//
// The watcher calls window.__ecoMeetEmit(event) (a Playwright binding) with:
//   { type: "caption", id, speaker, text }     a caption line that appeared or changed (the host waits for it to settle)
//   { type: "chat", id, author, text }         a new chat message (once each)
//   { type: "tile-click" }                     the small corner tile was clicked (enlarge it)
//   { type: "state", inCall, captions, chat, lang }  when any of those change
//   { type: "roster", tiles: [{ name, speaking }], panel: [names] | null, count, lang }   who is shown (when it changes)
//   { type: "notice", text }                  a short notice Meet showed ("Rich Alvarez joined"; roster.mjs parseNotice reads it)
//   { type: "speaking", name, source, confidence }   a tile shows its person talking (lit border, sound meter)
// and offers window.__ecoMeet = { selfCheck(), participants(), roster(), panelOpen(), selfName(), inCall(), captionsOn(),
//   setTile(on, label), badge({ who, text, as } | null), rec({ text, paused } | null) (the "● Notes" sign), find(part) }.
//
// Who is in the call comes from several places (each with fallbacks, the accessible ones first): the People list,
// the name on each video tile, Meet's join/leave notices, the caption speakers and chat senders (the app merges them:
// roster.mjs), and the number on the People button to cross-check. Who is talking: the caption's speaker first, else
// a tile's lit-up border or moving sound meter.

export const REGISTRY = {
  captionsRegion: ['[role="region"][aria-label="Captions"]', '[role="region"][aria-label*="aption" i]', '[aria-live][aria-label*="aption" i]',
    '[role="region"][aria-label*="ous-titres" i]', '[role="region"][aria-label*="ntertitel" i]', '[role="region"][aria-label*="ubtítulos" i]', '[role="region"][aria-label*="egendas" i]', '[role="region"][aria-label*="ottotitoli" i]', '[role="region"][aria-label*="ndertitel" i]',
    'div[jsname="dsyhDe"]', 'div.a4cQT', '[data-mock="captions"]'],
  captionEntry: ['.nMcdL', '[data-caption-entry]', '.TBMuR', ':scope > div > div'],
  captionSpeaker: ['.NWpY1d', '.KcIKyf', '.zs7s8d', '[data-speaker-name]'],
  captionText: ['.ygicle', '.bh44bd', '.iTTPOb', '[data-caption-text]'],
  chatMessage: ['[data-message-id]', '[data-message-text]', '.GDhqjd .oIy2qc'],
  chatGroup: ['[data-sender-id]', '[data-sender-name]', '.Ss4fHf', '.GDhqjd'],
  chatAuthor: ['[data-sender-name]', '.poVWob', '.YTbUzc', '.ZNiiKc'],
  chatText: ['[jsname="dTKtvb"]', '.ptNLrf', '[data-message-text]', '.oIy2qc'],
  chatInput: ['textarea[aria-label*="Send a message" i]', 'textarea[aria-label*="message" i]', 'textarea[jsname]', '[contenteditable="true"][aria-label*="message" i]'],
  chatSend: ['button[aria-label*="Send a message" i]', 'button[aria-label="Send message"]', 'button[aria-label*="send" i]'],
  chatButton: ['button[aria-label*="Chat with everyone" i]', 'button[aria-label*="chat" i]'],
  captionsButton: ['button[aria-label*="Turn on captions" i]', 'button[aria-label*="Turn off captions" i]', 'button[aria-label*="captions" i]',
    'button[aria-label*="sous-titres" i]', 'button[aria-label*="Untertitel" i]', 'button[aria-label*="subtítulos" i]', 'button[aria-label*="legendas" i]', 'button[aria-label*="sottotitoli" i]'],
  peopleButton: ['button[aria-label*="Show everyone" i]', 'button[aria-label*="People" i]', 'button[aria-label*="participants" i]', 'button[aria-label*="personnes" i]', 'button[aria-label*="Teilnehmer" i]', 'button[aria-label*="participantes" i]'],
  participantItem: ['[role="list"][aria-label*="articipant" i] [role="listitem"]', '[role="list"][aria-label*="people" i] [role="listitem"]', '[data-participant-id]', '[data-requested-participant-id]'],
  participantName: ['[data-self-name]', '.zWGUib', '.XEazBc', '.dwSJ2e', '.ZjFb7c'],
  selfName: ['[data-self-name]'],
  // the People list only (not the tiles)
  panelItem: ['[role="list"][aria-label*="articipant" i] [role="listitem"]', '[role="list"][aria-label*="people" i] [role="listitem"]', '[role="list"][aria-label*="personnes" i] [role="listitem"]',
    '[role="list"][aria-label*="eilnehmer" i] [role="listitem"]', '[role="list"][aria-label*="articipante" i] [role="listitem"]', '[role="list"][aria-label*="artecipant" i] [role="listitem"]'],
  // a video tile, its name label, and signs that its person is talking
  tile: ['[data-participant-id]:not([role="listitem"])', '[data-requested-participant-id]:not([role="listitem"])', '[data-tile]'],
  tileName: ['[data-self-name]', '[data-participant-name]', '.zWGUib', '.XEazBc', '.dwSJ2e', '.ZjFb7c', '.notranslate'],
  tileSpeaking: ['[data-speaking="true"]', '[data-active-speaker="true"]', '[aria-label*="is speaking" i]', '[aria-label*="speaking" i]', '.kssMZb'],
  audioLevel: ['[data-audio-level]', '.IisKdb', '.DYfzY', '[class*="audio-level" i]', '[class*="audiolevel" i]'],
  // the number on the People button (everyone in the call, the owner too)
  participantCount: ['[data-participant-count]', 'button[aria-label*="Show everyone" i]', 'button[aria-label*="People" i]', 'button[aria-label*="participant" i]', 'button[aria-label*="personnes" i]', 'button[aria-label*="Teilnehmer" i]'],
  // where Meet puts its short notices ("Rich Alvarez joined")
  notice: ['[role="alert"]', '[role="status"]', '[aria-live="assertive"]', '[aria-live="polite"]'],
  leaveButton: ['button[aria-label*="Leave call" i]', 'button[aria-label*="leave" i]', '[data-mock="leave"]'],
  micButton: ['button[aria-label*="microphone" i]'],
  camButton: ['button[aria-label*="camera" i]'],
  joinButton: ['button[data-mock="join"]', 'button[jsname="Qx7uuf"]'],
};

export function mergeRegistry(extra = {}) {
  const out = {};
  for (const k of Object.keys(REGISTRY)) out[k] = [...(extra[k] ?? []), ...REGISTRY[k]];
  return out;
}

// ---- the in-page watcher (runs inside the Meet page; no imports, no closures over this module) ----------------------
function agent(REG) {
  if (window.__ecoMeet) return;
  const emit = (e) => { try { if (typeof window.__ecoMeetEmit === "function") window.__ecoMeetEmit(e); } catch { /* the binding is gone */ } };
  const q = (sel, root = document) => { try { return root.querySelector(sel); } catch { return null; } };
  const qa = (sel, root = document) => { try { return [...root.querySelectorAll(sel)]; } catch { return []; } };
  const used = {};
  const shown = (el) => Boolean(el && el.getClientRects().length && getComputedStyle(el).visibility !== "hidden");
  function find(part, root = document) { for (const s of REG[part] ?? []) { const el = q(s, root); if (el) { used[part] = s; return el; } } return null; }
  function findAll(part, root = document) { for (const s of REG[part] ?? []) { const els = qa(s, root); if (els.length) { used[part] = s; return els; } } return []; }
  const text = (el) => String(el?.innerText ?? el?.textContent ?? "").replace(/ /g, " ").trim();
  const lines = (el) => text(el).split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const inside = (el, part) => (REG[part] ?? []).some((s) => { try { return Boolean(el.closest(s)); } catch { return false; } });
  // a name, not one of Meet's icon words ("more_vert", "mic_off") or a button label
  const ICONISH = /^[a-z]+(?:_[a-z]+)+$|^(?:more options|pin|unpin|mute|remove|mic|videocam|keep|frame_person|visual_effects|more_vert)$/i;
  const nameLike = (s) => { const t = String(s ?? "").trim(); return t.length >= 1 && t.length <= 80 && !ICONISH.test(t) && /\p{L}/u.test(t); };
  const SELF_MARK = /\((?:you|vous|t[uú]|du|sie|voc[eê]|jij|u|me|moi|yo|ich|io|eu|ik)\)/i;
  const pageLang = () => document.documentElement.lang || navigator.language || "en";

  // ---- captions ----
  let seq = 0;
  const lastCaption = new Map();                  // entry id → text
  function captionEntries(region) {
    let list = findAll("captionEntry", region).filter((e) => region.contains(e));
    if (!list.length) list = [...region.children].length === 1 ? [...region.children[0].children] : [...region.children];
    return list.filter((e) => text(e));
  }
  // who said it: the speaker's label; else the first line of an entry that has a picture (a speaker's block); else
  // (a line with no name or picture) the speaker of the line before, carrying on
  function readEntry(e) {
    let speaker = "", said = "", how = "";
    for (const s of REG.captionSpeaker) { const el = q(s, e); if (el && text(el)) { speaker = text(el); used.captionSpeaker = s; how = "label"; break; } }
    for (const s of REG.captionText) { const el = q(s, e); if (el && text(el)) { said = text(el); used.captionText = s; break; } }
    if (!speaker || !said) {
      const ls = lines(e);
      if (speaker) said = said || ls.filter((l) => l !== speaker).join(" ");
      else if (ls.length >= 2 && ls[0].length <= 60 && q("img", e)) { speaker = ls[0]; how = "first-line"; said = said || ls.slice(1).join(" "); }
      else said = said || ls.join(" ");
    }
    return { speaker, said, how };
  }
  function scanCaptions() {
    const region = find("captionsRegion");
    if (!region || !shown(region)) return false;
    let prev = "";
    for (const e of captionEntries(region)) {
      if (!e.dataset.ecoId) e.dataset.ecoId = "c" + (++seq);
      let { speaker, said, how } = readEntry(e);
      if (!speaker && prev) { speaker = prev; how = "continues"; used.captionContinues = "the line before"; }
      if (speaker) prev = speaker;
      if (!said) continue;
      if (lastCaption.get(e.dataset.ecoId) === said) continue;
      lastCaption.set(e.dataset.ecoId, said);
      emit({ type: "caption", id: e.dataset.ecoId, speaker, text: said, how });
    }
    if (lastCaption.size > 300) { const keys = [...lastCaption.keys()].slice(0, 150); for (const k of keys) lastCaption.delete(k); }
    return true;
  }

  // ---- chat ----
  const seenChat = new Set();
  let chatPrimed = false;                          // messages already there when we started are not new questions
  function authorOf(m) {
    const withAttr = m.closest("[data-sender-name]");
    if (withAttr?.dataset.senderName) return withAttr.dataset.senderName;
    let g = null;
    for (const s of REG.chatGroup) { g = m.closest(s); if (g) break; }
    if (g) {
      for (const s of REG.chatAuthor) { const a = q(s, g); if (a && text(a) && !a.contains(m)) { used.chatAuthor = s; return a.getAttribute("data-sender-name") || text(a); } }
      const ls = lines(g); if (ls.length >= 2) return ls[0];
    }
    return "";
  }
  function bodyOf(m) {
    if (m.dataset.messageText) return m.dataset.messageText;
    for (const s of REG.chatText) { const el = m.matches(s) ? m : q(s, m); if (el && text(el)) return text(el); }
    return text(m);
  }
  function scanChat() {
    const msgs = findAll("chatMessage");
    for (const m of msgs) {
      const id = m.getAttribute("data-message-id") || (m.dataset.ecoId ||= "m" + (++seq));
      if (seenChat.has(id)) continue;
      seenChat.add(id);
      if (!chatPrimed) continue;
      const body = bodyOf(m);
      if (body) emit({ type: "chat", id, author: authorOf(m), text: body });
    }
    chatPrimed = true;
    return msgs.length > 0 || Boolean(find("chatInput"));
  }

  // ---- state, participants ----
  const inCall = () => shown(find("leaveButton"));
  function captionsOn() {
    const b = find("captionsButton");
    if (b) { const l = (b.getAttribute("aria-label") || "").toLowerCase(); if (b.getAttribute("aria-pressed") === "true" || /turn off captions/.test(l)) return true; if (/turn on captions/.test(l)) return false; }
    return shown(find("captionsRegion"));
  }
  function selfName() { const el = find("selfName"); return el ? (el.getAttribute("data-self-name") || text(el)) : ""; }
  function itemName(it) {
    let n = "";
    for (const s of REG.participantName) { const el = it.matches(s) ? it : q(s, it); if (el) { n = el.getAttribute("data-self-name") || text(el); if (n) break; } }
    if (!n) n = it.getAttribute("aria-label") || lines(it)[0] || "";
    n = String(n).split("\n")[0].trim();
    if (n && !SELF_MARK.test(n) && SELF_MARK.test(text(it))) n += " (You)";      // Meet marks the owner's own entry
    return n && n.length <= 90 ? n : "";
  }
  function participants() {
    const out = new Set();
    for (const it of findAll("participantItem")) { const n = itemName(it); if (n) out.add(n); }
    for (const t of tilesNow().tiles) { const n = tileName(t); if (n) out.add(n); }
    return [...out];
  }

  // ---- who is in the call: the People list, the video tiles, the count on the People button ----
  const panelOpen = () => findAll("panelItem").some(shown);
  function panelNow() {
    const items = findAll("panelItem").filter(shown);
    if (!items.length) return null;
    return [...new Set(items.map(itemName).filter(Boolean))];
  }
  function tileName(t) {
    for (const s of REG.tileName) {
      for (const el of (t.matches(s) ? [t] : qa(s, t))) {
        const n = String(el.getAttribute("data-self-name") || el.getAttribute("data-participant-name") || text(el)).split("\n")[0].trim();
        if (nameLike(n)) { used.tileName = s; return n; }
      }
    }
    const al = t.getAttribute("aria-label");
    if (nameLike(al)) { used.tileName = "aria-label"; return al.trim(); }
    const ls = lines(t).filter((l) => nameLike(l) && l.length <= 60);
    if (ls.length) { used.tileName = "text"; return ls[0]; }
    return "";
  }
  function tilesNow() {
    let tiles = findAll("tile").filter(shown), strategy = tiles.length ? used.tile : null;
    if (!tiles.length) {                            // no tile markers at all: each video, and the labelled box around it
      const set = new Set();
      for (const v of qa("video")) { if (!shown(v)) continue; let e = v.parentElement; for (let i = 0; i < 5 && e; i++, e = e.parentElement) { if (lines(e).some((l) => nameLike(l) && l.length <= 60)) { set.add(e); break; } } }
      tiles = [...set]; strategy = tiles.length ? "video" : null;
      if (strategy) used.tile = "video";
    }
    tiles = tiles.filter((t) => !tiles.some((o) => o !== t && o.contains(t)));    // a tile inside a tile: the outer one
    return { tiles, strategy };
  }
  function countNow() {
    for (const s of REG.participantCount) {
      const el = q(s); if (!el) continue;
      const al = el.getAttribute("aria-label") || "";
      const v = el.getAttribute("data-participant-count") || (text(el).match(/\d+/) ?? [])[0] || (/\((\d+)\)|(\d+)\s*(?:people|participants?|personnes|teilnehmer|participantes)/i.exec(al) ?? []).slice(1).find(Boolean);
      if (v && Number(v) > 0) { used.participantCount = s; return Number(v); }
    }
    return null;
  }

  // ---- who is talking on the tiles: a "speaking" marker, a sound meter that moves, or the one lit-up border ----
  const meters = new WeakMap();                    // sound meter → { sig, changedAt }
  function tileSpeaking(t) {
    for (const s of REG.tileSpeaking) { const el = t.matches(s) ? t : q(s, t); if (el) { used.tileSpeaking = s; return { source: "tile-indicator", confidence: 0.7 }; } }
    for (const s of REG.audioLevel) {
      const el = q(s, t); if (!el) continue;
      used.audioLevel = s;
      const sig = [el.className, el.getAttribute("style"), el.getAttribute("data-audio-level"), el.firstElementChild?.getAttribute("style")].join("|");
      const m = meters.get(el);
      if (!m) meters.set(el, { sig, changedAt: 0 });
      else if (m.sig !== sig) { m.sig = sig; m.changedAt = Date.now(); }
      const at = meters.get(el).changedAt;
      if (at && Date.now() - at < 1500 && el.getAttribute("data-audio-level") !== "0") return { source: "sound-meter", confidence: 0.55 };
      break;
    }
    return null;
  }
  function borderSig(el) {
    const cs = getComputedStyle(el);
    return [cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2 ? cs.outlineColor : "", parseFloat(cs.borderTopWidth) >= 2 ? cs.borderTopColor : "", cs.boxShadow !== "none" ? cs.boxShadow : ""].join("|");
  }
  function oddBorder(tiles) {                       // three or more tiles and exactly one looks different: it's lit up
    if (tiles.length < 3) return null;
    const sigs = tiles.map((t) => [t, ...[...t.children].slice(0, 6)].map(borderSig).join("/"));
    const n = new Map(); for (const x of sigs) n.set(x, (n.get(x) ?? 0) + 1);
    const odd = sigs.map((x, i) => (n.get(x) === 1 && /[^|/]/.test(x) ? i : -1)).filter((i) => i >= 0);
    return odd.length === 1 ? tiles[odd[0]] : null;
  }
  function roster() {
    const { tiles, strategy } = tilesNow();
    const lit = oddBorder(tiles);
    const list = [];
    for (const t of tiles) { const n = tileName(t); if (!n) continue; const sp = tileSpeaking(t) || (t === lit ? { source: "tile-border", confidence: 0.4 } : null); list.push({ name: n, speaking: sp }); }
    const panel = panelNow();
    return { tiles: list, tileStrategy: strategy, panel, count: countNow(), lang: pageLang() };
  }
  const lastSpoke = new Map();
  function speakTick() {
    for (const t of roster().tiles) {
      if (!t.speaking) continue;
      const at = lastSpoke.get(t.name) ?? 0;
      if (Date.now() - at > 900) { lastSpoke.set(t.name, Date.now()); used.speaking = t.speaking.source; emit({ type: "speaking", name: t.name, ...t.speaking }); }
    }
  }

  // ---- Meet's short notices ("Rich Alvarez joined"): never the chat or the captions (what people type or say) ----
  const noticeSeen = new Map();
  function checkNotice(node) {
    const el = node?.nodeType === 1 ? node : node?.parentElement;
    if (!el || !el.closest) return;
    let region = null;
    for (const s of REG.notice) { try { region = el.closest(s); } catch { region = null; } if (region) break; }
    if (!region) return;
    if (inside(el, "captionsRegion") || inside(el, "chatMessage") || inside(el, "chatGroup") || inside(el, "chatInput") || el.closest('[aria-label*="message" i]')) return;
    for (const t of lines(el)) {
      if (t.length > 120) continue;
      const last = noticeSeen.get(t); if (last && Date.now() - last < 5000) continue;
      noticeSeen.set(t, Date.now()); if (noticeSeen.size > 200) noticeSeen.clear();
      used.notice = "notices";
      emit({ type: "notice", text: t });
    }
  }

  function selfCheck() {
    const region = find("captionsRegion");
    const r = roster();
    return { inCall: inCall(), captions: shown(region), captionsOn: captionsOn(), chatInput: shown(find("chatInput")), chatMessages: findAll("chatMessage").length,
      participants: participants().length, selfName: selfName(), used: { ...used }, url: location.href, title: document.title,
      roster: { tiles: r.tiles.length, tileStrategy: r.tileStrategy, panel: r.panel ? r.panel.length : null, count: r.count, lang: r.lang } };
  }

  // ---- the corner tile: a see-through cover that says "click to enlarge" ----
  let cover = null;
  function setTile(on, label = "Click to enlarge") {
    if (!on) { cover?.remove(); cover = null; return; }
    if (cover) return;
    cover = document.createElement("div");
    cover.setAttribute("data-eco-tile", "");
    cover.style.cssText = "position:fixed;inset:0;z-index:2147483646;cursor:zoom-in;background:transparent;";
    const tag = document.createElement("div");
    tag.textContent = label;
    tag.style.cssText = "position:absolute;right:12px;bottom:12px;padding:10px 18px;border-radius:999px;background:rgba(10,14,30,.72);color:#fff;font:600 36px/1.2 system-ui,sans-serif;opacity:0;transition:opacity .2s";
    cover.appendChild(tag);
    cover.addEventListener("mouseenter", () => { tag.style.opacity = "1"; });
    cover.addEventListener("mouseleave", () => { tag.style.opacity = "0"; });
    cover.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); emit({ type: "tile-click" }); }, true);
    (document.body || document.documentElement).appendChild(cover);
  }
  // ---- who is answering (seen by the owner in the Meet window; by everyone when the owner shares it) ----
  let card = null;
  function badge(b) {
    if (!b) { card?.remove(); card = null; return; }
    if (!card) { card = document.createElement("div"); card.setAttribute("data-eco-badge", ""); (document.body || document.documentElement).appendChild(card); }
    const lantern = b.as === "lantern";
    card.style.cssText = `position:fixed;left:16px;top:16px;z-index:2147483647;display:flex;align-items:center;gap:10px;padding:8px 14px 8px 10px;border-radius:14px;` +
      `background:rgba(12,16,32,.82);color:#fff;font:600 15px/1.2 system-ui,sans-serif;box-shadow:0 0 ${b.speaking ? 22 : 8}px ${lantern ? "rgba(255,170,60,.75)" : "rgba(124,140,255,.75)"};pointer-events:none`;
    card.innerHTML = "";
    const dot = document.createElement("span");
    dot.textContent = lantern ? "🏮" : "●";
    dot.style.cssText = lantern ? "font-size:20px" : "font-size:18px;color:#8e9bff;text-shadow:0 0 8px #8e9bff";
    const t = document.createElement("span"); t.textContent = b.text || (lantern ? "Lantern" : "Dayspring");
    card.append(dot, t);
  }

  // ---- "● Notes" at the top right while notes are being taken (the owner sees it; so does everyone if it's shared) ----
  let recEl = null;
  function rec(r) {
    if (!r) { recEl?.remove(); recEl = null; return; }
    if (!recEl || !recEl.isConnected) { recEl = document.createElement("div"); recEl.setAttribute("data-eco-rec", ""); (document.body || document.documentElement).appendChild(recEl); }
    recEl.style.cssText = "position:fixed;right:16px;top:16px;z-index:2147483647;display:flex;align-items:center;gap:8px;padding:6px 14px;border-radius:999px;background:rgba(12,16,32,.82);color:#fff;font:600 22px/1.2 system-ui,sans-serif;pointer-events:none";
    recEl.innerHTML = "";
    const dot = document.createElement("span");
    dot.style.cssText = "width:14px;height:14px;border-radius:50%;background:" + (r.paused ? "#9aa0a6" : "#ea4335");
    const t = document.createElement("span"); t.textContent = r.text || (r.paused ? "Notes paused" : "Notes");
    recEl.setAttribute("data-paused", String(Boolean(r.paused)));
    recEl.append(dot, t);
  }

  let last = "", lastRoster = "";
  function tick() {
    const cap = scanCaptions();
    const chat = scanChat();
    const s = JSON.stringify({ inCall: inCall(), captions: cap, chat, lang: pageLang() });
    if (s !== last) { last = s; emit({ type: "state", ...JSON.parse(s) }); }
    if (!inCall()) return;
    const r = roster();
    const rs = JSON.stringify([r.tiles.map((t) => t.name), r.panel, r.count, r.lang]);
    if (rs !== lastRoster) { lastRoster = rs; emit({ type: "roster", ...r }); }
    speakTick();
  }
  // Changes are watched (not polled): new nodes and text for captions, chat and notices; attribute changes (a border
  // lighting up, a sound meter moving) for who is talking. A slow tick is only a safety net.
  let mo = null, ao = null, pending = false, spPending = false;
  function start() {
    if (!document.documentElement) return setTimeout(start, 10);
    mo = new MutationObserver((records) => {
      for (const r of records) { if (r.type === "characterData") checkNotice(r.target); else for (const n of r.addedNodes) checkNotice(n); }
      if (pending) return; pending = true; setTimeout(() => { pending = false; tick(); }, 120);
    });
    mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    ao = new MutationObserver(() => { if (spPending) return; spPending = true; setTimeout(() => { spPending = false; if (inCall()) speakTick(); }, 250); });
    ao.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ["class", "style", "data-speaking", "data-active-speaker", "data-audio-level"] });
    setInterval(tick, 1000);
    tick();
  }
  window.__ecoMeet = { selfCheck, participants, roster, panelOpen, selfName, inCall, captionsOn, setTile, badge, rec, find: (p) => Boolean(find(p)), used: () => ({ ...used }) };
  start();
}

export function agentSource(registry = REGISTRY) {
  return `(${agent.toString()})(${JSON.stringify(registry)});`;
}
