// Who in a meeting may ask the assistants something. The meeting's host (the owner) always may.
//
//   const perms = createPermissions({ assistants: ["dayspring", "lantern"], mode: "only-me" });
//   perms.allowed("Rich Alvarez", "lantern")                   → false (only the owner, for now)
//   perms.setMode("everyone") · perms.set("Rich Alvarez", { dayspring: true, lantern: true })
//   perms.command("let Rich and Jess ask", roster)              → { ok, reply, changed: ["Rich Alvarez", "Jess Park"] } | null
//     "let everyone ask" · "only listen to me" · "let Rich ask Lantern" · "stop letting Rich ask" · "don't let Jess ask Dayspring"
//
// modes: "only-me" (only the owner), "everyone" (anyone in the meeting), "custom" (the people switched on).
import { displayName, firstName, nameKey, isSelf } from "./names.mjs";

export function createPermissions({ assistants = ["dayspring", "lantern"], mode = "only-me", people = {} } = {}) {
  let m = ["only-me", "everyone", "custom"].includes(mode) ? mode : "only-me";
  const who = new Map(Object.entries(people).map(([k, v]) => [k.toLowerCase(), { ...v }]));

  const api = {
    assistants,
    mode: () => m,
    setMode(x) { if (["only-me", "everyone", "custom"].includes(x)) m = x; return m; },
    get(name) { return { ...(who.get(nameKey(name)) ?? {}) }; },
    set(name, can) {
      const k = nameKey(name); if (!k) return;
      const cur = who.get(k) ?? {};
      for (const a of assistants) if (typeof can[a] === "boolean") cur[a] = can[a];
      who.set(k, cur);
      if (m === "only-me" && Object.values(cur).some(Boolean)) m = "custom";
    },
    allowed(name, assistant = assistants[0], { isOwner = false } = {}) {
      if (isOwner || isSelf(name)) return true;
      if (m === "everyone") return who.get(nameKey(name))?.[assistant] !== false;   // unless switched off by name
      if (m === "only-me") return false;
      return who.get(nameKey(name))?.[assistant] === true;
    },
    snapshot() { return { mode: m, people: Object.fromEntries(who) }; },
    clear() { who.clear(); m = "only-me"; },
    command: (text, roster = []) => command(api, text, roster),
  };
  return api;
}

// ---- fuzzy names: "Rich" → "Rich Alvarez"; "Jessica" → "Jess Park" (close enough); "Jess" and "Jesse" → both? no: the closest ----
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
export function matchPerson(said, roster = []) {
  const s = String(said ?? "").toLowerCase().replace(/[^\p{L}\s'-]/gu, "").trim();
  if (!s) return null;
  const list = [...new Set(roster.map(displayName).filter((x) => x && !isSelf(x)))];
  const score = (full) => {
    const f = full.toLowerCase(), first = firstName(full).toLowerCase();
    if (f === s) return 0;
    if (first === s) return 1;
    if (f.startsWith(s + " ") || first.startsWith(s) || s.startsWith(first) && first.length >= 3) return 2;
    const d = Math.min(lev(s, first), lev(s, f));
    return d <= (s.length <= 4 ? 1 : 2) ? 3 + d : 99;
  };
  const ranked = list.map((x) => ({ x, sc: score(x) })).filter((r) => r.sc < 99).sort((a, b) => a.sc - b.sc);
  if (!ranked.length) return null;
  if (ranked.length > 1 && ranked[1].sc === ranked[0].sc) return null;   // two equally close: don't guess
  return ranked[0].x;
}

const ASSIST = (assistants) => new RegExp(`\\b(${assistants.join("|")})\\b`, "i");
function command(api, text, roster) {
  const t = String(text ?? "").toLowerCase().replace(/[.!?]+$/g, "").replace(/^(?:ok(?:ay)?|so|please|and)\s+/, "").trim();
  const only = ASSIST(api.assistants).exec(t)?.[1]?.toLowerCase() ?? null;
  const can = (on) => Object.fromEntries(api.assistants.map((a) => [a, only ? (a === only ? on : undefined) : on]).filter(([, v]) => v !== undefined));
  const label = only ? ` ask ${only[0].toUpperCase() + only.slice(1)}` : " ask";
  if (/^(?:only (?:listen|answer|respond) to me|just (?:listen|answer) to me|only me|nobody else(?: can ask)?|stop (?:letting )?(?:everyone|everybody|people) (?:ask|asking))$/.test(t)) {
    api.clear(); return { ok: true, mode: "only-me", reply: "Okay, I'll only answer you from now on." };
  }
  if (/^(?:let|allow) (?:everyone|everybody|all of you|anyone|anybody|the whole (?:meeting|call))(?: to)? ask\b/.test(t) || /^(?:everyone|everybody|anyone) can ask\b/.test(t)) {
    api.setMode("everyone"); return { ok: true, mode: "everyone", reply: `Okay, anyone in the meeting can ask${only ? ` ${only[0].toUpperCase() + only.slice(1)}` : " me"} now. Just start with my name.` };
  }
  let mm = /^(?:let|allow) (.+?)(?: to)? ask\b/.exec(t);
  const off = /^(?:stop letting|don'?t let|do not let|disallow|block) (.+?)(?: to)? ask(?:ing)?\b/.exec(t);
  if (off) mm = null;
  const group = (mm ?? off)?.[1];
  if (!group) return null;
  const said = group.split(/\s*(?:,|\band\b|&|\bplus\b)\s*/).map((s) => s.trim()).filter(Boolean);
  const found = [], missing = [];
  for (const s of said) { const p = matchPerson(s, roster); if (p) found.push(p); else missing.push(s); }
  for (const p of found) api.set(p, can(Boolean(mm)));
  if (!found.length) return { ok: false, reply: `I don't see ${said.join(" or ")} in the meeting.` };
  const names = found.map(firstName);
  const list = names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names.at(-1) : names[0];
  const extra = missing.length ? ` I couldn't find ${missing.join(" or ")}.` : "";
  return { ok: true, changed: found, reply: mm ? `Okay, ${list} can${label} now.${extra}` : `Okay, ${list} can't${label} anymore.${extra}` };
}
