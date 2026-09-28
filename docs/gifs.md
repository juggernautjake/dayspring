# GIFs

Find GIFs and stickers by voice or by typing, from several places at once, and all in one list. You can copy a GIF, save it to your computer, or add it to an email. GIFs work straight away with **no keys and no accounts**. A free key from GIPHY or KLIPY adds many more.

## Things you can say

- "Show me a GIF of a dancing cat"
- "Find a thumbs up GIF" · "Facepalm GIF" · "Find me a sticker of a cat"
- "Trending GIFs" · "Show me GIFs"
- "Add a funny GIF about Mondays" (with an AI, while you write an email)

The GIF picker opens with the results numbered. While it's open you can say:

- **"Number 4"** shows that GIF big, with its title and where it came from.
- **"More"** loads more GIFs.
- **"Save that GIF"** or **"save number 3"** saves it to your computer (see [Saving GIFs](#saving-gifs)).
- **"Copy that one"** or **"copy number 2"** copies the GIF so you can paste it anywhere. **"Copy the link"** copies just its web address.
- **"Only stickers"** or **"just GIFs"** switches between stickers and GIFs.
- **"Clean ones only"** shows only G-rated GIFs. "PG only" and "PG-13 only" work too.
- **"Only from GIPHY"** (or KLIPY, Imgur, the web) and **"all sources"**.
- **"Favourite that one"** adds it to your favourites.
- **"More like number 4"** looks for GIFs like that one.
- **"Pick number 3"** adds it to the email you're writing, when the picker was opened from the email editor.
- **"Back"** goes back to the grid. **"Close the GIFs"** closes the picker.

All of these work without an AI.

## The GIF picker

Open it with **🎞 GIFs** by the clock (in **⋯ More** when the screen is narrow), by saying "show me GIFs", or in any browser tab at `http://localhost:4747/gifs`.

- **Tabs:** Search, Trending, Categories, Favorites and Recent. Recent is the GIFs you picked, copied or saved.
- **The chips** under the search box are quick reactions: happy, thumbs up, facepalm, applause and more. Categories has many more.
- **Filters:** which source (All, GIPHY, KLIPY, Imgur, Web), the highest rating, GIFs or stickers, the format for the big preview and for saving (GIF, MP4 or WebP), and **Small (data saver)** for lighter previews.
- **The grid** loads more as you scroll. Each GIF has a number for voice and a small label saying where it came from.
- **Click a GIF** (or press Enter) for the big preview with its title, source, rating and size, and these buttons: **Insert this GIF** (only from the email editor), **Copy GIF**, **Copy link**, **Save to my computer**, **☆ Favourite**, **Open source page** and **More like this**.
- **Move and resize it:** drag the title bar to move the picker, and the corner to resize it. **▢** puts it back to fill the screen, and **–** shrinks it to a small 🎞 GIFs button. It always stays inside your screen margins.

### Keys for the keyboard

| Key | What it does |
|---|---|
| Arrow keys | Move between GIFs |
| Enter | Open the big preview (in the preview: insert, when picking for an email) |
| / | Jump to the search box |
| C · L · S · F | In the preview: copy the GIF, copy the link, save, favourite |
| ← → | In the preview: the previous or next GIF |
| Esc | Back to the grid, then close |

## Where GIFs come from

Dayspring asks every source that's switched on **at the same time**, then mixes the results into one list: one from each in turn, with the best match to your words first. The same GIF often exists on two sites, so duplicates are removed. Dayspring compares their IDs, their addresses, their titles and shapes, and even a tiny fingerprint of the first frame, so you don't see the same GIF twice.

| Source | Key? | What it has |
|---|---|---|
| **GIPHY** | A free key | The biggest GIF library. GIFs, stickers, trending and categories. Shown with "Powered by GIPHY". |
| **KLIPY** | A free key | A large free GIF and sticker library (the usual replacement for Tenor). Trending and categories too. |
| **Imgur** | A free Client ID | Animated GIFs from Imgur's gallery. Only with the PG-13 or R setting, because Imgur doesn't rate its GIFs. No stickers. |
| **Web** | None | Animated pictures from the web image search (DuckDuckGo, then Bing). Always available. |

**Tenor** isn't there: Google closed the Tenor API for good on June 30, 2026, and has taken no new keys since January 2026.

**When a source has trouble:** each one gets 4 seconds. A slow source never holds the others up: its GIFs join the list when they arrive. If a source fails three times in a row, Dayspring rests it for 3 minutes. If it says "too many searches" (a free key allows about 100 searches an hour), Dayspring waits as long as it asks. A small chip in the picker says so, for example "GIPHY busy right now". If no source can answer, the web search steps in, so you always get GIFs.

Searches are remembered for 10 minutes and trending GIFs for 30, so asking again is instant and doesn't use up your searches.

## Getting a free GIPHY key

1. Go to [developers.giphy.com](https://developers.giphy.com/dashboard/?create=true) and sign in, or make a free account.
2. Click **Create an App**, choose **API** (not SDK), and give it a name, like "Dayspring". Tick the box to agree to GIPHY's terms.
3. Copy the **API key** it shows you.
4. In Dayspring, open **Settings → GIFs**, paste the key into the GIPHY card and click **Save key**. Dayspring tests it straight away and shows **✓ Works**.

A new GIPHY key is a free "beta" key, which allows about 100 searches an hour. That's plenty for one home. GIPHY asks that "Powered by GIPHY" is shown with its GIFs, and Dayspring does that for you.

## Getting a free KLIPY key

1. Go to [partner.klipy.com](https://partner.klipy.com/) (KLIPY's Partner Panel) and make a free account.
2. Add an app (any name, like "Dayspring") and open its API keys.
3. Copy the key, paste it into the KLIPY card in **Settings → GIFs** and click **Save key**.

A new KLIPY key is a test key with about 100 searches an hour. KLIPY gives production keys for free if you ever need more. Dayspring never asks KLIPY for ads.

## Getting an Imgur Client ID

1. Sign in to Imgur, then open [api.imgur.com/oauth2/addclient](https://api.imgur.com/oauth2/addclient).
2. Name it "Dayspring", choose **Anonymous usage without user authorization**, and enter any callback address, for example `https://localhost`.
3. Copy the **Client ID** (not the Client secret), paste it into the Imgur card and click **Save key**.

## What about Tenor?

Google shut down the Tenor API on June 30, 2026, and stopped giving out new keys in January 2026, so Tenor can't be added. KLIPY has much the same GIFs and stickers, with a free key.

## Settings

Everything is in **Settings → GIFs**:

- **Sources:** each source's card has an on/off switch, its key (saved in Dayspring's `.env` file and never shown again), **Test** (it says ✓ Works, Key not accepted, Busy, or Unavailable), **Get a free key** with the steps, and the credit it's shown with. Drag the cards, or use ▲ ▼, to choose which source goes first.
- **Highest rating to show:** G, PG, PG-13 (the default) or R. Dayspring asks each source for that rating and also checks every GIF itself, so nothing rated higher gets through.
- **Show at first:** GIFs or stickers.
- **Preferred format:** GIF (works everywhere), MP4 or WebP (both smaller). It's used for the big preview, saving and attaching.
- **Animate GIFs:** always, only when pointed at, or never in the grid. If Windows is set to reduce motion, "always" animates only when pointed at.
- **Data saver:** smaller previews in the grid.
- **Save GIFs to:** a folder of your own, or leave it empty for **Pictures › Dayspring GIFs**.
- **Cache:** how much space GIFs kept for attaching and copying may take (200 MB to start), and **Clear GIF cache**.
- **Favourites and recent GIFs:** how many you have, and buttons to clear them. They're kept on this computer in `data\gifs.json`.
- **Say the GIF's title when you pick one:** "Number 4: Dancing cat, from GIPHY", or just "Number 4".

## Saving GIFs

If Dayspring may change files in your **Pictures** folder (Settings → **Permissions**), saved GIFs go to **Pictures › Dayspring GIFs**, or to the folder you chose in Settings. Otherwise they go to Dayspring's own `data\gifs` folder. Next to each GIF there's a small `.json` file noting where it came from. Every save is written in the [activity log](permissions.md#the-activity-log).

## Copying GIFs

**Copy GIF** puts three things on the Windows clipboard at once: the GIF file, the GIF as a picture, and its link. So pasting works almost anywhere: Outlook, Gmail, Word, Discord, Teams and Slack, or a folder. **Copy link** copies just the address of the GIF's page.

## GIFs in email

When you're writing an email, the email editor opens this same picker. Pick a GIF (click **Insert this GIF**, or say "pick number 3") and it goes into your email. With an AI you can also just ask: "add a funny GIF about Mondays". For developers: any page can open the picker with `window.dsGifPicker.open({ query, onPick })`, and `GET /api/gifs/file?id=…` hands back a local copy for attaching.

## Safety and privacy

- Every GIF is fetched by Dayspring and shown through its own safe proxy, so GIF sites never see your screen's requests. Addresses on your computer or home network are refused, and nothing over 20 MB is loaded.
- GIF titles are only ever shown as plain text.
- Your keys stay in the `.env` file. They're never logged or shown back.
- Your searches go to the sources you've switched on (and to DuckDuckGo or Bing for web results). Nothing else is sent.

## Related

- [Pictures from the web](image-search.md)
- [Permissions](permissions.md)
- [Settings reference](settings-reference.md)
