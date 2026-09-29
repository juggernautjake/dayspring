// Finding places: "coffee near me", "Home Depot", "123 Main Street, Springfield".
//   Free (no key): OpenStreetMap's Nominatim for a search, Photon for suggestions as you type (Nominatim's policy asks
//   that it NOT be used for type-ahead). Google (a Maps key): Places API (New) Text Search, and Autocomplete with a
//   session token (the suggestions are then free; only the Place Details lookup of the one picked is billed).
// Every answer becomes the same place: { id, name, address, lat, lon, category, rating, ratingCount, openNow, hours[],
//   source, distance (meters from the "near" point, when there is one) }
import { request, MapsError } from "./net.mjs";
import * as settings from "./settings.mjs";

// ---- distances --------------------------------------------------------------------------------------------------------
export function haversine(a, b) {
  const R = 6371008.8, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

// ---- the free search's words ------------------------------------------------------------------------------------------
// what people say → what OpenStreetMap calls it (Nominatim understands these "special phrases")
const OSM_WORDS = { coffee: "cafe", "coffee shop": "cafe", "coffee shops": "cafe", gas: "fuel", "gas station": "fuel", "gas stations": "fuel", groceries: "supermarket", "grocery store": "supermarket",
  "grocery stores": "supermarket", food: "restaurant", "somewhere to eat": "restaurant", "places to eat": "restaurant", doctor: "doctors", "urgent care": "clinic", "the park": "park", parks: "park",
  atm: "atm", pharmacy: "pharmacy", pharmacies: "pharmacy", library: "library", hospital: "hospital", "fast food": "fast food", pizza: "pizza", gym: "fitness centre", "post office": "post office" };
export const osmQuery = (q) => OSM_WORDS[clean(q).toLowerCase()] ?? clean(q);

// ---- parsing each service's answer (exported: scripts/qa/maps.mjs checks them against saved answers) ------------------
export function parseNominatim(list) {
  return (Array.isArray(list) ? list : []).map((x) => {
    const a = x.address ?? {};
    const town = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.suburb ?? "";
    const street = [a.house_number, a.road].filter(Boolean).join(" ");
    const name = clean(x.name) || street || clean(String(x.display_name ?? "").split(",")[0]);
    const address = [street && street !== name ? street : "", town, a.state].filter(Boolean).join(", ") || clean(x.display_name);
    const hours = x.extratags?.opening_hours ? [String(x.extratags.opening_hours)] : [];
    return { id: `osm:${x.osm_type ?? "n"}${x.osm_id ?? x.place_id}`, name, address, lat: num(x.lat), lon: num(x.lon), category: clean(x.type ?? x.category ?? "").replace(/_/g, " "),
      rating: null, ratingCount: null, openNow: null, hours, source: "osm" };
  }).filter((p) => p.lat != null && p.lon != null);
}
export function parsePhoton(j) {
  return (j?.features ?? []).map((f) => {
    const p = f.properties ?? {}, [lon, lat] = f.geometry?.coordinates ?? [];
    const street = [p.housenumber, p.street].filter(Boolean).join(" ");
    const name = clean(p.name) || street || clean(p.city);
    const address = [street && street !== name ? street : "", p.city && p.city !== name ? p.city : "", p.state].filter(Boolean).join(", ");
    return { id: `osm:${String(p.osm_type ?? "N").toLowerCase()}${p.osm_id ?? ""}`, name, address, lat: num(lat), lon: num(lon), category: clean(p.osm_value ?? p.type ?? "").replace(/_/g, " "),
      rating: null, ratingCount: null, openNow: null, hours: [], source: "osm" };
  }).filter((p) => p.lat != null && p.lon != null && p.name);
}
export function parseGooglePlaces(j) {
  return (j?.places ?? []).map((x) => ({
    id: `google:${x.id}`, name: clean(x.displayName?.text ?? x.displayName ?? ""), address: clean(x.formattedAddress ?? x.shortFormattedAddress ?? ""),
    lat: num(x.location?.latitude), lon: num(x.location?.longitude), category: clean(x.primaryTypeDisplayName?.text ?? (x.types ?? [])[0] ?? "").replace(/_/g, " "),
    rating: num(x.rating), ratingCount: num(x.userRatingCount), openNow: typeof x.currentOpeningHours?.openNow === "boolean" ? x.currentOpeningHours.openNow : null,
    hours: Array.isArray(x.currentOpeningHours?.weekdayDescriptions) ? x.currentOpeningHours.weekdayDescriptions.map(String) : [], source: "google",
  })).filter((p) => p.lat != null && p.lon != null && p.name);
}
export function parseGoogleAutocomplete(j) {
  return (j?.suggestions ?? []).map((s) => s.placePrediction).filter(Boolean).map((p) => ({
    id: `google:${p.placeId}`, name: clean(p.structuredFormat?.mainText?.text ?? p.text?.text ?? ""), address: clean(p.structuredFormat?.secondaryText?.text ?? ""), lat: null, lon: null, source: "google", needsDetails: true,
  })).filter((p) => p.name);
}

// the fields asked of Google decide the price: the basic ones (5,000 free a month), or with ratings and hours
// (1,000 free a month) only when Settings → Maps says so
const FIELDS_BASIC = ["places.id", "places.displayName", "places.formattedAddress", "places.location", "places.primaryTypeDisplayName"];
const FIELDS_RICH = ["places.rating", "places.userRatingCount", "places.currentOpeningHours.openNow", "places.currentOpeningHours.weekdayDescriptions"];
const gHeaders = (mask) => ({ "X-Goog-Api-Key": settings.googleKey(), "X-Goog-FieldMask": mask });

// search(q, { near: {lat, lon}, nearOnly, limit, provider }) → places, nearest first when searching near a point
export async function search(q, { near = null, nearOnly = false, limit = 8, provider = settings.active() } = {}) {
  q = clean(q).slice(0, 200);
  if (q.length < 2) return [];
  const s = settings.get();
  let out;
  if (provider === "google") {
    const body = { textQuery: q, maxResultCount: Math.min(20, limit), languageCode: "en" };
    if (near) body.locationBias = { circle: { center: { latitude: near.lat, longitude: near.lon }, radius: nearOnly ? 15000 : 50000 } };
    const mask = [...FIELDS_BASIC, ...(s.richDetails ? FIELDS_RICH : [])].join(",");
    out = parseGooglePlaces(await request("google-places", "/v1/places:searchText", { method: "POST", headers: gHeaders(mask), body, cacheKey: `t|${q}|${near ? `${near.lat.toFixed(2)},${near.lon.toFixed(2)}` : ""}|${nearOnly}|${mask}` }));
  } else {
    const p = new URLSearchParams({ format: "jsonv2", q: nearOnly ? osmQuery(q) : q, limit: String(Math.min(20, limit)), addressdetails: "1", extratags: "1", "accept-language": "en" });
    if (near) {
      const d = nearOnly ? 0.25 : 1.5;   // about 17 miles / 100 miles around the point
      p.set("viewbox", `${near.lon - d},${near.lat + d},${near.lon + d},${near.lat - d}`);
      if (nearOnly) p.set("bounded", "1");
    }
    out = parseNominatim(await request("nominatim", `/search?${p}`, { cacheKey: p.toString() }));
    // nothing close by with the special word: try the words as said
    if (!out.length && nearOnly && osmQuery(q) !== q) { p.set("q", q); out = parseNominatim(await request("nominatim", `/search?${p}`, { cacheKey: p.toString() })); }
  }
  if (near) { for (const x of out) x.distance = Math.round(haversine(near, x)); if (nearOnly) out.sort((a, b) => a.distance - b.distance); }
  return out.slice(0, limit);
}

// Suggestions as you type. seq: the caller's counter; an older request that's still waiting for its turn gives up.
let latestSeq = 0, session = null;
export async function suggest(q, { near = null, provider = settings.active(), seq = ++latestSeq } = {}) {
  q = clean(q).slice(0, 120);
  if (q.length < 3) return [];
  latestSeq = Math.max(latestSeq, seq);
  const stale = () => seq < latestSeq;
  if (provider === "google") {
    if (!session || Date.now() - session.at > 3 * 60_000) session = { token: crypto.randomUUID(), at: Date.now() };
    const body = { input: q, sessionToken: session.token, languageCode: "en", ...(near ? { locationBias: { circle: { center: { latitude: near.lat, longitude: near.lon }, radius: 50000 } } } : {}) };
    const j = await request("google-places", "/v1/places:autocomplete", { method: "POST", headers: { "X-Goog-Api-Key": settings.googleKey() }, body, isStale: stale });
    return j ? parseGoogleAutocomplete(j).slice(0, 6) : [];
  }
  const p = new URLSearchParams({ q, limit: "6", lang: "en" });
  if (near) { p.set("lat", String(near.lat)); p.set("lon", String(near.lon)); }
  const j = await request("photon", `/api/?${p}`, { cacheKey: p.toString(), isStale: stale });
  if (!j) return [];
  const out = parsePhoton(j);
  if (near) for (const x of out) x.distance = Math.round(haversine(near, x));
  return out;
}
// the one suggestion picked (Google's has no location yet: Place Details, same session token, so the typing was free)
export async function details(place) {
  if (!place?.needsDetails) return place;
  const id = String(place.id).replace(/^google:/, "");
  if (!/^[\w-]{5,300}$/.test(id)) throw new MapsError("That place can't be looked up.");
  const token = session?.token; session = null;
  const j = await request("google-places", `/v1/places/${encodeURIComponent(id)}${token ? `?sessionToken=${encodeURIComponent(token)}` : ""}`, { headers: gHeaders(["id", "displayName", "formattedAddress", "location"].join(",")) });
  return parseGooglePlaces({ places: [j] })[0] ?? place;
}
