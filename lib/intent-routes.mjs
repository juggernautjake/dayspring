// Timers, recipes and cooking, and "what can I say without AI".
//   GET  /api/timers                          → timers, ringing, stopwatch, alarms
//   POST /api/timers {action, ref, ms, label} → start | pause | resume | cancel | add | rename | dismiss | snooze | stopwatch
//   GET  /api/recipes[?q=]                    → saved recipes (summaries)
//   GET  /api/recipes/:id                     → one recipe, with its easy steps
//   POST /api/recipes {text} | {recipe}       → saved (pasted text is parsed)
//   POST /api/recipes/import {url}            → read from a recipe page (schema.org) and saved, with its picture
//   POST /api/recipes/:id {patch}             → edited (title, tags, favourite, ingredients, steps, servings)
//   DELETE /api/recipes/:id                   → deleted
//   GET  /api/recipes/find?q=&more=1          → up to 6 recipes found online (not saved)
//   POST /api/recipes/found {ref, then: cook|save|view}
//   GET  /api/recipes/found-image?ref=r3      → a found recipe's picture, fetched here (never hotlinked)
//   GET  /api/recipes/image/:name             → a saved recipe's picture (data/recipe-images)
//   GET  /api/cooking · POST /api/cooking {action: start|next|prev|goto|scale|stop, id, n, factor}
//   GET  /api/intents                         → everything Dayspring understands without AI (for the Help page)
//   POST /api/intents/try {text}              → what it would do (nothing runs)
//   POST /api/intents/forget                  → forgets the phrasings it learned from picks
//   GET  /api/intents/misses · POST /api/intents/misses/clear · POST /api/intents/teach {text, id}
//   POST /api/commands/try {text}             → the everyday command it would be (lib/commands; nothing runs)
//   GET  /api/commands/state                  → a question waiting, what "it" means, the undo list, timed changes
import { readFile } from "node:fs/promises";
import * as timers from "./timers.mjs";
import * as recipes from "./recipes.mjs";
import * as intents from "./intents/index.mjs";
import { sayDuration } from "./intents/slots.mjs";

const bad = (send, res, msg, status = 400) => (send(res, status, { error: msg }), true);

