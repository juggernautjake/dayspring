// Google Drive and several Google accounts (lib/connectors/google.mjs, lib/connectors/drive.mjs, lib/medialib), against a
// stand-in Google (OAuth, Drive, Calendar and Gmail on 127.0.0.1): never a real Google account, never real files.
//   1. the older single-account file becomes account 1 (same scopes, same email), its sign-in encrypted with Windows DPAPI
//   2. a second account at once (nickname "Work"), incremental scopes: Drive look-only by default; write only when turned on
//   3. the write tools (upload, mkdir, move, trash) aren't offered, and refuse, until "add and change files" is on
//   4. search across both Drives, one Drive by label, shared drives (supportsAllDrives / includeItemsFromAllDrives), shared with me
//   5. Docs and Sheets exported to text / CSV for reading; nothing of their contents in the activity log
//   6. the streaming proxy: Range passes through, the token stays on the server (never in what the page gets)
//   7. upload / mkdir / move / trash / download each wait for the owner's yes, are logged, and trash is Drive's trash
//   8. removing one account leaves the other (and withdraws the removed one's sign-in)
//   9. Calendar and Gmail with two accounts: events from both, mail from the primary unless another is named, replies go
//      back to the right account; calsync still sees Google
//  10. Drive audio in the same "play …" searches as his own files: his files first, unless a Drive is named
//   node scripts/qa/drive.mjs
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let fail = 0, pass = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${got !== "" && !ok ? "  (" + String(got).slice(0, 300) + ")" : ""}`); };

// ---- the stand-in Google ------------------------------------------------------------------------------------------------------
const codes = new Map();                 // code → { email, scope }
const refresh = new Map();               // refresh token → email
const access = new Map();                // access token → email
const revoked = [];
const created = [];                     // every event created: { email, body, query }
const seen = [];                         // every Drive/Calendar/Gmail request: { email, method, path, query, range, auth }
let n = 0;
const VIDEO = Buffer.from(Array.from({ length: 6000 }, (_, i) => i % 251));
const SONG = Buffer.from(Array.from({ length: 4000 }, (_, i) => (i * 7) % 253));
const files = {
  "me@example.com": [
    { id: "pv1wedding", name: "Wedding Video.mp4", mimeType: "video/mp4", size: String(VIDEO.length), modifiedTime: "2026-09-20T10:00:00Z", owners: [{ displayName: "Me" }], parents: ["root"], bytes: VIDEO, videoMediaMetadata: { width: 640, height: 360, durationMillis: "4000" } },
    { id: "pd1budget", name: "Budget 2026", mimeType: "application/vnd.google-apps.document", modifiedTime: "2026-09-25T10:00:00Z", owners: [{ displayName: "Me" }], parents: ["root"], text: "Budget: rent 1200, food 400." },
    { id: "pt1notes", name: "Notes.txt", mimeType: "text/plain", size: "20", modifiedTime: "2026-01-02T10:00:00Z", owners: [{ displayName: "Me" }], parents: ["root"], bytes: Buffer.from("plain notes in drive") },
  ],
  "boss@work.com": [
    { id: "wa1march", name: "Wedding March.mp3", mimeType: "audio/mpeg", size: String(SONG.length), modifiedTime: "2026-09-26T10:00:00Z", owners: [{ displayName: "Boss" }], parents: ["root"], bytes: SONG },
    { id: "wd1report", name: "Q3 Report", mimeType: "application/vnd.google-apps.document", modifiedTime: "2026-09-24T10:00:00Z", owners: [{ displayName: "Boss" }], parents: ["root"], text: "Q3 revenue grew 12 percent." },
    { id: "ws1numbers", name: "Numbers", mimeType: "application/vnd.google-apps.spreadsheet", modifiedTime: "2026-09-23T10:00:00Z", owners: [{ displayName: "Boss" }], parents: ["root"], csv: "month,sales\nJuly,10\nAugust,12" },
    { id: "wsh1plan", name: "Shared Plan", mimeType: "application/vnd.google-apps.document", modifiedTime: "2026-09-22T10:00:00Z", driveId: "sharedDrive1", owners: [], parents: ["sharedDrive1"], text: "The team plan." },
    { id: "wsw1fromsam", name: "From Sam.txt", mimeType: "text/plain", modifiedTime: "2026-09-21T10:00:00Z", sharedWithMe: true, owners: [{ displayName: "Sam" }], parents: [], bytes: Buffer.from("hi from sam") },
    { id: "wf1archive", name: "Archive", mimeType: "application/vnd.google-apps.folder", modifiedTime: "2026-01-01T10:00:00Z", owners: [{ displayName: "Boss" }], parents: ["root"] },
  ],
};
const meta = (f) => { const { bytes, text, csv, sharedWithMe, ...m } = f; void bytes; void text; void csv; void sharedWithMe; return m; };
// a small reader for the Drive "q" language (the parts Dayspring writes)
function matches(f, q) {
  if (!q) return true;
  return q.split(/ and /).every((t) => {
    let m;
    if (t === "trashed = false") return !f.trashed;
    if ((m = /^name contains '(.*)'$/.exec(t))) return f.name.toLowerCase().includes(m[1].replace(/\\'/g, "'").toLowerCase());
    if ((m = /^fullText contains '(.*)'$/.exec(t))) return (f.text ?? "").toLowerCase().includes(m[1].toLowerCase());
    if ((m = /^mimeType contains '(.*)'$/.exec(t))) return f.mimeType.includes(m[1]);
    if (/^\(mimeType contains 'audio\/' or mimeType contains 'video\/'\)$/.test(t)) return /^(audio|video)\//.test(f.mimeType);
    if ((m = /^mimeType = '(.*)'$/.exec(t))) return f.mimeType === m[1];
    if (t === "starred = true") return Boolean(f.starred);
    if (t === "sharedWithMe = true") return Boolean(f.sharedWithMe);
    if ((m = /^modifiedTime > '(.*)'$/.exec(t))) return f.modifiedTime > m[1];
    if ((m = /^modifiedTime < '(.*)'$/.exec(t))) return f.modifiedTime < m[1];
    if ((m = /^'(.*)' in parents$/.exec(t))) return (f.parents ?? []).includes(m[1]);
    return true;
  });
}
const body = (req) => new Promise((ok) => { const b = []; req.on("data", (c) => b.push(c)); req.on("end", () => ok(Buffer.concat(b))); });
const json = (res, code, x) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(x)); };
const idToken = (email) => `h.${Buffer.from(JSON.stringify({ email })).toString("base64url")}.s`;
const mock = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x"), p = url.pathname, q = url.searchParams;
  if (p === "/token") {
    const f = new URLSearchParams((await body(req)).toString());
    if (f.get("grant_type") === "authorization_code") {
      const c = codes.get(f.get("code")); if (!c || !f.get("code_verifier")) return json(res, 400, { error: "invalid_grant" });
      const rt = `rt-${c.email}-${++n}`, at = `at-${c.email}-${++n}`;
      refresh.set(rt, c.email); access.set(at, c.email);
      return json(res, 200, { access_token: at, refresh_token: rt, expires_in: 3600, id_token: idToken(c.email), scope: c.scope });
    }
    if (f.get("grant_type") === "refresh_token") {
      const email = refresh.get(f.get("refresh_token")); if (!email) return json(res, 400, { error: "invalid_grant" });
      const at = `at-${email}-${++n}`; access.set(at, email);
      return json(res, 200, { access_token: at, expires_in: 3600 });
    }
    return json(res, 400, { error: "unsupported_grant_type" });
  }
  if (p === "/revoke") { revoked.push(new URLSearchParams((await body(req)).toString()).get("token")); return json(res, 200, {}); }
  const auth = String(req.headers.authorization ?? ""), email = access.get(auth.replace(/^Bearer /, ""));
  if (!email) return json(res, 401, { error: { message: "Invalid Credentials" } });
  seen.push({ email, method: req.method, path: p, query: Object.fromEntries(q), range: req.headers.range ?? null, auth });
  const mine = files[email] ?? [];
  let m;
  // Drive
  if (p === "/drive/v3/files" && req.method === "GET") return json(res, 200, { files: mine.filter((f) => matches(f, q.get("q") ?? "")).map(meta) });
  if ((m = /^\/drive\/v3\/files\/([\w-]+)\/export$/.exec(p))) { const f = mine.find((x) => x.id === m[1]); if (!f) return json(res, 404, { error: { message: "File not found" } }); res.writeHead(200, { "content-type": q.get("mimeType") }); return res.end(q.get("mimeType") === "text/csv" ? f.csv ?? "" : q.get("mimeType") === "text/plain" ? f.text ?? "" : Buffer.from("PK-office-file")); }
  if ((m = /^\/drive\/v3\/files\/([\w-]+)$/.exec(p)) && req.method === "GET") {
    const f = mine.find((x) => x.id === m[1]); if (!f) return json(res, 404, { error: { message: "File not found" } });
    if (q.get("alt") !== "media") return json(res, 200, meta(f));
    const buf = f.bytes ?? Buffer.alloc(0), r = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
    if (r) { const s = Number(r[1]), e = r[2] ? Math.min(buf.length - 1, Number(r[2])) : buf.length - 1; res.writeHead(206, { "content-type": f.mimeType, "content-length": e - s + 1, "content-range": `bytes ${s}-${e}/${buf.length}`, "accept-ranges": "bytes", "x-goog-hash": "secret-ish" }); return res.end(buf.subarray(s, e + 1)); }
    res.writeHead(200, { "content-type": f.mimeType, "content-length": buf.length, "accept-ranges": "bytes" }); return res.end(buf);
  }
  if ((m = /^\/drive\/v3\/files\/([\w-]+)$/.exec(p)) && req.method === "PATCH") {
    const f = mine.find((x) => x.id === m[1]); if (!f) return json(res, 404, { error: { message: "File not found" } });
    const b = JSON.parse((await body(req)).toString() || "{}");
    if (b.trashed) f.trashed = true;
    if (b.name) f.name = b.name;
    if (q.get("addParents")) f.parents = [q.get("addParents")];
    return json(res, 200, meta(f));
  }
  if ((m = /^\/drive\/v3\/files\/([\w-]+)$/.exec(p)) && req.method === "DELETE") return json(res, 500, { error: { message: "DELETE must never be used" } });
  if (p === "/drive/v3/files" && req.method === "POST") { const b = JSON.parse((await body(req)).toString()); const f = { id: `new${++n}folder`, name: b.name, mimeType: b.mimeType, parents: b.parents, modifiedTime: new Date().toISOString() }; mine.push(f); return json(res, 200, meta(f)); }
  if (p === "/upload/drive/v3/files" && req.method === "POST") {
    const raw = (await body(req)).toString("latin1"), metaJson = /\r\n\r\n(\{.*?\})\r\n--/s.exec(raw)?.[1] ?? "{}";
    const mm = JSON.parse(metaJson), content = raw.split(/\r\n\r\n/).slice(2).join("\r\n\r\n").replace(/\r\n--[^\r\n]*--$/, "");
    const f = { id: `up${++n}file`, name: mm.name, mimeType: "text/plain", parents: mm.parents, modifiedTime: new Date().toISOString(), bytes: Buffer.from(content, "latin1"), uploadType: q.get("uploadType") };
    mine.push(f); return json(res, 200, meta(f));
  }
  // Calendar
  if (p === "/calendar/v3/users/me/calendarList") return json(res, 200, { items: [{ id: email, summary: email, primary: true, selected: true }] });
  if ((m = /^\/calendar\/v3\/calendars\/([^/]+)\/events$/.exec(p)) && req.method === "GET") return json(res, 200, { items: [{ id: `ev-${email.split("@")[0]}`, summary: `${email.split("@")[0]} meeting`, start: { dateTime: "2026-09-28T10:00:00" }, end: { dateTime: "2026-09-28T11:00:00" }, organizer: { self: true } }] });
  if ((m = /^\/calendar\/v3\/calendars\/([^/]+)\/events$/.exec(p)) && req.method === "POST") { const b = JSON.parse((await body(req)).toString()); created.push({ email, body: b, query: Object.fromEntries(q) }); const meetOn = b.conferenceData?.createRequest && q.get("conferenceDataVersion") === "1"; return json(res, 200, { id: `new-${email}`, summary: b.summary, htmlLink: "https://calendar.example/e", ...(meetOn ? { hangoutLink: "https://meet.google.com/abc-defg-hij" } : {}) }); }
  if ((m = /^\/calendar\/v3\/calendars\/([^/]+)\/events\/([^/?]+)$/.exec(p)) && req.method === "PATCH") return json(res, 200, { id: m[2], summary: "moved", htmlLink: "x" });
  // Gmail
  if (p === "/gmail/v1/users/me/messages") return json(res, 200, { messages: [{ id: `msg-${email.split("@")[0]}` }] });
  if ((m = /^\/gmail\/v1\/users\/me\/messages\/([\w-]+)$/.exec(p))) return json(res, 200, { id: m[1], threadId: "t1", snippet: `hello ${email}`, labelIds: ["UNREAD"], payload: { headers: [{ name: "From", value: `Friend <f@x.com>` }, { name: "Subject", value: `For ${email}` }, { name: "Date", value: "today" }, { name: "Message-ID", value: `<${m[1]}@x>` }], mimeType: "text/plain", body: { data: Buffer.from(`Body for ${email}`).toString("base64url") } } });
  if (p === "/gmail/v1/users/me/drafts") return json(res, 200, { id: `draft-${email}` });
  json(res, 404, { error: { message: `mock: no ${req.method} ${p}` } });
}).listen(0, "127.0.0.1");
await new Promise((r) => mock.once("listening", r));
const G = `http://127.0.0.1:${mock.address().port}`;

