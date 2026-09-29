# Maps and directions

A map window on the Dayspring screen. Search for places by typing or by voice, get directions for driving, walking or cycling (and bus or train with Google), and have Dayspring read them to you one step at a time: "In half a mile, turn left onto Main Street." It works straight away with **no keys and no accounts**, using free OpenStreetMap maps. Add a Google Maps key and it switches to Google by itself.

Maps is still being built: it's in the development version only (see [Feature status](features-status.md)).

## Things you can say

- "Show me a map of Springfield" · "Open the map" · "Close the map"
- "Find coffee near me" · "Where's the nearest hardware store?" · "Find the public library on the map"
- "Directions to the city library" · "Walking directions to the park" · "Directions to number 2"
- "How long to drive to Springfield?" · "How far is Springfield?" · "Directions to the museum from the train station"
- "Read the directions" (step by step) · "Read all the directions"
- "Next step" · "Previous step" · "Repeat that" · "Start over"
- "How far is it?" · "What's my ETA?"
- "Avoid highways" · "Avoid tolls" · "Switch to walking" · "Show the other route"
- "Send the directions to my phone" · "Show the QR code"
- "Demo the directions" (every step on a timer, to hear how it sounds) · "Stop the directions"

The words are understood **without an AI and without the internet**. The map, the search and the routes themselves need the internet. With an AI, you can also just ask ("is there a pharmacy open near me?", "how long would it take to bike to work?"): it uses the same map.

"Next", "repeat that" and "how far is it" only mean the map while the map is open with a route on it. While a recipe is open in cooking mode, a plain "next step" is the recipe's, unless you started guided directions.

## The Maps window

Open it with **🗺 Maps** by the clock (in **⋯ More** when the screen is narrow), or by voice. It sits inside the screen's margins like the Music & Video window: drag the title bar to move it, drag the corner to resize it, double-click the title bar (or **▢**) to fill the screen again, **–** to shrink it to a small button, **✕** or **Esc** to close it.

