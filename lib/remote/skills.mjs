// Remote control by voice (and for the AI): the owner speaks to the Dayspring in front of him and it asks one of his
// other Dayspring devices. No AI needed.
//   "which of my Dayspring devices are online?" · "is the office PC online?"
//   "turn on my home computer" · "on my office PC, turn on fan 2" · "turn on fan 2 on the office PC"
//   "how's printer 3 doing?" · "show me printer 1's camera" · "show the front door camera"
//   "tell the living room TV dinner's ready" · "remind the office PC at 5 pm to call Sam" · "what's on the laptop's schedule?"
// Risky things (a computer's power, heaters, unlocking, starting a print) are confirmed HERE, on the sending device,
// with the owner's own "yes" (lib/confirm.mjs), before they go.
//
//   createSkills({ engine, confirm, localHas, show })
//     handle(text, { surface }) → { reply, ... } | null      null = not a remote request (the local skills answer)
//     TOOLS · runTool(name, input)
import { isRisky, riskText, LIMITS } from "./policy.mjs";

const norm = (t) => String(t ?? "").toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
const SCREEN = ["tv", "desk", "typed"];                         // where a spoken or typed yes counts
const listText = (xs) => (xs.length <= 1 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1]);

export const TOOLS = [
  { name: "remote_devices", description: "List the owner's own Dayspring devices on his other computers and screens (signed in with the same account): which are online, when each was last seen, and what each can control (smart devices, 3D printers, cameras). Use for 'which of my devices are online', 'what can the office PC do'.",
    input_schema: { type: "object", properties: {} } },
  { name: "remote_command", description: "Ask one of the owner's OTHER Dayspring devices to do something, over the internet, end-to-end encrypted: its status, its schedule, say something there, set a reminder there, control a smart device it controls ('turn on my computer at home', 'turn on fan 2'), a 3D printer's status or camera, a camera still, or start a print. Leave device empty to let Dayspring pick the device that controls the thing named. Risky actions (power to a computer or heater, unlocking, starting a print) return needsConfirm with a question: ask the owner, and only after HE says yes call again with the same arguments plus confirm_token.",
    input_schema: { type: "object", properties: {
      device: { type: "string", description: "which of his devices, by name ('Office PC', 'Living room TV'); empty = the one that controls it" },
      action: { type: "string", enum: ["status", "schedule", "announce", "remind", "devices", "printers.status", "printers.camera", "printers.start", "cameras.snapshot", "cameras.list"] },
      command: { type: "string", description: "for devices: the command in his words, e.g. 'turn on fan 2'" },
      text: { type: "string", description: "for announce/remind: what to say or the reminder" },
      time: { type: "string", description: "for remind: HH:MM (24-hour)" },
      printer: { type: "string" }, camera: { type: "string" }, confirm_token: { type: "string" },
    }, required: ["action"] } },
];