// ---- a throwaway Dayspring data folder ---------------------------------------------------------------------------------------
const TMP = mkdtempSync(join(tmpdir(), "ds-drive-"));
const HOME = join(TMP, "home"), MUSIC = join(HOME, "Music"), DL = join(TMP, "downloads");
mkdirSync(join(TMP, "connectors"), { recursive: true }); mkdirSync(MUSIC, { recursive: true }); mkdirSync(DL, { recursive: true });
Object.assign(process.env, {
  GOOGLE_AUTH_BASE: `${G}/auth`, GOOGLE_TOKEN_URL: `${G}/token`, GOOGLE_REVOKE_URL: `${G}/revoke`, GOOGLE_CAL_BASE: `${G}/calendar/v3`, GOOGLE_GMAIL_BASE: `${G}/gmail/v1`, DRIVE_BASE: `${G}/drive/v3`, DRIVE_UPLOAD_BASE: `${G}/upload/drive/v3`,
  DAYSPRING_CONNECTORS_DIR: join(TMP, "connectors"), DAYSPRING_ACTIVITY_DIR: join(TMP, "activity"), DAYSPRING_PERMISSIONS_FILE: join(TMP, "perm", "permissions.json"), DAYSPRING_MEDIALIB_FILE: join(TMP, "media-library.json"),
  DAYSPRING_MEDIALIB_HOME: HOME, DAYSPRING_MEDIALIB_DELAY_MS: "0", DAYSPRING_SETTINGS_FILE: join(TMP, "settings.json"), DAYSPRING_CALDATA_DIR: TMP, DAYSPRING_NO_BROWSER: "1", DAYSPRING_NO_OPEN: "1", DS_FOLLOW_MARK: join(TMP, "follow.json"),
});
const OLD = { clientId: "123-abc.apps.googleusercontent.com", clientSecret: "GOCSPX-test-secret", refreshToken: "rt-me@example.com-old", accessToken: "at-stale", expires: 0, email: "me@example.com", at: 1 };
refresh.set(OLD.refreshToken, "me@example.com");
writeFileSync(join(TMP, "connectors", "google.json"), JSON.stringify(OLD));

