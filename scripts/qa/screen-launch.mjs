// The owner's own screen window, started with the DevTools pipe (lib/sinkfollow.mjs): no Chrome warning bar, and it must
// not look automated to the page (an automated copy never listens and never touches Spotify).
import "./guard-data.mjs";
import { pipeArgs } from "../../lib/sinkfollow.mjs";
import { launchArgs } from "../../lib/display.mjs";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log("PASS  " + name); } else { fail++; console.log("FAIL  " + name); } };
const b = { family: "chromium", exe: "chrome.exe", id: "chrome" };
const s = { x: 117, y: -720, width: 1280, height: 720, primary: false };
for (const mode of ["window", "fullscreen", "compact"]) {
  const a = pipeArgs(launchArgs(b, "http://localhost:4747/display", s, mode));
  ok(`${mode}: the mic stays allowed (--use-fake-ui-for-media-stream) and Chrome's warning bar is hidden (--test-type)`, a.includes("--use-fake-ui-for-media-stream") && a.includes("--test-type"));
  ok(`${mode}: AutomationControlled is off, so the screen still listens`, a.includes("--disable-blink-features=AutomationControlled"));
  ok(`${mode}: the app URL is kept`, a.some((x) => x.startsWith("--app=")));
}
console.log(fail ? `\nFAILED: ${pass} passed, ${fail} failed` : `\nALL PASSED: ${pass} passed`);
process.exit(fail ? 1 : 0);
