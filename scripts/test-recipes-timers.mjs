// Recipes, cooking and timers without a server or the internet: 6 made-up recipe pages (JSON-LD in its different
// shapes, microdata, a page with no recipe), choosing among results, saving with a picture, easy steps, scaling, the
// safety checks (addresses on this network are refused, text is cleaned), and the timers (names, what they're for,
// grouped completions, the reminder that repeats and stops, catching up after a restart, focus rounds, repeating
// reminders). A fake clock, so nothing waits.
//   node scripts/test-recipes-timers.mjs [--live]   (--live: one real search, skipped by default)
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = mkdtempSync(join(tmpdir(), "ds-recipes-"));
Object.assign(process.env, { DAYSPRING_TIMERS_FILE: join(TMP, "timers.json"), DAYSPRING_RECIPES_FILE: join(TMP, "recipes.json"), DAYSPRING_RECIPE_IMAGES: join(TMP, "img"), DAYSPRING_TIMER_REPEAT_MS: "60000" });
const imp = (p) => import(pathToFileURL(join(DESK, p)).href);
const recipes = await imp("lib/recipes.mjs");
const timers = await imp("lib/timers.mjs");
let pass = 0, fail = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${got !== "" && !ok ? "  (" + String(got).slice(0, 200) + ")" : ""}`); };

// ---------------- 6 made-up recipe pages ----------------
const ld = (obj) => `<html><head><title>x</title><script type="application/ld+json">${JSON.stringify(obj)}</script></head><body>…</body></html>`;
const PAGES = {
  "https://pancake-place.example/fluffy": ld({ "@context": "https://schema.org", "@type": "Recipe", name: "Fluffy Pancakes", author: { "@type": "Person", name: "Robin Ashby" }, image: "https://pancake-place.example/p.jpg",
    prepTime: "PT10M", cookTime: "PT15M", totalTime: "PT25M", recipeYield: "4 servings", recipeIngredient: ["2 cups flour", "2 eggs", "1 1/2 cups milk", "2 tbsp sugar"],
    recipeInstructions: [{ "@type": "HowToStep", text: "Whisk the flour and sugar." }, { "@type": "HowToStep", text: "Add eggs and milk and stir. Rest for 5 minutes." }, { "@type": "HowToStep", text: "Heat a griddle and fry them at 375°F for 2 minutes a side. Serve warm." }],
    aggregateRating: { ratingValue: "4.7", ratingCount: "210" } }),
  "https://graph-kitchen.example/chili": ld({ "@context": "https://schema.org", "@graph": [{ "@type": "WebPage", name: "page" }, { "@type": ["Recipe", "NewsArticle"], name: "Weeknight Chili &amp; Beans", image: [{ "@type": "ImageObject", url: "https://graph-kitchen.example/c.png" }],
    totalTime: "PT1H10M", recipeYield: ["6"], recipeIngredient: ["1 lb ground beef", "1 onion, diced", "2 cans beans"],
    recipeInstructions: [{ "@type": "HowToSection", name: "Prep", itemListElement: [{ "@type": "HowToStep", text: "Dice the onion." }] }, { "@type": "HowToSection", name: "Cooking", itemListElement: [{ "@type": "HowToStep", text: "Brown the beef for 8 minutes." }, { "@type": "HowToStep", text: "Add everything and simmer for 45 minutes." }] }] }] }),
  "https://micro.example/bread": `<div itemscope itemtype="https://schema.org/Recipe"><h1 itemprop="name">Banana Bread</h1><span itemprop="recipeIngredient">3 ripe bananas</span><span itemprop="recipeIngredient">2 cups flour</span><div itemprop="recipeInstructions">Mash the bananas. Mix in flour. Bake at 350°F for 60 minutes.</div></div>`,
  "https://strings.example/rice": ld({ "@type": "Recipe", name: "Simple <b>Rice</b> &lt;script&gt;alert(1)&lt;/script&gt;<img src=x onerror=alert(2)>", image: "https://strings.example/r.webp", recipeIngredient: ["1 cup rice", "2 cups water"], recipeInstructions: "Rinse the rice. Boil the water. Add rice and simmer 18 minutes.", totalTime: "PT25M" }),
  "https://pancake-copy.example/fluffy": ld({ "@type": "Recipe", name: "Fluffy Pancakes", recipeIngredient: ["2 cups flour"], recipeInstructions: ["Mix.", "Fry."] }),
  "https://no-recipe.example/blog": `<html><body><h1>My trip to Italy</h1><p>No recipe here.</p></body></html>`,
  "https://eggs.example/scrambled": ld({ "@type": "Recipe", name: "Soft Scrambled Eggs", image: { url: "https://eggs.example/e.jpg" }, totalTime: "PT8M", recipeYield: "2", recipeIngredient: ["4 eggs", "1 tbsp butter", "salt"], recipeInstructions: [{ text: "Beat the eggs." }, { text: "Melt butter over low heat and stir the eggs for 3 minutes." }] }),
};
const IMG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]);
const fetched = [];
const fakeFetch = async (url) => {
  fetched.push(url);
  if (/\.(jpg|png|webp)$/.test(url)) return { ok: true, status: 200, headers: new Map([["content-type", url.endsWith(".png") ? "image/png" : url.endsWith(".webp") ? "image/webp" : "image/jpeg"], ["content-length", String(IMG.length)]]), arrayBuffer: async () => IMG };
  const body = PAGES[url];
  return body ? { ok: true, status: 200, headers: new Map([["content-type", "text/html"]]), text: async () => body } : { ok: false, status: 404, headers: new Map(), text: async () => "" };
};
const publicIp = async () => [{ address: "93.184.216.34" }];
recipes.setDeps({ fetch: fakeFetch, lookup: async (h) => (/intranet\.example$/.test(h) ? [{ address: "10.0.0.5" }] : publicIp()), search: async () => ({ results: [...Object.keys(PAGES), "https://www.youtube.com/watch?v=x"].map((url) => ({ url, title: url })) }) });

// parsing
const p1 = recipes.fromHtml(PAGES["https://pancake-place.example/fluffy"], "https://pancake-place.example/fluffy");
check("JSON-LD: title, author, servings, times, rating, image", p1?.title === "Fluffy Pancakes" && p1.source?.author === "Robin Ashby" && p1.servings === 4 && p1.times?.total === 25 && Math.abs((p1.rating?.value ?? 0) - 4.7) < 0.01 && /p\.jpg$/.test(p1.remoteImage ?? ""), JSON.stringify(p1)?.slice(0, 200));
const p2 = recipes.fromHtml(PAGES["https://graph-kitchen.example/chili"], "https://graph-kitchen.example/chili");
check("@graph + type list + HowToSection + ImageObject + entities", p2?.title === "Weeknight Chili & Beans" && recipes.flatSteps(p2).length === 3 && p2.times?.total === 70 && /c\.png$/.test(p2.remoteImage ?? ""), JSON.stringify(p2)?.slice(0, 200));
const p3 = recipes.fromHtml(PAGES["https://micro.example/bread"], "https://micro.example/bread");
check("microdata: a Banana Bread with ingredients and steps", p3?.title === "Banana Bread" && p3.ingredients.length === 2 && recipes.flatSteps(p3).length >= 1, JSON.stringify(p3)?.slice(0, 200));
const p4 = recipes.fromHtml(PAGES["https://strings.example/rice"], "https://strings.example/rice");
check("text is cleaned: no markup survives", p4 && !/[<>]|onerror|script/i.test(p4.title) && /Rice/.test(p4.title) && recipes.flatSteps(p4).length >= 1, p4?.title);
check("a page with no recipe → nothing", recipes.fromHtml(PAGES["https://no-recipe.example/blog"]) == null);
check("ISO durations: PT1H10M = 70", recipes.isoMinutes("PT1H10M") === 70 && recipes.isoMinutes("PT45M") === 45);

// safety
const refuse = async (u) => { try { await recipes.guard(u); return false; } catch { return true; } };
check("SSRF: localhost, 127.0.0.1, 192.168.x, 10.x, [::1], .local and a name that resolves privately are refused",
  (await refuse("http://localhost/x")) && (await refuse("http://127.0.0.1/x")) && (await refuse("http://192.168.1.10/")) && (await refuse("http://10.1.2.3/")) && (await refuse("http://[::1]/")) && (await refuse("http://printer.local/")) && (await refuse("http://wiki.intranet.example/")) && (await refuse("file:///C:/x")));
check("SSRF: a public site is allowed", !(await refuse("https://pancake-place.example/fluffy")));

// searching online: parallel, de-duplicated, videos skipped, up to 6
const found = await recipes.findOnline("pancakes");
check("search: 5 readable, distinct recipes (the copy on another site kept as a separate site; the blog and the video skipped)", found.results.length >= 5 && found.results.length <= 6 && !fetched.some((u) => /youtube/.test(u)), JSON.stringify(found.results.map((r) => r.title + "@" + r.site)));
check("search: the most complete comes first", found.results[0].ingredients > 0 && found.results[0].image, JSON.stringify(found.results[0]));
const quick = recipes.fromResults("the quickest one");
check("choosing: 'the quickest one' → Soft Scrambled Eggs (8 min)", quick?.title === "Soft Scrambled Eggs", quick?.title);
check("choosing: 'number 2' and 'the one from graph-kitchen'", recipes.fromResults("number 2")?.title === found.results[1].title && /Chili/.test(recipes.fromResults("the one from graph kitchen")?.title ?? recipes.fromResults("graph-kitchen")?.title ?? ""));
const saved = await recipes.saveFound(recipes.fromResults("the one from pancake-place") ?? recipes.fromResults("1"));
check("save: stored with a cached picture (never the remote link), the site's tag and its address", saved && /^[a-f0-9]{16}\.(jpg|png|webp)$/.test(saved.image ?? "") && existsSync(join(TMP, "img", saved.image)) && !saved.remoteImage && saved.tags.some((t) => /^from /.test(t)) && /^https:/.test(saved.source?.url ?? ""), JSON.stringify(saved)?.slice(0, 200));
check("the saved picture is served only by its own name", recipes.imagePath(saved.image) && recipes.imagePath("../../etc/passwd") === null);

// easy steps, scaling, how much
const easy = recipes.easySteps(p1);
check("easy steps: Prep/Cooking/Finish, a 5-minute timer chip, 375°F ↔ 191°C", easy.some((s) => s.phase === "Prep") && easy.some((s) => s.phase === "Cooking") && easy.some((s) => s.timers?.some((t) => t.ms === 300000)) && easy.some((s) => s.temps?.some((t) => t.f === 375 && Math.abs(t.c - 191) <= 1)), JSON.stringify(easy).slice(0, 300));
check("easy steps: ingredients each step uses", easy.some((s) => (s.uses ?? []).some((u) => /flour/.test(u))));
check("scaling ×2: 1 1/2 cups milk → 3 cups", recipes.scaleLine("1 1/2 cups milk", 2) === "3 cups milk", recipes.scaleLine("1 1/2 cups milk", 2));
check("how much flour → 2 cups flour", (recipes.howMuch(p1, "flour") ?? []).some((x) => /2 cups flour/.test(x)));
const c = recipes.startCooking(p1);
check("cooking: starts before step 1, next → step 1, previous stays in range", c.i === -1 && recipes.move(1).i === 0 && recipes.move(-5).i >= -1);
recipes.stopCooking();
// the examples, typing a recipe, deleting
check("5 example recipes (marked as examples)", recipes.list().filter((r) => r.example).length === 5, recipes.list().map((r) => r.title).join(", "));
const typed = recipes.parseText("Grandma's Cookies\nServes 12\nIngredients\n2 cups flour\n1 cup butter\nInstructions\n1. Cream the butter.\n2. Add flour and bake 10 minutes.");
check("typed/pasted recipe is parsed", typed.title === "Grandma's Cookies" && typed.ingredients.length === 2 && typed.steps.length === 2 && typed.servings === 12, JSON.stringify(typed));

// ---------------- timers (fake clock) ----------------
let now = Date.UTC(2026, 8, 26, 17, 0, 0);
const rung = [];
timers.setDeps({ now: () => now, ring: (x) => rung.push(x), emit: () => {}, alarm: (a) => rung.push({ alarm: a }) });
timers._reset();
const a = timers.start({ ms: 60_000 });
check("no name → 'Timer 1', and it asks what it's for", a.timer.label === "Timer 1" && a.ask);
check("'it's for the pasta' → pasta", timers.setPurpose(a.timer.id, "it's for the pasta")?.label === "pasta");
const b = timers.start({ ms: 60_000, label: "garlic bread" });
check("a named one doesn't ask", !b.ask);
check("a second pasta → 'pasta 2'", timers.start({ ms: 600_000, label: "pasta" }).timer.label === "pasta 2");
check("rename 'the second one' → oven", timers.rename("second", "oven")?.label === "oven");
now += 61_000; timers.tick();
check("done together → said together: 'Your pasta and oven timers are done.'", rung.length === 1 && timers.doneLine(rung[0].labels, 0) === "Your pasta and oven timers are done.", JSON.stringify(rung));
now += 60_000; timers.tick();
check("a reminder a minute later", rung.length === 2 && rung[1].repeat === 1);
for (let k = 0; k < 6; k++) { now += 60_000; timers.tick(); }
check("… at most 5 reminders, then it stops", rung.filter((r) => r.repeat).length === 5, rung.length);
timers.dismiss("");
check("7 at most", (() => { timers._reset(); for (let k = 0; k < 7; k++) timers.start({ ms: 600_000, label: "t" + k }); return timers.start({ ms: 1000, label: "eighth" }).full === true; })());
timers._reset(); rung.length = 0;
timers.start({ ms: 120_000, label: "laundry" });
now += 10 * 60_000; timers._reload(); timers.tick();
check("catch-up: one that ended while Dayspring was closed rings once when it's back", rung.length === 1 && rung[0].labels[0] === "laundry");
timers._reset(); rung.length = 0;
timers.start({ ms: 25 * 60_000, label: "focus", cycle: { work: 25 * 60_000, rest: 5 * 60_000, rounds: 2 } });
now += 25 * 60_000 + 1000; timers.tick();
check("focus round → a 5-minute break starts by itself", timers.list().some((t) => /^break/.test(t.label)) && /Take a 5 minute break/.test(rung.at(-1)?.text ?? ""), JSON.stringify(rung.at(-1)));
now += 5 * 60_000 + 1000; timers.tick();
check("break → focus round 2", timers.list().some((t) => /^focus/.test(t.label)) && /round 2/.test(rung.at(-1)?.text ?? ""));
timers._reset(); rung.length = 0;
const al = timers.setAlarm({ hm: "20:00", label: "take out the trash", kind: "reminder", repeat: { days: [2] } });
check("repeating reminder: next Tuesday at 8 pm", new Date(al.at).getDay() === 2 && new Date(al.at).getHours() === 20);
now = Date.parse(al.at) + 1000; timers.tick();
check("… it fires and books the next Tuesday", rung.some((r) => r.alarm?.label === "take out the trash") && timers.alarms().length === 1 && Date.parse(timers.alarms()[0].at) - Date.parse(al.at) === 7 * 86_400_000);
check("timers survive a restart (atomic file)", (() => { timers.start({ ms: 60_000, label: "tea" }); timers._reload(); return timers.list().some((t) => t.label === "tea") && !existsSync(process.env.DAYSPRING_TIMERS_FILE + ".tmp"); })());

if (process.argv.includes("--live")) {
  const web = await imp("lib/web.mjs");
  recipes.setDeps({ fetch: (...x) => fetch(...x), lookup: undefined, search: web.search });
  const r = await recipes.findOnline("pancakes").catch((e) => ({ error: e.message, results: [] }));
  check("live: a real search finds readable recipes", r.results.length > 0, r.error ?? r.results.length);
}
rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
