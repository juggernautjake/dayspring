// ecosystem-core/client/meet-tile.js — the page side of a managed meeting: the "Meeting" chip, the people panel (who
// may ask which assistant), and the name card that shows which assistant is answering whom.
//
//   import { mountChip, mountPeople, mountNameCard } from "/eco/client/meet-tile.js";
//   const chip = mountChip(barEl, { onClick })              chip.update(state)
//   const people = mountPeople(panelEl, { adapter })        people.update(state)
//   const card = mountNameCard(document.body, { avatars })  card.show({ as: "lantern", text: "Lantern — answering Rich", speaking }) · card.hide()
//
//   state = { stage: "closed" | "loading" | "prejoin" | "sign-in" | "in-call" | "left", view: "tile" | "large",
//             mode: "only-me" | "everyone" | "custom", assistants: ["dayspring", "lantern"],
//             people: [{ name, owner, can: { dayspring, lantern } }], check: { captions, chat } }
//   adapter.post(path, body) → Promise   ("/meet/permissions" { mode } or { name, can })
//
// Plain DOM, no framework; styles are scoped under .eco-meet-*. Uses the shared tokens (tokens.css) when present.

const ASSIST_LABEL = { dayspring: "Dayspring", lantern: "Lantern" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let styled = false;
function style() {
  if (styled || typeof document === "undefined") return; styled = true;
  const s = document.createElement("style");
  s.textContent = `
  .eco-meet-chip{display:inline-flex;align-items:center;gap:.4em;padding:.28em .75em;border-radius:999px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.07);color:inherit;font:inherit;font-size:.85em;cursor:pointer}
  .eco-meet-chip[hidden]{display:none}
  .eco-meet-chip .dot{width:.6em;height:.6em;border-radius:50%;background:#9aa0a6}
  .eco-meet-chip[data-stage="in-call"] .dot{background:#34d399;box-shadow:0 0 8px #34d399}
  .eco-meet-chip[data-stage="sign-in"] .dot,.eco-meet-chip[data-stage="prejoin"] .dot{background:#fbbf24}
  .eco-meet-people{display:grid;gap:.5em}
  .eco-meet-people .modes{display:flex;gap:.35em;flex-wrap:wrap}
  .eco-meet-people .modes button{border-radius:999px;padding:.3em .8em;border:1px solid rgba(255,255,255,.2);background:transparent;color:inherit;cursor:pointer;font:inherit}
  .eco-meet-people .modes button[aria-pressed="true"]{background:var(--accent,#7c8cff);color:#0b0e1a;border-color:transparent}
  .eco-meet-people ul{list-style:none;margin:0;padding:0;display:grid;gap:.3em}
  .eco-meet-people li{display:flex;align-items:center;gap:.6em;justify-content:space-between;padding:.35em .55em;border-radius:.6em;background:rgba(255,255,255,.05)}
  .eco-meet-people li .who{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .eco-meet-people label{display:inline-flex;align-items:center;gap:.3em;font-size:.85em;cursor:pointer}
  .eco-meet-people .empty{opacity:.7;font-size:.9em}
  .eco-meet-card{position:fixed;left:50%;bottom:6.5em;transform:translateX(-50%);z-index:60;display:flex;align-items:center;gap:.7em;padding:.5em 1em .5em .6em;border-radius:1em;background:rgba(10,14,30,.86);color:#fff;box-shadow:0 0 18px rgba(124,140,255,.5);transition:opacity .25s,box-shadow .25s;pointer-events:none;font-weight:600}
  .eco-meet-card[hidden]{display:none}
  .eco-meet-card[data-as="lantern"]{box-shadow:0 0 20px rgba(255,170,60,.6)}
  .eco-meet-card[data-speaking="true"][data-as="lantern"]{box-shadow:0 0 34px rgba(255,170,60,.9)}
  .eco-meet-card[data-speaking="true"][data-as="dayspring"]{box-shadow:0 0 34px rgba(124,140,255,.9)}
  .eco-meet-card .face{width:44px;height:44px;flex:none;display:grid;place-items:center}
  .eco-meet-card .orbdot{width:28px;height:28px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#dfe4ff,#7c8cff 45%,#4b3bbf);box-shadow:0 0 14px #7c8cff}
  .eco-meet-card[data-speaking="true"] .orbdot{animation:ecoMeetPulse 1s ease-in-out infinite}
  @keyframes ecoMeetPulse{50%{transform:scale(1.15);box-shadow:0 0 24px #9aa6ff}}
  @media (prefers-reduced-motion: reduce){.eco-meet-card .orbdot{animation:none!important}}`;
  document.head.appendChild(s);
}

const STAGE_TEXT = { loading: "Joining…", prejoin: "Joining…", "sign-in": "Sign in to Google", "in-call": "Meeting", left: "Left meeting" };

export function mountChip(parent, { onClick = () => {} } = {}) {
  style();
  const b = document.createElement("button");
  b.type = "button"; b.className = "eco-meet-chip"; b.hidden = true;
  b.innerHTML = `<span class="dot"></span><span class="t">Meeting</span>`;
  b.addEventListener("click", () => onClick());
  parent.appendChild(b);
  return {
    el: b,
    update(st = {}) {
      const on = st.stage && st.stage !== "closed";
      b.hidden = !on;
      b.dataset.stage = st.stage ?? "closed";
      b.querySelector(".t").textContent = STAGE_TEXT[st.stage] ?? "Meeting";
      b.title = st.stage === "in-call" ? (st.view === "tile" ? "Enlarge the meeting" : "Shrink the meeting to the corner") : (STAGE_TEXT[st.stage] ?? "");
      b.setAttribute("aria-label", b.title || "Meeting");
    },
  };
}

export function mountPeople(parent, { adapter } = {}) {
  style();
  const box = document.createElement("div");
  box.className = "eco-meet-people";
  parent.appendChild(box);
  let st = {};
  const post = (path, body) => adapter?.post(path, body).catch(() => {});
  function render() {
    const as = st.assistants ?? ["dayspring", "lantern"];
    const mode = st.mode ?? "only-me";
    const people = (st.people ?? []).filter((p) => !p.owner);
    box.innerHTML = `
      <div class="modes" role="group" aria-label="Who can ask">
        <button type="button" data-mode="only-me" aria-pressed="${mode === "only-me"}">Only me</button>
        <button type="button" data-mode="everyone" aria-pressed="${mode === "everyone"}">Everyone can ask</button>
        <button type="button" data-mode="custom" aria-pressed="${mode === "custom"}">People I choose</button>
      </div>
      ${people.length ? `<ul>${people.map((p, i) => `<li><span class="who" title="${esc(p.name)}">${esc(p.name)}</span>${as.map((a) =>
        `<label><input type="checkbox" data-i="${i}" data-a="${a}" ${(mode === "everyone" ? p.can?.[a] !== false : p.can?.[a]) ? "checked" : ""}> Can ask ${ASSIST_LABEL[a] ?? a}</label>`).join("")}</li>`).join("")}</ul>`
        : `<p class="empty">Nobody else has joined yet (or the people list isn't readable). People also appear here when they speak or chat.</p>`}`;
    box.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => { st.mode = b.dataset.mode; render(); post("/meet/permissions", { mode: b.dataset.mode }); }));
    box.querySelectorAll("input[data-i]").forEach((c) => c.addEventListener("change", () => {
      const p = people[Number(c.dataset.i)]; if (!p) return;
      p.can = { ...(p.can ?? {}), [c.dataset.a]: c.checked };
      post("/meet/permissions", { name: p.name, can: { [c.dataset.a]: c.checked } });
    }));
  }
  return { el: box, update(next = {}) { st = { ...next, people: (next.people ?? []).map((p) => ({ ...p })) }; render(); } };
}