const imp = (p) => import(pathToFileURL(join(DESK, p)).href);
const google = await imp("lib/connectors/google.mjs");
const drive = await imp("lib/connectors/drive.mjs");
const connectors = await imp("lib/connectors/index.mjs");
(await imp("lib/media.mjs"))._setPolicy({ videosAllowed: true });   // not the real schedule: a study block right now would refuse videos
const confirm = await imp("lib/confirm.mjs");
const activity = await imp("lib/activity.mjs");
const permissions = await imp("lib/permissions.mjs");
const skills = await imp("lib/medialib/skills.mjs");
const library = await imp("lib/medialib/library.mjs");
const routes = await imp("lib/medialib/routes.mjs");
const connRoutes = await imp("lib/connector-routes.mjs");
const bus = await imp("lib/bus.mjs");
const events = [];
bus.on((type, data) => events.push({ type, data }));
const fileText = () => readFileSync(join(TMP, "connectors", "google.json"), "utf8");
// sign in as a Google account: start() gives the URL; the stand-in Google hands back a code for exactly those scopes
async function signIn(email, startOpts) {
  const url = new URL(typeof startOpts === "string" ? startOpts : google.start(startOpts));
  const code = `code-${++n}`;
  codes.set(code, { email, scope: url.searchParams.get("scope") });
  return { url, result: await google.finish({ code, state: url.searchParams.get("state") }) };
}
const has = (url, s) => url.searchParams.get("scope").split(" ").includes(`https://www.googleapis.com/auth/${s}`);

