// Maps (feature "maps", lib/features.mjs): a map panel on the Dayspring screen with search, directions and spoken
// step-by-step guidance. Free and keyless by default (OpenStreetMap: Nominatim/Photon search, OSRM or OpenRouteService
// routes, OSM map pictures through Dayspring); Google Maps (Embed, Places, Routes) as soon as a key is saved.
//   words.mjs    what's said: distances, times, steps, "leave by"      settings.mjs  Settings → Maps (keys in .env)
//   net.mjs      every request: User-Agent, one a second, cache, mocks  search.mjs    places      route.mjs  routes
//   guide.mjs    what the panel shows, steps, guided mode, the phone   skills.mjs    voice and the AI's tools
//   routes.mjs   /api/maps
// start(deps) wires it to the rest of Dayspring (server.mjs): the screen, the floor, home, his other devices.
import * as guide from "./guide.mjs";
import * as routes from "./routes.mjs";

export function start({ broadcast, announce, home, notify, addReminder } = {}) {
  guide.setDeps({ ...(broadcast ? { broadcast } : {}), ...(announce ? { announce } : {}), ...(home ? { home } : {}), ...(notify ? { notify } : {}) });
  routes.setDeps({ ...(announce ? { announce } : {}), ...(addReminder ? { addReminder } : {}) });
}
export { guide, routes };
