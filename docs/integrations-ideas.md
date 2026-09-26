# Integration ideas

Hookups Dayspring doesn't have yet, how each could work, and how hard it would be. Want one? Open an issue or build it: every connector follows the same small pattern, described at the end of this page. What already works is in [Connecting apps](connections.md).

**Feasibility:** ★★★ easy (an afternoon) · ★★ moderate (a day or two) · ★ hard or limited by the provider.

**Two shortcuts cover a lot of this list today:**

- **[Home Assistant](connections.md#home-assistant-smart-home)** already reaches most smart-home brands.
- **[Webhooks](connections.md#webhooks-ifttt-zapier-make-n8n)** (IFTTT, Zapier, Make, n8n) reach most web apps.

## Tasks and reminders

| Service | Feasibility | Approach |
|---|---|---|
| **Apple Reminders** (iCloud) | ★ | Apple has no public Reminders API. The CalDAV "VTODO" endpoint on iCloud stopped carrying Reminders when Apple upgraded them (iOS 13+).<br>Practical routes:<br>(1) An **Apple Shortcut** on the iPhone that runs on a schedule (Personal Automation) and POSTs the day's reminders to Dayspring's [incoming webhook](connections.md#incoming-webhooks-from-the-internet) (needs a tunnel).<br>(2) Keep using Microsoft To Do or Todoist, which do sync with phones. |
| **Trello** | ★★★ | REST API with a personal API key + token (trello.com/power-ups/admin → API key → generate a token).<br>List cards on a board or list, add a card, move a card to "Done".<br>Same shape as `todoist.mjs`. |
| **Asana** | ★★★ | Personal Access Token (Asana → My settings → Apps → Developer apps).<br>`GET /tasks?assignee=me&workspace=…&completed_since=now`, `POST /tasks`, `PUT /tasks/{id} {completed:true}`. |
| **Google Tasks** | ★★ | The Google connector already signs in; add the `tasks` scope and the Tasks API.<br>Needs the owner to reconnect Google once. |
| **TickTick, Things, OmniFocus** | ★ | No stable public write API (Things and OmniFocus are Mac-only automation).<br>TickTick has an OpenAPI with OAuth; possible, but thin. |

## Chat and work

| Service | Feasibility | Approach |
|---|---|---|
| **Slack** | ★★ | Create a Slack app with a **user token** (`channels:history`, `chat:write`, `search:read`).<br>"Any messages from my team?", "post 'running 5 late' in #general" (with a yes first, like email).<br>An incoming Slack **Workflow** can already call Dayspring's webhook. |
| **Microsoft Teams** | ★★ | The Microsoft connector can add `Chat.Read`, `ChannelMessage.Read.All` and `ChatMessage.Send` scopes to Graph.<br>Work and school tenants may need admin consent.<br>Reading calls or meetings from Outlook already works. |
| **Zoom / Google Meet** | ★★ | Today's meetings with join links already come from Google/Outlook calendar events.<br>A "join my next meeting" phrase just opens the link. |

## Health and fitness

| Service | Feasibility | Approach |
|---|---|---|
| **Strava** | ★★ | OAuth app (strava.com/settings/api, callback `http://localhost:4747/oauth/strava`).<br>"How far did I run this week?", recent activities, weekly totals.<br>Read-only. |
| **Fitbit** | ★★ | Google now runs Fitbit accounts. The Fitbit Web API (OAuth 2 + PKCE, "Personal" app type) gives steps, sleep and heart rate. Check the current Google Health API migration before building. |
| **Google Fit** | ★ | Google is winding down the Fit APIs in favor of Health Connect, which is on-device (Android only). Not a good target. |
| **Apple Health** | ★ | No cloud API. An Apple Shortcut could POST daily totals (steps, sleep) to the incoming webhook. |
| **Withings, Oura, Garmin** | ★★ | Withings and Oura have personal-token or OAuth APIs.<br>Garmin's Health API requires a business application. |

## Media and entertainment

| Service | Feasibility | Approach |
|---|---|---|
| **Plex** | ★★★ | Local server + `X-Plex-Token`.<br>"What's new on Plex", "play The Office on the living room TV" (`/clients` and the playback API), continue-watching list. |
| **Jellyfin / Emby** | ★★★ | Local server + API key (Dashboard → API Keys).<br>`/Items`, `/Sessions/{id}/Playing` to start playback on a client. |
| **Sonos** | ★★ | Through Home Assistant today (media_player entities work with `home_control`).<br>Direct: the Sonos Control API (OAuth, cloud) or local UPnP. |
| **Audiobookshelf, Podcasts** | ★★★ | Audiobookshelf has a token API.<br>Podcasts are RSS: the news feeds connector can already follow a podcast's feed for "what's new". |

## Smart home

| Service | Feasibility | Approach |
|---|---|---|
| **Philips Hue** (without Home Assistant) | ★★★ | Local Hue Bridge v2 API: press the bridge button and `POST /api` to get an app key, then `/clip/v2/resource/light`.<br>No cloud needed. |
| **Govee** | ★★★ | Govee Developer API key (Govee Home app → Profile → Settings → Apply for API key).<br>`GET /router/api/v1/user/devices`, `POST /router/api/v1/device/control`.<br>Rate-limited. |
| **TP-Link Kasa / Tapo, Wemo, LIFX** | ★★ | LIFX has a clean cloud token API (★★★).<br>Kasa and Tapo are local but their protocols change; Home Assistant handles that better. |
| **Ring** | ★ | No official public API; the unofficial ones break and need the account password + 2FA.<br>Use **Home Assistant's Ring integration** (then "is anyone at the door?" works through the Home Assistant connector). |
| **Nest / Google Home** | ★ | The Device Access program costs a one-time $5 and needs a Google Cloud project + Pub/Sub; thermostats and cameras only.<br>Home Assistant's Nest integration is the easier path. |
| **Alexa / Google Assistant routines** | ★★ | Trigger them via Home Assistant, or IFTTT/Alexa webhooks from the outgoing webhook connector. |

## Cars

| Service | Feasibility | Approach |
|---|---|---|
| **Tesla** | ★★ | Tesla Fleet API: register a developer app, OAuth, and a virtual key paired to the car for commands.<br>Read battery, range and location; climate on/off; lock/unlock (with a yes).<br>Fleet API calls are billed by Tesla past a free tier. |
| **Other cars** (FordPass, MyChevrolet, Hyundai/Kia) | ★ | Mostly unofficial APIs; Home Assistant integrations (some community) are the practical route. |
| **Smartcar** | ★★ | One API across ~40 brands, OAuth; free for personal testing, paid beyond. |

## Money

Dayspring won't move money. Read-only, opt-in only.

| Service | Feasibility | Approach |
|---|---|---|
| **YNAB** | ★★★ | Personal Access Token (YNAB → Account settings → Developer settings).<br>"How much is left in groceries?", recent transactions.<br>Read-only. The friendliest budget API. |
| **Monarch, Copilot, Rocket Money** | ★ | No public APIs. |
| **Banks** (via Plaid / SimpleFIN) | ★★ | **SimpleFIN Bridge** (~$15/yr) gives a personal read-only access URL covering many U.S. banks: balances and transactions, no developer account.<br>Plaid needs a developer account and production approval.<br>Either way, read-only balances and "did my paycheck land?" only. |
| **Bills and due dates** | ★★★ | Already possible: a calendar subscription or reminders. |

## Faith and community

| Service | Feasibility | Approach |
|---|---|---|
| **Church calendars** (Planning Center, Church Center) | ★★★ | Planning Center Calendar publishes `.ics` feeds; subscribe with the calendar connector today.<br>Planning Center Services (serving schedules) has a personal-access-token API (★★). |
| **YouVersion** | ★ | No public API for reading plans. |
| **Hallow, Pray.com** | ★ | No public API. |

## Home and life

| Service | Feasibility | Approach |
|---|---|---|
| **Grocy / Mealie / Paprika** | ★★★ | Grocy and Mealie are self-hosted with API keys (shopping lists, meal plans, recipes). Paprika has an unofficial sync API (★). |
| **AnyList / OurGroceries** | ★ | No public APIs. |
| **Package tracking** (AfterShip, 17TRACK) | ★★ | API key + tracking numbers the owner adds; "where's my package?". |
| **Air quality / pollen** | ★★★ | Open-Meteo's air-quality API (free, no key) alongside the forecast. |
| **School portals** (PowerSchool, Canvas) | ★★ | Canvas has personal access tokens (assignments, due dates).<br>PowerSchool varies by district.<br>Many schools already offer an `.ics` link. |

## How to add a connector

Every connector is one file in `lib/connectors/` exporting:

```js
export const connected = () => …;            // true when set up
export function status() { return { id, connected, who }; }
export async function connect(fields) { … }  // validates, then store.save("<id>", …)
export function disconnect() { … }           // store.forget("<id>")
```

Then:

1. **Guide:** add a walkthrough to `lib/connectors/guides.mjs` (steps, fields, notes). Settings and the voice guide show it automatically.
2. **Routes:** add the id to `NAMES` in `lib/connector-routes.mjs`. `POST /api/connect/<id>/start` calls your `connect(fields)`.
3. **AI and voice:** in `lib/connectors/index.mjs`:
   - add it to `statuses()`
   - add AI tools to `TOOLS` + `runTool`
   - optionally add no-AI phrases in `handle()`
4. **Docs:** add a section to `docs/connections.md`.

Keep secrets in `data/connectors/<id>.json` via `store.mjs` (never in code), use `store.fail(res, "Name")` for friendly errors, and ask the owner before anything irreversible or physical.