// ---- 1. the older single account ------------------------------------------------------------------------------------------------
{
  const st = google.status();
  check("the older single-account file becomes account 1 (same email, primary)", st.accounts.length === 1 && st.accounts[0].email === "me@example.com" && st.accounts[0].primary && st.accounts[0].id === "g1", JSON.stringify(st));
  check("…with the same access it had: Calendar and Gmail, no Drive", st.accounts[0].ready.calendar && st.accounts[0].ready.gmail && !st.accounts[0].ready.drive && google.connected());
  const raw = fileText(), j = JSON.parse(raw);
  check("…and its sign-in is encrypted at rest (DPAPI), the old plain token and access token gone", j.v === 2 && /^dpapi:/.test(j.accounts[0].token) && !raw.includes(OLD.refreshToken) && !raw.includes("accessToken") && !raw.includes("at-stale"), raw.slice(0, 200));
  const ev = await google.events("2026-09-28", "2026-09-28");
  check("Calendar still works with the moved account (the encrypted sign-in is used)", ev.length === 1 && ev[0].title === "me meeting" && ev[0].account === "g1", JSON.stringify(ev));
  const { dpapi } = await imp("vendor/ecosystem-core/lib/credentials.mjs");
  const back = dpapi({ entropy: "dayspring-google-v1" }).unprotect(Buffer.from(j.accounts[0].token.slice(6), "base64")).toString("utf8");
  check("…it's Windows DPAPI for this user (it decrypts back to the same sign-in)", back === OLD.refreshToken);
  const wrong = spawnSync("powershell.exe", ["-NoProfile", "-Command", "Add-Type -AssemblyName System.Security; try { [Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($env:X), [Text.Encoding]::UTF8.GetBytes('other-app'), 'CurrentUser') | Out-Null; 'opened' } catch { 'refused' }"], { env: { ...process.env, X: j.accounts[0].token.slice(6) }, encoding: "utf8", windowsHide: true });
  check("…and can't be opened with another app's key (entropy)", /refused/.test(wrong.stdout), wrong.stdout);
  check("the moved account was noted in the activity log (no token in it)", activity.search({ kind: "connect.google.upgraded" }).entries.length === 1 && !JSON.stringify(activity.search({ kind: "connect" }).entries).includes("rt-"));
}

// ---- 2. a second account; scopes asked for as needed ---------------------------------------------------------------------------
let workUrl;
{
  const { url, result } = await signIn("boss@work.com", { nickname: "Work" });
  workUrl = url;
  check("a new account asks for Drive LOOK-ONLY (drive.readonly), not the full Drive scope", has(url, "drive.readonly") && !has(url, "drive") && has(url, "calendar.events") && has(url, "gmail.compose"), url.searchParams.get("scope"));
  check("…lets the owner pick an account and asks for offline access with PKCE", /select_account/.test(url.searchParams.get("prompt")) && url.searchParams.get("access_type") === "offline" && url.searchParams.get("code_challenge_method") === "S256" && url.searchParams.get("include_granted_scopes") === "true");
  const st = google.status();
  check("two accounts at once; the first stays primary", st.accounts.length === 2 && st.accounts.find((a) => a.email === "boss@work.com")?.nickname === "Work" && st.accounts.find((a) => a.primary)?.email === "me@example.com", JSON.stringify(st.accounts.map((a) => [a.email, a.primary])));
  check("the sign-in page says who signed in (email only)", result.who === "boss@work.com");
  const r = google.update("g1", { services: { drive: true } });
  const u2 = new URL(r.url);
  check("turning Drive on for account 1 asks Google for just that (incremental, login_hint)", r.needsSignIn && has(u2, "drive.readonly") && u2.searchParams.get("login_hint") === "me@example.com" && u2.searchParams.get("include_granted_scopes") === "true");
  await signIn("me@example.com", r.url);
  check("…after the sign-in, account 1 has Drive (look only)", google.status().accounts.find((a) => a.id === "g1").ready.drive && !google.status().accounts.find((a) => a.id === "g1").driveWrite);
  check("still two accounts (the same Google account signing in again isn't a third)", google.status().accounts.length === 2);
  const raw = fileText();
  check("every sign-in in the file is encrypted (no refresh or access token in it)", !/rt-|at-/.test(raw) && JSON.parse(raw).accounts.every((a) => /^dpapi:/.test(a.token)));
  const pub = JSON.stringify([google.status(), connectors.statuses().google]);
  check("status (what Settings shows) has emails only: no tokens, no client secret", !/rt-|at-|GOCSPX|dpapi:/.test(pub), pub.slice(0, 200));
}

