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
//   { type: "state", inCall, captions, chat }  when any of those change
// and offers window.__ecoMeet = { selfCheck(), participants(), selfName(), inCall(), captionsOn(), setTile(on, label),
//   badge({ who, text, as } | null), find(part) }.

export const REGISTRY = {
  captionsRegion: ['[role="region"][aria-label="Captions"]', '[role="region"][aria-label*="aption" i]', '[aria-live][aria-label*="aption" i]', 'div[jsname="dsyhDe"]', 'div.a4cQT', '[data-mock="captions"]'],
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
  captionsButton: ['button[aria-label*="Turn on captions" i]', 'button[aria-label*="Turn off captions" i]', 'button[aria-label*="captions" i]'],
  peopleButton: ['button[aria-label*="Show everyone" i]', 'button[aria-label*="People" i]', 'button[aria-label*="participants" i]'],
  participantItem: ['[role="list"][aria-label*="articipant" i] [role="listitem"]', '[role="list"][aria-label*="people" i] [role="listitem"]', '[data-participant-id]', '[data-requested-participant-id]'],
  participantName: ['[data-self-name]', '.zWGUib', '.XEazBc', '.dwSJ2e', '.ZjFb7c'],
  selfName: ['[data-self-name]'],
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

  // ---- captions ----
  let seq = 0;
  const lastCaption = new Map();                  // entry id → text
  function captionEntries(region) {
    let list = findAll("captionEntry", region).filter((e) => region.contains(e));
    if (!list.length) list = [...region.children].length === 1 ? [...region.children[0].children] : [...region.children];
    return list.filter((e) => text(e));
  }
  function readEntry(e) {
    let speaker = "", said = "";
    for (const s of REG.captionSpeaker) { const el = q(s, e); if (el && text(el)) { speaker = text(el); used.captionSpeaker = s; break; } }
    for (const s of REG.captionText) { const el = q(s, e); if (el && text(el)) { said = text(el); used.captionText = s; break; } }
    if (!speaker || !said) { const ls = lines(e); if (ls.length >= 2 && ls[0].length <= 60) { speaker = speaker || ls[0]; said = said || ls.slice(1).join(" "); } }
    return { speaker, said };
  }
  function scanCaptions() {
    const region = find("captionsRegion");
    if (!region || !shown(region)) return false;
    for (const e of captionEntries(region)) {
      if (!e.dataset.ecoId) e.dataset.ecoId = "c" + (++seq);
      const { speaker, said } = readEntry(e);
      if (!said) continue;
      if (lastCaption.get(e.dataset.ecoId) === said) continue;
      lastCaption.set(e.dataset.ecoId, said);
      emit({ type: "caption", id: e.dataset.ecoId, speaker, text: said });
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
  function participants() {
    const out = new Set();
    for (const it of findAll("participantItem")) {
      let n = "";
      for (const s of REG.participantName) { const el = it.matches(s) ? it : q(s, it); if (el) { n = el.getAttribute("data-self-name") || text(el); if (n) break; } }
      if (!n) n = it.getAttribute("aria-label") || lines(it)[0] || "";
      n = String(n).split("\n")[0].trim();
      if (n && n.length <= 80) out.add(n);
    }
    return [...out];
  }
  function selfCheck() {
    const region = find("captionsRegion");
    return { inCall: inCall(), captions: shown(region), captionsOn: captionsOn(), chatInput: shown(find("chatInput")), chatMessages: findAll("chatMessage").length,
      participants: participants().length, selfName: selfName(), used: { ...used }, url: location.href, title: document.title };
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

  let last = "";
  function tick() {
    const cap = scanCaptions();
    const chat = scanChat();
    const s = JSON.stringify({ inCall: inCall(), captions: cap, chat });
    if (s !== last) { last = s; emit({ type: "state", ...JSON.parse(s) }); }
  }
  let mo = null, pending = false;
  function start() {
    if (!document.documentElement) return setTimeout(start, 50);
    mo = new MutationObserver(() => { if (pending) return; pending = true; setTimeout(() => { pending = false; tick(); }, 120); });
    mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    setInterval(tick, 1000);
    tick();
  }
  window.__ecoMeet = { selfCheck, participants, selfName, inCall, captionsOn, setTile, badge, find: (p) => Boolean(find(p)), used: () => ({ ...used }) };
  start();
}

export function agentSource(registry = REGISTRY) {
  return `(${agent.toString()})(${JSON.stringify(registry)});`;
}
