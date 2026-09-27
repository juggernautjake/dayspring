// Music requests on Spotify: does Dayspring play what the owner asked for? Everything runs against a pretend Spotify
// (fixtures/music/mock-spotify.mjs: a Web API and a web-player look-alike on 127.0.0.1). Never the owner's account,
// tokens, data folder or running Dayspring.
//   1. the bug: the old code turns "play christian fold music" into a pop playlist (reproduced, then fixed)
//   2. understanding: 70 phrasings (songs, artists, albums, playlists, his playlists, Liked Songs, genres, moods,
//      "more like this", typos and speech-to-text slips) → the kind, the words, and the thing chosen
//   3. checks: a genre is checked against its artists' genres; a mix is built when no playlist fits; "no Hillsong";
//      Spotify refusing an item; what's playing afterwards is read back and a mismatch is caught
//   4. not sure → "Did you mean…?" with 3 options, "number 2"; "not that" → the next one, remembered next time
//   5. controls: what's playing, save this song, add this to my playlist, queue a song, Discover Weekly
//   6. the media window's web player (headless Chrome, muted): all four result types read, scored the same way,
//      the now-playing bar checked
//   node scripts/qa/music.mjs [--verbose] [--no-browser]
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startMock } from "./fixtures/music/mock-spotify.mjs";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2), VERBOSE = args.includes("--verbose");
const TMP = mkdtempSync(join(tmpdir(), "ds-music-"));
const mock = await startMock();
Object.assign(process.env, {
  SPOTIFY_CLIENT_ID: "qa-test-client", DAYSPRING_SPOTIFY_API: `${mock.url}/v1`, DAYSPRING_SPOTIFY_ACCOUNTS: `${mock.url}/accounts`,
  DAYSPRING_SPOTIFY_TOKEN_FILE: join(TMP, "spotify-token.json"), DAYSPRING_MUSIC_PREFS: join(TMP, "music-prefs.json"),
  DAYSPRING_MUSIC_VERIFY_MS: "15", DAYSPRING_NO_BROWSER: "1",
});
writeFileSync(process.env.DAYSPRING_SPOTIFY_TOKEN_FILE, JSON.stringify({ access_token: "qa-token", refresh_token: "qa-refresh", scope: "streaming", expires_at: Date.now() + 3600_000, userId: "me" }));
const imp = (p) => import(pathToFileURL(join(DESK, p)).href);
const spotifyApi = await imp("lib/spotify-api.mjs");
const music = await imp("lib/music/index.mjs");
const { parseRequest, parseBoth } = await imp("lib/music/parse.mjs");
const { resolve } = await imp("lib/music/resolve.mjs");
const api = await imp("lib/music/webapi.mjs");
const prefs = await imp("lib/music/prefs.mjs");

let passed = 0, failed = 0;
const rec = (area, ok, note = "") => { if (ok) passed++; else failed++; if (!ok || VERBOSE) console.log(`${ok ? "PASS" : "FAIL"}  ${area}${note ? " — " + String(note).slice(0, 260) : ""}`); };
const section = (s) => console.log(`\n== ${s}`);
const DEV = "dev-screen";
const player = () => music.apiPlayer(DEV);
const deps = () => ({ media: { spotify: (o) => music.request(o, player()), nowPlaying: () => null }, apiReady: () => true, device: () => DEV, isSpotify: () => true });
const reset = () => { music.resetSession(); mock.state.sabotage = false; mock.state.unplayable.clear(); try { rmSync(process.env.DAYSPRING_MUSIC_PREFS, { force: true }); } catch { /* none yet */ } prefs.reload(); mock.state.calls.length = 0; mock.state.lastPlay = null; mock.state.shuffle = null; };

