// 1.8.0: everyday commands without AI (lib/commands), end to end, on a throwaway copy (port 4793, no AI keys, the
// development channel; nothing is heard or said, no device is touched, nothing opens on screen).
//   A. ending the conversation: "thanks" and the rest answer briefly and close; "…, thanks" asks no follow-up; the
//      look-alikes ("thanks for the reminder, now …", "never mind the timer, cancel it", "remind me to say thank you")
//   B. every setting changed by voice actually changes (settings, owner preferences, features), and "undo that"
//   C. security settings: nothing changes without a yes; the big grants are Settings only
//   D. the sky and the screen: weather, time of day, scenery, stars, motion; a timed change puts itself back
//   E. the schedule with repeats: rules checked in the store; move, cancel one day, make recurring, stop, change the rule
//   F. timers to a clock time, "every 30 minutes remind me", reminders once (the 1.7.2 water bug) and repeating
//   G. alarms: days, label, sound, volume, snooze, gentle, flash; off/on; skip; list; delete; and (with a fake clock,
//      in this process) recurring alarms firing on the right days only
//   H. two requests at once, "it", "not tomorrow, Friday", "don't remind me", one clarifying question
//   I. the screen (headless Chrome, muted): an ending closes the listening window at once (timed), a normal reply leaves it open
//   node scripts/qa/offline-commands.mjs [--keep] [--no-browser]
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { qaPort } from "./port.mjs";   // a free port (or QA_PORT), so parallel runs never collide
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = await qaPort(4793), BASE = `http://127.0.0.1:${PORT}`;
const TMP = mkdtempSync(join(tmpdir(), "ds-cmds-")), APP = join(TMP, "app");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
// playwright-core: QA_PLAYWRIGHT (a path or file:// URL), else the exported copy next to this project (…/dayspring-app), else this app's own (same lookup as images.mjs)
const PW = process.env.QA_PLAYWRIGHT ? (/^file:/.test(process.env.QA_PLAYWRIGHT) ? process.env.QA_PLAYWRIGHT : pathToFileURL(process.env.QA_PLAYWRIGHT).href)
  : pathToFileURL([join(DESK, "..", "..", "..", "dayspring-app", "node_modules", "playwright-core", "index.mjs"), join(DESK, "node_modules", "playwright-core", "index.mjs")].find((p) => existsSync(p)) ?? "").href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0, pass = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${got !== "" && !ok ? "  (" + String(got).slice(0, 260) + ")" : ""}`); };
const pad = (n) => String(n).padStart(2, "0");
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// ---------------------------------------------------------------- G2 first: recurring alarms on a fake clock (in process)
{
  process.env.DAYSPRING_TIMERS_FILE = join(TMP, "timers-fake.json");
  const timers = await import(pathToFileURL(join(DESK, "lib", "timers.mjs")).href);
  let clock = new Date(2026, 8, 27, 12, 0).getTime();          // Sunday 27 September 2026, noon
  const fired = [];
  timers.setDeps({ now: () => clock, alarm: (a) => fired.push({ label: a.label, day: new Date(clock).getDay(), date: isoOf(new Date(clock)), hm: a.hm, gentle: a.gentle, sound: a.sound }), emit: () => {}, ring: () => {} });
  timers._reset();
  timers.setAlarm({ hm: "06:30", label: "work", repeat: { days: [1, 2, 3, 4, 5] }, gentle: true, sound: "bells", snooze: 5 });
  timers.setAlarm({ hm: "08:00", label: "weekend", repeat: { days: [0, 6] } });
  timers.setAlarm({ hm: "07:00", label: "every other day", repeat: { rule: { freq: "daily", interval: 2, start: "2026-09-28" } } });
  timers.setAlarm({ hm: "09:00", label: "first monday", repeat: { rule: { freq: "monthly", interval: 1, nth: { n: 1, day: "mon" }, start: "2026-09-27" } } });
  const once = timers.setAlarm({ date: "2026-09-30", hm: "05:15", label: "flight" });
  // off and skip
  const wk = timers.alarms().find((a) => a.label === "weekend");
  timers.updateAlarm(wk.id, { off: true });
  const skipped = timers.skipAlarms("2026-10-01");                    // Thursday: the work alarm skips that day
  const end = new Date(2026, 9, 12, 12, 0).getTime();
  for (; clock < end; clock += 60_000) timers.tick();
  const days = (label) => fired.filter((f) => f.label === label);
  check("fake clock: the weekday alarm rang Monday–Friday only, 10 times in two weeks and a day (one skipped)", days("work").length === 10 && days("work").every((f) => f.day >= 1 && f.day <= 5 && f.hm === "06:30"), JSON.stringify(days("work").map((f) => f.day)));
  check("fake clock: …and not on the skipped Thursday", !fired.some((f) => f.label === "work" && f.date === "2026-10-01") && skipped.length === 1 && skipped[0].label === "work", JSON.stringify(skipped.map((x) => x.label)));
  check("fake clock: the weekend alarm, switched off, never rang (and is still kept)", days("weekend").length === 0 && timers.alarms().some((a) => a.label === "weekend" && a.off));
  check("fake clock: every other day from Sep 28: 8 times", days("every other day").length === 8, days("every other day").length);
  check("fake clock: the first Monday of the month: once (Oct 5)", days("first monday").length === 1 && days("first monday")[0].day === 1, JSON.stringify(days("first monday")));
  check("fake clock: a one-time alarm rang once and is gone", days("flight").length === 1 && !timers.alarms().some((a) => a.id === once.id));
  check("fake clock: ring options go with the alarm (gentle, bells)", days("work")[0]?.gentle === true && days("work")[0]?.sound === "bells");
  timers.stopTicking?.();
}

// ---------------------------------------------------------------- the throwaway server
spawnSync(process.execPath, [join(DESK, "scripts", "export.mjs"), APP], { encoding: "utf8" });
spawnSync("cmd.exe", ["/d", "/c", "mklink", "/J", join(APP, "node_modules"), join(DESK, "node_modules")], { windowsHide: true });
mkdirSync(join(APP, "data"), { recursive: true });
writeFileSync(join(APP, "data", "owner.json"), JSON.stringify({ name: "Tester", setupDone: true, display: "primary", wakeWords: ["dayspring"], location: { place: "", lat: null, lon: null, timezone: "America/Chicago" } }));
// the place lookup, without the internet (lib/geocode.mjs reads this instead)
const GEO = join(TMP, "geocode.json");
const place = (p, lat, lon, tz) => [{ place: p, lat, lon, timezone: tz }];
writeFileSync(GEO, JSON.stringify({ "springfield illinois": place("Springfield, Illinois", 39.80, -89.64, "America/Chicago"), springfield: place("Springfield, Illinois", 39.80, -89.64, "America/Chicago"), "62701": place("Springfield, Illinois", 39.80, -89.64, "America/Chicago"),
  peoria: place("Peoria, Illinois", 40.69, -89.59, "America/Chicago"), decatur: place("Decatur, Illinois", 39.84, -88.95, "America/Chicago"), denver: place("Denver, Colorado", 39.739, -104.99, "America/Denver") }));
const env = { ...process.env, PORT: String(PORT), DAYSPRING_CHANNEL: "dev", DAYSPRING_TEST_HOOKS: "1", DAYSPRING_DISPLAY: "", DAYSPRING_TV: "", DAYSPRING_NO_BROWSER: "1", DAYSPRING_DEVICES_DRYRUN: "1", DAYSPRING_NO_OVERLAY: "1", DAYSPRING_NO_ECO: "1",
  ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", XAI_API_KEY: "", ELEVENLABS_API_KEY: "", AI_PROVIDER: "", DAYSPRING_REMINDER_CHANNEL: "off", DAYSPRING_TIMERS_FILE: "", DAYSPRING_GEOCODE_FILE: GEO };
delete env.DAYSPRING_TIMERS_FILE;
const server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let serverLog = ""; server.stdout.on("data", (d) => (serverLog += d)); server.stderr.on("data", (d) => (serverLog += d));
const up = async () => { try { return (await fetch(`${BASE}/api/build`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };
for (let i = 0; i < 60 && !(await up()); i++) await sleep(500);
const api = async (path, body, method = body === undefined ? "GET" : "POST") => { const r = await fetch(BASE + "/api" + path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); return r.json(); };
const chat = (message) => api("/chat", { message, surface: "tv", typed: true });
const S = async () => (await api("/settings")).settings;
const O = async () => (await api("/setup/state")).owner;
const P = async () => (await api("/setup/state")).permissions;
const SKY = async () => (await api("/sky")).prefs;
const T = () => api("/timers");
const ST = () => api("/commands/state");
const say = async (t, re, name = null) => { const r = await chat(t); const ok = re instanceof RegExp ? re.test(r.reply ?? "") : re(r); check(name ?? `"${t}"`, ok, r.reply ?? r.error); return r; };

try {
  check("server started (no AI, development channel)", await up());
  check("the commands feature is on", (await api("/commands/state")).on === true);

  // ---------------- A. endings ----------------
  for (const t of ["thanks", "thank you", "that's all", "that's it", "that'll be all", "nothing else", "no that's fine", "I'm good", "all good", "okay thanks", "cool thanks", "goodbye", "bye", "see you", "later", "good night", "stop listening for now", "we're done", "perfect, thanks"]) {
    const r = await chat(t);
    check(`ending: "${t}" → a short answer and the window closes`, r.close === true && String(r.reply ?? "").length < 40 && !r.listen, JSON.stringify({ reply: r.reply, close: r.close }));
  }
  let r = await chat("set a timer for 5 minutes, thanks");
  check("\"set a timer for 5 minutes, thanks\" → the timer, no \"What's it for?\", and it closes", r.close === true && !/What's it for/.test(r.reply) && (await T()).timers.length === 1, r.reply);
  r = await chat("thanks for the reminder, now set a timer for 2 minutes");
  check("\"thanks for the reminder, now set a timer…\" → the timer is set (not an ending)", !r.close && (await T()).timers.length === 2, r.reply);
  r = await chat("never mind the timer, cancel it");
  check("\"never mind the timer, cancel it\" → a cancel, not an ending", !r.close && (await T()).timers.length === 1, r.reply);
  await api("/timers", { action: "cancel", ref: "all" });
  await chat("set a toast timer for 3 minutes");
  r = await chat("stop the timer");
  check("\"stop the timer\" is still the timer's own command (not a plain stop)", (await T()).timers.length === 0 && /Cancelled/.test(r.reply) && !r.close, r.reply);
  r = await chat("remind me to say thank you at 5pm");
  check("\"remind me to say thank you at 5pm\" → a reminder to say thank you (not an ending)", !r.close && /say thank you/.test(r.reply), r.reply);
  r = await chat("add dentist tomorrow at 3pm");
  check("a question is asked after adding (\"Want a reminder before it?\")", /reminder before it\?/.test(r.reply), r.reply);
  r = await chat("no thanks");
  check("\"no thanks\" to it → okay, closed, and nothing left waiting", r.close === true && !(await ST()).pending, r.reply);

  // ---------------- B. every setting by voice ----------------
  const SET = [
    ["set the volume to 40", async () => (await S()).volume === 40],
    ["make it a little louder, set the volume to 55", async () => (await S()).volume === 55],
    ["turn the music volume down", async () => (await S()).musicVolume === 85],
    ["set the video volume to 60", async () => (await S()).videoVolume === 60],
    ["turn the chimes down", async () => (await S()).soundsVolume === 65],
    ["set the alarm volume to 70", async () => (await S()).alarmVolume === 70],
    ["set the call volume to 50", async () => (await S()).callVolume === 50],
    ["talk a bit faster", async () => (await S()).speedAdj > 0],
    ["give me short answers", async () => (await S()).detail === "simple"],
    ["turn off the time of day tone", async () => (await S()).timeTone === false],
    ["set notifications to chime only", async () => (await S()).mode === "chime"],
    ["turn off the notification cards", async () => (await S()).overlay?.on === false],
    ["show notification cards for 15 seconds", async () => (await S()).overlay?.seconds === 15],
    ["turn off alarms when you're off", async () => (await S()).alarmsWhenOff === false],
    ["turn off timers when you're quiet", async () => (await S()).timersWhenQuiet === false],
    ["set speech recognition to private", async () => (await S()).speechEngine === "local"],
    ["stop logging the missed phrases", async () => (await S()).logMisses === false],
    ["turn on the morning alarm", async () => (await S()).alarm === true],
    ["set the snooze to 10 minutes", async () => (await S()).alarmSnooze === 10],
    ["turn off chore reminders", async () => (await S()).chores === false],
    ["turn off goal check ins", async () => (await S()).goals === false],
    ["turn off claude alerts", async () => (await S()).claudeAlerts === false],
    ["turn off joke offers", async () => (await S()).jokeOffersOn === false],
    ["use 24-hour time", async () => (await S()).clock24 === true],
    ["make everything bigger", async () => (await S()).uiScale === 110],
    ["make the text bigger", async () => (await S()).textScale === 110],
    ["make the clock smaller", async () => (await S()).clockScale === 85],
    ["make your panel wider", async () => (await S()).talkWidth > 0],
    ["slower slides", async () => (await S()).carouselSeconds === 60],
    ["show 8 rows", async () => (await S()).listRows === 8],
    ["one column", async () => (await S()).layoutMode === "one"],
    ["dayspring panel on the left", async () => (await S()).layoutMode === "talkLeft"],
    ["make the spacing tighter", async () => (await S()).density === "compact"],
    ["keep the proportions", async () => (await S()).fit === "keep"],
    ["turn on calmer motion", async () => (await S()).uiMotion === "reduced"],
    ["hide the clock", async () => (await S()).showClock === false],
    ["hide now and next", async () => (await S()).showNowNext === false],
    ["hide the rotating panel", async () => (await S()).showPanel === false],
    ["hide the exam card", async () => (await S()).showExam === false],
    ["hide the course rings", async () => (await S()).showCourses === false],
    ["show the transcript", async () => (await S()).showTranscript === true],
    ["set the margin to 5 percent", async () => (await S()).overscan === 5],
    ["set the top margin to 3", async () => (await S()).marginTop === 3],
    ["set night mode to dim", async () => (await S()).night === "dim"],
    ["keep dayspring mini on top", async () => (await S()).miniOnTop === true],
    ["turn off the weather", async () => (await O()).features.weather === false],
    ["turn off the news", async () => (await O()).features.news === false],
    ["turn on the faith features", async () => (await O()).features.faith === true],
    ["turn on memory verses", async () => (await O()).features.memoryVerses === true],
    ["my pronouns are she her", async () => (await O()).pronouns === "she"],
    ["turn off the developer log", async () => (await O()).diagnostics === false],
    ["keep the screen open", async () => (await O()).keepScreenOpen === true],
  ];
  for (const [t, ok] of SET) { const x = await chat(t); const good = await ok(); check(`setting: "${t}" changes it, and says so`, good && /now|is (on|off)|are (on|off)|Say “undo/.test(x.reply ?? ""), x.reply); }
  r = await chat("what's my wake word set to?");
  check("\"what's my wake word set to?\" → “dayspring”", /wake word is “dayspring”/i.test(r.reply), r.reply);
  r = await chat("what's the volume");
  check("\"what's the volume\" → 55%", /55%/.test(r.reply), r.reply);
  r = await chat("is night mode on");
  check("\"is night mode on\" → dim", /dim/.test(r.reply), r.reply);
  // undo
  await chat("set the volume to 70");
  r = await chat("undo that");
  check("\"undo that\" puts the last setting back (volume 70 → 55)", (await S()).volume === 55 && /Undone/.test(r.reply), r.reply);
  await chat("turn on the weather");
  r = await chat("undo");
  check("\"undo\" after a feature change: the weather is off again", (await O()).features.weather === false, r.reply);
  r = await chat("reset the text size");
  check("\"reset the text size\" → 100%", (await S()).textScale === 100, r.reply);
  r = await chat("switch to quiet mode until 11:59 pm");
  check("\"switch to quiet mode until 11:59 pm\" → quiet now, and it puts itself back later", (await S()).listenState === "quiet" && (await ST()).temp.some((x) => x.kind === "listen"), r.reply);
  await chat("turn listening back on");
  check("\"turn listening back on\" → active", (await S()).listenState === "active");

  // ---------------- C. security ----------------
  const p0 = await P();
  r = await chat("turn off web search");
  check("security: \"turn off web search\" asks first and changes nothing yet", /security setting/i.test(r.reply) && r.listen && (await P()).web === p0.web, r.reply);
  r = await chat("no");
  check("security: \"no\" → left alone", /left it alone/.test(r.reply) && (await P()).web === p0.web, r.reply);
  await chat("turn off web search");
  r = await chat("yes");
  check("security: … \"yes\" → changed", (await P()).web === false && /Done/.test(r.reply), r.reply);
  r = await chat("undo that");
  check("security: \"undo that\" puts it back", (await P()).web === p0.web, r.reply);
  r = await chat("allow deleting files");
  const del = (await P()).can?.delete;
  check("security: \"allow deleting files\" is never done on the words alone", del === p0.can?.delete && /Say yes/.test(r.reply), r.reply);
  await chat("never mind");
  r = await chat("give yourself access to all my files");
  check("security: \"give yourself access to all my files\" → Settings only", /only be changed in Settings/.test(r.reply) && (await P()).files === p0.files, r.reply);
  r = await chat("change the wake word to computer");
  check("security: the wake word waits for a yes", /Say yes/.test(r.reply) && (await O()).wakeWords.join() === "dayspring", r.reply);
  await chat("no");

  // ---------------- D. the sky and the screen ----------------
  const skyChecks = [
    ["make it rain", (s) => s.weather.follow === false && s.weather.choice === "rain"],
    ["let it snow", (s) => s.weather.choice === "snow"],
    ["thunderstorm", (s) => s.weather.choice === "storm" && s.weather.lightning === true],
    ["clear skies", (s) => s.weather.choice === "clear"],
    ["foggy", (s) => s.weather.choice === "fog"],
    ["sunny", (s) => s.weather.choice === "clear"],
    ["make it night", (s) => s.time.follow === false && s.time.phase === "night"],
    ["make it sunset", (s) => s.time.phase === "sunset"],
    ["make it sunrise", (s) => s.time.phase === "sunrise"],
    ["make it noon", (s) => s.time.phase === "midday"],
    ["turn off the stars", (s) => s.scenery.stars === false],
    ["turn on the stars", (s) => s.scenery.stars === true],
    ["change the scenery to mountains", (s) => s.scenery.scene === "hills"],
    ["use the forest scene", (s) => s.scenery.scene === "forest"],
    ["pause the animation", (s) => s.motion === "still"],
    ["resume the animation", (s) => s.motion === "normal"],
    ["make it winter", (s) => s.season.follow === false && s.season.choice === "winter"],
    ["make the background warmer", (s) => s.colors.warmth > 0],
    ["show the real sky again", (s) => s.time.follow && s.weather.follow && s.season.follow],
  ];
  for (const [t, ok] of skyChecks) { const x = await chat(t); const s = await SKY(); check(`sky: "${t}"`, ok(s) && /Done|Okay|closest/.test(x.reply ?? ""), `${x.reply} · ${JSON.stringify({ w: s.weather.choice, wf: s.weather.follow, t: s.time.phase, sc: s.scenery.scene, m: s.motion })}`); }
  r = await chat("make it rain for 5 seconds");
  const rainNow = (await SKY()).weather.choice === "rain" && (await SKY()).weather.follow === false;
  await sleep(7000);
  const after = await SKY();
  check("a timed change: \"make it rain for 5 seconds\" rains, then puts itself back", rainNow && after.weather.follow === true && /5 seconds/.test(r.reply), `${r.reply} · now follow=${after.weather.follow} ${after.weather.choice}`);
  r = await chat("change the scenery to the beach");
  check("scenery it doesn't have: the closest one, and says so", /closest/.test(r.reply) && (await SKY()).scenery.scene === "river", r.reply);
  r = await chat("pink theme");
  check("\"pink theme\" still works (Look & feel)", /pink|rose|candy|theme/i.test(r.reply ?? ""), r.reply);

  // ---------------- E. the schedule with repeats ----------------
  const routines = async () => (await api("/routines")).routines;
  r = await chat("add gym every Monday Wednesday Friday at 6am for an hour");
  let g = (await routines()).find((x) => x.title === "Gym");
  check("\"add gym every Monday Wednesday Friday at 6am for an hour\" → weekly mon/wed/fri 06:00–07:00", g && g.repeat.freq === "weekly" && g.repeat.days.join() === "mon,wed,fri" && g.start === "06:00" && g.end === "07:00", `${r.reply} · ${JSON.stringify(g?.repeat)}`);
  r = await chat("Bible study every weeknight at 9");
  g = (await routines()).find((x) => /bible study/i.test(x.title));
  check("\"Bible study every weeknight at 9\" → weekdays at 9 p.m.", g && g.repeat.days.join() === "mon,tue,wed,thu,fri" && g.start === "21:00", `${r.reply} · ${JSON.stringify(g)}`);
  r = await chat("add team sync the first Monday of every month at 2pm");
  g = (await routines()).find((x) => /team sync/i.test(x.title));
  check("\"the first Monday of every month\" → monthly, nth 1 Monday", g?.repeat.freq === "monthly" && g.repeat.nth?.n === 1 && g.repeat.nth?.day === "mon", JSON.stringify(g?.repeat));
  r = await chat("add piano on the 15th of each month at 4pm");
  g = (await routines()).find((x) => /piano/i.test(x.title));
  check("\"on the 15th of each month\" → monthly on the 15th", g?.repeat.freq === "monthly" && g.repeat.monthDay === 15, JSON.stringify(g?.repeat));
  r = await chat("add a walk every day until December at 7am");
  g = (await routines()).find((x) => /walk/i.test(x.title) && x.start === "07:00");
  check("\"every day until December\" → daily, until the end of November", g?.repeat.freq === "daily" && /-11-30$/.test(g.repeat.until ?? ""), JSON.stringify(g?.repeat));
  r = await chat("add standup weekdays at 1pm for the next 3 weeks");
  g = (await routines()).find((x) => /standup/i.test(x.title));
  check("\"weekdays … for the next 3 weeks\" → weekdays with an end date", g?.repeat.days?.length === 5 && Boolean(g.repeat.until), JSON.stringify(g?.repeat));
  r = await chat("add date night every other friday at 7pm");
  g = (await routines()).find((x) => /date night/i.test(x.title));
  check("\"every other friday\" → every 2 weeks on Friday", g?.repeat.interval === 2 && g.repeat.days?.join() === "fri", `${r.reply} · ${JSON.stringify(g?.repeat)}`);
  r = await chat("add trash night every thursday at 8pm except holidays");
  g = (await routines()).find((x) => /trash night/i.test(x.title));
  check("\"except holidays\" is kept on the rule", g?.repeat.exceptHolidays === true, JSON.stringify(g?.repeat));
  r = await chat("add yoga at 10");
  check("a repeating-free item at a bare hour: added (the next 10 o'clock)", /Added Yoga/.test(r.reply), r.reply);
  await chat("no thanks");
  r = await chat("add stretching every day at 9");
  check("a repeating item at a bare 9: one question, a.m. or p.m.?", /9 a\.m\. or 9 p\.m\./.test(r.reply) && r.listen, r.reply);
  r = await chat("in the morning");
  g = (await routines()).find((x) => /stretching/i.test(x.title));
  check("… \"in the morning\" → every day at 9 a.m.", g?.start === "09:00" && g.repeat.freq === "daily", `${r.reply} · ${JSON.stringify(g)}`);
  // edits
  const t2 = new Date(Date.now() + 2 * 86_400_000), d2 = isoOf(t2), dayName = t2.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
  r = await chat(`schedule a dentist appointment on ${dayName} at 3pm`);
  const agenda = async (d) => (await api(`/agenda?from=${d}&to=${d}`)).blocks;
  check("\"schedule a dentist appointment on <day> at 3pm\" → on the schedule", (await agenda(d2)).some((b) => /dentist appointment/i.test(b.title) && b.start === "15:00"), r.reply);
  await chat("no");
  r = await chat("move it to 4");
  check("\"move it to 4\" → the dentist at 4 p.m.", (await agenda(d2)).some((b) => /dentist appointment/i.test(b.title) && b.start === "16:00"), r.reply);
  r = await chat("make it recurring");
  check("\"make it recurring\" → how often? (one question)", /How often/.test(r.reply) && r.listen, r.reply);
  r = await chat("every other week");
  g = (await routines()).find((x) => /dentist appointment/i.test(x.title));
  check("… \"every other week\" → it repeats every 2 weeks", g?.repeat.freq === "weekly" && g.repeat.interval === 2, `${r.reply} · ${JSON.stringify(g?.repeat)}`);
  r = await chat("change it to every week");
  g = (await routines()).find((x) => /dentist appointment/i.test(x.title));
  check("\"change it to every week\" → weekly", g?.repeat.interval === 1, `${r.reply} · ${JSON.stringify(g?.repeat)}`);
  r = await chat("stop repeating");
  g = (await routines()).find((x) => /dentist appointment/i.test(x.title));
  check("\"stop repeating\" → the series ends after the next one", g?.repeat.until === d2, `${r.reply} · ${JSON.stringify(g?.repeat)}`);
  const fri = (() => { const d = new Date(); d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7)); return isoOf(d); })();
  r = await chat("cancel Friday's gym");
  const cal = await api(`/calendar?from=${fri}&to=${fri}`);
  const friBlocks = JSON.stringify(cal).includes("Gym");
  check("\"cancel Friday's gym\" → just that Friday is gone; the series stays", /Cancelled Gym/.test(r.reply) && !friBlocks && (await routines()).some((x) => x.title === "Gym"), `${r.reply}`);
  r = await chat("undo that");
  check("… \"undo that\" → Friday's gym is back", JSON.stringify(await api(`/calendar?from=${fri}&to=${fri}`)).includes("Gym"), `${r.reply} · ${JSON.stringify((await ST()).undo.slice(-3))} now=${Date.now()}`);

  // ---------------- F. timers and reminders ----------------
  const target = new Date(Date.now() + 10 * 60_000), hm = `${target.getHours() % 12 || 12}:${pad(target.getMinutes())} ${target.getHours() >= 12 ? "pm" : "am"}`;
  r = await chat(`set a timer for ${hm}`);
  let tm = (await T()).timers.at(-1);
  check(`"set a timer for ${hm}" → a timer until then (about 10 minutes)`, tm && Math.abs(tm.left - 10 * 60_000) < 90_000 && /Timer set until/.test(r.reply), `${r.reply} · ${tm?.left}`);
  r = await chat("every 30 minutes remind me to stand up");
  tm = (await T()).timers.find((x) => /stand up/.test(x.label));
  check("\"every 30 minutes remind me to stand up\" → a repeating 30-minute reminder", tm && tm.ms === 1_800_000, `${r.reply} · ${JSON.stringify(tm)}`);
  r = await chat("stop reminding me to stand up");
  check("\"stop reminding me to stand up\" → gone", !(await T()).timers.some((x) => /stand up/.test(x.label)), r.reply);
  await api("/timers", { action: "cancel", ref: "all" });
  r = await chat("remind me to drink water at 11pm");
  const st1 = await ST();
  check("the 1.7.2 bug: \"remind me to drink water at 11pm\" is ONE reminder at 11 p.m., never hourly", /Just once/.test(r.reply) && !/every hour/.test(r.reply) && !(await T()).timers.some((x) => /water/.test(x.label)) && st1.reminders.some((x) => x.text === "drink water" && x.time === "23:00"), `${r.reply} · ${JSON.stringify(st1.reminders)}`);
  r = await chat("remind me to drink water tomorrow at 6am");
  check("\"… tomorrow at 6am\" → once, tomorrow", /tomorrow at 6 a\.m\..*Just once/.test(r.reply), r.reply);
  r = await chat("remind me to drink water in 2 hours");
  tm = (await T()).timers.find((x) => /water/.test(x.label));
  check("\"… in 2 hours\" → a one-time 2-hour timer (never repeating)", tm && tm.ms === 7_200_000, `${r.reply} · ${JSON.stringify(tm)}`);
  await api("/timers", { action: "cancel", ref: "all" });
  r = await chat("remind me to drink water every hour");
  tm = (await T()).timers.find((x) => /water/.test(x.label));
  check("\"… every hour\" → the hourly one", tm && tm.ms === 3_600_000, r.reply);
  await api("/timers", { action: "cancel", ref: "all" });
  r = await chat("remind me to drink water every day at 11pm");
  let al = (await T()).alarms.find((x) => x.kind === "reminder" && /water/.test(x.label));
  check("\"… every day at 11pm\" → a daily reminder at 11 p.m.", al?.hm === "23:00" && al.repeat?.days?.length === 7, `${r.reply} · ${JSON.stringify(al)}`);
  r = await chat("remind me to take out the trash every Thursday night");
  al = (await T()).alarms.find((x) => /trash/.test(x.label));
  check("\"remind me to take out the trash every Thursday night\" → Thursdays at 8 p.m.", al?.hm === "20:00" && al.repeat?.days?.join() === "4", `${r.reply} · ${JSON.stringify(al)}`);
  r = await chat("remind me to pay rent on the 1st of every month at 9am");
  al = (await T()).alarms.find((x) => /rent/.test(x.label));
  check("\"… on the 1st of every month at 9am\" → monthly on the 1st (a repeat rule)", al?.repeat?.rule?.freq === "monthly" && al.repeat.rule.monthDay === 1 && al.hm === "09:00", `${r.reply} · ${JSON.stringify(al)}`);
  r = await chat("don't remind me to take out the trash");
  check("\"don't remind me to take out the trash\" → cancelled", !(await T()).alarms.some((x) => /trash/.test(x.label)), r.reply);

  // ---------------- G. alarms ----------------
  r = await chat("set an alarm for weekdays at 6:30 called work with the bells, a 5 minute snooze, a gentle wake and flash the screen");
  al = (await T()).alarms.find((x) => x.kind === "alarm" && x.label === "work");
  check("an alarm with days, a label, a sound, a snooze, gentle and flash", al?.hm === "06:30" && al.repeat?.days?.join() === "1,2,3,4,5" && al.sound === "bells" && al.snooze === 5 && al.gentle === true && al.flash === true, `${r.reply} · ${JSON.stringify(al)}`);
  r = await chat("set an alarm for Saturday at 8");
  al = (await T()).alarms.find((x) => x.kind === "alarm" && x.hm === "08:00");
  check("\"set an alarm for Saturday at 8\" → just that Saturday, 8 a.m.", al && !al.repeat && new Date(al.at).getDay() === 6, `${r.reply} · ${JSON.stringify(al)}`);
  r = await chat("set an alarm for 9 on weekends");
  r = await chat("turn off my weekend alarms");
  check("\"turn off my weekend alarms\" → switched off, kept", (await T()).alarms.filter((x) => x.kind === "alarm" && (x.repeat?.days?.includes(0) || new Date(x.at).getDay() === 6)).every((x) => x.off), r.reply);
  r = await chat("turn my weekend alarms back on");
  check("… \"turn my weekend alarms back on\" → on again", (await T()).alarms.filter((x) => x.kind === "alarm" && x.repeat?.days?.includes(0)).every((x) => !x.off), r.reply);
  r = await chat("what alarms do I have");
  check("\"what alarms do I have\" → lists them, with the label", /You have \d alarms?/.test(r.reply) && /work/.test(r.reply), r.reply);
  const tomorrowD = new Date(Date.now() + 86_400_000), tomorrow = isoOf(tomorrowD);
  // (rings tomorrow: a repeating one on tomorrow's weekday and not skipped, or a one-time one set for tomorrow)
  const ringsTomorrow = (x) => x.kind === "alarm" && !x.off && !(x.skip ?? []).includes(tomorrow) && (x.repeat?.days ? x.repeat.days.includes(tomorrowD.getDay()) : isoOf(new Date(x.at)) === tomorrow);
  const beforeSkip = (await T()).alarms.filter(ringsTomorrow).length;
  r = await chat("skip tomorrow's alarm");
  check("\"skip tomorrow's alarm\" → nothing rings tomorrow", beforeSkip === 0 ? /don't have an alarm tomorrow/.test(r.reply) : (await T()).alarms.filter(ringsTomorrow).length === 0, `${r.reply} · ${beforeSkip} before`);
  r = await chat("delete the 6:30 alarm");
  check("\"delete the 6:30 alarm\" → gone", !(await T()).alarms.some((x) => x.hm === "06:30"), r.reply);
  r = await chat("undo that");
  check("… \"undo that\" → the 6:30 alarm is back", (await T()).alarms.some((x) => x.hm === "06:30"), r.reply);
  r = await chat("a timer that goes off every day at 7");
  check("\"a timer that goes off every day at 7\" → an alarm every day at 7 a.m.", (await T()).alarms.some((x) => x.kind === "alarm" && x.hm === "07:00" && x.repeat?.days?.length === 7), r.reply);

  // ---------------- H. two at once, "it", corrections, a question ----------------
  r = await chat("set the volume to 30 and make it snow");
  check("\"set the volume to 30 and make it snow\" → both", (await S()).volume === 30 && (await SKY()).weather.choice === "snow", r.reply);
  r = await chat("turn off the lights and set a timer for 10 minutes");
  check("\"turn off the lights and set a timer for 10 minutes\" → both parts answered, the timer set", (await T()).timers.some((x) => x.ms === 600_000) && r.parts?.length === 2, r.reply);
  await api("/timers", { action: "cancel", ref: "all" });
  r = await chat("remind me to call mom tomorrow at 6pm");
  r = await chat("not tomorrow, friday");
  const rem = (await ST()).reminders.find((x) => /call mom/i.test(x.text));
  check("\"not tomorrow, friday\" → the reminder moves to Friday", rem?.date === fri && rem.time === "18:00", `${r.reply} · ${JSON.stringify(rem)}`);
  r = await chat("schedule a haircut");
  check("\"schedule a haircut\" (no when) → one question", /When is/.test(r.reply) && r.listen, r.reply);
  r = await chat("never mind");
  check("… \"never mind\" drops it", !(await ST()).pending && r.close, r.reply);
  r = await chat("set an alarm");
  check("\"set an alarm\" → what time?", /What time/.test(r.reply), r.reply);
  r = await chat("5:45 am");
  check("… \"5:45 am\" → set", (await T()).alarms.some((x) => x.hm === "05:45"), r.reply);

  // ---------------- J. you: your name, where you live, what you like (lib/commands/profile.mjs) ----------------
  r = await chat("my name is Morgan");
  check("\"my name is Morgan\" → saved, and read back", (await O()).name === "Morgan" && /Morgan/.test(r.reply), r.reply);
  r = await chat("call me Robin");
  check("\"call me Robin\" → a nickname first, the name stays", (await O()).nicknames[0] === "Robin" && (await O()).name === "Morgan", r.reply);
  r = await chat("I go by Z");
  check("\"I go by Z\" → a nickname", (await O()).nicknames.includes("Z"), r.reply);
  r = await chat("add a nickname Ziggy");
  check("\"add a nickname Ziggy\"", (await O()).nicknames.includes("Ziggy"), r.reply);
  r = await chat("remove the nickname Ziggy");
  check("\"remove the nickname Ziggy\"", !(await O()).nicknames.includes("Ziggy"), r.reply);
  r = await chat("what's my name?");
  check("\"what's my name?\" → Morgan (and the nicknames)", /Morgan/.test(r.reply) && /Robin/.test(r.reply), r.reply);
  r = await chat("what do you call me?");
  check("\"what do you call me?\"", /Robin/.test(r.reply), r.reply);
  const asst = (await O()).assistantName;
  await chat("your name is Nova");
  check("\"your name is Nova\" is the assistant's name: the owner's name is untouched", (await O()).name === "Morgan" && !/Nova/.test((await O()).nicknames.join()), (await O()).name);
  void asst;
  r = await chat("I live in Springfield, Illinois");
  check("\"I live in Springfield, Illinois\" → the place found, saved, and read back", (await O()).location.place === "Springfield, Illinois" && /Springfield, Illinois, got it\. Weather and sunrise will use that/.test(r.reply), r.reply);
  r = await chat("I'm going to Chicago tomorrow");
  check("\"I'm going to Chicago tomorrow\" is a trip, not a move", (await O()).location.place === "Springfield, Illinois", r.reply);
  r = await chat("set my location to Peoria");
  check("\"set my location to Peoria\"", (await O()).location.place === "Peoria, Illinois", r.reply);
  r = await chat("my zip code is 62701");
  check("\"my zip code is 62701\" → Springfield", (await O()).location.place === "Springfield, Illinois", r.reply);
  const tz0 = (await O()).location.timezone;
  r = await chat("I moved to Denver");
  check("\"I moved to Denver\" → saved; the new time zone waits for a yes", (await O()).location.place === "Denver, Colorado" && /Switch the time zone too\?/.test(r.reply) && (await O()).location.timezone === tz0, r.reply);
  r = await chat("yes");
  check("… \"yes\" → the time zone follows", (await O()).location.timezone === "America/Denver", r.reply);
  r = await chat("where do you think I am?");
  check("\"where do you think I am?\" → Denver", /Denver/.test(r.reply), r.reply);
  r = await chat("use my current location");
  check("\"use my current location\" → explains, asks for a town", /can't tell where this computer is/.test(r.reply), r.reply);
  r = await chat("I'm a carpenter");
  check("\"I'm a carpenter\" → About you", /I'm a carpenter\./.test((await O()).about), r.reply);
  r = await chat("I work at Acme Tools");
  check("\"I work at Acme Tools\" → About you, his capitals", /I work at Acme Tools\./.test((await O()).about), `${r.reply} · ${(await O()).about}`);
  r = await chat("my birthday is July 9th");
  check("\"my birthday is July 9th\" → saved and read back", /My birthday is July 9\./.test((await O()).about) && /July 9/.test(r.reply), r.reply);
  r = await chat("I like kayaking and D&D");
  const ints = (await O()).interests;
  check("\"I like kayaking and D&D\" → interests", ints.includes("kayaking") && ints.includes("D&D"), `${r.reply} · ${JSON.stringify((await O()).interests)}`);
  r = await chat("I don't like country music");
  check("\"I don't like country music\" → kept as a preference", /country music/.test(r.reply), r.reply);
  r = await chat("add fishing to my interests");
  check("\"add fishing to my interests\"", (await O()).interests.includes("fishing"), r.reply);
  r = await chat("remove D&D from my interests");
  check("\"remove D&D from my interests\"", !(await O()).interests.some((x) => /D&D/i.test(x)), `${r.reply} · ${JSON.stringify((await O()).interests)}`);
  r = await chat("what do you know about me?");
  check("\"what do you know about me?\" → name, place, work, interests, the dislike", /Morgan/.test(r.reply) && /Denver/.test(r.reply) && /carpenter/.test(r.reply) && /fishing/.test(r.reply) && /country music/.test(r.reply), r.reply);
  r = await chat("forget that I don't like country music");
  const r2 = await chat("what do you know about me?");
  check("\"forget that I don't like country music\" → gone", !/country music/.test(r2.reply), `${r.reply} · ${r2.reply}`);
  r = await chat("let me tell you about myself");
  check("\"let me tell you about myself\" → the first question (your name)", /what's your name/i.test(r.reply) && r.listen, r.reply);
  r = await chat("Sam");
  check("… \"Sam\" → saved, then where you live", (await O()).name === "Sam" && /Where do you live/.test(r.reply), r.reply);
  r = await chat("skip");
  check("… \"skip\" → the next question (work)", /work/i.test(r.reply), r.reply);
  r = await chat("I'm a teacher");
  check("… \"I'm a teacher\" → saved, then what you like", /I'm a teacher\./.test((await O()).about) && /fun/.test(r.reply), r.reply);
  r = await chat("that's all");
  check("… \"that's all\" ends the questions (nothing left waiting)", r.close === true && !(await ST()).pending, r.reply);
  r = await chat("undo that");
  check("\"undo that\" after the profile change puts it back", (await O()).about && !/I'm a teacher\./.test((await O()).about), `${r.reply} · ${(await O()).about}`);

  // ---------------- I. the screen: an ending closes the listening window at once ----------------
  if (!process.argv.includes("--no-browser") && existsSync(CHROME)) {
    const { chromium } = await import(PW);
    const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio"] });
    const mock = () => {
      window.__spoken = []; window.__slow = 60;
      const ss = window.speechSynthesis;
      if (ss) { ss.speak = (u) => { window.__spoken.push({ t: u.text, at: Date.now() }); u.__t = setTimeout(() => { window.__spokeEnd = Date.now(); u.onend?.(); }, window.__slow); window.__u = u; }; ss.cancel = () => { window.__cancelAt = Date.now(); const u = window.__u; if (u) { clearTimeout(u.__t); window.__u = null; setTimeout(() => u.onerror?.({ error: "interrupted" }), 0); } }; }
      HTMLMediaElement.prototype.play = function () { setTimeout(() => this.onended?.(), 30); return Promise.resolve(); };
    };
    try {
      const ctx = await browser.newContext(); await ctx.addInitScript(mock);
      const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
      await p.goto(BASE + "/display"); await p.waitForTimeout(2500);
      if (await p.locator("#startBtn").isVisible().catch(() => false)) await p.click("#startBtn").catch(() => {});
      const waitFor = (fn, arg, ms = 20_000) => p.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);
      await waitFor(() => window.dsCore && window.dsCore.mode === "idle");
      // a normal answer leaves the window open for a follow-up
      await p.evaluate(() => { window.__spoken = []; window.dispatchEvent(new CustomEvent("ds-test-final", { detail: "Dayspring what time is it" })); });
      await waitFor(() => window.__spoken.length > 0);
      const open = await waitFor(() => window.dsCore.mode === "command", null, 4000);
      check("screen: a normal answer opens the follow-up window (unchanged)", open);
      // "thanks" in that window: answered, and the window closes right after the words
      await p.evaluate(() => { window.__spoken = []; window.__spokeEnd = 0; window.dispatchEvent(new CustomEvent("ds-test-final", { detail: "thanks" })); });
      await waitFor(() => window.__spoken.length > 0 && window.__spokeEnd > 0, null, 10_000);
      const t0 = await p.evaluate(() => window.__spokeEnd);
      await waitFor(() => window.dsCore.mode === "idle", null, 8000);
      const closedAfter = (await p.evaluate(() => Date.now())) - t0;
      const said = await p.evaluate(() => window.__spoken.map((x) => x.t).join(" | "));
      check("screen: \"thanks\" → a short answer, then the window closes at once (< 1.5 s, not the usual 7 s)", /welcome|Anytime|Happy to help/.test(said) && closedAfter < 1500, `${said} · closed ${closedAfter} ms after`);
      // a request with "thanks" on the end: done, no follow-up question, closed
      await p.evaluate(() => { window.__spoken = []; window.__spokeEnd = 0; window.dispatchEvent(new CustomEvent("ds-test-final", { detail: "Dayspring set a timer for 4 minutes thanks" })); });
      await waitFor(() => window.__spoken.length > 0 && window.__spokeEnd > 0, null, 10_000);
      const t1 = await p.evaluate(() => window.__spokeEnd);
      await waitFor(() => window.dsCore.mode === "idle", null, 8000);
      const said2 = await p.evaluate(() => window.__spoken.map((x) => x.t).join(" | "));
      check("screen: \"…timer for 4 minutes thanks\" → no \"What's it for?\", closed at once", !/What's it for/.test(said2) && (await p.evaluate(() => Date.now())) - t1 < 1500, said2);
      check("screen: the clock shows 24-hour time after \"use 24-hour time\"", await waitFor(() => !document.querySelector("#clock .ap"), null, 5000));

      // ---- "stop": cuts Dayspring off mid-sentence, closes this window, and never stops listening ----
      const notStopped = () => p.evaluate(() => !window.dsCore.micMuted && window.dsCore.listenState === "active" && !document.documentElement.classList.contains("stopped"));
      const idleNow = () => waitFor(() => window.dsCore.mode === "idle" && !window.dsCore.speaking, null, 20_000);
      await idleNow();
      await p.evaluate(() => { window.__spoken = []; window.__slow = 5000; window.__cancelAt = 0; window.dispatchEvent(new CustomEvent("ds-test-final", { detail: "Dayspring what's on my schedule today" })); });
      await waitFor(() => window.dsCore.speaking, null, 10_000);
      const tStop = await p.evaluate(() => { const t = Date.now(); window.dispatchEvent(new CustomEvent("ds-test-interim", { detail: "stop" })); return t; });
      await waitFor(() => window.__cancelAt > 0, null, 2000);
      const cutAfter = (await p.evaluate(() => window.__cancelAt)) - tStop;
      check("stop: \"stop\" said over Dayspring's voice cuts it off within 300 ms", cutAfter >= 0 && cutAfter < 300, `${cutAfter} ms`);
      check("stop: …the window closes (idle), and listening is NOT stopped", await waitFor(() => window.dsCore.mode === "idle" && !window.dsCore.speaking, null, 3000) && await notStopped(),
        JSON.stringify(await p.evaluate(() => ({ mode: window.dsCore.mode, speaking: window.dsCore.speaking, muted: window.dsCore.micMuted, listen: window.dsCore.listenState, spoken: window.__spoken.map((x) => x.t.slice(0, 60)) }))));
      await p.evaluate(() => { window.__slow = 60; window.__spoken = []; window.dispatchEvent(new CustomEvent("ds-test-final", { detail: "stop the timer" })); });
      await p.waitForTimeout(3200);
      await p.evaluate(() => { window.__spoken = []; window.dispatchEvent(new CustomEvent("ds-test-final", { detail: "Dayspring what time is it" })); });
      check("stop: the very next \"Dayspring, …\" is heard and answered", await waitFor(() => window.__spoken.some((x) => /\d/.test(x.t)), null, 10_000), JSON.stringify(await p.evaluate(() => window.__spoken)));
      await idleNow();
      // "that's enough" as a whole phrase while it talks
      await p.evaluate(() => { window.__spoken = []; window.__slow = 5000; window.__cancelAt = 0; window.dispatchEvent(new CustomEvent("ds-test-final", { detail: "Dayspring tell me a fun fact" })); });
      await waitFor(() => window.dsCore.speaking, null, 10_000);
      await p.evaluate(() => window.dispatchEvent(new CustomEvent("ds-test-final", { detail: "that's enough" })));
      check("stop: \"that's enough\" stops it too, and listening stays on", await waitFor(() => window.__cancelAt > 0 && window.dsCore.mode === "idle", null, 3000) && await notStopped());
      await p.evaluate(() => { window.__slow = 60; window.__spoken = []; });
      await p.waitForTimeout(1700);
      await p.evaluate(() => window.dispatchEvent(new CustomEvent("ds-test-final", { detail: "Dayspring what time is it" })));
      check("stop: after \"that's enough\", the next \"Dayspring, …\" works at once", await waitFor(() => window.__spoken.some((x) => /\d/.test(x.t)), null, 10_000));
      await idleNow();
      // a document being read aloud
      await p.evaluate(() => { window.__readerPaused = 0; window.__origReader = window.dsReader; window.dsReader = { pause: () => { window.__readerPaused = Date.now(); }, state: () => ({ playing: true }) }; window.dispatchEvent(new CustomEvent("ds-test-final", { detail: "stop" })); });
      check("stop: \"stop\" while a document is read aloud pauses the reading", await waitFor(() => window.__readerPaused > 0, null, 3000));
      await p.evaluate(() => { window.dsReader = window.__origReader; });
      await p.waitForTimeout(1700);
      // a question Dayspring asked
      await p.evaluate(() => { window.__spoken = []; window.dispatchEvent(new CustomEvent("ds-test-final", { detail: "Dayspring schedule a haircut" })); });
      await waitFor(() => window.__spoken.some((x) => /When is/.test(x.t)) && window.dsCore.mode === "command", null, 10_000);
      const asked = Boolean((await ST()).pending);
      await p.evaluate(() => window.dispatchEvent(new CustomEvent("ds-test-final", { detail: "stop" })));
      await p.waitForTimeout(800);
      check("stop: \"stop\" during a question drops the question (nothing left waiting), window closed", asked && !(await ST()).pending && await p.evaluate(() => window.dsCore.mode === "idle"), `asked=${asked}`);
      await p.waitForTimeout(1700);
      // "stop" with music playing and nothing being said: the music stops
      const mediaStops = []; p.on("request", (rq) => { if (/\/api\/media\/stop/.test(rq.url())) mediaStops.push(rq.url()); });
      await p.evaluate(() => { window.__dsTestMedia = true; window.dispatchEvent(new CustomEvent("ds-test-final", { detail: "Dayspring stop" })); });
      await p.waitForTimeout(800);
      check("stop: \"Dayspring, stop\" with music playing and nothing said → the music stops", mediaStops.length > 0);
      await p.evaluate(() => { window.__dsTestMedia = false; });
      // …but over Dayspring's own voice, "stop" leaves the music alone
      await p.waitForTimeout(1700); mediaStops.length = 0;
      await p.evaluate(() => { window.__dsTestMedia = true; window.__slow = 5000; window.dispatchEvent(new CustomEvent("ds-test-final", { detail: "Dayspring tell me a fun fact" })); });
      await waitFor(() => window.dsCore.speaking, null, 10_000);
      await p.evaluate(() => window.dispatchEvent(new CustomEvent("ds-test-interim", { detail: "stop" })));
      await p.waitForTimeout(800);
      check("stop: \"stop\" over Dayspring's voice stops the voice, not the music", mediaStops.length === 0 && await waitFor(() => !window.dsCore.speaking, null, 2000),
        JSON.stringify({ mediaStops: mediaStops.length, ...(await p.evaluate(() => ({ speaking: window.dsCore.speaking, mode: window.dsCore.mode, at: window.dsStopPhrase.at, spoken: window.__spoken.map((x) => x.t.slice(0, 50)) }))) }));
      await p.evaluate(() => { window.__dsTestMedia = false; window.__slow = 60; });
      // which words count
      const phr = await p.evaluate(() => Object.fromEntries(["stop", "that's enough", "enough", "okay stop", "stop talking", "be quiet", "shh", "hush", "quiet", "cancel", "never mind", "that's all", "okay that's good", "alright alright", "got it thanks", "stop stop",
        "stop the timer", "stop the alarm", "don't stop the music", "stop the music", "I can't stop laughing", "what's the stop date", "stop listening"].map((t) => [t, window.dsStopPhrase.test(t)])));
      const yes = ["stop", "that's enough", "enough", "okay stop", "stop talking", "be quiet", "shh", "hush", "quiet", "cancel", "never mind", "that's all", "okay that's good", "alright alright", "got it thanks", "stop stop"];
      check("stop: the owner's stop phrases all count", yes.every((t) => phr[t]), JSON.stringify(Object.entries(phr).filter(([t, v]) => yes.includes(t) && !v)));
      check("stop: \"stop the timer\", \"stop the alarm\", \"don't stop the music\", \"stop listening\"… are their own commands, not a stop", ["stop the timer", "stop the alarm", "don't stop the music", "stop the music", "I can't stop laughing", "what's the stop date", "stop listening"].every((t) => !phr[t]));
      await idleNow();
      check("screen: no script errors", errs.length === 0, errs.join(" | "));
      await browser.close();
    } catch (e) { check("screen checks ran", false, e.message); await browser.close().catch(() => {}); }
  } else console.log("SKIP  the screen checks (no Chrome, or --no-browser)");
  check("the server logged no errors", !/TypeError|ReferenceError|SyntaxError|Unhandled|commands: /.test(serverLog), serverLog.split("\n").filter((l) => /Error|commands:/.test(l)).slice(0, 4).join(" | "));
} finally {
  server.kill();
  await sleep(800);
  if (!process.argv.includes("--keep")) try { rmSync(TMP, { recursive: true, force: true }); } catch { /* files still held */ }
}
console.log(`\n${fail ? "FAILED" : "ALL PASSED"}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
