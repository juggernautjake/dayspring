// Choosing another screen moves the open Dayspring screen there now (lib/display.mjs moveToScreen), and the spoken
// "move Dayspring to the other screen / screen 2 / the TV / my main screen" is understood (lib/window-routes.mjs).
// Nothing real opens or moves: DS_LAUNCH_LOG / DS_WINDOW_LOG write down what would have happened.
//   node scripts/qa/screen-move.mjs
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "ds-screen-move-"));
process.env.DS_LAUNCH_LOG = join(TMP, "launch.jsonl");
process.env.DS_WINDOW_LOG = join(TMP, "window.jsonl");
process.env.DS_BROWSER = process.env.DS_BROWSER || "chrome";
const display = await import("../../lib/display.mjs");
const win = await import("../../lib/window-routes.mjs");

let pass = 0, fail = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && got !== "" ? "  (" + String(got).slice(0, 300) + ")" : ""}`); };
const lines = (f) => (existsSync(f) ? readFileSync(f, "utf8").trim().split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)) : []);

// ---- the words ----
const said = {
  "move dayspring to the other screen": "secondary", "Dayspring, move yourself to screen 2": "2", "put the screen on the tv": "secondary",
  "move it to my main screen": "primary", "show dayspring on screen one": "1", "use the second monitor": "secondary", "move dayspring to 3": "3",
  "move it to the laptop screen": "primary", "move dayspring to chrome": null, "move the window to the left": null, "move my meeting to friday": null,
};
for (const [t, want] of Object.entries(said)) check(`“${t}” → ${want}`, win.moveScreenIntent(t) === want, win.moveScreenIntent(t));

// ---- moving what's open ----
const all = await display.screens();
check("the screens can be read", all.length >= 1, JSON.stringify(all));
// a fake two-screen layout when this computer has one screen, so the move is still exercised
const two = all.length >= 2 ? all : [{ number: 1, primary: true, x: 0, y: 0, width: 1920, height: 1080 }, { number: 2, primary: false, x: 1920, y: 0, width: 1280, height: 720 }];
const target = display.pick(two, "secondary");
check("“secondary” picks the other screen", target && !target.primary, JSON.stringify(target));

if (all.length >= 2) {
  await display.open({ openAs: "fullscreen", screen: "1", force: true });
  check("opened full screen on screen 1 (recorded)", lines(process.env.DS_LAUNCH_LOG).length === 1);
  const r = await display.moveToScreen("secondary");
  const last = lines(process.env.DS_LAUNCH_LOG).pop();
  const pos = (last?.args ?? []).find((a) => a.startsWith("--window-position="));
  check("full screen moves by opening again, full screen, on the other screen", r.moved && last?.args?.includes("--kiosk") && pos === `--window-position=${target.x},${target.y}`, JSON.stringify({ r, pos }));
  check("…and it says which screen", r.screen === target.number, JSON.stringify(r));
} else console.log("SKIP  moving full screen needs two real screens (this computer has one)");

// nothing open: the choice is kept for next time, nothing is launched
{
  const before = lines(process.env.DS_LAUNCH_LOG).length;
  const fresh = await import(`../../lib/display.mjs?fresh=${Date.now()}`);
  const r = await fresh.moveToScreen("primary");
  check("with Dayspring closed nothing opens: it's used next time", r.ok && r.moved === false && /next time/.test(r.note ?? "") && lines(process.env.DS_LAUNCH_LOG).length === before, JSON.stringify(r));
}
// a screen that isn't connected
{
  const r = await display.moveToScreen("9");
  check("a screen that isn't connected is refused, with what to do", r.ok === false && /Extend/.test(r.message ?? ""), JSON.stringify(r));
}

try { rmSync(TMP, { recursive: true, force: true }); } catch { /* temp */ }
console.log(`\n${fail ? "FAILED" : "ALL PASSED"}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
