# Pictures from the web

Ask Dayspring to find pictures of anything, and they show up on the Dayspring screen as a numbered grid. You don't need an AI or a key for this.

## Things you can say

- "Show me pictures of golden retrievers"
- "Image search for mid-century desk"
- "Find a transparent PNG of a lantern" · "Find a GIF of a dancing cat" · "Find me wallpapers of mountains"
- "What does a capybara look like?"

About 12 pictures show at a time, each with a number, its title and the site it came from.

While the pictures are up:

- **"Show number 3"** or **"show number 2 bigger"** shows one picture large, with a link to the page it came from. You can also click a picture.
- **"More"** or **"next page"** shows the next pictures. Their numbers carry on from 13. **"Previous page"** goes back.
- **"More like number 4"** looks for pictures like that one.
- **"Save number 3"** or **"save that one"** downloads the picture (see below).
- **"Open the source for number 2"** opens the picture's page in your browser.
- **"Close images"**, **✕** or **Esc** closes them. In the big view, Esc goes back to the grid.

## Narrowing it down

Say any of these while pictures are up, and Dayspring searches again:

- **"Only photos"**, **"just clip art"**, **"only GIFs"**, **"transparent ones"**
- **"Bigger ones"** or **"smaller ones"**
- **"Only red ones"** or **"in black and white"**
- **"Wide ones"**, **"tall ones"** or **"square ones"**
- **"Recent ones"**
- **"From Wikipedia"**, or any site, for example "from nasa.gov"
- **"All of them"** or **"clear filters"** to start over

## Saving pictures

If Dayspring may change files in your **Pictures** folder (Settings → **Permissions**), saved pictures go to **Pictures › Dayspring**. Otherwise they go to Dayspring's own `data\images` folder.

Next to each picture there's a small `.json` file with the same name. It notes the page the picture came from, its web address, and what you searched for, so you can always find the original again.

Asking to save counts as your OK, so Dayspring doesn't ask a second time.

## With an AI

With an AI set up, you can just talk about the pictures: "find me some cozy reading nooks and tell me which one has a fireplace." If your AI can see pictures (Claude can), it can answer questions like **"which of these has a red door?"** by looking at them.

The AI describes what's in a picture, but it never tries to say who a person in it is.

## SafeSearch

SafeSearch is on (**moderate**) to begin with. To change it, say **"set safe search to strict"**, **"moderate"** or **"turn safe search off"**.

## Privacy

- The Dayspring screen never loads pictures straight from other websites. Dayspring fetches each one itself and passes it along, so the sites don't see the screen, and nothing from them runs on it.
- Dayspring only fetches pictures from the open web. Addresses on your computer or your home network are always refused, even when a website tries to redirect there.
- It only accepts real image files, up to 8 MB each, and gives up on any that take too long.
- Searches go to DuckDuckGo first, then Bing. The results are kept for about 10 minutes, so paging back and forth doesn't search again.

## Optional: a search key

Dayspring works without any key. If you have a key for an image search service, Dayspring uses it first and falls back to the free searches when it can't.

| Service | What goes in `.env` |
|---|---|
| Brave Search API | `BRAVE_SEARCH_API_KEY` |
| Google Programmable Search | `GOOGLE_CSE_KEY` and `GOOGLE_CSE_ID` (a search engine with image search on) |
| Bing Image Search | `BING_IMAGE_SEARCH_KEY` |

Keys are kept in `.env` like Dayspring's other keys. They're never shown again or written to a log.

## If it doesn't work

- **"I couldn't reach any picture search just now"**: check the internet connection. If it keeps happening, the search sites may be blocking automated searches for a while. Try again later, or add a key (above).
- **A picture shows 🖼 instead of the image**: that site refused to hand it over, or it wasn't a real image. Try another number.
- **"Looking things up online is turned off"**: turn on **Web** in Settings → **Permissions**.