// ---- 3. write tools only when allowed ------------------------------------------------------------------------------------------
{
  const names = () => skills.tools().map((t) => t.name);
  check("with Drive look-only: the read tools are offered", ["drive_search", "drive_read", "drive_play", "drive_recent", "drive_download"].every((x) => names().includes(x)));
  check("…the write tools (upload, mkdir, move, trash) are not", !names().some((x) => /^drive_(upload|mkdir|move|trash)$/.test(x)), names().join(","));
  const r = await skills.runTool("drive_upload", { name: "x.txt", text: "hi" });
  check("…and calling one anyway is refused", /No connected Drive allows changes/.test(r.error ?? ""), JSON.stringify(r));
  const w = google.update("g2", { driveWrite: true });
  check("turning on “add and change files” asks Google for the drive scope", w.needsSignIn && has(new URL(w.url), "drive"));
  check("…and until Google says yes, it still can't write", !drive.canWrite("work") && !names().includes("drive_upload"));
  await signIn("boss@work.com", w.url);
  check("after the owner's yes at Google: the write tools appear (for the Work Drive only)", names().includes("drive_upload") && drive.canWrite("work") && !drive.canWrite("me@example.com"));
}

// ---- 4. search ---------------------------------------------------------------------------------------------------------------
{
  seen.length = 0;
  let r = await drive.search({ query: "wedding" });
  check("search looks in both Drives at once, and says which Drive each file is in", r.files.length === 2 && r.files.some((f) => f.drive === "Work" && f.name === "Wedding March.mp3") && r.files.some((f) => f.drive === "me@example.com" && f.name === "Wedding Video.mp4"), JSON.stringify(r.files.map((f) => [f.name, f.drive])));
  check("…with shared drives included (supportsAllDrives, includeItemsFromAllDrives, corpora=allDrives)", seen.every((s) => s.query.supportsAllDrives === "true" && s.query.includeItemsFromAllDrives === "true" && s.query.corpora === "allDrives"));
  r = await drive.search({ query: "wedding", account: "work" });
  check("“in my work drive”: only that Drive", r.files.length === 1 && r.files[0].drive === "Work");
  r = await drive.search({ query: "plan" });
  check("a file in a shared drive is found (and marked)", r.files.some((f) => f.name === "Shared Plan" && f.sharedDrive === "sharedDrive1"));
  r = await drive.search({ sharedWithMe: true });
  check("shared with me", r.files.length === 1 && r.files[0].name === "From Sam.txt");
  r = await drive.search({ type: "audio" });
  check("by type (audio)", r.files.length === 1 && r.files[0].kind === "audio");
  r = await drive.search({ text: "revenue" });
  check("full text", r.files.length === 1 && r.files[0].name === "Q3 Report");
  r = await drive.changes({ days: 3650 });
  check("recent changes, across both, newest first", r.files.length >= 8 && r.files[0].modified >= r.files[1].modified && Object.keys(r.byDrive).length === 2);
  const t = await skills.runTool("drive_search", { query: "wedding" });
  check("drive_search (AI) shows the list on the screen", t.count === 2 && events.some((e) => e.type === "medialib" && e.data.list?.items.length === 2));
  const said = await skills.command("search my work drive for the report");
  check("by voice: “search my work drive for the report”", /Q3 Report/.test(said?.reply ?? "") && !/Budget/.test(said?.reply ?? ""), said?.reply);
  const ch = await skills.command("what changed in my drive this week");
  check("by voice: “what changed in my Drive this week”", /changed in the last 7 days/.test(ch?.reply ?? ""), ch?.reply);
}

// ---- 5. reading -------------------------------------------------------------------------------------------------------------------
{
  let r = await skills.runTool("drive_read", { file: "g2:wd1report" });
  check("a Google Doc is exported to text", r.text === "Q3 revenue grew 12 percent." && seen.some((s) => /\/export$/.test(s.path) && s.query.mimeType === "text/plain"), JSON.stringify(r).slice(0, 200));
  r = await skills.runTool("drive_read", { file: "g2:ws1numbers" });
  check("a Sheet is exported as CSV", /month,sales\nJuly,10/.test(r.text ?? ""));
  r = await skills.runTool("drive_read", { file: "g1:pt1notes" });
  check("a text file is read", r.text === "plain notes in drive");
  r = await skills.runTool("drive_read", { file: "g1:pv1wedding" });
  check("a video isn't “read”: it says to play it", r.text === null && /drive_play/.test(r.note ?? ""));
  const logged = activity.search({ kind: "drive.read" }).entries;
  check("reads are logged by name and size, never their contents", logged.length >= 3 && !JSON.stringify(logged).includes("revenue") && !JSON.stringify(logged).includes("July"));
}

