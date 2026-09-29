// Directions with steps: driving, walking, cycling, and (Google only) transit.
//   Google (a Maps key): Routes API computeRoutes. Traffic-unaware by default (the Essentials tier: 10,000 free a
//     month); "live traffic" in Settings → Maps asks for TRAFFIC_AWARE (the Pro tier: 5,000 free a month).
//   Free: OpenRouteService with its free key when there is one (2,000 routes a day), otherwise the FOSSGIS OSRM servers
//     that OpenStreetMap's own site uses (routing.openstreetmap.de: car, bike and foot; one request a second).
// Every answer becomes the same shape:
//   route { distance (m), duration (s), summary, geometry: [[lat, lon]…], steps: [step], provider, mode, traffic, note? }
//   step  { text, distance (m, from this maneuver to the next), duration (s), kind, street, at: [lat, lon] }
import { request, MapsError } from "./net.mjs";
import * as settings from "./settings.mjs";
import { osrmInstruction, orsInstruction, ORS_KIND } from "./words.mjs";

const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
const secs = (d) => num(String(d ?? "0").replace(/s$/, ""));
const lonlatToLatLon = (c) => (Array.isArray(c) ? c.map(([lon, lat]) => [lat, lon]) : []);

// Google's encoded polyline → [[lat, lon]…]
export function decodePolyline(str) {
  const out = []; let i = 0, lat = 0, lon = 0;
  const s = String(str ?? "");
  while (i < s.length) {
    for (const which of [0, 1]) {
      let shift = 0, result = 0, b;
      do { b = s.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && i < s.length + 1);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += d; else lon += d;
    }
    out.push([lat / 1e5, lon / 1e5]);
  }
  return out;
}

// ---- parsing (exported: scripts/qa/maps.mjs checks them against saved answers) ----------------------------------------
export function parseOsrm(j, mode = "driving") {
  if (j?.code && j.code !== "Ok") throw new MapsError(j.code === "NoRoute" ? "There's no route between those two places." : `The route service couldn't find a way (${j.code}).`, { code: "no-route", service: "osrm" });
  return (j?.routes ?? []).map((r) => {
    const steps = (r.legs ?? []).flatMap((l) => l.steps ?? []).map((s) => ({
      text: osrmInstruction(s), distance: num(s.distance), duration: num(s.duration), kind: s.maneuver?.type === "arrive" ? "arrive" : s.maneuver?.type === "depart" ? "depart" : s.maneuver?.type ?? "turn",
      street: s.name || s.ref || "", at: s.maneuver?.location ? [s.maneuver.location[1], s.maneuver.location[0]] : null,
    }));
    const summary = [...new Set((r.legs ?? []).flatMap((l) => String(l.summary ?? "").split(/\s*,\s*/)).filter(Boolean))].join(" and ");
    return { distance: num(r.distance), duration: num(r.duration), summary: summary ? `via ${summary}` : "", geometry: lonlatToLatLon(r.geometry?.coordinates), steps, provider: "osrm", mode, traffic: false };
  });
}
export function parseOrs(j, mode = "driving") {
  return (j?.features ?? []).map((f) => {
    const coords = lonlatToLatLon(f.geometry?.coordinates);
    const segs = f.properties?.segments ?? [];
    const steps = segs.flatMap((sg) => sg.steps ?? []).map((s) => ({
      text: orsInstruction(s), distance: num(s.distance), duration: num(s.duration), kind: ORS_KIND[s.type] ?? "turn",
      street: s.name && s.name !== "-" ? s.name : "", at: coords[s.way_points?.[0]] ?? null,
    }));
    const sum = f.properties?.summary ?? {};
    const names = [...new Set(steps.filter((s) => s.street && s.distance > 800).sort((a, b) => b.distance - a.distance).slice(0, 2).map((s) => s.street))];
    return { distance: num(sum.distance), duration: num(sum.duration), summary: names.length ? `via ${names.join(" and ")}` : "", geometry: coords, steps, provider: "ors", mode, traffic: false };
  });
}
function transitText(t = {}) {
  const v = t.transitLine?.vehicle?.name?.text ?? "transit", line = t.transitLine?.nameShort ?? t.transitLine?.name ?? "";
  const from = t.stopDetails?.departureStop?.name, to = t.stopDetails?.arrivalStop?.name;
  const stops = t.stopCount ? `, ${t.stopCount} stop${t.stopCount === 1 ? "" : "s"}` : "";
  return `Take the ${v.toLowerCase()}${line ? ` ${line}` : ""}${t.headsign ? ` toward ${t.headsign}` : ""}${from ? ` from ${from}` : ""}${stops}${to ? `, and get off at ${to}` : ""}`;
}
export function parseGoogleRoutes(j, mode = "driving", { traffic = false } = {}) {
  return (j?.routes ?? []).map((r) => {
    const steps = (r.legs ?? []).flatMap((l) => l.steps ?? []).map((s) => {
      const nav = s.navigationInstruction ?? {}, man = String(nav.maneuver ?? "");
      const text = s.transitDetails ? transitText(s.transitDetails) : String(nav.instructions ?? "").replace(/\s*\n\s*/g, ". ").trim() || (man === "DEPART" ? "Head out" : "Continue");
      const ll = s.startLocation?.latLng;
      return { text, distance: num(s.distanceMeters), duration: secs(s.staticDuration ?? s.duration), kind: man === "DEPART" ? "depart" : /ROUNDABOUT/.test(man) ? "roundabout" : s.transitDetails ? "transit" : man.toLowerCase() || "turn",
        street: "", at: ll ? [ll.latitude, ll.longitude] : null };
    });
    // Google's last step is the last turn: the arrival is added, so every provider ends the same way
    const end = r.legs?.[r.legs.length - 1]?.endLocation?.latLng;
    if (steps.length) steps.push({ text: "Arrive at your destination", distance: 0, duration: 0, kind: "arrive", street: "", at: end ? [end.latitude, end.longitude] : null });
    return { distance: num(r.distanceMeters), duration: secs(r.duration), summary: r.description ? `via ${r.description}` : "", geometry: decodePolyline(r.polyline?.encodedPolyline), steps, provider: "google", mode, traffic };
  });
}

