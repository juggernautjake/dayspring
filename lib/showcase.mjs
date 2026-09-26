// What the TV's big panel rotates through besides the schedule: the weather, a recommended video, an encouraging
// quote or verse, and today's prayer list and memory verses. Everything is cached so the TV can ask often.
//   Weather: Open-Meteo (free, no key). Location: DAYSPRING_LAT / DAYSPRING_LON / DAYSPRING_PLACE in .env, else the owner's
//     location (data/owner.json); no location, no weather.
//   Video: a YouTube search built from the owner's interests, skipping what they've already watched (refreshed every few hours).
import * as morning from "./morning.mjs";
import * as media from "./media.mjs";
import * as owner from "./owner.mjs";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const coord = (env, v) => (process.env[env] ? Number(process.env[env]) : v === null || v === undefined || v === "" ? null : Number(v));
const LAT = () => coord("DAYSPRING_LAT", owner.get().location?.lat), LON = () => coord("DAYSPRING_LON", owner.get().location?.lon);
// (|| not ??: a new install's .env has an empty DAYSPRING_PLACE= line, which must not hide the place chosen in setup)
export const PLACE = () => process.env.DAYSPRING_PLACE || owner.get().location?.place || "";

// WMO weather codes → words and an icon
const WMO = [[[0], "Clear", "☀️"], [[1], "Mostly clear", "🌤️"], [[2], "Partly cloudy", "⛅"], [[3], "Cloudy", "☁️"], [[45, 48], "Foggy", "🌫️"],
  [[51, 53, 55, 56, 57], "Drizzle", "🌦️"], [[61, 63, 66], "Rain", "🌧️"], [[65, 67], "Heavy rain", "🌧️"], [[71, 73, 75, 77], "Snow", "🌨️"],
  [[80, 81], "Showers", "🌦️"], [[82], "Heavy showers", "⛈️"], [[85, 86], "Snow showers", "🌨️"], [[95], "Thunderstorms", "⛈️"], [[96, 99], "Storms with hail", "⛈️"]];
const wmo = (c) => { const w = WMO.find(([codes]) => codes.includes(c)); return { text: w?.[1] ?? "—", icon: w?.[2] ?? "🌡️" }; };

let wx = { at: 0, data: null };
export async function weather() {
  if (wx.data && Date.now() - wx.at < 30 * 60_000) return wx.data;
  if (!Number.isFinite(LAT()) || !Number.isFinite(LON()) || (LAT() === 0 && LON() === 0)) return null;   // no location set up yet
  const p = new URLSearchParams({ latitude: LAT(), longitude: LON(), current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset", hourly: "temperature_2m,weather_code,precipitation_probability",
    temperature_unit: "fahrenheit", wind_speed_unit: "mph", timezone: owner.get().location?.timezone || "auto", forecast_days: "7" });
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?${p}`, { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    const c = j.current, d = j.daily;
    const nowH = new Date().getHours();
    const hours = j.hourly.time.map((t, i) => ({ t, temp: Math.round(j.hourly.temperature_2m[i]), rain: j.hourly.precipitation_probability[i], ...wmo(j.hourly.weather_code[i]) }))
      .filter((h) => h.t.slice(0, 10) === d.time[0] && Number(h.t.slice(11, 13)) >= nowH).filter((_, i) => i % 2 === 0).slice(0, 8);
    wx = { at: Date.now(), data: {
      place: PLACE(),
      now: { temp: Math.round(c.temperature_2m), feels: Math.round(c.apparent_temperature), wind: Math.round(c.wind_speed_10m), humidity: c.relative_humidity_2m, ...wmo(c.weather_code) },
      today: { hi: Math.round(d.temperature_2m_max[0]), lo: Math.round(d.temperature_2m_min[0]), rain: d.precipitation_probability_max[0], sunrise: d.sunrise[0].slice(11), sunset: d.sunset[0].slice(11) },
      hours,
      // the next 24 hours, every hour (the detail view)
      day24: j.hourly.time.map((t, i) => ({ t, temp: Math.round(j.hourly.temperature_2m[i]), rain: j.hourly.precipitation_probability[i], ...wmo(j.hourly.weather_code[i]) }))
        .filter((h) => Date.parse(h.t) >= Date.now() - 3600_000).slice(0, 24),
      link: `https://forecast.weather.gov/MapClick.php?lat=${LAT()}&lon=${LON()}`,
      week: d.time.map((t, i) => ({ date: t, hi: Math.round(d.temperature_2m_max[i]), lo: Math.round(d.temperature_2m_min[i]), rain: d.precipitation_probability_max[i], ...wmo(d.weather_code[i]) })),
    } };
  } catch { /* offline: keep the last forecast if there is one */ }
  return wx.data;
}
// "It's 72 and partly cloudy. High of 88, low of 65, 20% chance of rain."
export function spokenWeather(w) {
  if (!w) return null;
  return `${w.place ? `In ${w.place} it's` : "It's"} ${w.now.temp} degrees and ${w.now.text.toLowerCase()}. Today's high is ${w.today.hi}, the low ${w.today.lo}${w.today.rain >= 20 ? `, with a ${w.today.rain} percent chance of rain` : ""}.`;
}

