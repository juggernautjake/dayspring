// Dayspring's default voices, checked without any keys or a real browser:
//   • the free-voice list (public/voices.js) picks a warm female voice for Dayspring and a warm male one for the guide,
//     in the documented order, on the voice sets real computers have (Edge, Chrome, Windows only)
//   • the server defaults: ElevenLabs Matilda for Dayspring, Will for the guide, OpenAI "coral"
//   node scripts/qa/voice-defaults.mjs      (exit 0 = all good; prints each check)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let fail = 0;
const check = (name, ok, got) => { if (!ok) fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  (got " + got + ")"}`); };

// public/voices.js in a pretend browser whose speechSynthesis.getVoices() returns what we give it
const win = { speechSynthesis: { getVoices: () => [] } };
vm.runInNewContext(readFileSync(join(DESK, "public", "voices.js"), "utf8"), { window: win });
const P = win.dsVoicePrefs;
const V = (name, lang = "en-US") => ({ name, lang });
const EDGE = [V("Microsoft Andrew Online (Natural) - English (United States)"), V("Microsoft Aria Online (Natural) - English (United States)"), V("Microsoft Ava Online (Natural) - English (United States)"),
  V("Microsoft Brian Online (Natural) - English (United States)"), V("Microsoft Guy Online (Natural) - English (United States)"), V("Microsoft Jenny Online (Natural) - English (United States)"),
  V("Microsoft Sonia Online (Natural) - English (United Kingdom)", "en-GB"), V("Microsoft David - English (United States)"), V("Microsoft Zira - English (United States)"), V("Microsoft Mark - English (United States)")];
const pickName = (kind, list) => P.pick(kind, list)?.name ?? null;

check("Edge, no keys: Dayspring speaks with Ava (Natural)", /Ava Online \(Natural\)/.test(pickName("assistant", EDGE)), pickName("assistant", EDGE));
check("Edge without Ava: Jenny (Natural)", /Jenny/.test(pickName("assistant", EDGE.filter((v) => !/Ava/.test(v.name)))), pickName("assistant", EDGE.filter((v) => !/Ava/.test(v.name))));
check("…without Ava and Jenny: Aria (Natural)", /Aria/.test(pickName("assistant", EDGE.filter((v) => !/Ava|Jenny/.test(v.name)))), "");
check("…only Sonia among the Natural women: Sonia", /Sonia/.test(pickName("assistant", EDGE.filter((v) => !/Ava|Jenny|Aria/.test(v.name)))), pickName("assistant", EDGE.filter((v) => !/Ava|Jenny|Aria/.test(v.name))));
const WIN = [V("Microsoft David - English (United States)"), V("Microsoft Zira - English (United States)"), V("Microsoft Mark - English (United States)")];
check("Chrome/Firefox with Windows voices only: Zira", /Zira/.test(pickName("assistant", WIN)), pickName("assistant", WIN));
const OTHER = [V("Google Deutsch", "de-DE"), V("Google US English"), V("Google UK English Male", "en-GB")];
check("no known voice: the first US-English one", pickName("assistant", OTHER) === "Google US English", pickName("assistant", OTHER));
check("no voices at all: nothing, no error", P.pick("assistant", []) === null, "");
check("the guide: Andrew (Natural), a warm male voice", /Andrew Online \(Natural\)/.test(pickName("guide", EDGE)), pickName("guide", EDGE));
check("the guide without Andrew: Brian (Natural)", /Brian/.test(pickName("guide", EDGE.filter((v) => !/Andrew/.test(v.name)))), "");
check("the guide without Andrew and Brian: Guy (Natural)", /Guy/.test(pickName("guide", EDGE.filter((v) => !/Andrew|Brian/.test(v.name)))), "");
check("the guide with Windows voices only: David", /David/.test(pickName("guide", WIN)), pickName("guide", WIN));
check("the guide and Dayspring never share a voice by default", pickName("guide", EDGE) !== pickName("assistant", EDGE) && pickName("guide", WIN) !== pickName("assistant", WIN), "");

// the server's defaults (no keys; nothing is spoken)
delete process.env.DAYSPRING_VOICE_ID;
const voice = await import("../../lib/voice.mjs");
check("ElevenLabs default is Matilda (XrExE9yKIg1WjnnlVkGX)", voice.VOICES.Matilda === "XrExE9yKIg1WjnnlVkGX" && voice.defaults().elevenId === voice.VOICES.Matilda, JSON.stringify(voice.defaults()));
check("the guide's ElevenLabs voice is Will (bIHbv24MWmeRgasZH58o)", voice.VOICES.Will === "bIHbv24MWmeRgasZH58o" && P.ELEVEN.guide === "Will", voice.VOICES.Will);
check("OpenAI default is coral", voice.OPENAI_DEFAULT === "coral" && P.OPENAI.assistant === "coral", voice.OPENAI_DEFAULT);
console.log(fail ? `\n${fail} failed.` : "\nAll voice defaults are right.");
process.exit(fail ? 1 : 0);
