// Email on the Dayspring screen and in Settings, in headless Chrome, on a throwaway copy (port 4773) talking to stand-in
// mail servers (scripts/qa/fixtures/mail/mock-servers.mjs): never a real account, never the real data folder.
//   · Settings → Email: add a mailbox with Test connection (a wrong password and a right one), choices saved and still
//     there after a reload, a signature written in its rich editor
//   · the Mail window at 1280×720, 1920×1080 and mini (380×560): folders | list | reader (collapsing when narrow), inside
//     the screen's margins; reading in a sandboxed frame with pictures held back until "Show pictures"; several selected
//     and archived / moved to Trash (with a confirm); the unread badge; keyboard shortcuts
//   · the email editor: every toolbar control is there and works (the formatting reaches the email exactly as the editor
//     has it), emoji, table, divider, undo/redo, attachments (size and the 25 MB warning), several editors at once,
//     minimise to a tab, maximise, resizable, inside the margins; auto-save to Drafts; Send, and Undo send; dictation
//     (word for word, and organize my thoughts without AI); an AI change shown with Undo; GIFs from the GIF picker
//   · the invitation editor opens with its fields and agenda
//   node scripts/qa/email-ui.mjs [--keep]
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { qaPort } from "./port.mjs";   // a free port (or QA_PORT), so parallel runs never collide
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import MailComposer from "nodemailer/lib/mail-composer";
import { simpleParser } from "mailparser";
import { startImap, startSmtp } from "./fixtures/mail/mock-servers.mjs";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PW = [join(DESK, "node_modules", "playwright-core", "index.mjs"), join(DESK, "..", "..", "..", "dayspring-app", "node_modules", "playwright-core", "index.mjs")].find((p) => existsSync(p));
if (!PW) { console.log("FAIL  playwright-core not found"); process.exit(1); }
const { chromium } = await import(pathToFileURL(PW).href);
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = await qaPort(4773), BASE = `http://127.0.0.1:${PORT}`;
const TMP = mkdtempSync(join(tmpdir(), "ds-emailui-")), APP = join(TMP, "app");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0, pass = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && got !== "" ? "  (" + String(got).slice(0, 400) + ")" : ""}`); };

// ---- stand-in mail servers with a few emails ----
const USER = "me@mockmail.test", PASS = "apppassword1234";
const imap = await startImap({ user: USER, pass: PASS });
const smtp = await startSmtp({ user: USER, pass: PASS });
const mimeOf = (o) => new MailComposer(o).compile().build();
const now = Date.now();
for (const [i, o] of [
  { from: "Pat <pat@work.test>", subject: "Project plan", text: "Here's the plan." },
  { from: "First Bank <alerts@bank.test>", subject: "Your statement is ready", text: "Your monthly statement is ready." },
  { from: "News <news@letters.test>", subject: "Weekly letter", html: "<p>News of the week</p>" },
  { from: "Sam Carter <sam@friends.test>", subject: "Dinner Friday", html: `<p>Hi! <b>Dinner</b> at 7?</p><img src="https://tracker.test/pixel.gif" width="1" height="1"><script>document.title="hacked"</script>`, text: "Hi! Dinner at 7?", attachments: [{ filename: "menu.pdf", content: Buffer.from("%PDF fake"), contentType: "application/pdf" }] },
].entries()) imap.add("INBOX", await mimeOf({ to: USER, date: new Date(now - (4 - i) * 3600_000), ...o }), i === 0 ? ["\\Seen"] : [], new Date(now - (4 - i) * 3600_000));

// ---- a throwaway copy of Dayspring ----
spawnSync(process.execPath, [join(DESK, "scripts", "export.mjs"), APP], { encoding: "utf8" });
spawnSync("cmd.exe", ["/d", "/c", "mklink", "/J", join(APP, "node_modules"), join(DESK, "node_modules")], { windowsHide: true });
mkdirSync(join(APP, "data"), { recursive: true });
writeFileSync(join(APP, "data", "owner.json"), JSON.stringify({ name: "Tester", setupDone: true, display: "primary" }));
const env = { ...process.env, PORT: String(PORT), DAYSPRING_DISPLAY: "", DAYSPRING_TV: "", DAYSPRING_NO_BROWSER: "1", DAYSPRING_DEVICES_DRYRUN: "1", DAYSPRING_NO_OVERLAY: "1", DAYSPRING_NO_ECO: "1", DS_PROFILE: "DayspringQA",
  DAYSPRING_CHANNEL: "dev", DAYSPRING_TOKEN_CRYPTO: "fake", DAYSPRING_MAIL_PEOPLE: "0", DAYSPRING_MAIL_UNDO_MS: "2500", DAYSPRING_MAIL_SENDER_NAME: "Tester" };
const server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let serverLog = ""; server.stdout.on("data", (d) => (serverLog += d)); server.stderr.on("data", (d) => (serverLog += d));
const up = async () => { try { return (await fetch(`${BASE}/api/build`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };
let isUp = false; for (let i = 0; i < 120 && !(isUp = await up()); i++) await sleep(500);
check("the throwaway server is up", isUp, serverLog.slice(-400));
const J = async (p, body, headers = {}) => { const r = await fetch(BASE + "/api" + p, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };

const browser = await chromium.launch(existsSync(CHROME) ? { executablePath: CHROME, headless: true, args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required"] }
  : { channel: (await import(pathToFileURL(join(DESK, "lib", "browsers.mjs")).href)).playwrightChannel(), headless: true, args: ["--mute-audio"] });
const mock = () => {
  window.__dsAllowAutomatedListen = true;
  const ss = window.speechSynthesis; if (ss) { ss.speak = (u) => setTimeout(() => u.onend?.(), 10); ss.cancel = () => {}; }
  HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  class FakeSR { start() {} abort() { setTimeout(() => this.onend?.(), 5); } stop() { this.abort(); } }
  window.SpeechRecognition = window.webkitSpeechRecognition = FakeSR;
};
const DEVICE_ROUTES = /\/api\/(sound|window|devices\/use|voicemeeter\/(install|setup)|keepawake|tunein|callbridge|open|app\/quit|update)/;
async function page({ w, h, path = "/display" }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(mock);
  await ctx.route("**/*", (rt) => { const u = rt.request().url(); if (rt.request().method() === "POST" && DEVICE_ROUTES.test(u)) return rt.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }); if (!u.startsWith(BASE) && !u.startsWith("data:")) return rt.fulfill({ status: 404, body: "" }); return rt.continue(); });
  const p = await ctx.newPage(); p.errs = []; p.on("pageerror", (e) => p.errs.push(String(e.stack || e.message).slice(0, 300)));
  await p.goto(BASE + path); await p.waitForTimeout(1800);
  if (await p.locator("#startBtn").isVisible().catch(() => false)) { await p.click("#startBtn"); await p.waitForTimeout(500); }
  p.ctx = ctx;
  return p;
}
const saveMargins = (m) => fetch(BASE + "/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ overscan: 0, marginTop: m, marginBottom: m, marginLeft: m, marginRight: m }) });
// is it inside the safe rectangle, and are its buttons clickable?
const inside = (p, sel) => p.evaluate((s) => {
  const el = [...document.querySelectorAll(s)].find((e) => e.getBoundingClientRect().width > 1 && !e.closest("[hidden]"));
  if (!el) return { found: false };
  const S = window.dsSafeRect(), r = el.getBoundingClientRect(), t = 1.5;
  const ok = r.left >= S.left - t && r.top >= S.top - t && r.right <= S.right + t && r.bottom <= S.bottom + t;
  return { found: true, ok, box: `${Math.round(r.left)},${Math.round(r.top)}→${Math.round(r.right)},${Math.round(r.bottom)}`, safe: `${Math.round(S.left)},${Math.round(S.top)}→${Math.round(S.right)},${Math.round(S.bottom)}` };
}, sel);

// ================================================================================ Settings → Email
{
  const p = await page({ w: 1280, h: 900, path: "/settings?s=email" });
  await p.waitForSelector("#emAdd", { timeout: 8000 }).catch(() => {});
  check("Settings → Email is in the Settings list (under Apps & connections)", await p.evaluate(() => [...document.querySelectorAll("#nav button")].some((b) => /Email/.test(b.textContent))));
  await p.click('[data-add="other"]');
  await p.fill("#emEmail", USER); await p.fill("#emPass", "wrong-password");
  await p.fill("#emImapHost", "127.0.0.1"); await p.fill("#emImapPort", String(imap.port)); await p.fill("#emSmtpHost", "127.0.0.1"); await p.fill("#emSmtpPort", String(smtp.port));
  await p.click("#emTest");
  await p.waitForFunction(() => /✗|✓/.test(document.querySelector("#emAddMsg")?.textContent ?? ""), null, { timeout: 20000 }).catch(() => {});
  const bad = await p.textContent("#emAddMsg");
  check("Test connection with a wrong app password: says so, plainly", /✗ Reading: .*app password/.test(bad), bad);
  await p.fill("#emPass", PASS);
  await p.click("#emTest");
  await p.waitForFunction(() => /✓ Reading/.test(document.querySelector("#emAddMsg")?.textContent ?? ""), null, { timeout: 20000 }).catch(() => {});
  const good = await p.textContent("#emAddMsg");
  check("…and with the right one: reading (IMAP) and sending (SMTP) both work", /✓ Reading \(IMAP\) works · ✓ Sending \(SMTP\) works/.test(good), good);
  await p.click("#emCanSend"); await p.fill("#emNick", "Home");
  await p.click("#emSave");
  await p.waitForFunction(() => document.querySelectorAll(".embox").length === 1, null, { timeout: 20000 }).catch(() => {});
  check("adding it: the mailbox is listed (nickname, primary, can send), the password field emptied", await p.evaluate(() => { const r = document.querySelector(".embox"); return Boolean(r && /Home/.test(r.textContent) && /Primary/.test(r.textContent) && /can send/.test(r.textContent) && document.querySelector("#emPass").value === ""); }));
  check("…the password is nowhere on the page", !(await p.content()).includes(PASS));
  // test an added mailbox from its row
  await p.click('.embox [data-a="test"]');
  await p.waitForFunction(() => /✓|✗/.test(document.querySelector(".embox [data-msg]")?.textContent ?? ""), null, { timeout: 20000 }).catch(() => {});
  check("Test connection on a saved mailbox", /✓ Reading \(IMAP\) works/.test(await p.textContent(".embox [data-msg]")));
  // choices + a signature, saved and still there after a reload
  await p.evaluate(() => { document.querySelector("#emUndo").value = "5"; document.querySelector("#emUndo").dispatchEvent(new Event("input", { bubbles: true })); });
  await p.selectOption("#emTone", "formal"); await p.selectOption("#emPreview", "2"); await p.selectOption("#emImages", "known"); await p.fill("#emAuto", "2");
  await p.click("#emConv");                                        // conversation view off
  await p.check('input[name=emAi][value="headers"]');
  await p.click("#emSigAdd"); await p.fill("#emSigName", "Home sig");
  await p.click("#emSigEd .ql-editor"); await p.keyboard.type("Best wishes, Tester");
  await p.click("#next");
  await p.waitForTimeout(1200);
  const saved = await J("/mail/settings");
  check("Save: the choices reach Dayspring", saved.prefs.undoSeconds === 5 && saved.prefs.tone === "formal" && saved.prefs.previewLines === 2 && saved.prefs.remoteImages === "known" && saved.prefs.conversationView === false && saved.prefs.aiAccess === "headers" && saved.prefs.autosaveSeconds === 2, JSON.stringify(saved.prefs));
  check("…and the signature (from the rich editor)", /Best wishes, Tester/.test(saved.boxes[0].signatures?.[0]?.html ?? "") && saved.boxes[0].defaultSig === saved.boxes[0].signatures[0].id, JSON.stringify(saved.boxes[0]).slice(0, 300));
  await p.reload(); await p.waitForSelector(".embox", { timeout: 8000 }).catch(() => {});
  const back = await p.evaluate(() => ({ undo: document.querySelector("#emUndo").value, tone: document.querySelector("#emTone").value, prev: document.querySelector("#emPreview").value, conv: document.querySelector("#emConv").getAttribute("aria-checked"), ai: document.querySelector("input[name=emAi]:checked")?.value, sig: document.querySelector("#emSigEd .ql-editor")?.textContent }));
  check("…and they're still there after reloading the page", back.undo === "5" && back.tone === "formal" && back.prev === "2" && back.conv === "false" && back.ai === "headers" && /Best wishes/.test(back.sig), JSON.stringify(back));
  await J("/mail/settings", { prefs: { aiAccess: "full", conversationView: true, remoteImages: "ask", previewLines: 1 } });
  check("Settings → Email: no page errors", p.errs.length === 0, p.errs.join(" | "));
  await p.ctx.close();
}

// ================================================================================ the Mail window, three sizes
for (const [path, w, h, m] of [["/display", 1920, 1080, 0], ["/display", 1280, 720, 8], ["/mini", 380, 560, 0]]) {
  const tag = `${path} ${w}×${h}${m ? ` margins ${m}%` : ""}`;
  await saveMargins(m);
  const p = await page({ w, h, path });
  await p.waitForTimeout(600);
  const badge = await p.evaluate(() => document.querySelector("#mailBadge")?.textContent ?? "");
  const unseen = imap.state.boxes.get("INBOX").msgs.filter((m) => !m.flags.has("\\Seen")).length;
  check(`${tag}: the ✉ button shows the unread count`, badge === String(unseen) && unseen > 0, `${badge} vs ${unseen}`);
  await p.evaluate(() => window.dsMail.open());
  await p.waitForFunction(() => document.querySelectorAll(".mw-row").length >= 4, null, { timeout: 15000 }).catch(() => {});
  const lay = await p.evaluate(() => { const vis = (s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 20 && r.height > 20 && getComputedStyle(e).display !== "none"; }; return { folders: vis(".mw-folders"), list: vis(".mw-list"), read: vis(".mw-read"), sel: vis(".mw-foldersel"), rows: document.querySelectorAll(".mw-row").length, narrow: document.querySelector(".mailwin").classList.contains("narrow") }; });
  if (w >= 1280) check(`${tag}: three panes side by side (folders | list | reader)`, lay.folders && lay.list && lay.read && !lay.narrow && lay.rows === 4, JSON.stringify(lay));
  else check(`${tag}: narrow: the folders become a menu and the list fills the window`, !lay.folders && lay.sel && lay.list && !lay.read && lay.narrow && lay.rows === 4, JSON.stringify(lay));
  let r = await inside(p, ".mailwin"); check(`${tag}: the Mail window is inside the margins`, r.ok, `${r.box} safe ${r.safe}`);
  // read "Dinner Friday"
  await p.evaluate(() => [...document.querySelectorAll(".mw-row")].find((x) => /Dinner Friday/.test(x.textContent)).click());
  await p.waitForSelector(".mw-frame", { timeout: 10000 }).catch(() => {});
  const rd = await p.evaluate(() => { const f = document.querySelector(".mw-frame"); const vis = (s) => { const e = document.querySelector(s); return Boolean(e && e.getBoundingClientRect().width > 20 && getComputedStyle(e).display !== "none"); }; return { sandbox: f?.getAttribute("sandbox"), doc: f?.srcdoc ?? "", note: document.querySelector(".mw-note")?.textContent ?? "", atts: document.querySelectorAll(".mw-att").length, list: vis(".mw-list"), read: vis(".mw-read"), title: document.title }; });
  check(`${tag}: the email shows in a sandboxed frame (no scripts: "allow-scripts" isn't there)`, rd.sandbox && !/allow-scripts|allow-same-origin/.test(rd.sandbox) && !/<script/i.test(rd.doc) && rd.title !== "hacked", rd.sandbox);
  check(`${tag}: the tracking picture is held back, with “Show pictures”`, /held back/.test(rd.note) && !/\ssrc="https:\/\/tracker/.test(rd.doc) && /Content-Security-Policy/.test(rd.doc), rd.note);
  check(`${tag}: the attachment is listed`, rd.atts === 1);
  if (w < 700) check(`${tag}: narrow: the reader takes the window (with ← Back)`, rd.read && !rd.list && await p.isVisible(".mw-back"), JSON.stringify(rd).slice(0, 100));
  r = await inside(p, ".mw-racts"); check(`${tag}: the reader's buttons are inside the margins`, r.ok, `${r.box} safe ${r.safe}`);
  await p.click('[data-r="images"]');
  await p.waitForFunction(() => /\ssrc="https:\/\/tracker\.test/.test(document.querySelector(".mw-frame")?.srcdoc ?? ""), null, { timeout: 10000 }).catch(() => {});
  check(`${tag}: “Show pictures” shows them (this once)`, await p.evaluate(() => /\ssrc="https:\/\/tracker\.test/.test(document.querySelector(".mw-frame")?.srcdoc ?? "")));
  if (w < 700) await p.click(".mw-back");
  check(`${tag}: no page errors`, p.errs.length === 0, p.errs.join(" | "));
  await p.ctx.close();
}
await saveMargins(0);

// ================================================================================ organizing, several at once; keyboard
{
  const p = await page({ w: 1600, h: 900 });
  await p.evaluate(() => window.dsMail.open());
  await p.waitForFunction(() => document.querySelectorAll(".mw-row").length >= 4, null, { timeout: 15000 }).catch(() => {});
  for (const s of ["Weekly letter", "Project plan"]) await p.evaluate((t) => { const r = [...document.querySelectorAll(".mw-row")].find((x) => x.textContent.includes(t)); r.querySelector("input").click(); }, s);
  check("select two: the bulk bar shows “2 selected”", /2 selected/.test(await p.textContent(".mw-bulk")) && await p.isVisible(".mw-bulk"));
  await p.click('[data-b="archive"]');
  await p.waitForFunction(() => document.querySelectorAll(".mw-row").length === 2, null, { timeout: 15000 }).catch(() => {});
  check("…Archive: both leave the inbox and land in Archive on the server", imap.state.boxes.get("Archive").msgs.length === 2 && imap.state.boxes.get("INBOX").msgs.length === 2, imap.state.boxes.get("Archive").msgs.length);
  await p.evaluate(() => [...document.querySelectorAll(".mw-row")].find((x) => x.textContent.includes("statement")).querySelector("input").click());
  await p.click('[data-b="trash"]');
  await p.waitForSelector(".mailconfirm", { timeout: 5000 }).catch(() => {});
  check("Trash asks first (a confirm inside the margins)", await p.isVisible(".mailconfirm") && (await inside(p, ".mailconfirm .box")).ok);
  await p.click('.mailconfirm [data-v="1"]');
  await p.waitForFunction(() => document.querySelectorAll(".mw-row").length === 1, null, { timeout: 15000 }).catch(() => {});
  check("…then it's in the Trash folder (still on the server)", imap.state.boxes.get("Trash").msgs.length === 1);
  // keyboard: j, Enter, ?, Esc
  await p.focus(".mailwin"); await p.keyboard.press("j"); await p.keyboard.press("Enter");
  await p.waitForSelector(".mw-frame", { timeout: 8000 }).catch(() => {});
  check("keys: j then Enter opens the email", await p.isVisible(".mw-frame"));
  await p.focus(".mailwin"); await p.keyboard.press("?");
  check("keys: ? shows the shortcuts (inside the margins)", await p.isVisible(".mailhelp") && (await inside(p, ".mailhelp .box")).ok);
  await p.keyboard.press("Escape");
  check("…Esc closes them", !(await p.isVisible(".mailhelp").catch(() => false)));
  check("organizing: no page errors", p.errs.length === 0, p.errs.join(" | "));
  await p.ctx.close();
}

// ================================================================================ the email editor
const TOOLBAR = ["ql-font", "ql-size", "ql-header", "ql-bold", "ql-italic", "ql-underline", "ql-strike", "ql-color", "ql-background", "ql-list", "ql-indent", "ql-align", "ql-blockquote", "ql-code", "ql-code-block", "ql-link", "ql-image", "ql-divider", "ql-tablemenu", "ql-emoji", "ql-clean", "ql-undo", "ql-redo", "ql-dictate", "ql-shortcuts"];
{
  const p = await page({ w: 1600, h: 900 });
  await p.evaluate(() => { window.__gifPicked = null; window.dsGifPicker = { open: ({ onPick }) => onPick({ url: "https://gifs.test/dance.gif", title: "dance", source: "test", file: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" }) }; });
  await p.evaluate(() => window.dsMailCompose.newEmail({}));
  await p.waitForSelector(".mailcomp .ql-editor", { timeout: 10000 }).catch(() => {});
  const tb = await p.evaluate((list) => list.filter((c) => !document.querySelector(`.mailcomp .mc-tb .${c}`)), TOOLBAR);
  check(`the editor's toolbar has every control (${TOOLBAR.length})`, tb.length === 0, tb.join(", "));
  check("…fonts, sizes, colours and alignment are pickers; the GIF button shows when the GIF picker is there", await p.evaluate(() => document.querySelectorAll(".mailcomp .ql-picker").length >= 6 && !document.querySelector(".mailcomp .ql-gif").hidden));
  check("spell check is on (the browser's own), in the chosen language", await p.evaluate(() => document.querySelector(".mailcomp .ql-editor").getAttribute("spellcheck") === "true" && Boolean(document.querySelector(".mailcomp .ql-editor").getAttribute("lang"))));
  let r = await inside(p, ".mailcomp"); check("the editor window is inside the margins", r.ok, `${r.box} safe ${r.safe}`);
  check("…and resizable", await p.evaluate(() => getComputedStyle(document.querySelector(".mailcomp")).resize === "both"));
  check("…with the signature for this mailbox already in it", /Best wishes, Tester/.test(await p.textContent(".mailcomp .ql-editor")));
  // To with a suggestion, subject
  await p.click(".mailcomp [data-f=to] input"); await p.keyboard.type("sam@friends.test"); await p.keyboard.press("Enter");
  await p.fill(".mailcomp [data-f=subject]", "Formatting test");
  // format with the toolbar: each control, on its own line
  await p.evaluate(() => { const q = window.dsMailCompose.editors.values().next().value.quill; q.setContents([], "silent"); });
  const line = async (text, fmt) => { await p.evaluate(({ text }) => { const q = window.dsMailCompose.editors.values().next().value.quill; const i = q.getLength() - 1; q.insertText(i, text + "\n", "user"); q.setSelection(i, text.length, "user"); }, { text }); await fmt(); };
  const click = (sel) => () => p.click(`.mailcomp .mc-tb ${sel}`);
  const pick = (cls, value) => async () => { await p.click(`.mailcomp .mc-tb .ql-picker.${cls} .ql-picker-label`); await p.click(`.mailcomp .mc-tb .ql-picker.${cls} .ql-picker-item[data-value="${value}"]`); };
  await line("Bold words", click(".ql-bold"));
  await line("Italic words", click(".ql-italic"));
  await line("Underlined", click(".ql-underline"));
  await line("Struck", click(".ql-strike"));
  await line("A heading", pick("ql-header", "2"));
  await line("Big Georgia", async () => { await pick("ql-font", "Georgia, serif")(); await pick("ql-size", "20px")(); });
  await line("Red text", pick("ql-color", "#e60000"));
  await line("Highlighted", pick("ql-background", "#ffff00"));
  await line("First item", click('.ql-list[value="ordered"]'));
  await line("A bullet", click('.ql-list[value="bullet"]'));
  await line("Indented", click('.ql-indent[value="+1"]'));
  await line("Centred", pick("ql-align", "center"));
  await line("Quoted", click(".ql-blockquote"));
  await line("mono()", click(".ql-code"));
  await p.evaluate(() => { const q = window.dsMailCompose.editors.values().next().value.quill; const i = q.getLength() - 1; q.insertText(i, "a link\n", "user"); q.formatText(i, 6, "link", "https://example.org/", "user"); q.setSelection(q.getLength() - 1, 0); });
  await p.click(".mailcomp .mc-tb .ql-divider");
  await p.click(".mailcomp .mc-tb .ql-emoji"); await p.click(".mailcomp .mc-emoji button:first-child");
  await p.click(".mailcomp .mc-tb .ql-tablemenu"); await p.click('.mailcomp .mc-menu [data-k="t22"]');
  const html = await p.evaluate(() => window.dsMailCore.emailHtml(window.dsMailCompose.editors.values().next().value.quill, {}));
  const want = [["bold", /<strong>Bold words<\/strong>/], ["italic", /<em>Italic words<\/em>/], ["underline", /<u>Underlined<\/u>/], ["strike", /<s>Struck<\/s>/], ["heading", /<h2>A heading<\/h2>/], ["font and size", /font-family: Georgia, serif;[^"]*font-size: 20px|font-size: 20px;[^"]*font-family: Georgia/],
    ["colour", /color: rgb\(230, 0, 0\)/], ["highlight", /background-color: rgb\(255, 255, 0\)/], ["numbered list", /<ol><li[^>]*>First item/], ["bulleted list", /<ul><li[^>]*>A bullet/], ["indent", /padding-left: 2em/], ["alignment", /text-align: center/],
    ["quote", /<blockquote[^>]*>Quoted/], ["code", /<code[^>]*>mono\(\)<\/code>/], ["link", /<a href="https:\/\/example\.org\/"[^>]*>a link<\/a>/], ["divider", /<hr/], ["emoji", /😀/], ["table", /<table[\s\S]*<td/]];
  const miss = want.filter(([, re]) => !re.test(html)).map(([n]) => n);
  check(`the toolbar's formatting is all in the email's HTML (${want.length} kinds, inline styles, no editor classes)`, !miss.length && !/class="ql-/.test(html), `missing: ${miss.join(", ")} · ${html.slice(0, 400)}`);
  // undo / redo / clear formatting
  const before = await p.evaluate(() => window.dsMailCompose.editors.values().next().value.quill.getText());
  await p.click(".mailcomp .mc-tb .ql-undo");
  const undone = await p.evaluate(() => window.dsMailCompose.editors.values().next().value.quill.getText());
  await p.click(".mailcomp .mc-tb .ql-redo");
  const redone = await p.evaluate(() => window.dsMailCompose.editors.values().next().value.quill.getText());
  check("undo and redo", undone !== before && redone === before, JSON.stringify([before.length, undone.length, redone.length]));
  await p.evaluate(() => { const q = window.dsMailCompose.editors.values().next().value.quill; q.setSelection(0, 10); });
  await p.click(".mailcomp .mc-tb .ql-clean");
  check("clear formatting", await p.evaluate(() => !window.dsMailCompose.editors.values().next().value.quill.getFormat(0, 4).bold));
  // a picture pasted in, and a GIF from the GIF picker
  await p.click(".mailcomp .mc-tb .ql-gif"); await p.click('.mailcomp .mc-menu [data-g="inline"]');
  await p.waitForTimeout(400);
  check("GIF: picked in the GIF picker, it goes into the email (embedded)", await p.evaluate(() => /<img src="data:image\/gif/.test(window.dsMailCompose.editors.values().next().value.quill.root.innerHTML)));
  // attachments: a file from this computer, and the size warning
  await p.setInputFiles(".mailcomp [data-file]", { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("the notes") });
  await p.waitForSelector(".mailcomp .mc-att", { timeout: 8000 }).catch(() => {});
  check("attach a file: it shows with its size", /notes\.txt/.test(await p.textContent(".mailcomp .mc-atts")) && /KB/.test(await p.textContent(".mailcomp .mc-atts")));
  await p.setInputFiles(".mailcomp [data-file]", { name: "big.bin", mimeType: "application/octet-stream", buffer: Buffer.alloc(19 * 1024 * 1024, 1) });
  await p.waitForFunction(() => /close to the 25 MB/.test(document.querySelector(".mailcomp .mc-warn")?.textContent ?? ""), null, { timeout: 30000 }).catch(() => {});
  check("…a warning as it nears the 25 MB limit", /close to the 25 MB limit/.test(await p.textContent(".mailcomp .mc-warn")));
  await p.click(".mailcomp .mc-att:last-child .x");
  check("…and attachments can be removed", !/big\.bin/.test(await p.textContent(".mailcomp .mc-atts")));
  // attach an email (as a .eml)
  await p.click('.mailcomp [data-a="attach"]'); await p.click('.mailcomp .mc-menu [data-k="mail"]');
  await p.waitForSelector(".mailpick input[data-i]", { timeout: 10000 }).catch(() => {});
  await p.evaluate(() => [...document.querySelectorAll(".mailpick li")].find((li) => /Dinner Friday/.test(li.textContent))?.querySelector("input").click());
  await p.click(".mailpick [data-go]");
  await p.waitForFunction(() => /Dinner Friday\.eml/.test(document.querySelector(".mailcomp .mc-atts")?.textContent ?? ""), null, { timeout: 10000 }).catch(() => {});
  check("“Attach an email”: pick one from the mail and it's attached as a .eml", /Dinner Friday\.eml/.test(await p.textContent(".mailcomp .mc-atts")));
  // auto-save to Drafts (every 2 s, as set in Settings)
  const draftsOf = (subject) => imap.state.boxes.get("Drafts").msgs.filter((m) => m.raw.toString("latin1").includes(`Subject: ${subject}`));
  await p.click(".mailcomp .ql-editor"); await p.keyboard.press("End"); await p.keyboard.type(" AUTOSAVED");
  await p.waitForTimeout(4500);
  const ds = draftsOf("Formatting test");
  const dText = ds[0] ? (await simpleParser(ds[0].raw)).text ?? "" : "";
  check("auto-save: it's saved in the mailbox's Drafts on its own, one copy, the latest words", ds.length === 1 && dText.includes("AUTOSAVED") && ds[0].flags.has("\\Draft") && /Saved/.test(await p.textContent(".mailcomp .st")), `${ds.length} ${dText.slice(-80)} ${await p.textContent(".mailcomp .st")}`);
  // Send → the email that arrives has exactly the editor's HTML
  const sentBefore = smtp.got.length;
  const exported = await p.evaluate(() => window.dsMailCore.emailHtml(window.dsMailCompose.editors.values().next().value.quill, window.dsMailCompose.editors.values().next().value && { font: "Arial, Helvetica, sans-serif", size: "14px" }));
  await p.click('.mailcomp [data-a="send"]');
  await p.waitForSelector(".mailtoast", { timeout: 8000 }).catch(() => {});
  check("Send: a “Sending in … s” note with Undo, and the editor steps aside", /Sending in/.test(await p.textContent(".mailtoast")) && await p.isVisible(".mailtoast button") && !(await p.isVisible(".mailcomp")));
  await p.waitForFunction((n) => false, null, { timeout: 3500 }).catch(() => {});
  await sleep(1500);
  const got = smtp.got[sentBefore];
  const norm = (s) => String(s ?? "").replace(/data:image\/gif;base64,[^"]+/g, "IMG").replace(/cid:[^"]+/g, "IMG");
  check("…then it's sent: to Sam, the subject, and the HTML is exactly what the editor had (the GIF as an inline part)", got && got.to.includes("sam@friends.test") && got.parsed.subject === "Formatting test" && norm(got.parsed.html) === norm(exported) && got.parsed.attachments.some((a) => a.filename === "notes.txt") && got.parsed.attachments.some((a) => a.contentType === "image/gif" && a.contentDisposition === "inline"), got ? norm(got.parsed.html).slice(0, 200) + " ≠ " + norm(exported).slice(0, 200) : "nothing sent");
  check("…with the attached email inside it (message/rfc822)", got && /Content-Type: message\/rfc822/i.test(got.raw.toString("latin1")) && /Subject: Dinner Friday/.test(got.raw.toString("latin1")));
  check("…and its draft is gone from Drafts", draftsOf("Formatting test").length === 0, draftsOf("Formatting test").length);
  // Undo send
  await p.evaluate(() => window.dsMailCompose.newEmail({ to: "sam@friends.test", subject: "Oops" }));
  await p.waitForSelector(".mailcomp .ql-editor", { timeout: 8000 });
  const n2 = smtp.got.length;
  await p.click('.mailcomp [data-a="send"]');
  await p.waitForSelector(".mailtoast button", { timeout: 8000 });
  await p.click(".mailtoast button");
  await p.waitForSelector(".mailcomp", { state: "visible", timeout: 8000 }).catch(() => {});
  await sleep(3200);
  check("Undo send: it isn't sent, and the editor comes back", smtp.got.length === n2 && await p.isVisible(".mailcomp"), `${smtp.got.length} vs ${n2}`);
  // several editors: minimise to a tab, maximise, all inside
  await p.evaluate(() => window.dsMailCompose.newEmail({ subject: "Second" }));
  await p.waitForFunction(() => document.querySelectorAll(".mailcomp").length === 2, null, { timeout: 8000 });
  check("two editors at once", await p.evaluate(() => document.querySelectorAll(".mailcomp:not([hidden])").length === 2));
  await p.click('.mailcomp:last-of-type [data-w="min"]');
  check("minimise: it becomes a tab along the bottom (inside the margins)", await p.isVisible(".mailtabs button") && (await inside(p, ".mailtabs")).ok && /Second/.test(await p.textContent(".mailtabs")));
  await p.click(".mailtabs button");
  check("…the tab brings it back", await p.evaluate(() => document.querySelectorAll(".mailcomp:not([hidden])").length === 2));
  await p.click('.mailcomp:last-of-type [data-w="max"]');
  const mx = await p.evaluate(() => { const r = document.querySelector(".mailcomp.max").getBoundingClientRect(), S = window.dsSafeRect(); return { w: Math.round(r.width), sw: Math.round(S.width), h: Math.round(r.height), sh: Math.round(S.height) }; });
  check("maximise: it fills the safe area", Math.abs(mx.w - (mx.sw - 20)) < 4 && Math.abs(mx.h - (mx.sh - 20)) < 4 && (await inside(p, ".mailcomp.max")).ok, JSON.stringify(mx));
  await p.click('.mailcomp.max [data-w="max"]');
  // margins change while editors are open: they move to stay inside
  await saveMargins(10); await p.waitForTimeout(1200);
  const all = await p.evaluate(() => [...document.querySelectorAll(".mailcomp:not([hidden])")].map((e) => { const r = e.getBoundingClientRect(), S = window.dsSafeRect(); return r.left >= S.left - 2 && r.top >= S.top - 2 && r.right <= S.right + 2 && r.bottom <= S.bottom + 2; }));
  check("the margins change (10%): every open editor moves or shrinks to stay inside", all.length === 2 && all.every(Boolean), JSON.stringify(all));
  await saveMargins(0); await p.waitForTimeout(600);
  // dictation, word for word
  await p.evaluate(() => { for (const e of [...window.dsMailCompose.editors.values()].slice(1)) e.el.querySelector('[data-w="close"]').click(); });
  await p.waitForTimeout(600);
  await p.evaluate(() => { const ed = window.dsMailCompose.editors.values().next().value; ed.quill.setContents([], "silent"); ed.quill.setSelection(0, 0); });
  await p.click(".mailcomp .mc-tb .ql-dictate"); await p.click('.mailcomp .mc-menu [data-m="words"]');
  check("🎙 Dictate (word for word): it listens (a bar says so)", await p.isVisible(".mailcomp .mc-dict") && await p.evaluate(() => window.dsDictation.active));
  await p.evaluate(() => { window.dsDictation.take("hello sam comma thanks for dinner period new paragraph see you friday"); window.dsDictation.take("stop dictating"); });
  const dtext = await p.evaluate(() => window.dsMailCompose.editors.values().next().value.quill.getText());
  check("…spoken punctuation works (“comma”, “period”, “new paragraph”) and “stop dictating” stops", /^Hello sam, thanks for dinner\.\n\nSee you friday/.test(dtext) && !(await p.evaluate(() => window.dsDictation.active)), JSON.stringify(dtext));
  const dt = await p.evaluate(() => window.dsMailCore.dictateText("so question mark open quote hi close quote exclamation point"));
  check("…the words-to-text rules", dt.text === "So? “Hi”!", JSON.stringify(dt));
  // dictation: organize my thoughts (no AI key here: written down as said, in paragraphs)
  await p.click(".mailcomp .mc-tb .ql-dictate"); await p.click('.mailcomp .mc-menu [data-m="organize"]');
  await p.evaluate(() => { window.dsDictation.take("um tell her the meeting moved to thursday"); window.dsDictation.take("and bring the slides. that's all"); });
  await p.waitForFunction(() => /Tell her the meeting moved to thursday/.test(window.dsMailCompose.editors.values().next().value.quill.getText()), null, { timeout: 8000 }).catch(() => {});
  check("organize my thoughts (no AI): what he said, tidied into the email, with an Undo", /Tell her the meeting moved to thursday and bring the slides\./.test(await p.evaluate(() => window.dsMailCompose.editors.values().next().value.quill.getText())) && await p.isVisible(".mailcomp .mc-ai"));
  // an AI change arrives: shown, with Undo
  const cid = await p.evaluate(() => window.dsMailCompose.editors.values().next().value.id);
  await p.evaluate((id) => { const ed = window.dsMailCompose.editors.get(id); window.dsMail.onEvent({ kind: "edit", compose: { ...ed.c, id, to: "sam@friends.test", cc: "rich@work.test", subject: "Changed by AI", html: "<p>A shorter version.</p>", attachments: ed.atts, rev: 99 }, before: {}, note: "made it shorter" }); }, cid);
  await p.waitForTimeout(400);
  const ai = await p.evaluate(() => ({ bar: document.querySelector(".mailcomp .mc-ai")?.textContent ?? "", text: window.dsMailCompose.editors.values().next().value.quill.getText(), subj: document.querySelector(".mailcomp [data-f=subject]").value, cc: document.querySelector(".mailcomp [data-f=cc]").textContent }));
  check("an AI change shows in the editor with what it did (“made it shorter”)", /made it shorter/.test(ai.bar) && /A shorter version/.test(ai.text) && ai.subj === "Changed by AI" && /rich@work\.test/.test(ai.cc), JSON.stringify(ai));
  await p.click('.mailcomp .mc-ai [data-u]');
  await p.waitForTimeout(400);
  check("…and Undo puts the owner's own words back", /Tell her the meeting moved/.test(await p.evaluate(() => window.dsMailCompose.editors.values().next().value.quill.getText())));
  // the invitation editor
  await p.evaluate(() => window.dsMailCompose.newInvite({ title: "Demo day", date: "2026-10-06", start: "09:30", minutes: 45, invitees: ["pat@work.test"] }));
  await p.waitForSelector(".mailcomp.invite .ql-editor", { timeout: 8000 }).catch(() => {});
  const inv = await p.evaluate(() => { const e = document.querySelector(".mailcomp.invite"); const v = (k) => e.querySelector(`[data-i=${k}]`)?.value; return { title: v("title"), date: v("date"), start: v("start"), minutes: v("minutes"), guests: e.querySelector("[data-i=invitees]").textContent, meet: e.querySelector("[data-i=meet]").checked, tb: e.querySelectorAll(".mc-tb .ql-bold, .mc-tb .ql-list, .mc-tb .ql-link").length }; });
  check("the invitation editor: title, when, length, guests, video link, and the rich description toolbar", inv.title === "Demo day" && inv.date === "2026-10-06" && inv.start === "09:30" && inv.minutes === "45" && /pat@work\.test/.test(inv.guests) && inv.meet && inv.tb >= 3, JSON.stringify(inv));
  await p.click('.mailcomp.invite [data-a="agenda"]');
  check("…“Add an agenda” puts a numbered agenda in", /Agenda/.test(await p.textContent(".mailcomp.invite .ql-editor")) && await p.evaluate(() => Boolean(document.querySelector(".mailcomp.invite .ql-editor ol"))));
  r = await inside(p, ".mailcomp.invite"); check("…and it's inside the margins", r.ok, `${r.box} safe ${r.safe}`);
  check("the editors: no page errors", p.errs.length === 0, p.errs.join(" | "));
  await p.ctx.close();
}

// ================================================================================ mini: the editor fits a small window too
{
  const p = await page({ w: 380, h: 560, path: "/mini" });
  await p.evaluate(() => window.dsMailCompose.newEmail({ subject: "Tiny" }));
  await p.waitForSelector(".mailcomp .ql-editor", { timeout: 8000 }).catch(() => {});
  const r = await inside(p, ".mailcomp");
  check("mini (380×560): the editor fits the window", r.ok, `${r.box} safe ${r.safe}`);
  check("…Send and Save are reachable", await p.evaluate(() => { const b = document.querySelector('.mailcomp [data-a="send"]').getBoundingClientRect(); const e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return Boolean(e?.closest('[data-a="send"]')); }));
  check("mini: no page errors", p.errs.length === 0, p.errs.join(" | "));
  await p.ctx.close();
}

await browser.close();
server.kill();
await Promise.all([smtp.close(), imap.close().catch(() => {})]);
await sleep(500);
if (!process.argv.includes("--keep")) { spawnSync("cmd.exe", ["/d", "/c", "rmdir", join(APP, "node_modules")], { windowsHide: true }); try { rmSync(TMP, { recursive: true, force: true }); } catch { /* fine */ } }
else console.log("kept:", TMP);
console.log(fail ? `\n${fail} failed, ${pass} passed` : `\nALL PASSED: ${pass} passed`);
process.exit(fail ? 1 : 0);