export async function handle(req, res, { m, p, q, send, readJSON }) {
  // ---- timers
  if (p === "/timers" && m === "GET") return send(res, 200, timers.snapshot()), true;
  if (p === "/timers" && m === "POST") {
    const b = await readJSON(req).catch(() => ({}));
    const ref = b.ref ?? b.id ?? "";
    const ms = Number(b.ms) || 0;
    let r;
    switch (b.action) {
      case "start": if (!(ms > 0)) return bad(send, res, "ms is required"); r = timers.start({ ms, label: String(b.label ?? "") }); break;
      case "pause": r = timers.pause(ref); break;
      case "resume": r = timers.resume(ref); break;
      case "cancel": r = timers.cancel(ref); break;
      case "add": r = timers.addTime(ref, ms || 60_000); break;
      case "rename": r = timers.rename(ref, String(b.label ?? "")); break;
      case "dismiss": r = timers.dismiss(ref); break;
      case "snooze": r = timers.snooze(ref, ms || 5 * 60_000); break;
      case "stopwatch": r = timers.stopwatch(String(b.what ?? "read")); break;
      default: return bad(send, res, "unknown action");
    }
    return send(res, 200, { ok: true, result: r, ...timers.snapshot() }), true;
  }
  // ---- recipes
  if (p === "/recipes" && m === "GET") return send(res, 200, { recipes: q.get("q") ? recipes.searchSaved(q.get("q")) : recipes.list() }), true;
  if (p === "/recipes" && m === "POST") {
    const b = await readJSON(req).catch(() => ({}));
    const input = b.recipe ?? (b.text ? recipes.parseText(String(b.text)) : null);
    if (!input?.title && !input?.ingredients?.length) return bad(send, res, "Paste a recipe, or give it a title and ingredients.");
    try { const r = recipes.saveRecipe(input); return send(res, 200, { recipe: r }), true; } catch (e) { return bad(send, res, e.message); }
  }
  if (p === "/recipes/import" && m === "POST") {
    const { url } = await readJSON(req).catch(() => ({}));
    try { const r = await recipes.importUrl(String(url ?? "")); const saved = await recipes.saveFound(r); return send(res, 200, { recipe: saved }), true; }
    catch (e) { return bad(send, res, e.message); }
  }
  if (p === "/recipes/find" && m === "GET") {
    const last = recipes.lastResults();
    try {
      const r = q.get("more") && last ? await recipes.findOnline(last.query, { offset: last.offset + 6 }) : await recipes.findOnline(q.get("q") ?? "");
      return send(res, 200, r), true;
    } catch (e) { return bad(send, res, e.message); }
  }
  if (p === "/recipes/found" && m === "POST") {
    const b = await readJSON(req).catch(() => ({}));
    const r = recipes.fromResults(String(b.ref ?? ""));
    if (!r) return bad(send, res, "That recipe isn't in the list anymore.", 404);
    if (b.then === "save") return send(res, 200, { recipe: await recipes.saveFound(r) }), true;
    if (b.then === "cook") return send(res, 200, { cooking: recipes.startCooking(r) }), true;
    return send(res, 200, { recipe: { ...r, easy: recipes.easySteps(r) } }), true;
  }
  if (p === "/recipes/found-image" && m === "GET") {
    const r = recipes.fromResults(String(q.get("ref") ?? ""));
    if (!r?.remoteImage) return send(res, 404, { error: "no picture" }), true;
    try { const name = await recipes.cacheImage(r.remoteImage); return serveImage(res, name, send); } catch { return send(res, 404, { error: "no picture" }), true; }
  }
  let mm;
  if ((mm = p.match(/^\/recipes\/image\/([^/]+)$/)) && m === "GET") return serveImage(res, decodeURIComponent(mm[1]), send);
  if ((mm = p.match(/^\/recipes\/([A-Za-z0-9-]+)$/))) {
    const r = recipes.get(mm[1]);
    if (m === "GET") return r ? (send(res, 200, { recipe: { ...r, easy: recipes.easySteps(r) } }), true) : bad(send, res, "no such recipe", 404);
    if (m === "DELETE") return recipes.remove(mm[1]) ? (send(res, 200, { ok: true }), true) : bad(send, res, "no such recipe", 404);
    if (m === "POST" || m === "PATCH") { const b = await readJSON(req).catch(() => ({})); const u = recipes.update(mm[1], b.patch ?? b); return u ? (send(res, 200, { recipe: u }), true) : bad(send, res, "no such recipe", 404); }
  }
  // ---- cooking
  if (p === "/cooking" && m === "GET") return send(res, 200, { cooking: recipes.cookingNow() }), true;
  if (p === "/cooking" && m === "POST") {
    const b = await readJSON(req).catch(() => ({}));
    let c = null;
    if (b.action === "start") { const r = recipes.get(String(b.id ?? "")); if (!r) return bad(send, res, "no such recipe", 404); c = recipes.startCooking(r, Number(b.factor) || 1); }
    else if (!recipes.cookingNow()) return bad(send, res, "not cooking");
    else if (b.action === "next") c = recipes.move(1);
    else if (b.action === "prev") c = recipes.move(-1);
    else if (b.action === "goto") c = recipes.goTo(Number(b.n) || 1);
    else if (b.action === "scale") c = recipes.setScale(Number(b.factor) || 1);
    else if (b.action === "timer") {
      const cur = recipes.cookingNow(); const tm = cur.step?.timers?.[Number(b.i) || 0];
      if (!tm) return bad(send, res, "this step has no time in it");
      const r = timers.start({ ms: tm.ms, label: tm.label || `step ${cur.i + 1}`, step: cur.i + 1 });
      return send(res, 200, { cooking: cur, timer: r.timer ?? null, full: Boolean(r.full), say: r.timer ? `Started a ${r.timer.label} timer for ${sayDuration(tm.ms)}.` : null }), true;
    }
    else if (b.action === "stop") { recipes.stopCooking(); c = null; }
    else return bad(send, res, "unknown action");
    return send(res, 200, { cooking: c }), true;
  }
  // ---- without AI
  if (p === "/intents" && m === "GET") return send(res, 200, { intents: intents.INTENT_LIST(), stats: intents.stats(), learned: intents.learnedCount() }), true;
  // the everyday commands without AI (lib/commands): what a phrase would do (nothing runs), and what's waiting
  // (a question, what "it" means, what "undo that" would undo, changes that put themselves back)
  if (p === "/commands/try" && m === "POST") {
    const { text } = await readJSON(req).catch(() => ({}));
    if (!String(text ?? "").trim()) return bad(send, res, "Type something to try.");
    const commands = await import("./commands/index.mjs");
    return send(res, 200, { text, on: commands.enabled(), parsed: commands.parse(text) }), true;
  }
  if (p === "/commands/stop" && m === "POST") {
    const { surface } = await readJSON(req).catch(() => ({}));
    const commands = await import("./commands/index.mjs");
    return send(res, 200, await commands.stopNow(surface === "desk" ? "desk" : "tv")), true;
  }
  if (p === "/commands/state" && m === "GET") {
    const commands = await import("./commands/index.mjs");
    return send(res, 200, { on: commands.enabled(), ...commands.state(q.get("surface") ?? "tv") }), true;
  }
  if (p === "/intents/try" && m === "POST") {
    const { text } = await readJSON(req).catch(() => ({}));
    if (!String(text ?? "").trim()) return bad(send, res, "Type something to try.");
    const t0 = performance.now();
    const r = intents.plan(String(text));
    const list = intents.INTENT_LIST();
    const labelOf = (id) => list.find((x) => x.id === id)?.label ?? id;
    return send(res, 200, { intent: r.intent, label: r.intent ? labelOf(r.intent) : null, score: r.score, action: r.action, confident: r.score >= 0.7 && (r.score - (r.ranked[1]?.score ?? 0)) >= 0.07, options: r.ranked.filter((x) => x.score >= 0.26).map((x) => ({ ...x, label: labelOf(x.id) })), ms: Math.round((performance.now() - t0) * 10) / 10 }), true;
  }
  if (p === "/intents/clear" && m === "POST") { const b = await readJSON(req).catch(() => ({})); const what = Array.isArray(b.what) ? b.what.filter((x) => ["knock", "jokeQA", "jokeOffer", "pick", "purpose", "follow", "confirm"].includes(x)) : undefined; return send(res, 200, intents.clearState(b.surface === "desk" ? "desk" : "tv", what)), true; }
  if (p === "/intents/forget" && m === "POST") return send(res, 200, intents.forgetLearned()), true;
  // phrases it didn't understand (words only, this computer only), and teaching what they mean
  if (p === "/intents/misses" && m === "GET") return send(res, 200, { misses: intents.misses() }), true;
  if (p === "/intents/misses/clear" && m === "POST") return send(res, 200, intents.clearMisses()), true;
  if (p === "/intents/teach" && m === "POST") { const b = await readJSON(req).catch(() => ({})); try { return send(res, 200, intents.teach(String(b.text ?? ""), String(b.id ?? ""))), true; } catch (e) { return bad(send, res, e.message); } }
  return false;
}

async function serveImage(res, name, send) {
  const path = recipes.imagePath(name);
  if (!path) return send(res, 404, { error: "no picture" }), true;
  const body = await readFile(path);
  res.writeHead(200, { "content-type": recipes.imageType(name), "cache-control": "max-age=86400", "x-content-type-options": "nosniff" });
  res.end(body);
  return true;
}