export function createSkills({ engine, confirm, localHas = () => false, show = async () => null }) {
  let ask = null;                                               // { token, op, at, device, action, args, what }

  const deviceList = () => { try { return engine()?.cached() ?? []; } catch { return []; } };
  const approved = () => { try { return Boolean(engine()?.approved()); } catch { return false; } };
  // a device named at the START of some words: "office pc turn on fan 2" → [device, "turn on fan 2"]
  function namedAtStart(words) {
    const q = norm(words).replace(/^(my|the|our) /, "");
    let best = null;
    for (const d of deviceList()) {
      if (d.trust === "revoked") continue;
      const n = norm(d.name).replace(/^(my|the) /, "");
      if (n && (q === n || q.startsWith(n + " ")) && (!best || n.length > best[1])) best = [d, n.length];
    }
    return best ? [best[0], q.slice(best[1]).trim()] : null;
  }
  function namedAtEnd(words) {
    const q = norm(words);
    for (const d of deviceList()) {
      const n = norm(d.name);
      for (const pre of ["on my ", "on the ", "at my ", "at the ", "on "]) if (n && q.endsWith(" " + pre + n)) return [d, q.slice(0, q.length - pre.length - n.length - 1).trim()];
    }
    return null;
  }
  const byName = (words) => { const hit = namedAtStart(words); return hit && !hit[1] ? hit[0] : engine()?.findDevice(words) ?? null; };

  // what the words ask a device to do → { action, args } (words already stripped of the device's name)
  function classify(w) {
    const q = norm(w);
    let m;
    if ((m = /^(?:show|let me see|pull up|open)(?: me)? (?:the )?(printer ?\d+|.*?printer)(?:'s| s)? camera\b/.exec(q)) || (m = /^(?:show|let me see)(?: me)? (?:the )?camera (?:on|of|for) (?:the )?(printer ?\d*)/.exec(q))) return { action: "printers.camera", args: { printer: m[1].replace(/printer ?(\d+)/, "printer $1").trim() } };
    if ((m = /^(?:how'?s|how is|hows|what'?s|what is|check(?: on)?)(?: the)? (printer ?\d*|.*?printer)(?: doing| status| up to)?\b/.exec(q)) || (m = /^(printer ?\d*) status$/.exec(q))) return { action: "printers.status", args: { printer: m[1].replace(/printer ?(\d+)/, "printer $1").trim() || null } };
    if ((m = /^(?:start|begin|kick off) (?:a |the )?print(?: on (printer ?\d+))?(?: of (.+))?$/.exec(q))) return { action: "printers.start", args: { printer: m[1] ?? null, job: m[2] ?? null } };
    if ((m = /^(?:show|let me see|pull up)(?: me)? (?:the )?(.+?) camera$/.exec(q))) return { action: "cameras.snapshot", args: { camera: m[1] } };
    if (/^(?:what'?s|what is) on (?:the |its |my )?(?:schedule|calendar)|^(?:schedule|what'?s planned)/.test(q)) return { action: "schedule", args: {} };
    if (/^(?:status|how are you|are you (?:there|on|ok)|ping)\b/.test(q)) return { action: "status", args: {} };
    if ((m = /^(?:say|announce|tell (?:them|everyone|him|her)(?: that)?)[ ,]+(.+)$/.exec(q))) return { action: "announce", args: { text: m[1] } };
    if ((m = /^remind (?:me|them|us)?\s*(?:at ([0-9: ]+(?:am|pm|a m|p m)?))? ?(?:to |about |that )?(.+?)(?: at ([0-9: ]+(?:am|pm|a m|p m)?))?$/.exec(q))) return { action: "remind", args: { text: m[2], time: hm(m[1] ?? m[3]) } };
    if (/^(?:turn|switch|power|shut|start|stop|set|dim|open|close|lock|unlock|toggle|restart|reboot|wake)\b/.test(q)) return { action: "devices", args: { command: String(w).trim() } };
    return null;
  }
  function hm(t) {
    if (!t) return null;
    const m = /^(\d{1,2})(?::?(\d{2}))? ?(am|pm|a m|p m)?$/.exec(norm(t).replace(/\s+/g, " ").trim());
    if (!m) return null;
    let h = Number(m[1]); const mi = Number(m[2] ?? 0), ap = (m[3] ?? "").replace(/\s/g, "");
    if (ap === "pm" && h < 12) h += 12; if (ap === "am" && h === 12) h = 0;
    if (!ap && h < 7) h += 12;                                  // "at 5" means 5 pm
    return h < 24 && mi < 60 ? `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}` : null;
  }

  function onlineText() {
    const list = deviceList().filter((d) => d.trust === "approved" || d.trust === "this");
    const others = list.filter((d) => d.trust !== "this");
    if (!others.length) return "This is your only Dayspring device so far. To add another, sign in on it (Settings → Devices & sign-in) and approve it here.";
    const on = others.filter((d) => d.online).map((d) => d.name), off = others.filter((d) => !d.online).map((d) => d.name);
    return `${on.length ? `Online: ${listText(on)}.` : "None of your other devices is online right now."}${off.length ? ` Offline: ${listText(off)}.` : ""}`;
  }

  // send it (asking first when it's risky); camera pictures go to the screen
  async function go(device, action, args, { surface = "tv", confirmed = false, fromTool = false } = {}) {
    const e = engine();
    if (!confirmed && isRisky(action, args)) return askFirst(device, action, args, fromTool, surface);
    const r = await e.send(device.id, action, args, { confirmed });
    if (r?.needsConfirm && !confirmed) return askFirst(device, action, args, fromTool, surface, r.say);
    if (r?.bytes) {
      const url = await show({ device, action, args, bytes: r.bytes, contentType: r.contentType }).catch(() => null);
      const what = args.printer ? `${args.printer}'s camera` : args.camera ? `the ${args.camera} camera` : "the camera";
      return { reply: `Here's ${what} from ${device.name}.`, ok: true, image: url };
    }
    return { reply: r?.say ? (r.ok ? `${device.name}: ${r.say}` : r.say) : r?.ok ? `Done on ${device.name}.` : `${device.name} couldn't do that.`, ok: Boolean(r?.ok), offline: Boolean(r?.offline) };
  }
  // the question is asked HERE; its "yes" travels inside the signed command (confirmed), and the other device acts on it
  function askFirst(device, action, args, fromTool, surface, theirQuestion = null) {
    const op = { tool: "remote_command", device: device.id, action, args };
    const what = riskText(action, args);
    const token = confirm.issue(op, { text: `Do this on ${device.name}: ${what}?`, what: `remote ${action} on ${device.name}`, surfaces: SCREEN });
    ask = { token, op, at: Date.now(), device, action, args, surface };
    const their = theirQuestion && !/^that needs your ok first/i.test(theirQuestion) ? String(theirQuestion).trim().replace(/\s*(say yes|are you sure)[^.?!]*[.?!]?\s*$/i, "") : "";
    const q = their ? `${device.name} asks: ${their} Are you sure? Say yes to go ahead.` : `That will ${what} through ${device.name}. Are you sure? Say yes to go ahead.`;
    return fromTool ? { needsConfirm: true, confirm_token: token, say: q } : { reply: q, listen: true };
  }

  async function handle(text, { surface = "tv" } = {}) {
    const q = norm(text);
    if (!q) return null;
    // the answer to our own question
    if (ask && Date.now() - ask.at < 2 * 60_000 && (confirm.isYes(text) || confirm.isNo(text))) {
      const a = ask; ask = null;
      if (confirm.isNo(text)) return { reply: "Okay, I won't." };
      const c = confirm.consume(a.token, a.op);
      if (!c.ok) return { reply: c.why === "expired" ? "That question expired. Ask me again." : "I couldn't take that as a yes from here. Ask me again on this screen." };
      return go(a.device, a.action, a.args, { surface, confirmed: true });
    }
    const aboutDevices = /\b(dayspring (devices|computers|screens)|my other (devices|computers|dayspring))\b/.test(q);
    const onlineAsk = /\b(which|what) of my (dayspring )?(devices|computers|screens)\b.*\b(online|on|connected|up|awake)\b|\bwhich (of )?(my )?(dayspring )?devices are (online|on|connected)\b|\b(are|is) (all )?my (dayspring |other )?devices (online|on|connected)\b|^list my dayspring devices$/.test(q);
    if (!approved()) {
      if (onlineAsk || (aboutDevices && /\b(online|connected|list)\b/.test(q))) return { reply: "This Dayspring isn't signed in to your other devices yet. Open Settings → Devices & sign-in to connect them." };
      return null;
    }
    if (onlineAsk) { await engine().sync().catch(() => {}); return { reply: onlineText() }; }
    let m;
    if ((m = /^is (?:my |the )?(.+?) (online|on|connected|awake|up)$/.exec(q))) {
      const d = byName(m[1]);
      if (d && d.trust !== "this") { await engine().sync().catch(() => {}); const f = engine().cached().find((x) => x.id === d.id) ?? d; return { reply: f.online ? `Yes, ${f.name} is online.` : `No, ${f.name} is offline${f.lastSeen ? " (last seen " + new Date(f.lastSeen).toLocaleString() + ")" : ""}.` }; }
    }
    // "tell the living room tv dinner's ready" · "let the office pc know I'm on my way"
    if ((m = /^(?:tell|let) (.+)$/.exec(q))) {
      const hit = namedAtStart(m[1]);
      if (hit && hit[0].trust === "approved" && hit[1]) {
        const msg = hit[1].replace(/^(that|to say|know|know that) /, "").replace(/^know /, "");
        if (msg) return go(hit[0], "announce", { text: msg.charAt(0).toUpperCase() + msg.slice(1) }, { surface });
      }
    }
    // "remind the office pc at 5 pm to call sam"
    if ((m = /^remind (.+)$/.exec(q))) {
      const hit = namedAtStart(m[1]);
      if (hit && hit[0].trust === "approved" && hit[1]) { const c = classify("remind " + hit[1]); if (c) return go(hit[0], c.action, c.args, { surface }); }
    }
    // "what's on the laptop's schedule"
    if ((m = /^what'?s on (?:the |my )?(.+?)(?:'s| s) (?:schedule|calendar)$/.exec(q))) { const d = byName(m[1]); if (d?.trust === "approved") return go(d, "schedule", {}, { surface }); }
    // "on my office pc, turn on fan 2" · "on the living room tv say dinner's ready"
    if ((m = /^(?:on|at|using|via) (?:my |the )?(.+)$/.exec(q))) {
      const hit = namedAtStart(m[1]);
      if (hit && hit[1]) {
        if (hit[0].trust === "this") return null;               // "on this computer…": the local skills
        if (hit[0].trust !== "approved") return { reply: `${hit[0].name} isn't one of your approved devices yet.` };
        const c = classify(hit[1]) ?? { action: "devices", args: { command: hit[1] } };
        return go(hit[0], c.action, c.args, { surface });
      }
    }
    // "turn on fan 2 on the office pc" · "how's printer 3 doing on the living room tv"
    { const hit = namedAtEnd(q); if (hit && hit[0].trust === "approved") { const c = classify(hit[1]); if (c) return go(hit[0], c.action, c.args, { surface }); } }
    // nothing named: the device that controls the thing, when it isn't this one
    const c = classify(text);
    if (!c) return null;
    const thing = c.action === "devices" ? thingIn(c.args.command) : c.action.startsWith("printers.") ? (c.args.printer || "printer") : c.action === "cameras.snapshot" ? c.args.camera : null;
    if (!thing) return null;
    const kind = c.action === "cameras.snapshot" ? "cameras.snapshot" : c.action.startsWith("printers.") ? "printers.status" : "devices";
    if (localHas(kind, thing)) return null;                     // this computer controls it itself
    const at = engine().whoHandles(kind, thing.replace(/\b(at home|home|my home)\b/g, "").trim() || thing);
    const saysHome = /\b(at home|my home|home)\b/.test(q);
    if (at.length === 1) return go(at[0].device, c.action, { ...c.args, ...(c.action === "devices" ? { command: String(text).replace(/\s*\bat home\b/i, "").replace(/\bmy home\b/i, "my").replace(/\s+/g, " ").trim() } : {}) }, { surface });
    if (at.length > 1) return { reply: `More than one of your devices has ${thing}: ${listText(at.map((x) => x.device.name))}. Say which, like "on ${at[0].device.name}, ${String(text).trim()}".` };
    if (saysHome || c.action.startsWith("printers.")) return { reply: `None of your Dayspring devices says it controls ${thing}${deviceList().some((d) => d.trust === "approved" && !d.online) ? " (some are offline, so they may not have said yet)" : ""}. Name the device, like "on my office PC, ${String(text).trim()}".` };
    return null;
  }
  const thingIn = (cmd) => norm(cmd).replace(/^(turn|switch|power|shut|start|stop|set|dim|open|close|lock|unlock|toggle|restart|reboot|wake)( up| down| on| off)? /, "").replace(/ (on|off|up|down)$/, "").replace(/^(on|off) /, "").replace(/^(the|my) /, "").replace(/ to \d+.*$/, "").trim();

  async function runTool(name, input = {}) {
    if (name === "remote_devices") {
      if (!approved()) return { error: "This Dayspring isn't signed in to the owner's other devices (Settings → Devices & sign-in)." };
      const list = await engine().devices();
      return { devices: list.filter((d) => d.trust === "approved" || d.trust === "this").map((d) => ({ name: d.name, thisDevice: d.trust === "this", online: d.online, lastSeen: d.lastSeen, controls: d.names, mayAsk: d.trust === "this" ? undefined : undefined })) };
    }
    if (name !== "remote_command") return undefined;
    if (!approved()) return { error: "This Dayspring isn't signed in to the owner's other devices (Settings → Devices & sign-in)." };
    const action = String(input.action ?? "");
    const args = action === "devices" ? { command: String(input.command ?? input.text ?? "") } : action === "announce" ? { text: String(input.text ?? "") } : action === "remind" ? { text: String(input.text ?? ""), time: input.time ? hm(input.time) ?? input.time : null }
      : action.startsWith("printers.") ? { printer: input.printer ?? null } : action.startsWith("cameras.") ? { camera: input.camera ?? null } : {};
    let device = input.device ? byName(input.device) : null;
    if (input.device && !device) return { error: `No device called "${input.device}". Ask remote_devices for the names.` };
    if (!device) {
      const kind = action.startsWith("printers.") ? "printers.status" : action.startsWith("cameras.") ? "cameras.snapshot" : action === "devices" ? "devices" : null;
      const at = kind ? engine().whoHandles(kind, action === "devices" ? thingIn(args.command) : args.printer ?? args.camera ?? "") : [];
      if (at.length !== 1) return { error: at.length ? `More than one device can: ${at.map((x) => x.device.name).join(", ")}. Say which.` : "Say which device." };
      device = at[0].device;
    }
    if (device.trust === "this") return { error: "That's this device; do it here instead." };
    if (input.confirm_token) {
      const op = { tool: "remote_command", device: device.id, action, args };
      const c = confirm.consume(input.confirm_token, op);
      if (!c.ok) return { error: c.why === "not-approved" ? "The owner hasn't said yes yet." : "That confirmation doesn't match or has expired. Ask again." };
      const r = await go(device, action, args, { confirmed: true, fromTool: true });
      return { ok: r.ok, say: r.reply, image: r.image ?? undefined };
    }
    const r = await go(device, action, args, { fromTool: true });
    return r.needsConfirm ? r : { ok: r.ok, say: r.reply, offline: r.offline || undefined, image: r.image ?? undefined };
  }
  return { handle, runTool, classify, _ask: () => ask, LIVE: LIMITS.LIVE_FRAME_MS };
}
