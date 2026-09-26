# Discover: things you're into

Tell Dayspring what you're into, like hunting, marine wildlife, woodworking or pickleball. Every so often it looks for something good about one of those interests: a popular new YouTube video, a **Short** (a quick clip under a minute or so), or an article worth reading. It shows the best few on the screen under **For you**, and it never shows you the same thing twice.

## Your interests

Add anything you like, up to 40, in your own words.

- **During setup:** the Interests step has a list to pick from, plus **Add your own**. Type one and press Enter.
- **In Settings → You:** the same chips. ✕ removes one.
- **By voice or typing:**
  - "Add woodworking to my interests" · "I'm into pickleball" · "My new hobby is fly fishing"
  - "Remove golf from my interests" · "I'm not into golf anymore"
  - "What are my interests?"

When an interest clearly belongs to one of the menu's (pickleball → Sports, hunting → Running & outdoors, marine wildlife → Science & nature), the matching features switch on too. Nothing is ever switched off this way. Anything else is kept exactly as you typed it and becomes a search topic.

## How it searches

The kind of interest decides what it looks for. With an AI brain, the AI decides the kind; without one, Dayspring makes a sensible guess.

| Kind | Examples | What it finds |
|---|---|---|
| **Discovery** | marine wildlife, space, birds, dinosaurs | New discoveries, rare sightings and amazing footage, favoring National Geographic, Smithsonian, NOAA, BBC, NASA and similar sources |
| **Hobby** | hunting, woodworking, pickleball, cooking | Tips, how-tos, gear, season advice and good stories |
| **News** | tech news, politics, markets | The latest news |

Each time it looks, it picks the interest it hasn't looked at for the longest, finds recent popular videos and Shorts, and (if web lookup is allowed in **Permissions**) articles. It skips shopping sites, social media, paywalled news and anything you've already watched. With an AI it picks the best 3 or 4 and writes one line on why you'd like each. Without an AI it ranks them by views, how recent they are and the source.

## On the screen

- **For you** joins the rotating showcase once there's something to show. It shows a picture, a **Video**, **Short** or **Article** badge, where it's from, and why you'd like it.
  - **▶ Watch** plays it on the screen. **Open ↗** opens an article in your browser.
  - **👍 More like this** looks for more like it right away and leans toward that interest.
  - **👎** hides it and shows a bit less of that interest for a while.
  - **All finds** opens the full list, with a filter for each interest and a **Look now** button.
- **A pop-up**, now and then: "Found a popular new marine wildlife short clip. Want to watch?" At most 2 a day by default, only in the daytime, and never for something you just asked for.

## Things you can say

- "Show me something new about woodworking" · "Find me something cool about sharks"
- "Surprise me" · "Find me something new"
- "What did you find for me today?" · "Show my For you list"
- "More like that" · "Not interested in that" (about what's on the screen)

With an AI brain you can also ask in your own words ("got any good ocean videos?"), and the AI can add interests for you.

## Settings

In **Settings → Features & apps → Discover**:

- **On or off.**
- **How often:** a few times a day (the default), about every hour, or only when you ask.
- **Pop-ups a day:** none, 1, 2 (the default), 3 or 5.

It only looks while the Dayspring screen is open, and never at night (10 PM to 7 AM).

## Where it's kept

What it found is saved in `data\discover.json` on your computer: about the last 100 finds, what you've seen, liked or hidden, and a list of everything it's already shown so nothing repeats. To start over, close Dayspring and delete that file. Searches go to YouTube and, for articles, the web search Dayspring already uses. With an AI brain, the results' titles also go to your AI provider so it can pick the best. Your interests aren't sent anywhere else.
