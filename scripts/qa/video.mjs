// Videos (lib/video): finding them, creators' channels, the grid, his YouTube playlists, the queue, and playback
// control on every player. Everything runs against a pretend YouTube (fixtures/video/mock-youtube.mjs: results, channel
// and playlist pages, a Data API and a mocked iframe player) on 127.0.0.1. Never the owner's YouTube, his account, his
// Chrome or the DayspringMedia profile, his data folder, his running Dayspring (:4747), or real sound.
//   1. understanding: 90+ phrasings → what kind of request, the words, the filters; the Bible, music and pictures keep theirs
//   2. creators: "oneyplays", "one-y plays", "david wood", "mike winger", "john mcarthur"… → their own channel (not a fan
//      channel, never a video that only mentions them); corrections and the editable list
//   3. finding and ranking: plays the best, the top 3 when unsure, "number 2", "not that" (remembered), filters, Shorts,
//      live, "more like this", the next episode, the study rule
//   4. the grid: 12–24 videos, "more", "number 3", "queue number 2 and 4", newest / most viewed / long / no Shorts
//   5. his playlists: the signed-in browser (fake) and the Data API (mock): list, play, shuffle, Liked, Watch later, queue
//   6. the queue: queue X, play X next, queue 3 about Y, show, play number 5, remove, move, clear, shuffle, repeat,
//      autoplay, and it survives a restart (the file)
//   7. playback controls by voice (no AI): 45 phrasings → the action, what's playing, how long is left
//   8. on the screen (a throwaway Dayspring, headless Chrome, muted): YouTube (mocked iframe API), a local HTML5 video, Spotify
//      (mocked SDK) and the media window's page control: every control, the buttons, the keys, the grid and the queue panels
//   node scripts/qa/video.mjs [--verbose] [--no-browser] [--keep]
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { qaPort } from "./port.mjs";   // a free port (or QA_PORT), so parallel runs never collide
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startMock, search as mockSearch, PLAYLISTS, CHANNELS, playlistData, feedPlaylistsPage, pageHtml, IFRAME_API } from "./fixtures/video/mock-youtube.mjs";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2), VERBOSE = args.includes("--verbose"), NO_BROWSER = args.includes("--no-browser");
const TMP = mkdtempSync(join(tmpdir(), "ds-video-"));
const mock = await startMock();
Object.assign(process.env, {
  DAYSPRING_YT_BASE: mock.url, DAYSPRING_YT_API: `${mock.url}/youtube/v3`, DAYSPRING_NO_HEADLESS_SEARCH: "1", DAYSPRING_NO_BROWSER: "1",
  DAYSPRING_VIDEO_QUEUE: join(TMP, "video-queue.json"), DAYSPRING_VIDEO_PREFS: join(TMP, "video-prefs.json"), DAYSPRING_VIDEO_CREATORS: join(TMP, "video-creators.json"),
  DAYSPRING_VIDEO_ACCOUNT: join(TMP, "video-account.json"), DAYSPRING_MEDIA_FILE: join(TMP, "media.json"), DAYSPRING_VIDEOLISTS_FILE: join(TMP, "video-playlists.json"),
  DAYSPRING_FEATURE_SWITCHES: join(TMP, "feature-switches.json"), DAYSPRING_FEATURE_STAGES: join(TMP, "feature-stages.json"), DAYSPRING_CHANNEL: "stable",
  DAYSPRING_MEDIA_PROFILE: join(TMP, "media-profile"), DAYSPRING_SEARCH_PROFILE: join(TMP, "search-profile"), DAYSPRING_SPOTIFY_TOKEN_FILE: join(TMP, "spotify-token.json"),
  DAYSPRING_INTENT_LEARNED: join(TMP, "learned.json"), DAYSPRING_INTENT_MISSES: join(TMP, "misses.json"), DAYSPRING_SETTINGS_FILE: join(TMP, "settings.json"),
  DAYSPRING_TIMERS_FILE: join(TMP, "timers.json"), DAYSPRING_RECIPES_FILE: join(TMP, "recipes.json"), DAYSPRING_LISTS_FILE: join(TMP, "lists.json"),
});
const imp = (p) => import(pathToFileURL(join(DESK, p)).href);

