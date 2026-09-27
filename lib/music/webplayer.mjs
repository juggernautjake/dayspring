// The resolver's view of Spotify through the web player (open.spotify.com in Dayspring's media window, used when
// Spotify isn't connected inside Dayspring). Reads Spotify's own search pages: all four kinds of result (songs,
// artists, albums, playlists), a playlist's description and artists, the library sidebar, and the now-playing bar.
// Every function takes the Playwright page and the site's address, so the same code runs against a test page.
//   scrapeSearch(p, base, query, type|"all") → [{ type, uri, id, url, name, by, description, artists }]
//   inspectEntity(p, base, url) → { name, description, artists, tracks }      library(p, base) → [{ name, uri, url }]
//   webSource({ find, inspect, library, now }) → a source for resolve()

const TYPES = ["track", "artist", "album", "playlist"];
const pathFor = (type) => (type === "track" ? "tracks" : `${type}s`);

export async function scrapeSearch(p, base, query, type = "all", max = 10) {
  const url = `${base}/search/${encodeURIComponent(query)}${type === "all" ? "" : "/" + pathFor(type)}`;
  await p.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  const sel = type === "all" ? TYPES.map((t) => `main a[href*="/${t}/"]`).join(", ") : `main a[href*="/${type}/"]`;
  await p.locator(sel).first().waitFor({ timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(300);        // results finish rendering after the first card
  const found = await p.evaluate(([types, max]) => {
    const out = [], seen = new Set();
    const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
    for (const a of document.querySelectorAll("main a[href]")) {
      const m = /\/(track|artist|album|playlist)\/([A-Za-z0-9]+)/.exec(a.getAttribute("href") ?? "");
      if (!m || !types.includes(m[1])) continue;
      const key = `${m[1]}:${m[2]}`;
      const box = a.closest('[data-testid="tracklist-row"], [role="row"], [data-encore-id="card"], [data-testid="top-result-card"], [role="group"], li, article') ?? a.parentElement?.parentElement ?? a;
      const title = clean(a.getAttribute("title")) || clean(a.textContent) || clean(box.querySelector('[data-encore-id="cardTitle"], [data-testid="card-title"]')?.textContent);
      if (seen.has(key)) { const o = out.find((x) => x.key === key); if (o && !o.name && title) o.name = title; continue; }
      // a track row's own artist links; for a card, the text under the title ("By Spotify", "Artist", a description)
      const artists = m[1] === "track" || m[1] === "album" ? [...box.querySelectorAll('a[href*="/artist/"]')].map((x) => ({ name: clean(x.textContent), id: /\/artist\/([A-Za-z0-9]+)/.exec(x.getAttribute("href"))?.[1] ?? null })).filter((x) => x.name) : [];
      const sub = clean(box.querySelector('[data-encore-id="cardSubtitle"], [data-testid="card-subtitle"], [data-testid="description"]')?.textContent ?? box.textContent.replace(title, ""));
      seen.add(key);
      if (out.filter((x) => x.type === m[1]).length >= max) continue;
      out.push({ key, type: m[1], id: m[2], href: `/${m[1]}/${m[2]}`, name: title, by: artists.length ? artists.map((x) => x.name).join(", ") : sub.replace(/^(By |Playlist ?[·•] ?|Album ?[·•] ?)/, ""), description: m[1] === "playlist" ? sub : "", artists });
    }
    return out;
  }, [type === "all" ? TYPES : [type], max]);
  return found.filter((f) => f.name).map((f) => ({ type: f.type, id: f.id, uri: `spotify:${f.type}:${f.id}`, url: base + f.href, name: f.name, by: f.by, description: f.description, artists: f.artists }));
}

// A playlist or album page: the name, the description, and the first songs with their artists.
export async function inspectEntity(p, base, url) {
  await p.goto(url.replace(/^https?:\/\/open\.spotify\.com/, base), { waitUntil: "domcontentloaded", timeout: 30000 });
  await p.locator('[data-testid="tracklist-row"]').first().waitFor({ timeout: 15000 }).catch(() => {});
  return p.evaluate(() => {
    const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
    const name = clean(document.querySelector("main h1")?.textContent);
    const description = clean(document.querySelector('[data-testid="description"], [data-testid="entity-description"], [data-testid="playlist-description"]')?.textContent)
      || clean(document.querySelector('meta[name="description"]')?.getAttribute("content"));
    const rows = [...document.querySelectorAll('[data-testid="tracklist-row"]')].slice(0, 30);
    const tracks = rows.map((r) => ({ name: clean(r.querySelector('a[href*="/track/"]')?.textContent), by: [...r.querySelectorAll('a[href*="/artist/"]')].map((a) => clean(a.textContent)).join(", ") })).filter((t) => t.name);
    const artists = [...new Set(rows.flatMap((r) => [...r.querySelectorAll('a[href*="/artist/"]')].map((a) => clean(a.textContent))))].filter(Boolean).map((n) => ({ name: n }));
    return { name, description, tracks, artists };
  });
}

// His playlists, from the library sidebar
export async function library(p, base) {
  if (!p.url().startsWith(base)) await p.goto(base, { waitUntil: "domcontentloaded", timeout: 30000 });
  await p.locator('[data-testid="rootlist-item"]').first().waitFor({ timeout: 12000 }).catch(() => {});
  const got = await p.evaluate(() => [...document.querySelectorAll('[data-testid="rootlist-item"]')].map((el) => {
    const lab = el.getAttribute("aria-labelledby") ?? "";
    const id = /spotify:playlist:([A-Za-z0-9]+)/.exec(lab)?.[1] ?? /\/playlist\/([A-Za-z0-9]+)/.exec(el.querySelector('a[href*="/playlist/"]')?.getAttribute("href") ?? "")?.[1] ?? null;
    const name = (el.querySelector('[data-encore-id="listRowTitle"], [data-testid="listrow-title"]')?.textContent ?? el.textContent.split("\n")[0]).replace(/\s+/g, " ").trim();
    return { id, name };
  }).filter((x) => x.id && x.name));
  return got.map((x) => ({ type: "playlist", id: x.id, uri: `spotify:playlist:${x.id}`, url: `${base}/playlist/${x.id}`, name: x.name, mine: true }));
}

// The now-playing bar: { playing, title, artist }
export async function nowPlaying(p) {
  return p.evaluate(() => {
    const w = document.querySelector('[data-testid="now-playing-widget"]');
    const label = document.querySelector('[data-testid="control-button-playpause"]')?.getAttribute("aria-label") ?? "";
    const title = w?.querySelector('[data-testid="context-item-link"], [data-testid="context-item-info-title"]')?.textContent?.trim() ?? "";
    const artist = [...(w?.querySelectorAll('[data-testid="context-item-info-artist"], a[href*="/artist/"]') ?? [])].map((a) => a.textContent.trim()).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ");
    return { playing: /pause/i.test(label), title, artist };
  }).catch(() => ({ playing: false }));
}

// A resolver source from the four page readers (browser.mjs hands in its media window's; tests hand in a test page's).
export function webSource({ find, inspect, library: lib, now }) {
  return {
    kind: "web",
    async search(q, types = ["track"], { limit = 10 } = {}) {
      const list = await find(q, types.length === 1 ? types[0] : "all");
      const out = Object.fromEntries(types.map((t) => [t, []]));
      for (const c of list) if (out[c.type] && out[c.type].length < limit) out[c.type].push(c);
      return out;
    },
    inspect: async (c) => (c.url ? inspect(c.url) : null),
    myPlaylists: async () => (lib ? lib() : []),
    liked: async () => [],
    current: async () => { const n = await now?.(); return n?.title ? { name: n.title, by: n.artist, artists: n.artist ? n.artist.split(", ").map((name) => ({ name })) : [], playing: n.playing } : null; },
  };
}
