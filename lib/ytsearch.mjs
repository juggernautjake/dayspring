// YouTube search for Dayspring, with nothing opening on screen:
//   1. the YouTube Data API, if a key is set (optional; slightly faster)
//   2. youtube.com's own results page, fetched and read directly (no browser, no key; the usual way)
//   3. a HEADLESS browser in its own profile, only if YouTube sends a check page instead of results
// Never the visible media window: that one is only for Spotify and for signing in.
// search(query, { recentDays, popular, newest, kind: "video"|"playlist", shorts, max }) → results (see ecosystem-core ytsearch)
import { createYtSearch } from "../vendor/ecosystem-core/lib/ytsearch.mjs";

// (tests: DAYSPRING_YT_BASE points youtube.com's pages at a local mock, so a whole Dayspring can be tested with fixtures)
const base = () => (process.env.DAYSPRING_YT_BASE || "").replace(/\/$/, "");
const viaBase = (url, init) => fetch(base() ? String(url).replace(/^https:\/\/www\.youtube\.com/, base()) : url, init);
const yt = createYtSearch({ apiKey: () => (base() ? "" : process.env.YOUTUBE_API_KEY ?? ""), fetch: viaBase });
let fake = null;                                          // tests: _setFake((query, opts) => results)
export function _setFake(fn) { fake = fn; }

export async function search(query, opts = {}) {
  if (fake) return fake(query, opts);
  try { return await yt.search(query, opts); }
  catch (e) {
    if (process.env.DAYSPRING_NO_HEADLESS_SEARCH) throw e;
    const browser = await import("./browser.mjs");
    return browser.youtubeSearchHeadless(query, opts);
  }
}