- **Search:** type a place, a kind of place or an address. Suggestions appear as you type (use ↑ ↓ and Enter, or click one). Tick **Near home** for places close to home, nearest first.
- **Results** are numbered on the list and on the map, with the address, how far from home, and (with Google) the rating and opening hours. **Directions** gets a route; **Google Maps ↗** opens the place in your browser.
- **Directions:** the route is drawn on the map with any other routes in grey (click one to use it). Choose **Drive, Walk, Bike** or **Transit** (bus and train need Google), and tick **Avoid highways, tolls or ferries** for driving. Each route shows its distance and time.
- **Steps:** the current step is highlighted and shown in big letters. **◀ Previous**, **🔊 Say it** and **Next ▶** move through them (each is said out loud when "Say each step out loud" is on). Click any step to jump to it. **▷ Demo** reads them on a timer; **■ Stop** stops.
- **From:** trips start from home. Type another start (an address or a place) and press **Go**.
- **Open in Google Maps ↗**, **📱 Send to phone** and **▦ QR code** hand the trip to your phone (see [On your phone](#on-your-phone)).

## Where trips start: no GPS

A computer doesn't know where it is. "Near me" and every route start from your **home**, set in **Settings → Where you are**. If home isn't set, Dayspring says so; you can still say or type a start ("directions to the museum from the train station").

Real turn-by-turn navigation (the next turn said as you reach it) needs a moving position, which only a phone has. On this computer the steps move on when you say "next" (or on the demo timer). For the drive itself, send the trip to your phone.

For developers: the hook for a live position is ready. `POST /api/maps/position { lat, lon }` moves the route to the step being driven and says the next turn as you get close (once per turn, through the floor). A future phone client of Dayspring's multiple-devices link could send its GPS position there. There is no phone app yet.

## On your phone

- **📱 Send to phone** (or "send the directions to my phone") sends a Google Maps link to your other devices if Dayspring is signed in to them (see [Dayspring on more than one computer](multiple-devices.md)). The link opens the trip in the Google Maps app on Android or iPhone, ready to start.
- Otherwise, or as well, a **QR code** appears on the map: point your phone's camera at it and tap the link.

## Your schedule: Directions and "leave by"

An item on your schedule with a place gets a **🗺 Directions** button in the Schedule app. Outside calendars (Google, Outlook) use the event's location. For Dayspring's own items, put the place in the notes on a line of its own: `Where: 200 Main Street` (or `Location:`, `At:`, or `📍`).

For an item still ahead, Dayspring works out the drive from home and suggests when to go: "You need to leave by 2:35 to make your 3:00." (the trip time, plus the extra minutes set in Settings → Maps, rounded down to 5 minutes). **⏰ Remind me** sets a reminder for that time.

## Settings → Maps

In **Settings → Apps & connections → Maps**:

- **Maps:** **Automatic** (Google when a key is saved, otherwise OpenStreetMap), **always the free OpenStreetMap maps**, or **always Google**.
- **Google Maps key** with **Save key**, **Test** and **Remove key**, and the guide below.
- **OpenRouteService key** (optional, free): better free walking and cycling routes and avoiding roads; 2,000 routes a day.
- **Distances in** miles and feet, or kilometers and meters. **Usually travel by** car, walking, bike, or bus or train.
- **Say each step out loud**, the **demo** speed, and the **"leave by" extra minutes**.
- **Google extras (cost more):** ratings and opening hours in search, and live traffic in driving times.

Keys are kept in Dayspring's `.env` file on this computer and are never shown again, not even in Settings.

## Making a Google Maps key safely

You need a Google Cloud project with billing turned on (Google asks for it even for the free amounts). About ten minutes:

1. Open the [Google Cloud console](https://console.cloud.google.com/) and pick your project at the top (or make one).
2. **Billing:** turn it on for the project.
3. **APIs & Services → Library:** enable **Maps Embed API**, **Places API (New)** and **Routes API**.
4. **APIs & Services → Credentials → Create credentials → API key.**
5. **Restrict the key:** edit it → **API restrictions → Restrict key** → tick only those three APIs. Leave **Application restrictions** on **None** (Dayspring asks Google from your computer, not from a website), or use an **IP address** restriction if your home internet address never changes.
6. **Cap it:** for **Places API (New)** and **Routes API**, open **Quotas & System Limits** and lower the requests per day (100 a day is plenty for one person). Then **Billing → Budgets & alerts**: a small budget (like $1) with email alerts. A budget only warns you; the daily quotas are what stop spending.
7. In Dayspring, **Settings → Maps**: paste the key, **Save key**, then **Test**. Test tries one search and one route and says which API still needs turning on.

## What it costs

- **Free maps (no key):** nothing. They're community services with fair-use rules, and Dayspring keeps them: at most one request a second, its own name on every request, answers remembered for 10 minutes, map pictures kept for a week, the © OpenStreetMap credit always shown, and suggestions while typing come from Photon (the main OpenStreetMap search asks not to be used for that).
- **Google** (prices from March 2025, per month): the map (Maps Embed API) is free with no limit. Search: 5,000 free, or 1,000 with ratings and hours turned on. Directions: 10,000 free, or 5,000 with live traffic. Suggestions while typing are free when you pick one. Beyond those, Google charges per thousand (from about $5 for directions to $35 for searches with ratings), which is why the daily quotas matter.

## Troubleshooting

- **"I don't know where home is yet":** set it in Settings → Where you are.
- **Test says an API isn't turned on:** enable it in the Google Cloud console (step 3 above) and wait a minute.
- **Test says billing is needed:** turn on billing for the project (step 2).
- **The Google map says "This API project is not authorized":** enable **Maps Embed API** for the key.
- **"There's no route between those two places":** try another travel mode, or turn off an Avoid box.
- **Transit is greyed out:** bus and train directions need a Google key.
- **Everything says it can't reach the map service:** check the internet; the voice commands still work, the map needs to be online.