// The card that shows who's answering: the lantern avatar for Lantern, the orb for Dayspring.
export function mountNameCard(parent = document.body, { lanternAvatar = null } = {}) {
  style();
  const card = document.createElement("div");
  card.className = "eco-meet-card"; card.hidden = true; card.setAttribute("role", "status");
  card.innerHTML = `<div class="face"></div><div class="t"></div>`;
  parent.appendChild(card);
  let lamp = null, hideTimer = null;
  const face = card.querySelector(".face");
  function setFace(as) {
    if (card.dataset.as === as && face.firstChild) return;
    lamp?.destroy?.(); lamp = null; face.innerHTML = "";
    if (as === "lantern" && lanternAvatar?.mount) { const holder = document.createElement("div"); holder.style.cssText = "width:44px;height:44px"; face.appendChild(holder); try { lamp = lanternAvatar.mount(holder, { preset: "classic", size: 44, label: "Lantern" }); } catch { face.textContent = "🏮"; } }
    else if (as === "lantern") face.textContent = "🏮";
    else face.innerHTML = `<span class="orbdot"></span>`;
  }
  return {
    el: card,
    show({ as = "dayspring", text = "", speaking = false, ms = 0 } = {}) {
      clearTimeout(hideTimer);
      setFace(as);
      card.dataset.as = as; card.dataset.speaking = String(Boolean(speaking));
      card.querySelector(".t").textContent = text;
      card.hidden = false;
      lamp?.setState?.(speaking ? "speak" : "think");
      if (ms) hideTimer = setTimeout(() => this.hide(), ms);
    },
    speaking(on) { card.dataset.speaking = String(Boolean(on)); lamp?.setState?.(on ? "speak" : "idle"); },
    hide() { card.hidden = true; lamp?.setState?.("idle"); },
  };
}