// ---- 6. streaming through Dayspring -----------------------------------------------------------------------------------------------
const readJSON = (req) => new Promise((ok) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { ok(JSON.parse(b || "{}")); } catch { ok({}); } }); });
const send = (res, code, x) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(x)); };
const app = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1"), p = url.pathname.slice(4);
  if (await routes.handle(req, res, { m: req.method, p, q: url.searchParams, send, readJSON })) return;
  if (await connRoutes.handle(req, res, { m: req.method, p, q: url.searchParams, send, readJSON })) return;
  send(res, 404, { error: "no route" });
}).listen(0, "127.0.0.1");
await new Promise((r) => app.once("listening", r));
const A = `http://127.0.0.1:${app.address().port}`;
const get = (path, headers = {}, method = "GET", data = null) => new Promise((ok, no) => { const r = http.request(A + path, { method, headers: { ...(data ? { "content-type": "application/json" } : {}), ...headers } }, (res) => { const b = []; res.on("data", (c) => b.push(c)); res.on("end", () => ok({ status: res.statusCode, headers: res.headers, body: Buffer.concat(b) })); }); r.on("error", no); if (data) r.write(JSON.stringify(data)); r.end(); });
{
  seen.length = 0; events.length = 0;
  const pl = await skills.runTool("drive_play", { query: "wedding video" });
  const cmd = [...events].reverse().find((e) => e.type === "media")?.data;
  check("drive_play plays it on the screen through Dayspring's own address", /Wedding Video/.test(pl.say ?? "") && cmd?.provider === "local" && cmd.queue[0].src === "/api/drive/stream?ref=g1%3Apv1wedding", JSON.stringify(cmd?.queue?.[0]));
  let r = await get(cmd.queue[0].src.replace(/^\/api/, "/api"), { range: "bytes=100-299" });
  const up = seen.find((s) => s.query.alt === "media");
  check("the proxy passes Range through (206, the right bytes)", r.status === 206 && r.body.equals(VIDEO.subarray(100, 300)) && r.headers["content-range"] === `bytes 100-299/${VIDEO.length}` && up?.range === "bytes=100-299", `${r.status} ${r.headers["content-range"]}`);
  check("…the Google token was used only between Dayspring and Google", /^Bearer at-me@example\.com-/.test(up?.auth ?? ""));
  const everything = JSON.stringify(r.headers) + r.body.toString("latin1") + JSON.stringify(events);
  check("…and never reaches the page (not in the headers, the body, or anything sent to the screen)", !/at-me@example|at-boss@work|rt-|Bearer|authorization|x-goog-hash/i.test(everything));
  r = await get("/api/drive/stream?ref=g1:pv1wedding");
  check("the whole file without Range (200)", r.status === 200 && r.body.equals(VIDEO) && r.headers["content-type"] === "video/mp4");
  r = await get("/api/drive/stream?ref=g1:pd1budget");
  check("only audio, video and pictures stream (a Doc is refused)", r.status === 415 || r.status === 404, r.status);
  r = await get("/api/drive/stream?ref=g9:pv1wedding");
  check("an account that isn't connected → refused", r.status === 404, r.status);
  r = await get("/api/drive/stream?ref=../../etc");
  check("a made-up reference → refused", r.status === 400 || r.status === 404, r.status);
  r = await get("/api/connect/google/account", {}, "POST", { action: "update", id: "g1", nickname: "Personal", open: false });
  check("Settings' account route: nickname saved; the answer has emails only", r.status === 200 && JSON.parse(r.body).accounts.find((a) => a.id === "g1").nickname === "Personal" && !/rt-|at-|dpapi|GOCSPX/.test(r.body.toString()));
}