let passed = 0, failed = 0;
const rec = (area, ok, note = "") => { if (ok) passed++; else failed++; if (!ok || VERBOSE) console.log(`${ok ? "PASS" : "FAIL"}  ${area}${note !== "" && (!ok || VERBOSE) ? " — " + String(note).slice(0, 300) : ""}`); };
const section = (s) => console.log(`\n== ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = (x) => JSON.stringify(x);

const ytsearch = await imp("lib/ytsearch.mjs");
ytsearch._setFake((q, o) => mockSearch(q, o));           // searches: the fixture corpus (the same one the mock's pages serve)
const media = await imp("lib/media.mjs");
media._setPolicy({ videosAllowed: true });
const bus = await imp("lib/bus.mjs");
const P = await imp("lib/video/parse.mjs");
const controls = await imp("lib/video/controls.mjs");
const creators = await imp("lib/video/creators.mjs");
const yt = await imp("lib/video/youtube.mjs");
const R = await imp("lib/video/rank.mjs");
const queue = await imp("lib/video/queue.mjs");
const account = await imp("lib/video/account.mjs");
const video = await imp("lib/video/index.mjs");
const features = await imp("lib/features.mjs");
const intents = await imp("lib/intents/index.mjs");

// what reaches the screen: every broadcast (a pretend screen is connected, so media.control sends to it)
const events = [];
bus.on((type, data) => events.push({ type, data }));
const fakeScreen = { writeHead() {}, write() {}, on() {} };
bus.addClient(fakeScreen, { page: "display", id: "qa-screen" });
const last = (type) => [...events].reverse().find((e) => e.type === type)?.data ?? null;
const since = (n) => events.slice(n);
video._setDeps({ spotifyReady: () => false, othersAt: async () => 0 });
const playing = (x) => media.setState({ source: "youtube", title: x?.title ?? "Something", artist: x?.channel ?? "Someone", playing: true, position: 30, duration: 600, rate: 1, videoId: x?.videoId ?? "abcdefghijk" });
const reset = () => { video._reset(); rmSync(process.env.DAYSPRING_VIDEO_QUEUE, { force: true }); rmSync(process.env.DAYSPRING_VIDEO_PREFS, { force: true }); rmSync(process.env.DAYSPRING_VIDEO_CREATORS, { force: true }); queue.reload(); creators.reload(); media.setState(null); events.length = 0; };
const cmd = (t) => video.command(t, { surface: "desk" });

try {
  // ------------------------------------------------------------------------------------------------ 0. the feature
  section("the feature: videosearch");
  rec("videosearch is a beta feature, on in production and marked New", features.get("videosearch")?.stage === "beta" && features.on("videosearch") && features.describe("videosearch").isNew && features.describe("videosearch").switchable);
  rec("its routes, tools and intents are gated", features.routeBlocked("/video/queue") === null && features.toolAllowed("video_find") && features.intentAllowed("video.find"));

  // ------------------------------------------------------------------------------------------------ 1. understanding
  section("1. understanding what was asked (parse)");
  const U = [
    // [words, expected act, check(request) → true]
    ["find bible reading in psalms on youtube", "play", (r) => r.query === "bible reading in psalms"],
    ["play bible reading in psalms on youtube", "play", (r) => /psalms/.test(r.query)],
    ["play psalm 23 on youtube", "play", (r) => r.query === "psalm 23"],
    ["look up how to cut dovetails on youtube", "play", (r) => r.query === "how to cut dovetails"],
    ["watch the chosen season 4 trailer on youtube", "play", (r) => /chosen season 4 trailer/.test(r.query)],
    ["youtube amazing grace pentatonix", "play", (r) => /amazing grace pentatonix/.test(r.query)],
    ["play the video amazing grace", "play", (r) => r.kind === "title" && r.query === "amazing grace"],
    ["play the video called how to cut dovetails by hand", "play", (r) => r.kind === "title" && r.query === "how to cut dovetails by hand"],
    ["show me a video of a cat playing piano", "play", (r) => /cat playing piano/.test(r.query)],
    ["find a video about surfing in bali", "play", (r) => r.kind === "topic" && r.query === "surfing in bali"],
    ["play a video about biking", "play", (r) => r.kind === "topic" && r.query === "biking"],
    ["put on a video about the psalms", "play", (r) => /psalms/.test(r.query)],
    ["play a video by oneyplays", "play", (r) => r.kind === "creator" && r.creator === "oneyplays"],
    ["play a video by oney plays", "play", (r) => r.kind === "creator" && r.creator === "oney plays"],
    ["play a video by one-y plays", "play", (r) => r.kind === "creator" && /one-?y plays/.test(r.creator)],
    ["play a video by david wood", "play", (r) => r.kind === "creator" && r.creator === "david wood"],
    ["play a video from mike winger", "play", (r) => r.kind === "creator" && r.creator === "mike winger"],
    ["play a video by john macarthur", "play", (r) => r.kind === "creator" && r.creator === "john macarthur"],
    ["play a video by john mcarthur", "play", (r) => r.kind === "creator" && r.creator === "john mcarthur"],
    ["play the latest video from mike winger", "play", (r) => r.kind === "creator" && r.filters.newest],
    ["play the newest video by oneyplays", "play", (r) => r.kind === "creator" && r.filters.newest],
    ["play a popular video by david wood", "play", (r) => r.kind === "creator" && r.filters.popular],
    ["play john macarthur's latest video", "play", (r) => r.kind === "creator" && /john macarthur/.test(r.creator)],
    ["play something from grace to you's channel", "play", (r) => r.kind === "creator" && r.creator === "grace to you"],
    ["play a video by mike winger about the trinity", "play", (r) => r.kind === "creator" && r.query === "the trinity"],
    ["is mike winger live", "play", (r) => r.kind === "creator" && r.live],
    ["play the mike winger live stream on youtube", "play", (r) => r.live],
    ["find a live stream of morning worship on youtube", "play", (r) => r.live && /morning worship/.test(r.query)],
    ["play a youtube playlist of worship songs", "play", (r) => r.kind === "playlist" && /worship songs/.test(r.query)],
    ["play a video about biking under 10 minutes", "play", (r) => r.filters.maxSecs === 600 && r.query === "biking"],
    ["play a video about surfing longer than 20 minutes", "play", (r) => r.filters.minSecs === 1200 && r.query === "surfing"],
    ["play a full episode of the chosen on youtube", "play", (r) => r.filters.full],
    ["play the most popular video about dovetails", "play", (r) => r.filters.popular && r.query === "dovetails"],
    ["play a youtube short about cats", "play", (r) => r.filters.shorts],
    ["play a video about biking from this week", "play", (r) => r.filters.recentDays === 7],
    ["play 3 videos about surfing", "play", (r) => r.count === 3 && r.query === "surfing" && r.kind === "topic"],
    ["play more like this", "play", (r) => r.kind === "morelike"],
    ["find more videos like this", "browse", (r) => r.kind === "morelike"],
    ["play the next episode", "play", (r) => r.kind === "episode"],
    ["pull up videos about biking", "browse", (r) => r.kind === "topic" && r.query === "biking"],
    ["pull up a bunch of videos about surfing", "browse", (r) => r.query === "surfing"],
    ["show me videos about woodworking", "browse", (r) => r.query === "woodworking"],
    ["show me videos by mike winger", "browse", (r) => r.kind === "creator" && r.creator === "mike winger"],
    ["pull up videos from oneyplays", "browse", (r) => r.kind === "creator" && r.creator === "oneyplays"],
    ["show me the newest videos about surfing", "browse", (r) => r.filters.newest && r.query === "surfing"],
    ["pull up videos about biking no shorts", "browse", (r) => r.filters.noShorts && r.query === "biking"],
    ["pull up videos about surfing longer than 20 minutes", "browse", (r) => r.filters.minSecs === 1200],
    ["search youtube for dovetails", "browse", (r) => r.query === "dovetails"],
    ["browse youtube for bible reading", "browse", (r) => r.query === "bible reading"],
    ["videos about biking", "browse", (r) => r.query === "biking"],
    ["what's on youtube about surfing", "browse", (r) => r.query === "surfing"],
    ["find videos about john macarthur", "browse", (r) => /john macarthur/.test(r.query ?? r.creator)],
    ["queue how to cut dovetails", "queue", (r) => r.query === "how to cut dovetails"],
    ["queue up amazing grace pentatonix", "queue", (r) => /amazing grace pentatonix/.test(r.query)],
    ["add the video amazing grace to the queue", "queue", (r) => r.kind === "title" && r.query === "amazing grace"],
    ["add half-blind dovetails explained to my queue", "queue", (r) => /half-blind dovetails/.test(r.query)],
    ["play hand cut dovetails for beginners next", "queue", (r) => r.next && /hand cut dovetails/.test(r.query)],
    ["queue 3 videos about dovetails", "queue", (r) => r.count === 3 && r.query === "dovetails"],
    ["queue five videos about surfing", "queue", (r) => r.count === 5 && r.query === "surfing"],
    ["queue a video by david wood", "queue", (r) => r.kind === "creator" && r.creator === "david wood"],
    ["add this to my queue", "queue", (r) => r.kind === "this"],
    ["queue the next episode", "queue", (r) => r.kind === "episode"],
    ["list my youtube playlists", "playlists", (r) => r.explicit],
    ["what youtube playlists do i have", "playlists", (r) => r.explicit],
    ["show my youtube playlists", "playlists", () => true],
    ["play my worship playlist", "playlist", (r) => r.name === "worship" && !r.shuffle],
    ["play my worship youtube playlist", "playlist", (r) => r.name === "worship" && r.explicit],
    ["shuffle my workout playlist", "playlist", (r) => r.shuffle && r.name === "workout"],
    ["play my liked videos", "playlist", (r) => r.special === "liked"],
    ["play my watch later", "playlist", (r) => r.special === "watchlater"],
    ["queue my worship playlist after this", "queuePlaylist", (r) => r.next && r.name === "worship"],
    ["what's in my worship playlist", "showPlaylist", (r) => r.name === "worship"],
    ["when i say pastor bob i mean first baptist church", "alias", (r) => r.name === "pastor bob" && r.channel === "first baptist church"],
  ];
  for (const [w, act, ok] of U) { const r = P.request(w); rec(`“${w}” → ${act}`, r?.act === act && ok(r), j(r)); }
  // what the screen's list answers, and the queue
  const C = [["number 3", { op: "pick", n: 3 }], ["play number 2", { op: "pick", n: 2 }], ["the second one", { op: "pick", n: 2 }], ["queue number 2 and 4", { op: "queueMany", ns: [2, 4] }],
    ["add 3 and 5 to the queue", { op: "queueMany", ns: [3, 5] }], ["more", { op: "more" }], ["show more", { op: "more" }], ["newest first", { op: "refine" }], ["most viewed", { op: "refine" }],
    ["only longer than 20 minutes", { op: "refine" }], ["no shorts", { op: "refine" }], ["not that", { op: "notThat" }], ["not that one", { op: "notThat" }], ["wrong video", { op: "notThat" }],
    ["next one", { op: "notThat" }], ["wrong channel", { op: "notThat" }], ["none of these", { op: "none" }], ["close the videos", { op: "close" }]];
  for (const [w, want] of C) { const r = P.context(w); rec(`on screen: “${w}” → ${want.op}`, r?.op === want.op && (!want.n || r.n === want.n) && (!want.ns || j(r.ns) === j(want.ns)), j(r)); }
  const QO = [["show the queue", "show"], ["what's in the queue", "show"], ["what's in this playlist", "show"], ["play number 5 in the queue", "play"], ["remove number 3", "remove"], ["remove number 3 from the queue", "remove"],
    ["move number 4 up", "move"], ["move number 2 to the top", "move"], ["move number 1 to the end", "move"], ["clear the queue", "clear"], ["shuffle the queue", "shuffle"], ["repeat the queue", "repeat"], ["what's up next", "whatsNext"]];
  for (const [w, op] of QO) { const r = P.queueOp(w); rec(`queue: “${w}” → ${op}`, r?.op === op, j(r)); }

  // the Bible, music and pictures keep their own words; video words win
  section("1b. the Bible reader, music and pictures vs videos");
  const notVideo = ["read psalms 23", "read psalm 23", "read john 3:16", "what does the bible say about peace", "verse of the day", "play some jazz", "play gratitude by hollow pines", "play my liked songs",
    "show me pictures of golden retrievers", "play christian folk music", "pause", "what time is it", "set a timer for 10 minutes"];
  for (const w of notVideo) { const r = await cmd(w); rec(`not a video request: “${w}”`, r === null, j(r)); }
  const I = (t) => intents.plan(t).intent;
  rec("“read psalms 23” still reads the Bible (bible.read)", I("read psalms 23") === "bible.read", I("read psalms 23"));
  rec("“read psalm 23 to me” still reads the Bible", I("read psalm 23 to me") === "bible.read", I("read psalm 23 to me"));
  rec("the no-AI catalogue: “find bible reading in psalms on youtube” is a video, not the Bible", I("find bible reading in psalms on youtube") === "video.find", I("find bible reading in psalms on youtube"));
  rec("the no-AI catalogue: “pull up videos about biking” is the video grid", I("pull up videos about biking") === "video.browse", I("pull up videos about biking"));
  rec("the no-AI catalogue: “show me pictures of golden retrievers” is still pictures", /^images\./.test(I("show me pictures of golden retrievers")), I("show me pictures of golden retrievers"));
  reset();
  { const r = await cmd("find bible reading in psalms on youtube"); const m = last("media");
    rec("“find bible reading in psalms on youtube” plays a Bible-reading video (not the Bible reader)", r?.intent === "video" && m?.action === "play" && /psalm/i.test(m.title) && !/#shorts/i.test(m.title), `${r?.reply} | ${m?.title}`); }
  { const r = await cmd("show me a video of psalm 23"); rec("“show me a video of psalm 23” is a video too", r?.intent === "video" && /psalm/i.test(last("media")?.title ?? ""), r?.reply); }

  // ------------------------------------------------------------------------------------------------ 2. creators
  section("2. creators → their own channel");
  const CR = [["oneyplays", "OneyPlays"], ["oney plays", "OneyPlays"], ["one-y plays", "OneyPlays"], ["one y plays", "OneyPlays"], ["oney", "OneyPlays"], ["david wood", "Acts17Apologetics"],
    ["acts 17", "Acts17Apologetics"], ["mike winger", "Mike Winger"], ["mike wingar", "Mike Winger"], ["michael winger", "Mike Winger"], ["john macarthur", "Grace to You"], ["john mcarthur", "Grace to You"],
    ["john mac arthur", "Grace to You"], ["pastor john macarthur", "Grace to You"], ["rc sproul", "Ligonier Ministries"], ["alistair begg", "Truth For Life"], ["veritasium", "Veritasium"]];
  for (const [w, want] of CR) {
    const r = await creators.resolve(w);
    const ch = CHANNELS.find((c) => c.name === want);
    rec(`creator “${w}” → ${want}`, r.channel?.name === want && (!ch || r.channel.channelId === ch.channelId || r.channel.handle === ch.handle), j(r));
  }
  rec("a fan channel with the person's name loses to the one they're known for (John MacArthur Clips ≠ Grace to You)", (await creators.resolve("john macarthur")).channel?.channelId === "UCgtyNowGraceToYou00002");
  rec("…and to the official channel of a name not on the list (Veritasium, not Veritasium Clips)", (await creators.resolve("veritasium")).channel?.channelId === "UCveritasiumOfficial011");
  reset();
  for (const [w, want] of [["play a video by oneyplays", "OneyPlays"], ["play a video by oney plays", "OneyPlays"], ["play a video by david wood", "Acts17Apologetics"], ["play a video by mike winger", "Mike Winger"], ["play a video by john macarthur", "Grace to You"], ["play a video by john mcarthur", "Grace to You"]]) {
    events.length = 0;
    const r = await cmd(w), m = last("media");
    rec(`“${w}” plays a video from ${want}'s channel (not one that mentions them, not a Short)`, m?.action === "play" && m.channel === want && !/#shorts/i.test(m.title) && !/react|exposed|fan|compilation/i.test(m.title), `${r?.reply} | ${m?.title} / ${m?.channel}`);
  }
  { events.length = 0; await cmd("play the latest video from mike winger"); const m = last("media"); rec("“the latest video from mike winger” is his newest upload", m?.title === "The Trinity Explained (Mike Winger)", m?.title); }
  { events.length = 0; await cmd("play a popular video by oneyplays"); const m = last("media"); rec("“a popular video by oneyplays” is their most viewed (not a Short)", m?.title === "Oney Plays Animal Crossing (Funny Moments)", m?.title); }
  { events.length = 0; await cmd("play a video by oneyplays"); const m = last("media"); rec("“a video by oneyplays”: a recent one people watched", m?.channel === "OneyPlays" && /Mario Party - Episode 11|Animal Crossing/.test(m.title), m?.title); }
  { events.length = 0; await cmd("is mike winger live"); const m = last("media"); rec("“is mike winger live” plays his live stream", /LIVE: Bible Q&A/.test(m?.title ?? ""), m?.title); }
  // teaching and correcting
  { const r = await cmd("when I say pastor bob I mean truth for life"); const x = await creators.resolve("pastor bob");
    rec("“when I say pastor bob I mean truth for life” is remembered (the editable list)", /Truth For Life/i.test(r?.reply ?? "") && x.channel?.name === "Truth For Life" && JSON.parse(readFileSync(process.env.DAYSPRING_VIDEO_CREATORS, "utf8")).people[0].name.toLowerCase() === "pastor bob", j(x)); }
  { creators.reject("pastor bob", { name: "Truth For Life", channelId: "UCtruthForLifeBegg00012", handle: "@truthforlife" }); const x = await creators.resolve("pastor bob");
    rec("a channel he turned down isn't picked again for those words", x.channel?.name !== "Truth For Life", j(x)); }
  rec("the list can be read and edited (GET/POST /api/video/creators)", creators.people().some((p) => p.name === "John MacArthur" && p.channels[0].name === "Grace to You") && creators.removeAlias("pastor bob"));
  { events.length = 0; await cmd("play a video by john macarthur"); const r = await cmd("wrong channel"); const m = last("media");
    rec("“wrong channel” after a creator: another channel, and it's remembered", m?.channel !== "Grace to You" && (JSON.parse(readFileSync(process.env.DAYSPRING_VIDEO_CREATORS, "utf8")).rejected?.johnmacarthur ?? []).length === 1, `${r?.reply} | ${m?.channel}`); }

  // ------------------------------------------------------------------------------------------------ 3. finding and ranking
  section("3. finding, ranking, choosing");
  reset();
  { const r = await cmd("play how to cut dovetails by hand on youtube"); rec("a clear title plays straight away", last("media")?.title === "How to Cut Dovetails by Hand" && !r.listen, r?.reply); }
  { events.length = 0; const r = await cmd("play the video amazing grace"); const g = last("vbrowse");
    rec("an unclear title: the top 3 are offered (said and on screen), nothing plays yet", r?.listen && /not sure/i.test(r.reply) && g?.ask && g.items.length === 3 && !last("media"), r?.reply);
    const pick = g?.items?.[1];
    const r2 = await cmd("number 2");
    rec("“number 2” plays the second one", last("media")?.videoId === pick?.videoId, `${r2?.reply}`);
    const keptKey = R.keyOf({ kind: "title", creator: "", query: "amazing grace" });
    rec("…and the choice is remembered", JSON.parse(readFileSync(process.env.DAYSPRING_VIDEO_PREFS, "utf8")).requests[keptKey]?.kept?.id === pick?.videoId);
    events.length = 0; video._reset();
    await cmd("play the video amazing grace");
    rec("next time the same words play the one he chose, without asking", last("media")?.videoId === pick?.videoId && !last("vbrowse"), last("media")?.title); }
  { reset(); await cmd("play a video about surfing"); const first = last("media"); playing(first);
    const r = await cmd("not that"); const second = last("media");
    rec("“not that” plays the next best", second?.videoId && second.videoId !== first?.videoId, r?.reply);
    video._reset(); events.length = 0; await cmd("play a video about surfing");
    rec("…and the turned-down one isn't picked again for the same words", last("media")?.videoId !== first?.videoId, last("media")?.title); }
  { reset(); await cmd("play a video about biking under 10 minutes"); const m = last("media"); const it = mockSearch("biking").find((x) => x.videoId === m?.videoId);
    rec("“under 10 minutes” is respected", it && /^\d:\d\d$|^[0-9]:\d\d$/.test(it.length) && Number(it.length.split(":")[0]) < 10, `${m?.title} ${it?.length}`); }
  { reset(); await cmd("play a video about surfing longer than 20 minutes"); const m = last("media"); const it = mockSearch("surfing").find((x) => x.videoId === m?.videoId); rec("“longer than 20 minutes” is respected", it?.length === "26:00", `${m?.title} ${it?.length}`); }
  { reset(); await cmd("play a video about biking"); rec("Shorts aren't picked unless asked for", !/#shorts/i.test(last("media")?.title ?? "#shorts"), last("media")?.title);
    events.length = 0; await cmd("play a youtube short about biking"); rec("…and a Short when asked for one", /#shorts/i.test(last("media")?.title ?? ""), last("media")?.title); }
  { reset(); await cmd("play 3 videos about surfing"); rec("“play 3 videos about surfing”: one plays, two are queued after it", last("media")?.action === "play" && queue.get().upcoming.length === 2, j(queue.get().upcoming.map((x) => x.title))); }
  { reset(); playing({ title: "The Bible Project - Episode 4: Exodus", channel: "BibleProject" }); await cmd("play the next episode"); rec("“play the next episode” finds episode 5", /Episode 5/.test(last("media")?.title ?? ""), last("media")?.title); }
  { reset(); playing({ title: "How to Cut Dovetails by Hand", channel: "Paul Sellers", videoId: mockSearch("dovetails")[0].videoId }); await cmd("play more like this"); const m = last("media");
    rec("“more like this” plays a similar video, not the same one", /dovetail/i.test(m?.title ?? "") && m.title !== "How to Cut Dovetails by Hand", m?.title); }
  { reset(); media._setPolicy({ videosAllowed: false, reason: "It's FS study until 4:00." }); const r = await cmd("play a video about surfing");
    rec("during a study block videos are refused (the study rule)", /No videos right now/.test(r?.reply ?? "") && !last("media"), r?.reply); media._setPolicy({ videosAllowed: true }); }
  { reset(); const r = await cmd("play a video about xyzzy nothing matches"); rec("nothing found: said so", /couldn't find/i.test(r?.reply ?? ""), r?.reply); }
  // the ranking itself
  { const ranked = R.rank(mockSearch("mike winger"), { kind: "creator", query: "", filters: {} }, { channel: { name: "Mike Winger" } });
    rec("ranking: with a channel, videos from other channels fall to the bottom", ranked[0].channel === "Mike Winger" && ranked.at(-1).channel !== "Mike Winger", j(ranked.map((x) => x.channel))); }

  // ------------------------------------------------------------------------------------------------ 4. the grid
  section("4. the grid: browse, pick, queue, filters");
  reset();
  { const r = await cmd("pull up videos about biking"); const g = last("vbrowse");
    rec("“pull up videos about biking”: a grid of 12 with thumbnails, titles, channels, lengths", g?.open && g.items.length === 12 && g.items.every((x) => x.thumb && x.title && x.channel && x.length) && /12 videos/.test(r.reply), r?.reply);
    rec("…no Shorts in it", g.items.every((x) => !/#shorts/i.test(x.title)));
    const r2 = await cmd("more"); const g2 = last("vbrowse"); rec("“more” shows up to 24", g2.items.length === 24, r2?.reply);
    const r3 = await cmd("queue number 2 and 4");
    const q = queue.get();
    rec("“queue number 2 and 4” adds both (nothing was playing, so number 2 starts)", q.total === 2 && q.items[0].videoId === g2.items[1].videoId && q.items[1].videoId === g2.items[3].videoId && last("media")?.videoId === g2.items[1].videoId, r3?.reply);
    playing(g2.items[1]);
    const r4 = await cmd("number 3"); rec("“number 3” plays number 3 from the grid", last("media")?.videoId === g2.items[2].videoId && !last("vbrowse").open, r4?.reply); }
  { reset(); await cmd("pull up videos about surfing"); const before = last("vbrowse").items.map((x) => x.videoId);
    await cmd("newest first"); const g = last("vbrowse"); rec("“newest first” re-sorts", g.filters.newest && j(g.items.map((x) => x.videoId)) !== j(before), j(g.filters));
    await cmd("only longer than 20 minutes"); const g2 = last("vbrowse"); rec("“only longer than 20 minutes” filters", g2.items.length > 0 && g2.items.every((x) => /^2\d:|^\d:\d\d:\d\d/.test(x.length)), j(g2.items.map((x) => x.length)));
    await cmd("most viewed"); const g3 = last("vbrowse"); rec("“most viewed” sorts by views", g3.filters.popular, j(g3.filters));
    await cmd("show all"); rec("“show all” clears the filters", j(last("vbrowse").filters) === "{}"); }
  { reset(); const r = await cmd("show me videos by mike winger"); const g = last("vbrowse");
    rec("“show me videos by mike winger”: only his channel's videos", g?.items.length >= 3 && g.items.every((x) => x.channel === "Mike Winger"), r?.reply); }
  { reset(); await cmd("pull up videos about biking"); await cmd("close the videos"); rec("“close the videos” closes it", last("vbrowse")?.open === false); }
  { reset(); await cmd("pull up videos about biking"); const g = last("vbrowse"); const r = await video.gridAction({ action: "queue", n: 5 });
    rec("＋ Queue on a card (the screen's button) queues that one", queue.get().items.some((x) => x.videoId === g.items[4].videoId), r?.reply); }

  // ------------------------------------------------------------------------------------------------ 5. his playlists
  section("5. his YouTube playlists");
  reset();
  const fakeBrowser = { calls: [], async youtubeMyPlaylists() { this.calls.push("list"); return PLAYLISTS.filter((p) => !["LL", "WL"].includes(p.playlistId)).map((p) => ({ playlistId: p.playlistId, title: p.title })); },
    async youtubePlaylistPage(id) { this.calls.push("page:" + id); return playlistData(id); } };
  account._setDeps({ auth: async () => null, browser: async () => fakeBrowser });
  { const r = await cmd("list my youtube playlists"); const g = last("vbrowse");
    rec("“list my youtube playlists” names them, plus Liked and Watch later (the signed-in browser)", /4 YouTube playlists: Worship Songs, Workout Mix, Woodworking and Sunday Sermons, plus Liked videos and Watch later/.test(r?.reply ?? "") && fakeBrowser.calls.includes("list"), r?.reply);
    rec("…and shows them on the screen to pick from", g?.kind === "playlists" && g.items.some((x) => x.title === "Liked videos") && g.items.some((x) => x.title === "Watch later"), j(g?.items?.map((x) => x.title))); }
  { events.length = 0; const r = await cmd("play my worship playlist"); const q = queue.get();
    rec("“play my worship playlist” (fuzzy: Worship Songs) fills the queue with its videos and plays the first", q.source?.name === "Worship Songs" && q.total === 5 && last("media")?.videoId === q.items[0].videoId, r?.reply); }
  { events.length = 0; const r = await cmd("shuffle my workout playlist"); const q = queue.get();
    rec("“shuffle my workout playlist” plays it shuffled", q.shuffle && q.source?.name === "Workout Mix" && q.total === 4, r?.reply); }
  { events.length = 0; const r = await cmd("play my liked videos"); rec("“play my liked videos” reads Liked videos in the signed-in browser", fakeBrowser.calls.includes("page:LL") && queue.get().total === 3, r?.reply); }
  { events.length = 0; const r = await cmd("play my watch later"); rec("“play my watch later” too", fakeBrowser.calls.includes("page:WL") && queue.get().source?.name === "Watch later", r?.reply); }
  { playing(queue.get().current); const before = queue.get().total; const r = await cmd("queue my woodworking playlist after this"); const q = queue.get();
    rec("“queue my woodworking playlist after this” puts its videos right after the one playing", q.total === before + 4 && /dovetail/i.test(q.items[q.index + 1].title), r?.reply); }
  { const r = await cmd("what's in my sunday sermons playlist"); const g = last("vbrowse");
    rec("“what's in my sunday sermons playlist” shows every video in it", g?.kind === "playlistItems" && g.items.length === 3 && /3 videos/.test(r?.reply ?? ""), r?.reply);
    const r2 = await cmd("number 2"); rec("…and “number 2” starts it there", queue.get().source?.name === "Sunday Sermons" && queue.get().index === 1, r2?.reply); }
  { rec("the list is kept for next time (no media window every time)", JSON.parse(readFileSync(process.env.DAYSPRING_VIDEO_ACCOUNT, "utf8")).playlists.length === 6); }
  // the Data API, when a Google account has the YouTube scope
  account._setDeps({ auth: async () => ({ fetcher: (url) => fetch(url, { headers: { authorization: "Bearer qa-token" } }) }), browser: async () => { throw new Error("the browser must not be used with the Data API"); } });
  rmSync(process.env.DAYSPRING_VIDEO_ACCOUNT, { force: true }); account.reload();
  { const r = await cmd("list my youtube playlists");
    rec("with the Data API: his playlists come from it (no media window)", /Worship \(from the API\)/.test(r?.reply ?? "") && /Road Trip Videos/.test(r.reply) && mock.calls.some((c) => /\/youtube\/v3\/playlists\?/.test(c)), r?.reply); }
  { events.length = 0; const r = await cmd("play my road trip playlist"); const q = queue.get();
    rec("…and its videos too, with their lengths (deleted videos left out)", q.source?.name === "Road Trip Videos" && q.total === 4 && q.items.every((x) => x.secs > 0) && !q.items.some((x) => x.videoId === "deletedxxxx"), r?.reply); }
  { events.length = 0; const r = await cmd("play my liked videos"); rec("…Liked videos through the API's own id", mock.calls.some((c) => /playlistId=LLapiLiked/.test(c)) && queue.get().total === 3, r?.reply); }
  { const noAuth = await fetch(`${mock.url}/youtube/v3/playlists?mine=true`); rec("the mock Data API refuses a request without the token (so the test proves the token went)", noAuth.status === 401); }
  account._setDeps({ auth: async () => null, browser: async () => fakeBrowser });

  // ------------------------------------------------------------------------------------------------ 6. the queue
  section("6. the queue");
  reset();
  { const r = await cmd("queue how to cut dovetails"); rec("“queue X” with nothing playing: it plays", last("media")?.title === "How to Cut Dovetails by Hand" && queue.get().total === 1, r?.reply); playing(queue.get().current); }
  { const r = await cmd("add half-blind dovetails explained to the queue"); rec("“add X to the queue” adds it at the end", queue.get().items.at(-1).title === "Half-Blind Dovetails Explained", r?.reply); }
  { const r = await cmd("queue 3 videos about surfing"); rec("“queue 3 videos about surfing” adds three", queue.get().total === 5 && queue.get().items.slice(2).every((x) => /surf/i.test(x.title)), r?.reply); }
  { const r = await cmd("play hand cut dovetails for beginners next"); rec("“play X next” goes right after the one playing", queue.get().items[queue.get().index + 1].title === "Hand Cut Dovetails for Beginners", r?.reply); }
  { const r = await cmd("add this to my queue"); rec("“add this to my queue” adds what's playing", queue.get().items.at(-1).title === "How to Cut Dovetails by Hand" && queue.get().total === 7, r?.reply); }
  { const r = await cmd("show the queue"); const e = last("vqueue");
    rec("“show the queue” opens the queue on the screen and says what's in it", e?.open === true && e.queue.total === 7 && /7 videos in the queue/.test(r?.reply ?? ""), r?.reply);
    rec("every item has a title, channel, length and thumbnail id, and the one playing is marked", e.queue.items.every((x) => x.title && x.videoId && "channel" in x && "length" in x) && e.queue.items.filter((x) => x.current).length === 1); }
  { const r = await cmd("play number 5"); rec("“play number 5” (queue on screen) jumps there", queue.get().index === 4 && last("media")?.videoId === queue.get().items[4].videoId, r?.reply); playing(queue.get().current); }
  { const t3 = queue.get().items[2].title; const r = await cmd("remove number 3"); rec("“remove number 3”", queue.get().total === 6 && !queue.get().items.some((x, i) => i === 2 && x.title === t3 && false) && queue.get().index === 3, r?.reply); }
  { const t4 = queue.get().items[3].title; const r = await cmd("move number 4 up"); rec("“move number 4 up”", queue.get().items[2].title === t4 && queue.get().index === 2, r?.reply); }
  { const t6 = queue.get().items[5].title; const r = await cmd("move number 6 to the top"); rec("“move number 6 to the top”", queue.get().items[0].title === t6, r?.reply); }
  { const before = j(queue.get().items.map((x) => x.id)); queue.reload(); const after = queue.get();
    rec("the queue survives a restart (read back from data/video-queue.json)", j(after.items.map((x) => x.id)) === before && after.index === 3 && existsSync(process.env.DAYSPRING_VIDEO_QUEUE), `${after.total} items, index ${after.index}`); }
  { const r = await cmd("what's up next"); rec("“what's up next”", new RegExp(queue.get().items[4].title.slice(0, 20).replace(/[()]/g, ".")).test(r?.reply ?? ""), r?.reply); }
  { events.length = 0; const r = video.advance("ended"); rec("autoplay: when a queued video ends, the next one plays", r.n === 5 && last("media")?.videoId === queue.get().items[4].videoId); }
  { await cmd("repeat this one"); rec("“repeat this one”: repeat one", queue.get().repeat === "one" && last("player")?.action === "queueMode"); events.length = 0; const r = video.advance("ended"); rec("…the same video starts over at its end", r.again && last("player")?.action === "restart"); }
  { await cmd("repeat the queue"); queue.jump(queue.get().total); events.length = 0; const r = video.advance("ended"); rec("“repeat the queue”: at the end it starts over", r.n === 1 && last("media")?.videoId === queue.get().items[0].videoId); }
  { await cmd("repeat off"); const n = queue.get().total; queue.jump(n); const r = video.advance("ended"); rec("repeat off: at the end it stops", r.ended === true); }
  { const order = j(queue.get().items.slice(1).map((x) => x.id)); await cmd("shuffle the queue"); const sh = queue.get();
    rec("“shuffle the queue” mixes what's up next (the one playing stays)", sh.shuffle && j(sh.items.slice(sh.index + 1).map((x) => x.id)) !== order || sh.items.length < 4); await cmd("unshuffle"); rec("“unshuffle” puts it back in order", !queue.get().shuffle); }
  { events.length = 0; const r = await cmd("skip"); rec("“skip” goes to the screen's player (a video from the queue asks the queue there)", last("player")?.action === "next" && r?.reply === "Next.", r?.reply); }
  { const cur = queue.get().current; const r = await cmd("clear the queue"); rec("“clear the queue” keeps only what's playing", queue.get().total === 1 && queue.get().current?.id === cur?.id, r?.reply); }
  { const r = await cmd("add this to my queue"); rec("(and it can be added to again)", queue.get().total === 2, r?.reply); }

  // ------------------------------------------------------------------------------------------------ 7. playback controls by voice
  section("7. playback controls (no AI)");
  const CT = [
    ["pause", "pause"], ["pause the video", "pause"], ["resume", "resume"], ["play", "resume"], ["keep playing", "resume"], ["stop", "stop"], ["stop the video", "stop"],
    ["restart", "restart"], ["go back to the beginning", "restart"], ["start it over", "restart"], ["from the top", "restart"],
    ["rewind 30 seconds", "seekBy", -30], ["go back 10 seconds", "seekBy", -10], ["rewind", "seekBy", -10], ["skip ahead 2 minutes", "seekBy", 120], ["fast forward 90 seconds", "seekBy", 90], ["fast forward", "seekBy", 30],
    ["skip forward 1 minute", "seekBy", 60], ["jump to 5:30", "seek", 330], ["go to 2 minutes 15", "seek", 135], ["go to the middle", "seekPct", 50], ["jump halfway", "seekPct", 50],
    ["double speed", "speed", 2], ["1.5x", "speed", 1.5], ["play at 1.25 speed", "speed", 1.25], ["half speed", "speed", 0.5], ["slow down", "speedBy", -1], ["speed it up", "speedBy", 1], ["normal speed", "speed", 1],
    ["volume up", "volumeBy", 15], ["turn it down", "volumeBy", -15], ["mute", "mute"], ["unmute", "unmute"], ["volume 40", "volume", 40], ["set the video volume to 25 percent", "volume", 25],
    ["captions on", "captions", true], ["turn on subtitles", "captions", true], ["captions off", "captions", false], ["captions in spanish", "captionLang", "es"], ["turn on french subtitles", "captionLang", "fr"],
    ["highest quality", "quality", "highest"], ["720p", "quality", "720p"], ["set the quality to 1080p", "quality", "1080p"], ["auto quality", "quality", "auto"],
    ["fullscreen", "view", "full"], ["exit fullscreen", "view", "exitFull"], ["minimize the player", "view", "audio"], ["bring the video back", "view", "big"], ["picture in picture", "view", "corner"],
    ["next", "next"], ["next video", "next"], ["previous", "previous"], ["previous video", "previous"], ["repeat this one", "repeat", "track"], ["repeat all", "repeat", "context"], ["repeat off", "repeat", "off"], ["shuffle", "shuffle", true], ["shuffle off", "shuffle", false],
  ];
  for (const [w, a, v] of CT) { const r = controls.parse(w, { playing: true }); rec(`control “${w}” → ${a}${v !== undefined ? " " + v : ""}`, r?.action === a && (v === undefined || r.value === v), j(r)); }
  rec("“what's playing” is a question", controls.parse("what's playing")?.ask === "now");
  rec("“how long is left” is a question", controls.parse("how long is left")?.ask === "left" && controls.parse("how much time is left in this video")?.ask === "left");
  rec("“turn up your voice” is Dayspring's own voice, not the video", controls.parse("turn up your voice", { playing: true }) === null);
  rec("“volume 40” with nothing playing isn't taken", controls.parse("volume 40", { playing: false }) === null);
  // through the no-AI entry point: the screen gets the command (a pretend screen is connected)
  reset(); media.setState({ source: "youtube", title: "Hope for Hard Times", artist: "Grace to You", playing: true, position: 100, duration: 2460, rate: 1, videoId: "x".repeat(11) });
  for (const [w, a, v] of [["skip ahead 2 minutes", "seekBy", 120], ["captions in spanish", "captionLang", "es"], ["1.5x", "speed", 1.5], ["volume 40", "volume", 40], ["go to the middle", "seekPct", 50], ["minimize the player", "view", "audio"], ["720p", "quality", "720p"]]) {
    events.length = 0; const r = await cmd(w); const p = last("player");
    rec(`“${w}” reaches the screen's player as ${a}`, p?.action === a && (v === undefined || p.value === v) && Boolean(r?.reply), `${j(p)} ${r?.reply}`);
  }
  { const r = await cmd("what's playing"); rec("“what's playing”", /Hope for Hard Times, from Grace to You/.test(r?.reply ?? ""), r?.reply); }
  { const r = await cmd("how long is left"); rec("“how long is left”", /About 39 minutes left, of 41 minutes/.test(r?.reply ?? ""), r?.reply); }
  { media.setState({ source: "spotify", title: "Gratitude", artist: "Hollow Pines", playing: true, position: 10, duration: 200 }); events.length = 0; await cmd("pause"); rec("Spotify: “pause” reaches the screen's player too", last("player")?.action === "pause");
    const r = await cmd("how long is left"); rec("Spotify: “how long is left”", /About 3 minutes 10 seconds left, of 3 minutes 20 seconds/.test(r?.reply ?? ""), r?.reply); }
  { media.setState({ source: "file", title: "Sarah's wedding", artist: "Videos", playing: true, position: 5, duration: 90, video: true }); events.length = 0; await cmd("rewind 30 seconds"); rec("his own video: “rewind 30 seconds” reaches the screen's player", last("player")?.action === "seekBy" && last("player").value === -30); }
  media.setState(null);
  { const r = await cmd("pause"); rec("with nothing playing, “pause” is left for the rest of Dayspring", r === null, j(r)); }

  // ------------------------------------------------------------------------------------------------ the AI's tools
  section("the AI's tools");
  { const names = video.TOOLS.map((t) => t.name); rec("four tools with unique names", new Set(names).size === 4 && names.every((n) => /^(video_|youtube_)/.test(n)), j(names)); }
  reset();
  { const r = await video.runTool("video_find", { action: "play", creator: "david wood" }); rec("video_find creator → the channel's own video", last("media")?.channel === "Acts17Apologetics" && !/react/i.test(last("media")?.title ?? ""), r?.reply); }
  { const r = await video.runTool("video_find", { action: "browse", query: "surfing", newest: true }); rec("video_find browse → the grid", last("vbrowse")?.items.length >= 12 && last("vbrowse").filters.newest, r?.reply); }
  { const r = await video.runTool("video_find", { action: "queue", numbers: [1, 2] }); rec("video_find queue numbers → queued", queue.get().total >= 2, r?.reply); }
  { const r = await video.runTool("video_queue", { action: "show" }); rec("video_queue show", last("vqueue")?.open === true, r?.reply); }
  { const r = await video.runTool("youtube_account_playlists", { action: "list" }); rec("youtube_account_playlists list", /Worship Songs/.test(r?.reply ?? ""), r?.reply); }
  { const r = await video.runTool("video_creator_alias", { action: "list" }); rec("video_creator_alias list", r.people.some((p) => p.channels[0] === "Acts17Apologetics") && r.people.some((p) => p.name === "John MacArthur" && p.channels[0] === "Grace to You")); }

  // ------------------------------------------------------------------------------------------------ the parsers against real-shaped pages
  section("reading YouTube's pages");
  { const ch = await yt.channels("mike winger"); rec("channel search page: names, handles, verified, subscribers", ch.some((c) => c.name === "Mike Winger" && c.handle === "@MikeWinger" && c.verified && c.subscribers === 610000), j(ch)); }
  { const v = await yt.channelVideos({ handle: "@MikeWinger" }); rec("a channel page in the newer layout (lockups): titles, lengths, views", v.videos.length === 3 && v.videos[0].secs === 4200 && v.videos[0].viewCount === 450000 && v.channel.name === "Mike Winger", j(v.videos[0])); }
  { const v = await yt.channelVideos({ channelId: "UCgtyNowGraceToYou00002" }); rec("a channel page by id (videoRenderer)", v.videos.length === 6 && v.channel.handle === "@gracetoyou"); }
  { const p = await yt.playlist("PLworshipSongs0000000001"); rec("a playlist page", p.title === "Worship Songs" && p.items.length === 5 && p.items.filter((x) => x.secs > 0).length >= 4, j(p.items.map((x) => x.secs))); }
} catch (e) { rec("module tests ran to the end", false, e.stack); }

// ------------------------------------------------------------------------------------------------ 8. on the screen
if (!NO_BROWSER) await screenTests().catch((e) => rec("screen tests ran to the end", false, e.stack));

async function screenTests() {
  section("8. on the screen: every player, the buttons, the keys, the panels");
  const PW = [join(DESK, "node_modules", "playwright-core", "index.mjs"), join(DESK, "..", "..", "..", "dayspring-app", "node_modules", "playwright-core", "index.mjs")].find((p) => existsSync(p));
  const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
  if (!PW || !existsSync(CHROME)) { rec("headless Chrome and playwright-core are here", false, PW ?? "no playwright-core"); return; }
  const { chromium } = await import(pathToFileURL(PW).href);
  // a throwaway Dayspring (the export, its own empty data), pointed at the pretend YouTube
  const APP = join(TMP, "app"), PORT = await qaPort(4776), BASE = `http://127.0.0.1:${PORT}`;
  const ex = spawnSync(process.execPath, [join(DESK, "scripts", "export.mjs"), APP], { encoding: "utf8" });
  if (ex.status !== 0) { rec("the throwaway copy exported", false, (ex.stdout + ex.stderr).slice(-400)); return; }
  spawnSync("cmd.exe", ["/d", "/c", "mklink", "/J", join(APP, "node_modules"), join(DESK, "node_modules")], { windowsHide: true });
  mkdirSync(join(APP, "data"), { recursive: true });
  writeFileSync(join(APP, "data", "owner.json"), JSON.stringify({ name: "Tester", setupDone: true, display: "primary" }));
  // a short local video (Dayspring's own ffmpeg) with a subtitle file, for his-own-files playback
  const ff = (await import(pathToFileURL(join(DESK, "node_modules", "ffmpeg-static", "index.js")).href).catch(() => null))?.default;
  mkdirSync(join(APP, "public", "qa"), { recursive: true });
  const clip = join(APP, "public", "qa", "clip.webm");
  if (ff) spawnSync(ff, ["-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=15", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "20", "-c:v", "libvpx", "-b:v", "200k", "-c:a", "libopus", "-shortest", clip], { windowsHide: true });
  writeFileSync(join(APP, "public", "qa", "clip.vtt"), "WEBVTT\n\n00:00.000 --> 00:20.000\nHello from the captions\n");
  mock.files.set("/clip.webm", { path: clip, type: "video/webm" }); mock.files.set("/clip.vtt", { path: join(APP, "public", "qa", "clip.vtt"), type: "text/vtt" });
  mock.files.set("/window.html", { body: `<!doctype html><video id="v" src="/clip.webm" preload="auto"><track kind="subtitles" srclang="en" src="/clip.vtt" default><track kind="subtitles" srclang="es" src="/clip.vtt"></video>`, type: "text/html" });
  rec("a short local test video was made", existsSync(clip));
  const env = { ...process.env, PORT: String(PORT), DAYSPRING_DISPLAY: "", DAYSPRING_TV: "", DAYSPRING_NO_BROWSER: "1", DAYSPRING_DEVICES_DRYRUN: "1", DAYSPRING_NO_OVERLAY: "1", DAYSPRING_NO_ECO: "1", DS_PROFILE: "DayspringQA", DAYSPRING_CHANNEL: "stable",
    DAYSPRING_YT_BASE: mock.url, DAYSPRING_NO_HEADLESS_SEARCH: "1", DS_NO_SINK_FOLLOW: "1", DAYSPRING_NO_MEDIA_BROWSER: "1" };
  for (const k of ["DAYSPRING_VIDEO_QUEUE", "DAYSPRING_VIDEO_PREFS", "DAYSPRING_VIDEO_CREATORS", "DAYSPRING_VIDEO_ACCOUNT", "DAYSPRING_MEDIA_FILE", "DAYSPRING_VIDEOLISTS_FILE", "DAYSPRING_FEATURE_SWITCHES", "DAYSPRING_FEATURE_STAGES", "DAYSPRING_SETTINGS_FILE", "DAYSPRING_INTENT_LEARNED", "DAYSPRING_INTENT_MISSES", "DAYSPRING_TIMERS_FILE", "DAYSPRING_RECIPES_FILE", "DAYSPRING_LISTS_FILE", "DAYSPRING_SPOTIFY_TOKEN_FILE"]) delete env[k];
  const server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let log = ""; server.stdout.on("data", (d) => (log += d)); server.stderr.on("data", (d) => (log += d));
  let browser = null;
  try {
    let up = false;
    for (let i = 0; i < 120 && !up; i++) { up = await fetch(`${BASE}/api/build`, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok).catch(() => false); if (!up) await sleep(500); }
    rec("the throwaway Dayspring is up", up, log.slice(-300));
    if (!up) return;
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required"] });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.addInitScript(() => {
      window.__dsAllowAutomatedListen = true;
      const ss = window.speechSynthesis; if (ss) { ss.speak = (u) => setTimeout(() => u.onend?.(), 5); ss.cancel = () => {}; }
      class FakeSR { start() {} abort() { setTimeout(() => this.onend?.(), 5); } stop() { this.abort(); } }
      window.SpeechRecognition = window.webkitSpeechRecognition = FakeSR;
    });
    // the YouTube player API → the mock; thumbnails → nothing; no device, window or network side effects
    await ctx.route("**/*", (rt) => {
      const u = rt.request().url();
      if (/youtube\.com\/iframe_api/.test(u)) return rt.fulfill({ status: 200, contentType: "text/javascript", body: IFRAME_API });
      if (/i\.ytimg\.com|sdk\.scdn\.co|googlevideo|youtube\.com/.test(u)) return rt.fulfill({ status: 204, body: "" });
      if (rt.request().method() === "POST" && /\/api\/(sound|window|devices\/use|voicemeeter|keepawake|tunein|callbridge|open|app\/quit|update|media\/popout)/.test(u)) return rt.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
      if (/^https?:\/\/(?!127\.0\.0\.1)/.test(u)) return rt.fulfill({ status: 204, body: "" });
      return rt.continue();
    });
    const page = await ctx.newPage();
    const errs = []; page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 200)));
    await page.goto(`${BASE}/display`); await sleep(2200);
    if (await page.locator("#startBtn").isVisible().catch(() => false)) { await page.click("#startBtn"); await sleep(500); }
    const chat = (message) => fetch(`${BASE}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, surface: "desk" }) }).then((r) => r.json());
    const ytm = () => page.evaluate(() => { const m = window.__ytMock; if (!m) return null; m._tick?.(); return { id: m.id, t: Math.round(m.t), rate: m.rate, vol: m.vol, state: m.state, quality: m.quality, captions: m.captions, modules: [...m.modules], calls: m.calls.slice(-6) }; });
    const P = () => page.evaluate(() => { const p = window.dayspring.player; const box = document.getElementById("media"); return { source: p.source, playing: p.playing, rate: p.rate, repeat: p.repeat, shuffle: p.shuffle, video: p.video, captions: Boolean(p.captions), mini: box.classList.contains("minip"), full: box.classList.contains("full"), hidden: box.hidden }; });
    const until = async (fn, ms = 4000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn().catch(() => null); if (v) return v; await sleep(80); } return v; };
    rec("the screen is ready (the mocked YouTube player API loaded, the video panels there)", Boolean(await until(() => page.evaluate(() => Boolean(window.YT && window.dayspring && window.dsEvents && window.dsVQueue)), 8000)));

    // --- YouTube on the screen (the mocked iframe player) ---------------------------------------------------------------
    let r = await chat("find bible reading in psalms on youtube");
    const started = await until(async () => { const y = await ytm(); return y?.state === 1 && y; });
    rec("YouTube: “find bible reading in psalms on youtube” plays in the screen's player", Boolean(started) && /psalm/i.test(r.reply ?? ""), `${r.reply} ${j(started)}`);
    if (!started) { console.log("DEBUG", j(await page.evaluate(() => ({ YT: Boolean(window.YT), mock: Boolean(window.__ytMock), P: window.dayspring?.player, media: document.getElementById("media")?.className, speaker: window.dsIsSpeaker, vs: window.dsFeatures?.on?.("videosearch") }))), errs.slice(0, 5)); }
    const PH = [
      ["pause", async () => (await P()).playing === false && (await ytm()).state === 2],
      ["resume", async () => (await ytm()).state === 1],
      ["skip ahead 2 minutes", async () => (await ytm()).t >= 120],
      ["rewind 30 seconds", async () => { const y = await ytm(); return y.t >= 85 && y.t < 120; }],
      ["jump to 5:30", async () => Math.abs((await ytm()).t - 330) <= 2],
      ["go to the middle", async () => Math.abs((await ytm()).t - 300) <= 2],
      ["go back to the beginning", async () => (await ytm()).t <= 2],
      ["fast forward", async () => (await ytm()).t >= 29],
      ["double speed", async () => (await ytm()).rate === 2],
      ["1.5x", async () => (await ytm()).rate === 1.5],
      ["slow down", async () => (await ytm()).rate === 1.25],
      ["normal speed", async () => (await ytm()).rate === 1],
      ["volume 40", async () => (await ytm()).vol === Math.round(85 * 40 / 100)],
      ["volume up", async () => (await ytm()).vol === Math.round(85 * 55 / 100)],
      ["mute", async () => (await ytm()).vol === 0],
      ["unmute", async () => (await ytm()).vol > 0],
      ["captions on", async () => (await ytm()).modules.includes("captions") && (await P()).captions],
      ["captions in spanish", async () => (await ytm()).captions?.languageCode === "es"],
      ["captions off", async () => !(await ytm()).modules.includes("captions") && !(await P()).captions],
      ["720p", async () => (await ytm()).quality === "hd720"],
      ["highest quality", async () => (await ytm()).quality === "hd1080"],
      ["fullscreen", async () => (await P()).full],
      ["exit fullscreen", async () => !(await P()).full],
      ["minimize the player", async () => (await P()).video === false],          // (minimise: audio only, the owner's word for it)
      ["bring the video back", async () => (await P()).video && !(await P()).mini],
      ["picture in picture", async () => (await P()).mini],
      ["make it big", async () => !(await P()).mini && (await P()).video],
      ["repeat this one", async () => (await P()).repeat === "track"],
      ["repeat off", async () => (await P()).repeat === "off"],
    ];
    for (const [w, ok] of PH) { const rr = await chat(w); const good = await until(ok, 3000); rec(`YouTube: “${w}”`, Boolean(good), `${rr.reply} ${j(await ytm())} ${j(await P())}`); }
    { const rr = await chat("what's playing"); rec("YouTube: “what's playing”", /This is .*psalm/i.test(rr.reply ?? "") || /This is Mock video/.test(rr.reply ?? ""), rr.reply); }
    { const rr = await chat("how long is left"); rec("YouTube: “how long is left”", /left, of 10 minutes/.test(rr.reply ?? ""), rr.reply); }
    // the queue on the screen: next / previous / autoplay
    await chat("queue how to cut dovetails"); await chat("queue hand cut dovetails for beginners");
    { const before = (await ytm()).id; await chat("next"); const now = await until(async () => { const y = await ytm(); return y.id !== before && y; });
      rec("YouTube: “next” plays the queue's next video", now && /\w{11}/.test(now.id), j(now));
      const cur = now?.id; await page.evaluate(() => window.__ytMock._end()); const auto = await until(async () => { const y = await ytm(); return y.id !== cur && y.state === 1 && y; });
      rec("YouTube: autoplay: at the end of a queued video the next one starts", Boolean(auto), j(auto));
      const wasId = auto?.id; await chat("previous"); const back = await until(async () => { const y = await ytm(); return y.id !== wasId && y; });
      rec("YouTube: “previous” goes back in the queue", back?.id === cur, `${back?.id} ${cur}`); }
    { await chat("shuffle"); rec("YouTube: “shuffle” (the queue)", await until(async () => (await P()).shuffle)); await chat("shuffle off"); }
    // the video's own buttons and keys
    const btn = (sel) => page.evaluate((s) => { document.getElementById("media").classList.add("showctl"); document.querySelector(s)?.click(); }, sel);
    await btn("#vPlay"); rec("button: ⏯ pauses", await until(async () => (await ytm()).state === 2));
    await btn("#vPlay"); rec("button: ⏯ plays", await until(async () => (await ytm()).state === 1));
    { const t0 = (await ytm()).t; await btn('[data-p="fwd10"]'); rec("button: +10 s", await until(async () => (await ytm()).t >= t0 + 9)); }
    await btn("#vCC"); rec("button: CC turns captions on", await until(async () => (await P()).captions));
    await btn("#vCC"); rec("button: CC turns them off", await until(async () => !(await P()).captions));
    await page.selectOption("#vQual", "480p").catch(() => {}); rec("the quality menu", await until(async () => (await ytm()).quality === "large"));
    await page.selectOption("#vRate", "0.75").catch(() => {}); rec("the speed menu", await until(async () => (await ytm()).rate === 0.75));
    await btn("#vRep"); rec("button: repeat", await until(async () => (await P()).repeat !== "off"));
    await btn("#vMin"); rec("button: minimize", await until(async () => (await P()).mini));
    await btn("#vMin"); rec("button: back to big", await until(async () => !(await P()).mini));
    await btn("#vFull"); rec("button: full screen", await until(async () => (await P()).full));
    await btn("#vFull");
    await btn("#vQueueBtn"); rec("button: ☰ opens the queue panel", await until(() => page.evaluate(() => Boolean(document.querySelector("#dsVQueue li")))));
    { const q = await page.evaluate(() => [...document.querySelectorAll("#dsVQueue li")].map((li) => ({ cur: li.classList.contains("cur"), img: Boolean(li.querySelector(".im")?.style.backgroundImage), t: li.querySelector("b")?.textContent, sub: li.querySelector(".sub")?.textContent })));
      rec("the queue panel: every video with its picture, title, channel and length, the one playing marked", q.length >= 3 && q.filter((x) => x.cur).length === 1 && q.every((x) => x.img && x.t && x.sub), j(q.slice(0, 2)));
      const n0 = q.length; await page.click("#dsVQueue li:last-child [data-del]"); rec("queue panel: ✕ removes", await until(async () => (await page.evaluate(() => document.querySelectorAll("#dsVQueue li").length)) === n0 - 1));
      const t1 = await page.evaluate(() => document.querySelector("#dsVQueue li:nth-child(2) b").textContent); await page.click("#dsVQueue li:nth-child(2) [data-up]");
      rec("queue panel: ▲ moves up", await until(async () => (await page.evaluate(() => document.querySelector("#dsVQueue li:nth-child(1) b").textContent)) === t1));
      const lastId = await page.evaluate(() => document.querySelector("#dsVQueue li:last-child").dataset.n); await page.click(`#dsVQueue li[data-n="${lastId}"] b`);
      rec("queue panel: click jumps there", await until(async () => (await page.evaluate(() => document.querySelector("#dsVQueue li.cur")?.dataset.n)) === lastId)); }
    await page.keyboard.press("Escape"); rec("Esc closes the queue panel", await until(() => page.evaluate(() => !document.querySelector("#dsVQueue"))));
    // keys
    await page.evaluate(() => document.activeElement?.blur?.());
    const key = async (k, ok, name) => { await page.keyboard.press(k); rec(`key ${name ?? k}`, Boolean(await until(ok, 2500))); };
    await key("k", async () => (await ytm()).state === 2, "K (pause)"); await key("Space", async () => (await ytm()).state === 1, "Space (play)");
    await key("5", async () => Math.abs((await ytm()).t - 300) <= 3, "5 (50%)");
    await key("j", async () => (await ytm()).t <= 292, "J (−10 s)"); await key("l", async () => (await ytm()).t >= 298, "L (+10 s)");
    await key("Home", async () => (await ytm()).t <= 2);
    await key("c", async () => (await P()).captions, "C (captions)"); await key("c", async () => !(await P()).captions, "C again");
    await key("i", async () => (await P()).mini, "I (minimise)"); await key("i", async () => !(await P()).mini, "I again");
    await key("Shift+Period", async () => (await ytm()).rate > 1, "> (faster)"); await key("Shift+Comma", async () => (await ytm()).rate === 1, "< (slower)");
    await key("m", async () => (await ytm()).vol === 0, "M (mute)"); await key("m", async () => (await ytm()).vol > 0, "M again");
    await key("f", async () => (await P()).full, "F (full screen)"); await key("f", async () => !(await P()).full, "F again");
    await key("q", () => page.evaluate(() => Boolean(document.querySelector("#dsVQueue"))), "Q (the queue)"); await key("q", () => page.evaluate(() => !document.querySelector("#dsVQueue")), "Q again");
    // said on the screen itself (no server at all): the screen's own words
    { const said = await page.evaluate(() => { const out = {}; for (const t of ["how long is left", "captions in german", "go to the middle", "1080p", "minimize the video"]) out[t] = window.dayspring.musicCommand(t)?.say ?? null; return out; });
      rec("said to the screen: “how long is left”, captions, the middle, quality, minimise", /left, of 10 minutes/.test(said["how long is left"] ?? "") && said["captions in german"] === "Captions in German." && said["go to the middle"] === "Halfway through." && /1080p/.test(said["1080p"] ?? "") && said["minimize the video"] !== null, j(said));
      await chat("bring the video back"); }
    // the grid on the screen
    await chat("pull up videos about biking");
    { const g = await until(() => page.evaluate(() => { const el = document.getElementById("dsVideos"); return el && { cards: el.querySelectorAll(".dsv-card").length, add: el.querySelectorAll(".vq-add").length, nums: el.querySelectorAll(".dsv-card .n").length }; }));
      rec("the grid: 12 numbered cards, each with ＋ Queue", g?.cards === 12 && g.add === 12 && g.nums === 12, j(g));
      const S = await page.evaluate(() => { const s = window.dsSafeRect?.(); const b = document.getElementById("dsVideos").getBoundingClientRect(); return s && b.left >= s.left - 1 && b.top >= s.top - 1 && b.right <= s.right + 1 && b.bottom <= s.bottom + 1; });
      rec("the grid stays inside the screen's margins", S);
      const before = (await (await fetch(`${BASE}/api/video/queue`)).json()).queue.total;
      await page.click('#dsVideos .dsv-card:nth-child(3) .vq-add'); rec("＋ Queue on a card adds it", await until(async () => (await (await fetch(`${BASE}/api/video/queue`)).json()).queue.total === before + 1));
      await page.click('#dsVideos [data-f="newest"]'); rec("the Newest filter", await until(() => page.evaluate(() => document.querySelector('#dsVideos [data-f="newest"]')?.getAttribute("aria-pressed") === "true")));
      await page.click('#dsVideos [data-more]').catch(() => {}); rec("More shows more", await until(() => page.evaluate(() => document.querySelectorAll("#dsVideos .dsv-card").length > 12)));
      const id4 = await page.evaluate(() => /vi\/([\w-]{11})\//.exec(document.querySelector("#dsVideos .dsv-card:nth-child(4) .th").style.backgroundImage)?.[1]);
      await page.click("#dsVideos .dsv-card:nth-child(4) .th"); const on = await until(async () => { const y = await ytm(); return y?.id === id4 && y.id; });
      rec("clicking a card plays it", Boolean(id4) && on === id4, `${on} / ${id4}`); }
    // --- his own video (a local HTML5 video, public/medialib.js) ---------------------------------------------------------
    // (the file comes from the mock, which answers Range requests the way Dayspring's own stream route does, so it can seek)
    await page.evaluate((src) => { window.dsLocalPlayer.play({ queue: [{ id: "qa1", src, title: "QA clip", kind: "video", duration: 20 }, { id: "qa2", src, title: "QA clip 2", kind: "video", duration: 20 }], index: 0 }); }, `${mock.url}/clip.webm`);
    const lv = () => page.evaluate(() => { const e = document.getElementById("lv"); if (!e) return null; const box = document.getElementById("media"); return { t: Math.round(e.currentTime * 10) / 10, paused: e.paused, rate: e.playbackRate, cap: [...e.textTracks].filter((x) => x.mode === "showing").map((x) => x.language), full: box.classList.contains("full"), mini: box.classList.contains("minip"), audio: box.classList.contains("audio"), title: window.dayspring.player.title, dur: window.dayspring.player.dur }; });
    rec("his own video plays on the screen", Boolean(await until(async () => { const v = await lv(); return v && v.dur > 5 && v; }, 8000)), j(await lv()));
    await page.evaluate(() => { const e = document.getElementById("lv"); for (const [l, s] of [["en", "/qa/clip.vtt"], ["es", "/qa/clip.vtt"]]) { const t = document.createElement("track"); t.kind = "subtitles"; t.srclang = l; t.src = s; e.appendChild(t); } });
    await until(async () => (await P()).source === "file", 3000);
    const LOC = [
      ["pause", async () => (await lv()).paused], ["resume", async () => !(await lv()).paused],
      ["jump to 0:12", async () => Math.abs((await lv()).t - 12) < 1.5], ["rewind 5 seconds", async () => (await lv()).t < 10], ["go to the middle", async () => Math.abs((await lv()).t - 10) < 1.5],
      ["go back to the beginning", async () => (await lv()).t < 1.5], ["skip ahead 5 seconds", async () => (await lv()).t >= 4],
      ["double speed", async () => (await lv()).rate === 2], ["normal speed", async () => (await lv()).rate === 1], ["slow down", async () => (await lv()).rate === 0.75], ["normal speed", async () => (await lv()).rate === 1],
      ["captions on", async () => (await lv()).cap.length === 1], ["captions in spanish", async () => (await lv()).cap[0] === "es"], ["captions off", async () => (await lv()).cap.length === 0],
      ["minimize the player", async () => (await lv()).audio], ["bring the video back", async () => !(await lv()).audio && !(await lv()).mini], ["picture in picture", async () => (await lv()).mini], ["make it big", async () => !(await lv()).mini], ["exit fullscreen", async () => !(await lv()).full], ["fullscreen", async () => (await lv()).full],
      ["next", async () => (await lv())?.title === "QA clip 2"], ["previous", async () => (await lv())?.t < 2],
    ];
    for (const [w, ok] of LOC) { const rr = await chat(w); rec(`his own video: “${w}”`, Boolean(await until(ok, 3000)), `${rr.reply} ${j(await lv())}`); }
    { const rr = await chat("720p"); rec("his own video: quality says it plays at its own", rr.reply !== undefined); }
    await chat("stop");
    // --- the media window's page (lib/video/element-control.mjs, the code that runs inside youtube.com there) --------------
    { const { elementControl } = await imp("lib/video/element-control.mjs");
      const wp = await ctx.newPage(); await wp.goto(`${mock.url}/window.html`); await wp.waitForFunction(() => document.getElementById("v").readyState >= 1, null, { timeout: 8000 }).catch(() => {});
      const ec = (a, v) => wp.evaluate(elementControl, [a, v]);
      const steps = [["resume", null, (s) => !s.paused], ["pause", null, (s) => s.paused], ["seek", 12, (s) => Math.abs(s.time - 12) < 0.6], ["seekBy", -5, (s) => Math.abs(s.time - 7) < 0.6], ["seekPct", 50, (s) => Math.abs(s.time - 10) < 0.6],
        ["restart", null, (s) => s.time < 0.3], ["speed", 1.5, (s) => s.rate === 1.5], ["speedBy", -1, (s) => s.rate === 1.25], ["volume", 40, (s) => s.volume === 40], ["volumeBy", 15, (s) => s.volume === 55], ["mute", null, (s) => s.muted], ["unmute", null, (s) => !s.muted],
        ["captions", true, (s) => s.captions.length === 1], ["captionLang", "es", (s) => s.captions[0] === "es"], ["captions", false, (s) => !s.captions.length], ["full", true, (s) => s.full], ["full", false, (s) => !s.full], ["stop", null, (s) => s.paused && s.time === 0]];
      for (const [a, v, ok] of steps) { const out = await ec(a, v); rec(`the media window's player: ${a}${v != null ? " " + v : ""}`, out?.state && ok(out.state), j(out)); }
      rec("the media window: quality is YouTube's own there (says so)", /page itself/.test((await ec("quality", "720p")).say));
      // the signed-in browser's own pages: his playlists and a playlist's videos (the same readers browser.mjs runs in the media window)
      const bm = await imp("lib/browser.mjs");
      await wp.setContent(feedPlaylistsPage()); const mine = await wp.evaluate(bm.readMyPlaylists);
      rec("the media window: his playlists read off youtube.com/feed/playlists (both layouts)", mine.length === 4 && mine.some((p) => p.title === "Worship Songs") && mine.some((p) => p.title === "Workout Mix"), j(mine));
      await wp.setContent(pageHtml(playlistData("WL"))); const wl = yt.parsePlaylist(await wp.evaluate(bm.readPageData));
      rec("the media window: Watch later's videos read off its page", wl.title === "Watch later" && wl.items.length === 2, j(wl));
      await wp.close(); }
    // --- Spotify on the screen (a mocked Web Playback SDK) --------------------------------------------------------------------
    { const sp = await ctx.newPage(); const spCalls = [];
      await sp.route("**/api/player/status", (rt) => rt.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ spotify: { signedIn: true, configured: true }, screenPlayer: true }) }));
      await sp.route("**/api/player/spotify/token", (rt) => rt.fulfill({ status: 200, contentType: "application/json", body: '{"token":"qa"}' }));
      await sp.route("**/api/player/spotify/api", (rt) => { spCalls.push(JSON.parse(rt.request().postData() || "{}")); rt.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }); });
      await sp.addInitScript(() => {
        class Player { constructor(o) { this.o = o; this.l = {}; this.calls = []; this.vol = 1; window.__sp = this; } addListener(e, f) { this.l[e] = f; } connect() { setTimeout(() => this.l.ready?.({ device_id: "qa-dev" }), 20); return Promise.resolve(true); }
          disconnect() {} pause() { this.calls.push("pause"); return Promise.resolve(); } resume() { this.calls.push("resume"); return Promise.resolve(); } seek(ms) { this.calls.push("seek:" + Math.round(ms / 1000)); return Promise.resolve(); }
          nextTrack() { this.calls.push("next"); return Promise.resolve(); } previousTrack() { this.calls.push("previous"); return Promise.resolve(); } setVolume(v) { this.vol = v; return Promise.resolve(); } getVolume() { return Promise.resolve(this.vol); }
          emit(paused = false) { this.l.player_state_changed?.({ paused, position: 30000, duration: 200000, shuffle: false, repeat_mode: 0, track_window: { current_track: { name: "Gratitude", uri: "spotify:track:qa", artists: [{ name: "Hollow Pines" }], album: { images: [] } }, next_tracks: [] } }); } }
        window.Spotify = { Player };
      });
      await sp.goto(`${BASE}/display`); await sleep(2000);
      await sp.evaluate(() => window.dayspring.initSpotify());
      await until(() => sp.evaluate(() => Boolean(window.__sp?.l?.player_state_changed)), 5000);
      await sp.evaluate(() => window.__sp.emit(false));
      const ctlS = (a, v) => sp.evaluate(([x, y]) => window.dayspring.playerCtl(x, y), [a, v]);
      const spc = () => sp.evaluate(() => window.__sp.calls.slice());
      rec("Spotify on the screen (mocked SDK)", (await sp.evaluate(() => window.dayspring.player.source)) === "spotify");
      await ctlS("pause"); await ctlS("resume"); await ctlS("seekBy", 60); await ctlS("seekPct", 50); await ctlS("restart"); await ctlS("next"); await ctlS("previous");
      const calls = await spc();
      rec("Spotify: pause, resume, skip ahead, the middle, restart, next, previous", ["pause", "resume", "seek:90", "seek:100", "seek:0", "next"].every((c) => calls.includes(c)) && calls.some((c) => c === "previous" || c === "seek:0"), j(calls));
      await ctlS("volume", 40); rec("Spotify: media volume (the player's, not the computer's)", Math.abs((await sp.evaluate(() => window.__sp.vol)) - 0.4) < 0.01);
      await ctlS("shuffle", true); await ctlS("repeat", "track");
      rec("Spotify: shuffle and repeat go to Spotify", spCalls.some((c) => c.action === "shuffle" && c.value === true) && spCalls.some((c) => c.action === "repeat" && c.value === "track"), j(spCalls));
      const msgs = await sp.evaluate(async () => [await window.dayspring.playerCtl("speed", 2), await window.dayspring.playerCtl("captions", true), await window.dayspring.playerCtl("quality", "720p")]);
      rec("Spotify: speed, captions and quality say they don't apply", /YouTube/.test(msgs[0]) && /captions/.test(msgs[1]) && /quality/.test(msgs[2]), j(msgs));
      await sp.close(); }
    rec("no script errors on the screen", !errs.length, errs.slice(0, 3).join(" | "));
  } finally {
    await browser?.close().catch(() => {});
    server.kill();
    await sleep(500);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
await mock.close();
if (!args.includes("--keep")) { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* a file still in use */ } }
process.exit(failed ? 1 : 0);
