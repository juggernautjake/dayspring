// Pictures and people, started by the server: the background look through the owner's photos for faces (only with
// face recognition on and its models downloaded; low priority, throttled, pausable, picks up where it left off), the
// odd "Is 'Mike R' the same as Mike?" question about texts (inside the daily question budget), and trimming saved
// messages to the chosen time. Also the one call the photo panel makes: which question to ask about the next photo.
//   start({ announce, inCall }) · nextPhoto({ want }) · showing({ id, asked, kind }) · setOnScreen(item)
import * as vsettings from "./settings.mjs";
import * as library from "./library.mjs";
import * as ask from "./ask.mjs";
import * as describe from "./describe.mjs";
import * as photos from "../photos.mjs";
import * as store from "../store.mjs";

export { describeImage, describeWebImage, readText, setOnScreen, onScreen } from "./describe.mjs";

let started = false;
export function start({ announce = null, inCall = null } = {}) {
  // in a call or a meeting: the modules that know (already loaded by the server; never loaded just for this)
  const mods = {};
  for (const [k, path] of [["bridge", "../callbridge.mjs"], ["meet", "../meet/host.mjs"], ["discord", "../discord/bot.mjs"]]) import(path).then((m) => { mods[k] = m; }).catch(() => {});
  const busy = inCall ?? (() => Boolean(mods.bridge?.isTalking?.() || mods.meet?.inCall?.() || mods.discord?.inVoice?.()));
  ask.setDeps({ ...(announce ? { announce } : {}), inCall: busy });
  if (started) return;
  started = true;
  // faces: a minute after start (never slows the start-up), then every few hours for new photos
  const index = () => library.start().catch((e) => console.log(`faces: ${e.message}`));
  setTimeout(index, 60_000).unref?.();
  setInterval(index, 4 * 3600_000).unref?.();
  vsettings.onChange((now, before) => {
    if (now.faces && !before.faces) index();
    if ((!now.faces && before.faces) || (now.indexPaused && !before.indexPaused)) library.stop();
  });
  // people questions about texts and calls, and trimming saved messages
  setInterval(() => { ask.tickPeople().catch(() => {}); }, 10 * 60_000).unref?.();
  setInterval(async () => { try { (await import("../people/comms.mjs")).prune(); } catch { /* fine */ } }, 6 * 3600_000).unref?.();
}

// The TV wants the next photo (?ask=1: and whether to ask about it). One question at most, within the daily budget;
// "who" and "what" together are one question.
export async function nextPhoto({ want = false, date = store.todayISO() } = {}) {
  const p = await ask.plan({ date, want });
  const photo = photos.pick({ forQuestion: p.any, prefer: p.who ? p.prefer : null });
  const d = await ask.decide(photo, p);
  return { photo, ask: Boolean(d.ask), askKind: d.kind ?? null, question: d.question ?? null };
}
export async function showing({ id, asked = false, kind = null }) {
  describe.setOnScreen(id ? { kind: "photo", id } : null);
  if (asked && id) {
    // "What's this one?" is answered by the photo catalogue as before; "who" (and both at once) by ask.answer
    if (!kind || kind === "what" || kind === "both") photos.markAsked(id, store.todayISO());
    if (kind === "who" || kind === "both") await ask.markAsked(id, kind, store.todayISO());
    else vsettings.countAsk(store.todayISO());
  }
}