// ---- 7. changing Drive: always asks, always logged ----------------------------------------------------------------------------------
{
  const yes = () => confirm.userSaid("yes");
  let r = await skills.runTool("drive_upload", { name: "Report.txt", text: "the report text", folder: "Archive", account: "work" });
  check("upload asks first (needsConfirm with a one-time token)", r.needsConfirm && r.confirm_token && /Upload Report\.txt .* to Archive in Work/.test(r.text), JSON.stringify(r));
  const tok = r.confirm_token;
  r = await skills.runTool("drive_upload", { name: "Report.txt", text: "the report text", folder: "Archive", account: "work", confirm_token: tok });
  check("…the AI can't approve it itself (the token waits for the owner's yes)", r.needsConfirm && r.waiting && !files["boss@work.com"].some((f) => f.name === "Report.txt"));
  yes();
  r = await skills.runTool("drive_upload", { name: "Report.txt", text: "different text!", folder: "Archive", account: "work", confirm_token: tok });
  check("…a yes for one upload doesn't cover different content", (r.refused || r.needsConfirm) && !files["boss@work.com"].some((f) => f.name === "Report.txt"), JSON.stringify(r));
  r = await skills.runTool("drive_upload", { name: "Report.txt", text: "the report text", folder: "Archive", account: "work" });
  yes();
  r = await skills.runTool("drive_upload", { name: "Report.txt", text: "the report text", folder: "Archive", account: "work", confirm_token: r.confirm_token });
  const upf = files["boss@work.com"].find((f) => f.name === "Report.txt");
  check("…after the owner's yes: uploaded into that folder (multipart)", r.uploaded === "Report.txt" && upf?.parents?.[0] === "wf1archive" && upf.uploadType === "multipart" && upf.bytes.toString().includes("the report text"), JSON.stringify(r));
  check("…and logged (name, size and fingerprint; not the text)", activity.search({ kind: "drive.upload" }).entries[0]?.name === "Report.txt" && !JSON.stringify(activity.search({ kind: "drive.upload" }).entries).includes("the report text"));
  r = await skills.runTool("drive_mkdir", { name: "Projects", account: "work" });
  check("make a folder: asks first", r.needsConfirm && !files["boss@work.com"].some((f) => f.name === "Projects"));
  yes(); r = await skills.runTool("drive_mkdir", { name: "Projects", account: "work", confirm_token: r.confirm_token });
  check("…then makes it, and logs it", r.created === "Projects" && files["boss@work.com"].some((f) => f.name === "Projects" && f.mimeType === "application/vnd.google-apps.folder") && activity.search({ kind: "drive.mkdir" }).total === 1);
  r = await skills.runTool("drive_move", { file: "g2:wd1report", to: "Archive", rename: "Q3 Report (final)" });
  check("move and rename: asks first", r.needsConfirm && /move Q3 Report to Archive and rename it/.test(r.text));
  yes(); r = await skills.runTool("drive_move", { file: "g2:wd1report", to: "Archive", rename: "Q3 Report (final)", confirm_token: r.confirm_token });
  const moved = files["boss@work.com"].find((f) => f.id === "wd1report");
  check("…then moves it (addParents / removeParents) and logs it", moved.parents[0] === "wf1archive" && moved.name === "Q3 Report (final)" && activity.search({ kind: "drive.move" }).total === 1);
  seen.length = 0;
  r = await skills.runTool("drive_trash", { file: "g2:ws1numbers" });
  check("trash: asks first, and says it can be restored", r.needsConfirm && /trash.*30 days.*Are you sure/.test(r.text));
  yes(); r = await skills.runTool("drive_trash", { file: "g2:ws1numbers", confirm_token: r.confirm_token });
  check("…then moves it to Drive's trash (trashed: true), never a DELETE", r.trashed === "Numbers" && files["boss@work.com"].find((f) => f.id === "ws1numbers").trashed === true && !seen.some((s) => s.method === "DELETE"));
  check("…logged", activity.search({ kind: "drive.trash" }).entries[0]?.file === "Numbers");
  r = await skills.runTool("drive_move", { file: "g1:pt1notes", to: "root", rename: "x" });
  check("a Drive that's look-only can't be changed (account 1)", r.denied && /isn't allowed to add or change files in Personal/.test(r.text), JSON.stringify(r));
  check("every question and yes is in the log", activity.search({ kind: "confirm.asked" }).total >= 5 && activity.search({ kind: "confirm.given" }).total >= 4);
  // download into a folder on this computer: file permission plus a yes
  permissions.set({ files: "off", choice: true });
  r = await skills.runTool("drive_download", { file: "g1:pt1notes", to: DL });
  check("download with file access off: refused", r.denied === true && !existsSync(join(DL, "Notes.txt")));
  permissions.set({ files: "custom", entries: [{ path: DL, kind: "folder", access: "readwrite" }], can: { create: true }, choice: true });
  r = await skills.runTool("drive_download", { file: "g1:pt1notes", to: DL });
  check("download: asks first", r.needsConfirm && !existsSync(join(DL, "Notes.txt")));
  yes(); r = await skills.runTool("drive_download", { file: "g1:pt1notes", to: DL, confirm_token: r.confirm_token });
  check("…then saves it there, and logs the new file", existsSync(join(DL, "Notes.txt")) && readFileSync(join(DL, "Notes.txt"), "utf8") === "plain notes in drive" && activity.search({ kind: "file.create" }).entries[0]?.via === "drive_download");
}

// ---- 8/9. Calendar and Gmail with two accounts; removing one leaves the other ------------------------------------------------------
{
  seen.length = 0;
  connectors.clearCache();
  const ev = await connectors.externalEvents("2026-09-28", "2026-09-28");
  check("the schedule gets events from both accounts' calendars", ev.length === 2 && ev.some((e) => e.title === "me meeting") && ev.some((e) => e.title === "boss meeting"), JSON.stringify(ev.map((e) => e.title)));
  const cals = await google.calendars();
  check("the primary account's calendar is “primary”; the other is named after its account", cals.find((c) => c.id === "me@example.com")?.primary === true && cals.find((c) => c.id === "boss@work.com")?.name === "Work" && !cals.find((c) => c.id === "boss@work.com").primary);
  let m = await connectors.runTool("email_search", {});
  check("email_search uses the primary account unless another is named", m.messages?.length === 1 && m.messages[0].id === "msg-me", JSON.stringify(m));
  m = await connectors.runTool("email_search", { account: "work" });
  check("…“check my work email” (account: work) uses that one", m.messages?.[0]?.id === "msg-boss");
  const rd = await connectors.runTool("email_read", { id: "msg-boss" });
  check("reading a Work email goes back to the Work account", /Body for boss@work.com/.test(rd.text ?? ""), JSON.stringify(rd).slice(0, 120));
  const dr = await connectors.runTool("email_draft", { reply_to_id: "msg-boss", text: "Thanks!" });
  check("a reply draft is saved in the same account's Gmail (never sent)", /Work's Gmail Drafts \(not sent\)/.test(dr.saved ?? ""), JSON.stringify(dr));
  seen.length = 0;
  await connectors.runTool("calendar_add_event", { title: "Dentist", date: "2026-09-29", start: "15:00", end: "16:00" });
  check("adding an event goes to the primary account's calendar", seen.some((s) => s.method === "POST" && s.email === "me@example.com") && !seen.some((s) => s.method === "POST" && s.email === "boss@work.com"));
  seen.length = 0;
  await connectors.runTool("calendar_add_event", { title: "Standup", date: "2026-09-29", start: "09:00", end: "09:15", account: "work" });
  check("…or to the account named (account: work)", seen.some((s) => s.method === "POST" && s.email === "boss@work.com"));
  seen.length = 0;
  await google.updateEvent({ id: "g:ev-boss", calendarId: "boss@work.com", date: "2026-09-28", start: "12:00", end: "13:00" });
  check("moving a Work event (the conflict resolver) goes to the Work account", seen.some((s) => s.method === "PATCH" && s.email === "boss@work.com"));
  const calsync = await imp("lib/calsync.mjs");
  check("calsync still sees Google connected", calsync.status().google.connected === true);
  const bad = await connectors.runTool("email_search", { account: "school" });
  check("an account label that doesn't exist: says which ones do", /I don't have a Google account called "school"/.test(bad.error ?? ""), JSON.stringify(bad));
  // remove the primary one
  const before = revoked.length;
  const st = await google.remove("g1");
  check("removing one account leaves the other (and it becomes primary)", st.accounts.length === 1 && st.accounts[0].email === "boss@work.com" && st.accounts[0].primary);
  check("…the removed account's sign-in is withdrawn at Google", revoked.length === before + 1 && /^rt-me@example\.com-/.test(revoked.at(-1)));
  check("…and it's gone from the file", !fileText().includes("me@example.com"));
  connectors.clearCache();
  const ev2 = await connectors.externalEvents("2026-09-28", "2026-09-28");
  check("Calendar keeps working with the one that's left", ev2.length === 1 && ev2[0].title === "boss meeting");
  const r = await drive.search({ query: "wedding" });
  check("Drive keeps working with the one that's left", r.files.length === 1 && r.files[0].drive === "Work");
  m = await connectors.runTool("email_search", {});
  check("Gmail now uses the remaining account", m.messages?.[0]?.id === "msg-boss");
}

// ---- 10. Drive audio in the same "play …" searches ----------------------------------------------------------------------------------
{
  const FF = createRequire(join(DESK, "package.json"))("ffmpeg-static");
  spawnSync(FF, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=duration=2", "-c:a", "libmp3lame", "-metadata", "title=Wedding March", "-metadata", "artist=Organ", join(MUSIC, "Wedding March.mp3")], { windowsHide: true });
  permissions.set({ files: "custom", entries: [{ path: MUSIC, kind: "folder", access: "read" }, { path: DL, kind: "folder", access: "readwrite" }], choice: true });
  library._reset(); await library.scanNow();
  const { parse } = await imp("lib/medialib/phrases.mjs");
  const both = await skills.gather(parse("play wedding march"));
  check("“play wedding march”: his file first, then the Drive one (labelled)", both.length === 2 && both[0].source === "local" && both[1].source === "drive" && both[1].drive === "Work", JSON.stringify(both.map((x) => [x.source, x.title, x.drive])));
  events.length = 0;
  const r = await skills.command("play wedding march from my work drive");
  const q = [...events].reverse().find((e) => e.type === "media")?.data?.queue?.[0];
  check("“…from my work drive”: that Drive's file, streamed through Dayspring", /Wedding March.*from Work's Drive/.test(r?.reply ?? "") && /^\/api\/drive\/stream\?ref=g2%3Awa1march$/.test(q?.src ?? ""), `${r?.reply} ${q?.src}`);
  const res = await get(q.src.replace(/^\/api/, "/api"), { range: "bytes=0-99" });
  check("…and it plays (Range through the proxy)", res.status === 206 && res.body.equals(SONG.subarray(0, 100)));
}

// ---- 11. Google Meet invitations (meet_invite): asks first, then Google emails the invitations ------------------------------
{
  const confirm = await imp("lib/confirm.mjs");
  const ask = { title: "Dayspring demo", date: "2026-09-28", start: "19:00", minutes: 45, invitees: ["Friend@Example.com", "pal@example.org"] };
  created.length = 0;
  let r = await connectors.runTool("meet_invite", ask);
  check("meet_invite asks first: nothing is created and nobody is emailed before the owner's yes", r.needsConfirm && r.confirm_token && created.length === 0 && /friend@example\.com, pal@example\.org/.test(r.text), JSON.stringify(r));
  let r2 = await connectors.runTool("meet_invite", { ...ask, confirm_token: r.confirm_token });
  check("…the model can't approve it by itself (no yes from the owner yet)", r2.needsConfirm && created.length === 0, JSON.stringify(r2));
  confirm.userSaid("yes");
  r2 = await connectors.runTool("meet_invite", { ...ask, confirm_token: r2.confirm_token });
  const c = created[0];
  check("after the owner's yes: one event with a new Google Meet, invitations sent by Google (sendUpdates=all)", created.length === 1 && c.query.conferenceDataVersion === "1" && c.query.sendUpdates === "all" && c.body.conferenceData?.createRequest?.conferenceSolutionKey?.type === "hangoutsMeet", JSON.stringify(c));
  check("…with both people invited (emails tidied), 7:00–7:45 PM", JSON.stringify(c.body.attendees) === JSON.stringify([{ email: "friend@example.com" }, { email: "pal@example.org" }]) && /T19:00:00$/.test(c.body.start.dateTime) && /T19:45:00$/.test(c.body.end.dateTime), JSON.stringify(c.body));
  check("…and it hands back the Meet link", r2.meet === "https://meet.google.com/abc-defg-hij" && /meet\.google\.com/.test(r2.said), JSON.stringify(r2));
  const bad = await connectors.runTool("meet_invite", { ...ask, invitees: ["sam"] });
  check("a name without an email address is refused (it asks for the email)", /aren't email addresses: sam/.test(bad.error ?? ""), JSON.stringify(bad));
  const token = (await connectors.runTool("meet_invite", ask)).confirm_token;
  confirm.userSaid("yes");
  const changed = await connectors.runTool("meet_invite", { ...ask, invitees: ["someone@else.com"], confirm_token: token });
  check("a yes only covers the exact invitation it was asked about (a different guest list asks again)", changed.needsConfirm && created.length === 1, JSON.stringify(changed));
}

app.close(); mock.close();
try { rmSync(TMP, { recursive: true, force: true }); } catch { /* temp */ }
console.log(`\n${fail ? "FAILED" : "ALL PASSED"}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
