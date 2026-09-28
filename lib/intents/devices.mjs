// Smart devices and 3D printers, for the no-AI intent catalogue (catalog.mjs), in its template language: (a|b) one of,
// [x] optional, {text} free words, {num} a number. Every one plans { do: "devices", id, text } and the runner hands the
// words to lib/devices (which also answers these directly, before anything else, when the device is set up; this is the
// fallback that says "I don't know a device called …" and offers the page). The boost keeps them away from look-alikes
// ("turn off the music", "turn off my alarm"): they only score high when a device or printer word is there.
const THING = /\b(fan|fans|tv|television|computer|pc|monitor|lamp|light|lights|outlet|outlets|plug|plugs|strip|strips|printer|printers|3d|heater|speakers?|router|console|xbox|playstation|garage|coffee|air fryer|everything|anything|devices?|x1c?|p1s|p1p|a1|h2d|ender)\b/;
const PRINTER = /\b(printer|printers|print|3d|x1c?|p1s|p1p|a1|h2d|h2s|ender|bed|benchy)\b/;
// a printer named with a camera word: the printer's camera (the cameras family gives way: lib/intents/cameras.mjs)
export const PRINTER_NAME = /\b(printer|printers|3d printer|x1c?|x1e|p1s|p1p|a1|a1 mini|h2d|h2s|ender|voron|octoprint|klipper)\b/;
const PRINTER_CAM = { test: (q) => PRINTER_NAME.test(q) && /\b(camera|cam|webcam|feed|live view)\b/.test(q) };
const b = (re, hi = 1.3, lo = 0.55) => (c) => (re.test(c.q) ? hi : lo);
export const DEVICE_INTENTS = [
  ["devices.on", "Turn a device on", "turn on fan 2", ["(turn|switch|power) on [the|my] {text}", "(turn|switch|power) [the|my] {text} on", "(boot|wake) up [the|my] {text}"], b(THING)],
  ["devices.off", "Turn a device off", "turn off the tv", ["(turn|switch|power|shut) off [the|my] {text}", "(turn|switch|power|shut) [the|my] {text} off", "(turn|switch) (everything|all devices) off [in the {text}]"], b(THING)],
  // (the device words spelled out too: "is the tv on" is all little words apart from "tv", so without them nothing matched)
  ["devices.status", "Is a device on?", "are the lights off", ["(is|are) [the|my] {text} (on|off|running)", "(is|are) [the|my] (tv|television|computer|pc|monitor|lamp|light|lights|fan|fans|heater|outlet|outlets|plug|strip|printer|speakers|router|coffee maker) [still] (on|off|running)", "what devices are (on|running)", "is anything still (on|running)"], (c) => (THING.test(c.q) && ((/\b(is|are)\b/.test(c.q) && !/\bwhat (is|are)\b/.test(c.q)) || /\bwhat devices\b/.test(c.q)) ? 1.35 : 0.5)],
  ["devices.page", "Open the Devices page", "show my smart devices", ["(open|show) [me] [my|the] (smart devices|smart home|power strips|outlets) [page]", "(open|show) [me] the devices page", "list my smart devices"], b(/\b(smart devices|smart home|outlets|strips?|devices page)\b/, 1.3, 0.5)],
  ["printers.status", "How's a printer doing?", "how is printer 3 doing", ["how is [the|my] {text} doing", "how is [my|the] print going", "what is left on [the|my] {text}", "how (long|much time) is left on [the|my] {text}"], b(PRINTER)],
  ["printers.control", "Pause or resume a print", "pause printer 3", ["(pause|resume|stop|cancel) [the] {text}", "(pause|resume|stop|cancel) the print on {text}"], b(PRINTER, 1.35, 0.5)],
  // a printer's camera ("show me the printer camera", "show the X1C's camera"): the printer's own view, ahead of cameras.show
  ["printers.camera", "Show a printer's camera", "show me printer 3's camera", ["(show|open|pull up) [me] [the|my] {text} (camera|cam|webcam|feed|live view)", "(show|open|pull up) [me] the (camera|cam|feed|live view) (on|of|for) [the|my] {text}", "(show|open) [me] [the|my] (printer|3d printer) (camera|cam)"], b(PRINTER_CAM, 1.75, 0.4)],
  ["printers.bed", "Is the print bed clear?", "is the bed clear on printer 2", ["is the [print] bed (clear|empty) [on {text}]", "check the bed on {text}"], b(PRINTER)],
];