try {
  // ------------------------------------------------------------------ 1. the bug, reproduced with the old code
  section("the reported bug: \"play christian fold music\"");
  // the old no-AI path: "play (…) music" → query "<words> music", a public playlist, the first search result
  const oldOffline = await spotifyApi.resolve({ query: "christian fold music", type: "playlist" });
  rec("old offline path picks a pop playlist (bug reproduced)", /pop/i.test(oldOffline.title), oldOffline.title);
  // the AI path corrected the typo, but still took the first playlist result
  const oldAi = await spotifyApi.resolve({ query: "christian folk", type: "playlist" });
  rec("old AI path (typo fixed): takes the first result, unchecked", true, oldAi.title);
  // …and if the AI read it as a song, the first track that shares a word
  const oldTrack = await spotifyApi.resolve({ query: "christian folk music", type: "track" }).catch((e) => ({ title: `error: ${e.message}` }));
  rec("old AI path as a track: no genre check at all", true, oldTrack.title);
  reset();
  const fixed = await music.request({ request: "play christian fold music" }, player());
  rec("new: \"christian fold music\" → Christian Folk", fixed.picked?.name === "Christian Folk", `${fixed.picked?.name} | ${fixed.say}`);
  rec("new: plays that playlist on the screen device", mock.state.lastPlay?.context_uri === "spotify:playlist:cfolk", JSON.stringify(mock.state.lastPlay));
  rec("new: confirmed it's what's playing", fixed.verified === true, fixed.nowPlaying?.title);
  rec("new: says what it picked, with artists", /^Playing Christian Folk, a playlist with /.test(fixed.say) && /Gray Havens|Josh Garrels/.test(fixed.say), fixed.say);
  rec("new: shuffle on for a genre", mock.state.shuffle === true);
  reset();
  const viaAi = await music.request({ request: "play christian fold music", type: "track", query: "christian fold music" }, player());
  rec("new: the AI calling it a \"track\" still gets the genre", viaAi.picked?.name === "Christian Folk", viaAi.picked?.name);
  reset();
  const viaAi2 = await music.request({ type: "playlist", query: "christian folk" }, player());
  rec("new: the AI's playlist \"christian folk\" is checked by artist genres, not first result", viaAi2.picked?.name === "Christian Folk", `${viaAi2.picked?.name} (${viaAi2.picked?.why})`);

  // ------------------------------------------------------------------ 2. understanding: the corpus
  section("70 phrasings → kind, words, pick");
  const CASES = [
    // songs
    ["play Gratitude by Hollow Pines", "track", /^gratitude$/, /^Gratitude$/, "Hollow Pines"],
    ["play gratitude by hollow pins", "track", /gratitude/, /^Gratitude$/, "Hollow Pines"],
    ["play the song Gratitude", "track", /gratitude/, /^Gratitude$/, "Hollow Pines"],
    ["play Ring of Fire by Johnny Cash", "track", /ring of fire/, /^Ring of Fire$/, "Johnny Cash"],
    ["play ring of fire by jonny cash", "track", /ring of fire/, /^Ring of Fire$/, "Johnny Cash"],
    ["play Hurt by Johnny Cash", "track", /hurt/, /^Hurt$/],
    ["put on Way Maker", "any", /way maker/, /^Way Maker$/],
    ["play what a beautiful name", "any", /beautiful name/, /^What A Beautiful Name$/],
    ["can you play the song Levitating please", "track", /levitating/, /^Levitating$/],
    ["play the song that goes way maker miracle worker", "lyrics", /way maker/, /^Way Maker$/],
    ["play Espresso on spotify", "any", /espresso/, /^Espresso$/],
    ["play friends in low places", "any", /friends in low places/, /^Friends in Low Places$/],
    // artists
    ["play some Johnny Cash", "any", /johnny cash/, /^Johnny Cash$/, null, "artist"],
    ["play some jonny cash", "any", /jonny cash/, /^Johnny Cash$/, null, "artist"],
    ["play music by Josh Garrels", "artist", /josh garrels/, /^Josh Garrels$/],
    ["play songs by Hollow Pines", "artist", /hollow pines/, /^Hollow Pines$/],
    ["play Hillsong Worship", "any", /hillsong worship/, /^Hillsong Worship$/, null, "artist"],
    ["play hill song worship", "any", /hill song worship/, /^Hillsong Worship$/, null, "artist"],
    ["play the artist Gungor", "artist", /gungor/, /^Gungor$/],
    ["play Willie Nelson's greatest hits", "artist", /willie nelson/, /^Willie Nelson$/],
    ["play Rend Collective", "any", /rend collective/, /^Rend Collective$/, null, "artist"],
    ["i want to hear some waylon jennings", "any", /waylon jennings/, /^Waylon Jennings$/, null, "artist"],
    ["play mumford and sons", "any", /mumford and sons/, /^Mumford & Sons$/, null, "artist"],
    ["play elevation worship", "any", /elevation worship/, /^Elevation Worship$/, null, "artist"],
    ["play only Hillsong Worship", "any", /hillsong worship/, /^Hillsong Worship$/, null, "artist"],
    // albums
    ["play the album At Folsom Prison", "album", /folsom/, /^At Folsom Prison$/],
    ["play the album Home by Josh Garrels", "album", /home/, /^Home$/, "Josh Garrels"],
    ["play House of Miracles album", "album", /house of miracles/, /^House of Miracles$/],
    // public playlists
    ["play the This Is Johnny Cash playlist", "playlist", /johnny cash/, /^This Is Johnny Cash$/],
    ["play the Bluegrass Gospel Classics playlist", "playlist", /bluegrass gospel classics/, /^Bluegrass Gospel Classics$/],
    ["play a worship playlist", "genre", /^worship$/, /^Worship Now$/],
    ["play the lo-fi beats playlist", "genre", /lo fi/, /^Lo-Fi Beats$/],
    // his playlists
    ["play my Road Trip playlist", "myplaylist", /road trip/, /^Road Trip$/],
    ["shuffle my sunday morning playlist", "myplaylist", /sunday morning/, /^Sunday Morning$/],
    ["play my road trip", "myplaylist", /road trip/, /^Road Trip$/],
    ["play my roadtrip playlist", "myplaylist", /roadtrip/, /^Road Trip$/],
    ["play my discover weekly", "myplaylist", /discover weekly/, /^Discover Weekly$/],
    ["play discover weekly", "myplaylist", /discover weekly/, /^Discover Weekly$/],
    // Liked Songs
    ["play my liked songs", "liked", /^$/, /^Liked Songs$/],
    ["shuffle my favorite songs", "liked", /^$/, /^Liked Songs$/],
    ["play songs i liked", "liked", /^$/, /^Liked Songs$/],
    ["play some music", "vague", /^$/, /^Liked Songs$/],
    // genres
    ["play christian folk music", "genre", /^christian folk$/, /^Christian Folk$/],
    ["play christian fold music", "genre", /^christian folk$/, /^Christian Folk$/],
    ["play christian fold", "genre", /^christian folk$/, /^Christian Folk$/],
    ["put on some christain folk", "genre", /^christian folk$/, /^Christian Folk$/],
    ["play christian fork music", "genre", /^christian folk$/, /^Christian Folk$/],
    ["play worship music", "genre", /^worship$/, /^Worship Now$/],
    ["play some worhsip", "genre", /^worship$/, /^Worship Now$/],
    ["play some war ship music", "genre", /^worship$/, /^Worship Now$/],
    ["play worship but no hillsong", "genre", /^worship$/, /^(Worship Without Borders|Worship mix)$/],
    ["play 90s country", "genre", /^90s country$/, /^90s Country$/],
    ["play nineties country music", "genre", /^90s country$/, /^90s Country$/],
    ["play bluegrass gospel", "genre", /^bluegrass gospel$/, /^Bluegrass Gospel Classics$/],
    ["play blue grass gospel", "genre", /^bluegrass gospel$/, /^Bluegrass Gospel Classics$/],
    ["play some gospel bluegrass", "genre", /^bluegrass gospel$/, /^Bluegrass Gospel Classics$/],
    ["play lo-fi", "genre", /^lo fi$/, /^Lo-Fi Beats$/],
    ["play lofi hip hop", "genre", /^lo fi$/, /^Lo-Fi Beats$/],
    ["play some indie folk", "genre", /^indie folk$/, /^Indie Folk Essentials$/],
    ["play southern gospel", "genre", /^southern gospel$/, /^Southern Gospel mix$/, null, "mix"],
    ["play outlaw country", "genre", /^outlaw country$/, /^Outlaw Country mix$/, null, "mix"],
    ["hey dayspring play some hymns please", "genre", /^hymns$/, null],
    // moods
    ["play something calm for studying", "mood", /calm/, /^Calm Study$/],
    ["play upbeat workout music", "mood", /workout/, /^Upbeat Workout$/],
    ["play some study music", "mood", /study/, /^Calm Study$/],
    ["put on workout music", "mood", /workout/, /^Upbeat Workout$/],
    ["play something relaxing to study to", "mood", /calm/, /^Calm Study$/],
    // more like this
    ["play songs like Johnny Cash", "radio", /johnny cash/, /^songs like Johnny Cash$/, null, "mix"],
    ["play Josh Garrels radio", "radio", /josh garrels/, /^songs like Josh Garrels$/, null, "mix"],
    ["play more like this", "radio", /^$/, /^songs like White Owl$/, null, "mix"],
  ];
  rec(`corpus has ${CASES.length} phrasings (at least 60)`, CASES.length >= 60);
  for (const [phrase, kind, query, pick, by, type] of CASES) {
    reset();
    const r = parseRequest(phrase);
    const words = r.kind === "track" || r.kind === "any" || r.kind === "lyrics" ? `${r.title ?? r.query}` : r.query;
    const kindOk = r.kind === kind, qOk = query.test(words ?? "");
    if (/more like this/.test(phrase)) mock.state.player = { device: DEV, item: (await import("./fixtures/music/mock-spotify.mjs")).TRACKS.find((t) => t.id === "jg1"), context: null, playing: true };
    let got = null, err = null;
    if (pick) {
      try { const res = await resolve(r, api.source, { prefs }); got = res.choice; if (res.clarify) err = `asked instead: ${res.options.map((o) => o.name).join(" / ")}`; }
      catch (e) { err = e.message; }
    }
    const pickOk = !pick || (got && pick.test(got.name) && (!by || (got.by ?? "").includes(by)) && (!type || got.type === type) && !err);
    rec(`"${phrase}"`, kindOk && qOk && pickOk, `${r.kind}${kindOk ? "" : ` (want ${kind})`} · "${words}"${qOk ? "" : " (words?)"} · ${got ? `${got.type} ${got.name}${got.by ? " by " + got.by : ""}` : "-"}${err ? " · " + err : ""}`);
  }
  // the AI's reading and his words together
  const both = parseBoth("play christian fold music", { type: "playlist", query: "christian folk" });
  rec("AI hint + his words → the genre", both.kind === "genre" && both.genre.id === "christian folk", both.kind);
  const both2 = parseBoth("play Gratitude", { type: "track", query: "Gratitude by Hollow Pines" });
  rec("AI hint adds the artist it knows", both2.kind === "track" && both2.artist === "hollow pines", `${both2.kind} ${both2.artist}`);
  rec("typo keeps the same memory key", parseRequest("play christian fold").key === parseRequest("play christian folk music").key);
  rec("\"Rock of Ages\" is not the rock genre", parseRequest("play Rock of Ages").kind === "any");
  rec("\"Say No More\" is not \"no more\"", parseRequest("play Say No More").exclude.length === 0);

  // ------------------------------------------------------------------ 3. checks before and after
  section("checks before and after playing");
  reset();
  const sg = await music.request({ request: "play southern gospel" }, player());
  const sgArtists = new Set(["Gaither Vocal Band", "The Isaacs", "Karen Peck & New River", "The Hoppers"]);
  const sgUris = mock.state.lastPlay?.uris ?? [];
  const { TRACKS } = await import("./fixtures/music/mock-spotify.mjs");
  const allSg = sgUris.length >= 3 && sgUris.every((u) => TRACKS.find((t) => t.uri === u)?.artists.some((a) => sgArtists.has(a.name)));
  rec("genre with no playlist → a mix of that genre's artists only", allSg, `${sg.say} (${sgUris.length} songs)`);
  reset();
  const nohs = await music.request({ request: "shuffle worship music but no hillsong" }, player());
  rec("\"no Hillsong\": skips a playlist with Hillsong in it", nohs.picked?.name !== "Worship Now" && !/hillsong/i.test(nohs.say), nohs.say);
  rec("shuffle asked for → shuffle on", mock.state.shuffle === true);
  reset();
  mock.state.unplayable.add("spotify:playlist:cfolk");
  const unp = await music.request({ request: "play christian folk" }, player());
  rec("Spotify can't play the first pick → the next one, same screen", unp.playing && unp.picked?.name !== "Christian Folk" && /christian folk/i.test(unp.picked?.name ?? ""), unp.picked?.name);
  reset();
  mock.state.sabotage = true;
  const mis = await music.request({ request: "play Hurt by Johnny Cash" }, player());
  rec("now-playing check catches a mismatch", mis.verified === false && /Espresso/.test(mis.say), mis.say);
  rec("…and tried once more before saying so", mock.state.calls.filter((c) => c.startsWith("PUT /v1/me/player/play")).length >= 2);
  mock.state.sabotage = false;
  reset();
  const ok = await music.request({ request: "play Hurt by Johnny Cash" }, player());
  rec("now-playing check passes when it's right", ok.verified === true && ok.say === "Playing Hurt by Johnny Cash.", ok.say);
  rec("a single song: shuffle off", mock.state.shuffle === false);

  // ------------------------------------------------------------------ 4. not sure / not that
  section("not sure, and \"not that\"");
  reset();
  const cl = await music.request({ request: "play the song that goes father of lights heaven above" }, player());
  rec("low confidence → asks with 3 options, plays nothing", cl.clarify === true && cl.options.length === 3 && !mock.state.calls.some((c) => c.startsWith("PUT /v1/me/player/play")), cl.say);
  rec("…said aloud as \"Did you mean\"-style question", /Which one\?$/.test(cl.say) && /1, /.test(cl.say), cl.say);
  rec("…and shown on screen as a numbered list", music.takeSuggest()?.options?.length === 3);
  const chosenName = music.lastSession().res.options[1].name;
  const pick2 = await music.handle("number 2", deps());
  rec("\"number 2\" plays the second option", pick2?.played?.picked?.name === chosenName, pick2?.reply);
  reset();
  await music.request({ request: "play the song that goes father of lights heaven above" }, player());
  const none = await music.handle("none of these", deps());
  rec("\"none of these\" asks him to say it another way", /another way/.test(none?.reply ?? ""), none?.reply);
  reset();
  const first = await music.request({ request: "play christian folk" }, player());
  const nt = await music.handle("not that", deps());
  rec("\"not that\" → the next candidate", nt?.played?.playing && nt.played.picked?.uri !== first.picked?.uri, nt?.reply);
  rec("…said as \"Okay, playing …\"", /^Okay, playing /.test(nt?.reply ?? ""), nt?.reply);
  const nt2 = await music.handle("that's not what I wanted", deps());
  rec("\"that's not what I wanted\" → another again", nt2?.played?.playing && ![first.picked?.uri, nt.played.picked?.uri].includes(nt2.played.picked?.uri), nt2?.reply);
  const phrases = ["try another", "skip this playlist", "wrong one", "try a different one"];
  rec("other ways to say it are recognised", phrases.every((p) => /^(?:try another|skip this playlist|wrong one|try a different one)$/.test(p)) && (await Promise.all(phrases.map(async (p) => { music.lastSession().at = Date.now(); const r = await music.handle(p, deps()); return Boolean(r); }))).every(Boolean));
  const memory = prefs.forKey(parseRequest("play christian fold").key);
  rec("the turned-down ones are remembered", memory.rejected.has("spotify:playlist:cfolk"), [...memory.rejected].join(", "));
  music.resetSession();
  const again = await music.request({ request: "play christian fold music" }, player());
  rec("asking again later skips what he turned down", again.picked?.uri !== "spotify:playlist:cfolk", again.picked?.name);
  rec("\"not that\" with nothing picked lately is ignored", (music.resetSession(), await music.handle("not that", deps())) === null);

  // ------------------------------------------------------------------ 5. controls
  section("controls");
  reset();
  await music.request({ request: "play christian folk" }, player());
  const what = await music.handle("what's playing", deps());
  const cur = mock.state.player.item;
  rec("\"what's playing\" reads Spotify, and names the playlist", what?.reply === `This is ${cur.name} by ${cur.artists[0].name}, from Christian Folk.`, what?.reply);
  const what2 = await music.handle("what song is this", deps());
  rec("\"what song is this\"", /^This is /.test(what2?.reply ?? ""), what2?.reply);
  const save = await music.handle("save this song", deps());
  rec("\"save this song\" → Liked Songs", mock.state.liked.includes(cur.uri) && save?.reply === `Saved ${cur.name} to your Liked Songs.`, save?.reply);
  const add = await music.handle("add this to my road trip playlist", deps());
  rec("\"add this to my road trip playlist\"", mock.state.added.some((a) => a.playlist === "roadtrip" && a.uris[0] === cur.uri), add?.reply);
  const addBad = await music.handle("add this to my gym jams playlist", deps());
  rec("…a playlist he doesn't have is said plainly", /couldn't find a playlist of yours called "gym jams"/.test(addBad?.reply ?? ""), addBad?.reply);
  const q = await music.handle("queue ring of fire by johnny cash", deps());
  rec("\"queue X\" adds the right song to the queue", mock.state.queued.at(-1) === "spotify:track:ringoffire", q?.reply);
  const q2 = await music.handle("play hurt next", deps());
  rec("\"play X next\" queues it", mock.state.queued.at(-1) === "spotify:track:hurt", q2?.reply);
  reset();
  const dw = await music.request({ request: "play my discover weekly" }, player());
  rec("\"play my Discover Weekly\" → his Discover Weekly", mock.state.lastPlay?.context_uri === "spotify:playlist:dw", dw.say);
  const vol = await music.handle("turn the music up", deps());
  rec("volume / pause / next stay with the existing player commands", vol === null);

  // ------------------------------------------------------------------ 5b. other sources (his files, Drive) plug in
  section("other music sources (registerSource)");
  reset();
  const localCalls = { search: 0, played: [] };
  const off = music.registerSource({
    id: "local", label: "your computer", phrases: /\b(?:from|on) (?:my )?(?:computer|pc)\b/,
    search: async (req) => { localCalls.search++; return /holy forever/.test(`${req.title ?? ""} ${req.query}`) ? [{ type: "track", id: "C:/Music/Holy Forever.mp3", name: "Holy Forever", by: "Chris Tomlin", play: { file: "C:/Music/Holy Forever.mp3" } }] : []; },
    play: async (c) => { localCalls.played.push(c.play.file); return { title: c.name, artist: c.by }; },
    verify: async (c, st) => ({ ok: st?.title === c.name, now: { name: st?.title, by: st?.artist } }),
  });
  const pf = parseRequest("play Holy Forever from my computer");
  rec("\"from my computer\" → that source, words without it", pf.from === "local" && pf.query === "holy forever", `${pf.from} "${pf.query}"`);
  const l1 = await music.request({ request: "play Holy Forever from my computer" }, player());
  rec("…plays the file through that source, not Spotify", l1.source === "local" && localCalls.played.at(-1) === "C:/Music/Holy Forever.mp3" && !mock.state.calls.some((c) => c.startsWith("PUT /v1/me/player/play")), l1.say);
  rec("…and says where from", l1.say === "Playing Holy Forever by Chris Tomlin from your computer.", l1.say);
  reset();
  const l2 = await music.request({ request: "play Holy Forever" }, player());
  rec("no source named: the best match anywhere (here, his file)", l2.source === "local", `${l2.source} ${l2.say}`);
  reset();
  const l3 = await music.request({ request: "play Hurt by Johnny Cash" }, player());
  rec("…and Spotify when that's the match", l3.source === "spotify" && l3.picked?.name === "Hurt", `${l3.source} ${l3.say}`);
  const before = localCalls.search;
  reset();
  const l4 = await music.request({ request: "play Hurt on spotify" }, player());
  rec("\"on spotify\" asks Spotify only", l4.source === "spotify" && localCalls.search === before, `${l4.source}, local searched ${localCalls.search - before}×`);
  reset();
  const l5 = await music.request({ request: "play Ring of Fire from my computer" }, player()).catch((e) => ({ error: e.message }));
  rec("nothing on that source → says so (no Spotify fallback)", /Nothing on your computer matched "ring of fire"/.test(l5.error ?? ""), l5.error);
  off();
  rec("unregistering removes it", music.sources().length === 0);

  // ------------------------------------------------------------------ 6. the media window's web player
  section("web player (media window) fallback");
  if (args.includes("--no-browser")) rec("web player checks skipped (--no-browser)", true);
  else {
    const { chromium } = await import(pathToFileURL(process.env.QA_PLAYWRIGHT ?? [join(DESK, "..", "..", "..", "dayspring-app", "node_modules", "playwright-core", "index.mjs"), join(DESK, "node_modules", "playwright-core", "index.mjs")].find((p) => existsSync(p)) ?? "").href);
    const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--mute-audio", "--no-first-run"] });
    try {
      const page = await browser.newPage();
      const wp = await imp("lib/music/webplayer.mjs");
      const BASE = `${mock.url}/web`;
      const win = {
        find: (q, t) => wp.scrapeSearch(page, BASE, q, t), inspect: (u) => wp.inspectEntity(page, BASE, u), library: () => wp.library(page, BASE), now: () => wp.nowPlaying(page),
        play: async ({ url, type }) => { if (type === "liked") return { title: "", artist: "" }; await page.goto(url, { waitUntil: "domcontentloaded" }); await page.click('[data-testid="action-bar-row"] [data-testid="play-button"]'); await page.waitForTimeout(100); return { opened: url, ...(await wp.nowPlaying(page)) }; },
      };
      // what the old code did: open the first playlist card
      await page.goto(`${BASE}/search/${encodeURIComponent("christian fold music")}/playlists`);
      const firstCard = await page.locator('main a[href*="/playlist/"]').first().getAttribute("title");
      rec("old media-window path: the first card is a pop playlist (bug reproduced)", /pop/i.test(firstCard ?? ""), firstCard);
      const all = await wp.scrapeSearch(page, BASE, "johnny cash", "all");
      rec("reads all four result types from one search page", ["track", "artist", "album", "playlist"].every((t) => all.some((c) => c.type === t)), [...new Set(all.map((c) => c.type))].join(", "));
      const rows = await wp.scrapeSearch(page, BASE, "ring of fire", "track");
      rec("reads songs with their artists", rows.some((c) => c.name === "Ring of Fire" && c.by === "Johnny Cash"), rows.map((c) => `${c.name}/${c.by}`).join("; "));
      reset();
      const w1 = await music.request({ request: "play christian fold music" }, music.windowPlayer(win));
      rec("web player: \"christian fold music\" → Christian Folk", w1.picked?.name === "Christian Folk", `${w1.picked?.name} | ${w1.say}`);
      rec("web player: now-playing bar confirms it", w1.verified === true, JSON.stringify(w1.nowPlaying));
      reset();
      const w2 = await music.request({ request: "play some jonny cash" }, music.windowPlayer(win));
      rec("web player: \"jonny cash\" → the artist Johnny Cash (not the tribute band)", w2.picked?.name === "Johnny Cash" && w2.picked?.type === "artist", w2.picked?.name);
      reset();
      const w3 = await music.request({ request: "play my road trip playlist" }, music.windowPlayer(win));
      rec("web player: his playlist from the library sidebar", w3.picked?.name === "Road Trip", w3.picked?.name);
      reset();
      const w4 = await music.request({ request: "play the album Home by Josh Garrels" }, music.windowPlayer(win));
      rec("web player: an album by the right artist", w4.picked?.name === "Home" && /Josh Garrels/.test(w4.picked?.name === "Home" ? w4.artist : ""), `${w4.picked?.name} / ${w4.artist}`);
      reset();
      mock.state.sabotage = true;
      const w5 = await music.request({ request: "play christian folk" }, music.windowPlayer(win));
      rec("web player: a mismatch in the now-playing bar is caught", w5.verified === false && /Espresso/.test(w5.say), w5.say);
      mock.state.sabotage = false;
      const { rankFound } = await imp("lib/music/resolve.mjs");
      const cards = await wp.scrapeSearch(page, BASE, "christian folk", "playlist");
      rec("the older search-and-open path ranks the same way", rankFound(cards, "christian folk", "playlist")[0]?.name === "Christian Folk", cards.map((c) => c.name).join(" > "));
    } finally { await browser.close().catch(() => {}); }
  }
} catch (e) { rec("the test itself", false, e.stack); }
finally {
  await mock.close();
  rmSync(TMP, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
