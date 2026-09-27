// The demo's pre-flight checklist: each item is ok / not yet, with what to do about it.
//   await checklist() → { ready, items: [{ id, label, ok, detail, action? }] }
// Items only the owner can see are confirmed by the owner (settings.confirmed); nothing here changes a device.
import * as settings from "./settings.mjs";
import * as host from "./host.mjs";
import * as courseAnswer from "./course-answer.mjs";
import * as ci from "./course-index.mjs";
import * as llm from "../llm.mjs";
import * as bridge from "../callbridge.mjs";
import { displayCount } from "../bus.mjs";

let deps = {
  lanternRunning: async () => { try { return await (await import("../lantern.mjs")).running(); } catch { return false; } },
};
export function setDeps(d) { deps = { ...deps, ...d }; }

export async function checklist() {
  const s = settings.get(), st = host.status();
  const course = courseAnswer.courseId();
  const ix = course ? await ci.load(course).catch(() => null) : null;
  const talk = bridge.status();
  const items = [
    { id: "google", label: "Signed in to Google in the meeting window", ok: Boolean(s.signedIn),
      detail: s.signedIn ? "Signed in (the meeting window remembers it)." : "Open the meeting window once and sign in to Google yourself. Dayspring never types passwords.", action: s.signedIn ? null : "signin" },
    { id: "mic", label: "Meet's microphone is Voicemeeter Out B1", ok: Boolean(s.confirmed.micSet && talk.talk),
      detail: !talk.talk ? "Turn on “Answer into the call” (Settings → Calls), then in Meet: ⋮ → Settings → Audio → Microphone: Voicemeeter Out B1, and press Test." : s.confirmed.micSet ? "Confirmed." : "In Meet: ⋮ → Settings → Audio → Microphone: Voicemeeter Out B1 (press Test there). Then tick this.", action: "confirm:micSet" },
    { id: "sound", label: "Sound test: Dayspring's voice reaches the meeting", ok: Boolean(s.confirmed.soundTest),
      detail: s.confirmed.soundTest ? `Passed ${new Date(s.confirmed.soundTestAt ?? Date.now()).toLocaleString()}.` : "Run the sound test: it plays a test phrase into the call mixer and listens for it.", action: "soundtest" },
    { id: "captions", label: "Captions readable (who is talking)", ok: Boolean(st.check.captions || s.confirmed.captionsSeen),
      detail: st.check.captions ? `Captions detected ✓${st.check.used?.captionSpeaker ? "" : st.check.used?.captionEntry ? " (read by their layout: Meet's labels changed)" : ""}` : s.confirmed.captionsSeen ? "Captions were read in the last meeting or rehearsal ✓" : "Join the meeting (or run the rehearsal): captions turn on by themselves. If they can't be read, Tune in listens instead.", action: "rehearse" },
    { id: "people", label: "People detected (who's in the call, who's talking)", ok: Boolean(st.check.people?.ok || s.confirmed.peopleSeen),
      detail: st.check.people?.ok ? `Detected ✓ (${st.check.people.how})` : s.confirmed.peopleSeen ? "People were found in the last meeting or rehearsal ✓" : "Join the meeting (or run the rehearsal): names come from the People list, the video tiles, the captions and Meet's notices.", action: s.confirmed.peopleSeen ? null : "rehearse" },
    { id: "lantern", label: "Lantern running, with the course installed", ok: Boolean(course) && await deps.lanternRunning(),
      detail: !course ? "No Lantern course is installed on this computer." : `Course: ${ix?.course?.title ?? course}. ${await deps.lanternRunning() ? "Lantern is running." : "Start Lantern (it answers as itself when it can)."}`, action: "lantern" },
    { id: "index", label: "Course index ready", ok: Boolean(ix && ix.size > 0),
      detail: ix ? `${ix.size} lessons indexed (${ix.course.withText} with their text).` : "Nothing to index yet.", action: null },
    { id: "ai", label: "AI key working", ok: llm.ready(), detail: llm.ready() ? `Using ${llm.label()}.` : "Without AI, answers come straight from the lessons' key points.", action: null },
    { id: "link", label: "The course's public link is set and shared", ok: Boolean(course && s.courses?.[course]?.publicLessonUrl && s.confirmed.linkShared),
      detail: !s.courses?.[course]?.publicLessonUrl ? "Set the public lesson link (…#{lesson}) below." : s.confirmed.linkShared ? "Set and shared ✓" : "Make sure its sharing is “anyone with the link” (open it in a private window to check), then tick this.", action: "confirm:linkShared" },
    { id: "screen", label: "The Dayspring screen is open (it speaks the answers)", ok: displayCount() > 0, detail: displayCount() > 0 ? "Open ✓" : "Open the Dayspring screen: it plays the answers into the call.", action: null },
  ];
  return { ready: items.every((i) => i.ok), items, demo: s.demo };
}
