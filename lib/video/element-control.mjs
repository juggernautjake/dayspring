// Playback controls for an ordinary <video>/<audio> element on a page, used for YouTube playing in the media window
// (lib/browser.mjs youtubeWatchControl runs it inside youtube.com) and checked against a local HTML5 video in the tests.
// It runs INSIDE the page (page.evaluate), so it is self-contained: no imports, nothing from outside.
//   await elementControl([action, value]) → { ok, say?, state: { paused, time, duration, rate, volume, muted, captions, full } }
export async function elementControl([action, value]) {
  const el = [...document.querySelectorAll("video, audio")].find((e) => e.currentSrc || e.src) ?? document.querySelector("video, audio");
  if (!el) return { ok: false, say: "Nothing is playing there." };
  const dur = Number.isFinite(el.duration) ? el.duration : 0;
  const clamp = (t) => Math.max(0, dur ? Math.min(dur - 0.25, t) : t);
  const tracks = [...(el.textTracks ?? [])].filter((t) => t.kind === "subtitles" || t.kind === "captions");
  let say = "";
  switch (action) {
    case "pause": el.pause(); break;
    case "resume": case "play": el.play()?.catch?.(() => {}); break;
    case "toggle": if (el.paused) el.play()?.catch?.(() => {}); else el.pause(); break;
    case "stop": el.pause(); el.currentTime = 0; break;
    case "restart": el.currentTime = 0; break;
    case "seek": el.currentTime = clamp(Number(value) || 0); break;
    case "seekBy": el.currentTime = clamp(el.currentTime + (Number(value) || 0)); break;
    case "seekPct": if (dur) el.currentTime = clamp(dur * (Number(value) || 0) / 100); else say = "I can't tell how long it is yet."; break;
    case "speed": el.playbackRate = Math.max(0.25, Math.min(2, Number(value) || 1)); break;
    case "speedBy": { const steps = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]; const i = steps.reduce((b, r, k) => (Math.abs(r - el.playbackRate) < Math.abs(steps[b] - el.playbackRate) ? k : b), 0); el.playbackRate = steps[Math.max(0, Math.min(steps.length - 1, i + Math.sign(Number(value) || 1)))]; break; }
    case "volume": el.volume = Math.max(0, Math.min(1, (Number(value) || 0) / 100)); el.muted = false; break;
    case "volumeBy": el.volume = Math.max(0, Math.min(1, el.volume + (Number(value) || 0) / 100)); el.muted = false; break;
    case "mute": el.muted = true; break;
    case "unmute": el.muted = false; break;
    case "captions":
      if (!tracks.length) { say = "This one has no captions."; break; }
      tracks.forEach((t, k) => { t.mode = value === false ? "hidden" : k === 0 ? "showing" : "hidden"; });
      break;
    case "captionLang": {
      const t = tracks.find((x) => String(x.language).toLowerCase().startsWith(String(value).toLowerCase()));
      if (!t) { say = "There are no captions in that language for this one."; break; }
      tracks.forEach((x) => { x.mode = x === t ? "showing" : "hidden"; });
      break;
    }
    case "full":
      if (value === false) { el.classList.remove("ds-full"); if (document.fullscreenElement) await document.exitFullscreen?.().catch?.(() => {}); }
      else { el.classList.add("ds-full"); await el.requestFullscreen?.().catch?.(() => {}); }
      break;
    case "quality": say = "The quality of this one is chosen by the page itself."; break;
    default: return { ok: false, say: "" };
  }
  return { ok: !say, say, state: { paused: el.paused, time: Math.round(el.currentTime * 100) / 100, duration: dur, rate: el.playbackRate, volume: Math.round(el.volume * 100), muted: el.muted,
    captions: tracks.filter((t) => t.mode === "showing").map((t) => t.language), full: Boolean(document.fullscreenElement) || el.classList.contains("ds-full") } };
}
