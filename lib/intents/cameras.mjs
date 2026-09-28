// Cameras, for the no-AI intent catalogue (catalog.mjs), in its template language: (a|b) one of, [x] optional, {text}
// free words. Every one plans { do: "cameras", id, text } and the runner hands the words to lib/cameras/skills.mjs
// (which also answers these directly, before anything else, when it's sure). The 5th item boosts the score when the
// words are clearly about a camera.
const CAM_WORDS = /\b(cam|cams|camera|cameras|footage|trail cam|gopro|webcam|security camera)\b/;
// a printer's camera is printers.camera (lib/intents/devices.mjs), so a printer word lowers these
import { PRINTER_NAME } from "./devices.mjs";
const boost = (c) => (!CAM_WORDS.test(c.q) ? 0.8 : PRINTER_NAME.test(c.q) ? 0.9 : 1.6);
export const CAMERA_INTENTS = [
  ["cameras.show", "Show a camera", "show me the front camera", [
    "(show|open|pull up|bring up) [me] [the|my] {text} (camera|cam)", "(show|open) [me] [the|my] (cameras|cams|camera page|security cameras)", "let me see the {text} (camera|cam)",
    "what does the {text} (camera|cam) see", "(show|open) [me] the (trail cam|gopro|webcam)",
  ], boost],
  ["cameras.activity", "Say what the cameras saw", "any activity on the trail cam?", [
    "(any|was there any) (activity|motion|movement) on the {text} (camera|cam)", "(any|were there any) {text} on the (trail cam|camera|cameras)", "what did the {text} (camera|cam) see [today|last night]",
    "what happened on the {text} (camera|cam) [today|last night|yesterday]", "(anything|anyone) on the (cameras|camera|trail cam) [today|last night]", "(any|how many) deer [on the trail cam] [last night|today]",
  ], boost],
  ["cameras.play", "Play a camera clip", "play last night's deer clip", [
    "play [the] (last nights|todays|yesterdays|latest|last) {text} (clip|video|recording)", "play the (clip|video|recording) from the {text} (camera|cam)", "show [me] the (clip|video|footage) of the {text}",
  ], boost],
];