// Topics for the recommended video, one a refresh, rotating: the owner's own list (data/showcase.json "videoTopics"),
// else their interests, else a few general ones.
const SHOWCASE_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "showcase.json");
function videoTopics() {
  try { const t = existsSync(SHOWCASE_FILE) ? JSON.parse(readFileSync(SHOWCASE_FILE, "utf8")).videoTopics : null; if (t?.length) return t; } catch { /* fall through */ }
  const mine = (owner.get().interests ?? []).map((i) => String(i).replace(/\s*\(.*?\)\s*/g, " ").split(/[:,]/)[0].trim()).filter(Boolean);
  return mine.length ? mine : ["nature documentary", "cooking tips", "science explained", "travel", "music performance", "home projects"];
}
let vid = { at: 0, i: 0, data: null, busy: null };
export async function video({ refresh = false } = {}) {
  if (vid.data && !refresh && Date.now() - vid.at < 4 * 3600_000) return vid.data;
  if (vid.busy) return vid.data;
  const topics = videoTopics();
  const topic = topics[vid.i++ % topics.length];
  vid.busy = media.searchYouTube({ query: topic, recentDays: 30, popular: true, unseen: true, max: 4 })
    .then((r) => { const v = r.find((x) => x.videoId); if (v) vid = { ...vid, at: Date.now(), data: { ...v, topic, thumb: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg` } }; })
    .catch(() => {}).finally(() => { vid.busy = null; });
  await Promise.race([vid.busy, new Promise((r) => setTimeout(r, 20000))]);
  return vid.data;
}

// Encouraging words: Scripture (KJV) and well-known lines from Christians of the past.
export const QUOTES = [
  { text: "Study to shew thyself approved unto God, a workman that needeth not to be ashamed, rightly dividing the word of truth.", by: "2 Timothy 2:15" },
  { text: "And whatsoever ye do, do it heartily, as to the Lord, and not unto men.", by: "Colossians 3:23" },
  { text: "But they that wait upon the LORD shall renew their strength; they shall mount up with wings as eagles; they shall run, and not be weary; and they shall walk, and not faint.", by: "Isaiah 40:31" },
  { text: "Trust in the LORD with all thine heart; and lean not unto thine own understanding. In all thy ways acknowledge him, and he shall direct thy paths.", by: "Proverbs 3:5–6" },
  { text: "Have not I commanded thee? Be strong and of a good courage; be not afraid, neither be thou dismayed: for the LORD thy God is with thee whithersoever thou goest.", by: "Joshua 1:9" },
  { text: "They are new every morning: great is thy faithfulness.", by: "Lamentations 3:23" },
  { text: "Be still, and know that I am God.", by: "Psalm 46:10" },
  { text: "I can do all things through Christ which strengtheneth me.", by: "Philippians 4:13" },
  { text: "This is the day which the LORD hath made; we will rejoice and be glad in it.", by: "Psalm 118:24" },
  { text: "But seek ye first the kingdom of God, and his righteousness; and all these things shall be added unto you.", by: "Matthew 6:33" },
  { text: "You have made us for yourself, O Lord, and our heart is restless until it rests in you.", by: "Augustine, Confessions" },
  { text: "Expect great things from God; attempt great things for God.", by: "William Carey" },
  { text: "Let nothing disturb you, let nothing frighten you; all things are passing away: God never changes.", by: "Teresa of Ávila" },
  { text: "We ought not to be weary of doing little things for the love of God, who regards not the greatness of the work, but the love with which it is performed.", by: "Brother Lawrence" },
  { text: "God's work done in God's way will never lack God's supply.", by: "Hudson Taylor" },
  { text: "He is no fool who gives what he cannot keep to gain what he cannot lose.", by: "Jim Elliot" },
  { text: "Never be afraid to trust an unknown future to a known God.", by: "Corrie ten Boom" },
  { text: "I have learned to kiss the wave that throws me against the Rock of Ages.", by: "Charles Spurgeon" },
  { text: "The beginning of anxiety is the end of faith, and the beginning of true faith is the end of anxiety.", by: "George Müller" },
  { text: "Prayer is not overcoming God's reluctance, but laying hold of His willingness.", by: "Richard C. Trench" },
];
// For owners who haven't turned on the faith features: classic words of encouragement.
export const GENERAL_QUOTES = [
  { text: "The journey of a thousand miles begins with one step.", by: "Lao Tzu" },
  { text: "It does not matter how slowly you go as long as you do not stop.", by: "Confucius" },
  { text: "Well begun is half done.", by: "Aristotle" },
  { text: "Well done is better than well said.", by: "Benjamin Franklin" },
  { text: "Energy and persistence conquer all things.", by: "Benjamin Franklin" },
  { text: "Do what you can, with what you have, where you are.", by: "Theodore Roosevelt" },
  { text: "Believe you can and you're halfway there.", by: "Theodore Roosevelt" },
  { text: "Act as if what you do makes a difference. It does.", by: "William James" },
  { text: "The best way out is always through.", by: "Robert Frost" },
  { text: "Keep your face to the sunshine and you cannot see a shadow.", by: "Helen Keller" },
  { text: "Kind words do not cost much. Yet they accomplish much.", by: "Blaise Pascal" },
  { text: "Whatever you are, be a good one.", by: "Abraham Lincoln" },
  { text: "Happiness depends upon ourselves.", by: "Aristotle" },
  { text: "Nothing is particularly hard if you divide it into small jobs.", by: "Henry Ford" },
];
export function quote(date = new Date()) {
  // a different one every couple of hours, the same across screens
  const slot = Math.floor(date.getTime() / (2 * 3600_000));
  const list = owner.feature("faith") ? QUOTES : GENERAL_QUOTES;
  return list[slot % list.length];
}

// Today's prayer focus, the whole prayer list, the memory verses and the reading.
export function devotionToday() {
  const t = morning.today(), d = morning.devotion();
  return { reading: t.reading, memoryRef: t.memoryRef, memory: t.memory, memoryKind: t.memoryKind, memoryFocus: t.memoryFocus, translation: "KJV", reference: t.memoryRef ?? "",
    prayerToday: t.prayer, prayerItems: (t.prayerItems ?? []).map((p) => ({ title: p.title, detail: p.private ? null : p.detail ?? null })), prayerAll: (d.prayer?.list ?? []).map((p) => (typeof p === "string" ? p : p.title)), prayerChurch: t.prayerChurch ?? [], churchLine: t.churchLine };
}