// ---- asking ----------------------------------------------------------------------------------------------------------
const ORS_PROFILE = { driving: "driving-car", walking: "foot-walking", cycling: "cycling-regular" };
const OSRM_PROFILE = { driving: "routed-car", walking: "routed-foot", cycling: "routed-bike" };
const G_MODE = { driving: "DRIVE", walking: "WALK", cycling: "BICYCLE", transit: "TRANSIT" };
const G_FIELDS = ["routes.distanceMeters", "routes.duration", "routes.description", "routes.polyline.encodedPolyline", "routes.legs.endLocation", "routes.legs.steps.distanceMeters", "routes.legs.steps.staticDuration",
  "routes.legs.steps.startLocation", "routes.legs.steps.navigationInstruction", "routes.legs.steps.transitDetails"].join(",");
const ll = (p) => `${Number(p.lon).toFixed(6)},${Number(p.lat).toFixed(6)}`;

// directions(from, to, { mode, avoid: { highways, tolls, ferries }, alternatives, provider }) → [route] (best first)
export async function directions(from, to, { mode = "driving", avoid = {}, alternatives = true, provider = settings.active() } = {}) {
  if (!from || !to || [from.lat, from.lon, to.lat, to.lon].some((x) => !Number.isFinite(Number(x)))) throw new MapsError("I need a start and an end to find a route.");
  const s = settings.get();
  if (mode === "transit" && provider !== "google") throw new MapsError("Bus and train directions need Google (add a Google Maps key in Settings → Maps). You can open this trip in Google Maps instead.", { code: "no-transit" });
  if (provider === "google") {
    const drive = mode === "driving";
    const body = { origin: { location: { latLng: { latitude: from.lat, longitude: from.lon } } }, destination: { location: { latLng: { latitude: to.lat, longitude: to.lon } } }, travelMode: G_MODE[mode] ?? "DRIVE",
      computeAlternativeRoutes: Boolean(alternatives) && mode !== "transit", languageCode: "en-US", units: s.units === "km" ? "METRIC" : "IMPERIAL" };
    if (drive) { body.routingPreference = s.traffic ? "TRAFFIC_AWARE" : "TRAFFIC_UNAWARE"; body.routeModifiers = { avoidTolls: Boolean(avoid.tolls), avoidHighways: Boolean(avoid.highways), avoidFerries: Boolean(avoid.ferries) }; }
    const j = await request("google-routes", "/directions/v2:computeRoutes", { method: "POST", headers: { "X-Goog-Api-Key": settings.googleKey(), "X-Goog-FieldMask": G_FIELDS }, body, cacheKey: JSON.stringify(body) });
    const routes = parseGoogleRoutes(j, mode, { traffic: drive && s.traffic });
    if (!routes.length) throw new MapsError("Google found no route between those two places.", { code: "no-route" });
    return routes;
  }
  const wantAvoid = mode === "driving" && (avoid.highways || avoid.tolls || avoid.ferries);
  if (settings.orsKey()) {
    try {
      const body = { coordinates: [[from.lon, from.lat], [to.lon, to.lat]], instructions: true, units: "m", language: "en", geometry: true };
      if (alternatives) body.alternative_routes = { target_count: 3, share_factor: 0.6, weight_factor: 1.6 };
      if (wantAvoid) body.options = { avoid_features: [avoid.highways && "highways", avoid.tolls && "tollways", avoid.ferries && "ferries"].filter(Boolean) };
      const j = await request("ors", `/v2/directions/${ORS_PROFILE[mode] ?? "driving-car"}/geojson`, { method: "POST", headers: { Authorization: settings.orsKey() }, body, cacheKey: JSON.stringify([mode, body]) });
      const routes = parseOrs(j, mode);
      if (routes.length) return routes;
    } catch (e) { if (e.code === "no-route") throw e; /* the free servers below */ }
  }
  const p = new URLSearchParams({ overview: "full", geometries: "geojson", steps: "true", alternatives: alternatives ? "true" : "false" });
  // (the FOSSGIS car profile can leave out motorways, tolls and ferries)
  const excl = wantAvoid ? [avoid.highways && "motorway", avoid.tolls && "toll", avoid.ferries && "ferry"].filter(Boolean).join(",") : "";
  const path = (withExcl) => `/${OSRM_PROFILE[mode] ?? "routed-car"}/route/v1/driving/${ll(from)};${ll(to)}?${p}${withExcl && excl ? `&exclude=${excl}` : ""}`;
  let j, note = "";
  try { j = await request("osrm", path(true), { cacheKey: path(true) }); }
  catch (e) { if (!excl || e.status !== 400) throw e; j = await request("osrm", path(false), { cacheKey: path(false) }); note = "The free route service couldn't leave those roads out, so this route may use them."; }
  const routes = parseOsrm(j, mode);
  if (!routes.length) throw new MapsError("There's no route between those two places.", { code: "no-route" });
  if (note) for (const r of routes) r.note = note;
  return routes;
}
