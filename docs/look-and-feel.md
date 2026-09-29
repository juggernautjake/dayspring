# Look and feel: themes and avatars

Change Dayspring's colours and its face. Everything on this page is optional. Until you change something, Dayspring looks exactly as it always has: the dawn indigo and violet theme and the glowing orb.

Open **Settings → Look & feel** (under *Sound & screen*). Every change shows on the Dayspring screen straight away. **Back to the default look** puts everything back.

## Colour themes

There are 16 themes, and every one of them is easy to read:

| Theme | What it looks like |
|---|---|
| **Default** | Dayspring's dawn: night indigo and violet. |
| **Rose** | Deep berry glass with rose-pink light. |
| **Sage** | Soft garden greens, calm and earthy. |
| **Forest** | Deep pine green with fresh leaf accents. |
| **Ocean** | Sea blues and aqua. |
| **Sunset Coral** | Warm coral and amber over dusky plum. |
| **Lavender** | Gentle lilac and orchid. |
| **Mint** | Cool mint and seafoam. |
| **Harvest Gold** | Golden wheat and pumpkin on warm walnut. |
| **Crimson** | Rich crimson and ember red. |
| **Slate** | Quiet graphite greys with a steel-blue touch. |
| **Cherry Blossom** | Pale blossom pink with spring-leaf green. |
| **Emerald Night** | Jewel emerald over a deep teal night. |
| **Candy** | Bubblegum pink and bright teal on grape. |
| **High Contrast** | The strongest contrast, with bright yellow highlights: the easiest to read. |
| **Light (Day)** | A bright daytime page with dark text. |

A theme colours everything: the Dayspring screen, Dayspring mini, Settings, this guide, pop-ups, the Schedule, and the mail, GIF and video windows. It also tints the living sky and the scenery (most at night), and the orb takes the theme's colours.

- **Surprise me** picks one at random, and now and then makes a brand-new combination.
- **Preview on the Dayspring screen** shows the theme there for 15 seconds without keeping it.

### Make your own theme

Open **Make your own theme**, pick a main colour and a second colour, and (if you like) a background colour. Dayspring works out the rest: the glass, the cards, the borders, the focus ring and the sky tint. You see a sample straight away, with a check that every text colour is easy to read. Choose **Dark**, **Light** or **Automatic**, give it a name, and press **Use this theme**.

Whatever colours you pick, the text stays as easy to read as in the default theme. Each colour keeps the brightness of the one it replaces, so every piece of text keeps its contrast (WCAG AA or better).

### By voice

- "Switch to the pink theme" · "green theme" · "use the ocean theme" · "cherry blossom theme"
- "Default theme" · "light mode" · "dark mode"
- "Surprise me with a theme" · "change the theme" (the next one) · "what theme is this?" · "what themes are there?"

## Avatars

The orb is Dayspring's usual face. You can pick another one, and switch back at any time:

| Avatar | What it does |
|---|---|
| **Dayspring orb** (default) | The living ring and glassy orb. |
| **Aurora flame** | A flame of northern lights that leaps as it talks and sends up sparks. |
| **Sun ring** | A glowing ring of sunrise rays that reach out with the voice. |
| **Blob buddy** | A friendly blob whose mouth moves with the words. It blinks, looks at you when it listens, and looks up when it thinks. |
| **Waveform halo** | A halo drawn by the voice itself. |
| **Pixel pal** | A little 8-bit sprite that chatters, blinks and hops. |
| **Your picture** | Any picture you upload (see below). |

Every avatar shows what Dayspring is doing:

- **Idle:** it breathes.
- **Listening:** it leans in and brightens.
- **Thinking:** something circles around it.
- **Talking:** it moves with the voice.
- **Off (deafened):** it shows it's not listening: earmuffs, an eclipse, a flat line.
- **Stopped listening:** it shows a pause sign.
- **Error:** it sputters.
- **Quiet or night:** it sleeps (Zzz).

In Settings, each avatar has a live preview. **All of them** cycles through the states, or you can pick one state to see. **Test talking on the screen** makes the Dayspring screen's avatar talk for a few seconds without any sound.

### Your picture

Upload a JPEG, PNG, WebP or GIF as the **Main picture**. While Dayspring talks, it gently grows and shrinks with the voice. While it listens, it gets a little bigger.

You can also upload a different picture for any state: Listening, Thinking, Talking, Off, Stopped listening, Error, and Sleeping. A state without its own picture uses the main picture, and each change crossfades smoothly. Choose **Fill the circle** or **Show the whole picture**, and **Round** or **Rounded square**.

The pictures stay on this computer, in Dayspring's `data\avatar` folder.

### By voice

- "Use the blob avatar" · "use the pixel avatar" · "be the aurora flame" · "use my picture"
- "Change your avatar" (the next one) · "go back to the orb" · "what avatars do you have?"

## A look for each personality

Under **Per personality**, any personality can have its own avatar and theme. For example, the Cowboy can be Harvest Gold with the Pixel pal, and the Robot can be Slate with the Waveform halo. "The usual" means the one picked above.

A **saved personality** (a template) can remember an avatar and a theme too, so switching to it switches the look. A new template remembers the look that's in use when you save it. **Remember the look in use now** updates it, and **Forget** stops it changing the look.

## Expression mode (GIFs and memes)

This is **off** until you turn it on in **Settings → Look & feel → Expression mode**, or say "turn on expression mode". When it's on, Dayspring sometimes shows a GIF or a meme in the avatar's place to show how it feels. It might be excited, happy, proud, celebrating, thinking, confused, surprised, sympathetic, gently annoyed, sleepy, laughing, encouraging you ("you've got this"), grateful, saying hello or goodbye, saying "oops", giving a heads-up, or agreeing. After a loop or two, the avatar comes back.

- **How it knows the feeling:** from the words of what it's saying (on this computer), from the AI's own hint when there is an AI, and from events: a badge 🎉, a new level, an alarm ⏰, or an error that fixed itself.
- **Each personality has its own kind.** The Cowboy's are western (horses, saloons, yeehaw), the Robot's are tech and sci-fi, the Fair Maiden's are fairy tale, the Broski's are gym and bro, and the Star Sage's are wise masters and starry skies. The Default's are warm and wholesome, and every other personality and secret character has its own kind too. They're listed in one file you can edit: `lib/looks/expression-packs.json`. Put your changes in `data/expression-packs.json`, and they're kept when Dayspring updates.
- **It fits the moment:** each GIF plays for one or two whole loops, or about as long as Dayspring is talking. It reads how long a loop is from the GIF itself. It only ever shows in the avatar's own place, so it never covers anything you need.
- **It's never the same one twice in a row:** the last dozen shown for a feeling aren't used again, and fresher ones are picked more often.
- **Settings:** the highest rating (**G**, **PG** as usual, or **PG-13**), how often, how much space to use, whether to check each picture first, whether to find new ones on the web, whether to use your own, and whether events count.

### Building the library

**Build my expression library** finds about 30 GIFs for each feeling for this personality and the default one. It goes slowly, to stay within the GIF services' limits, and shows its progress. Choose **Every personality** to fill them all (this takes longer). You can see what's kept under **See and remove what's kept**, and remove any you don't like. A removed GIF is never fetched again.

### Checking each picture

Before a GIF is kept, Dayspring checks it:

1. **Its title, tags and page** must fit the personality's kind and the feeling, and must be clean. Anything with violence, weapons, alcohol, rude words or scary themes is left out, and so is anything whose words say the opposite feeling (a "sad" GIF for excitement).
2. **The words in the picture:** Windows reads any text in it, and text that contradicts the feeling (or isn't clean) rules it out.
3. **The picture itself,** when **Describe images with AI** is on (Settings → Photos & people). The AI is asked whether the picture shows the feeling, whether it suits all ages, and whether it's the personality's kind.

Each answer is remembered, so nothing is checked twice.

### Your own GIFs and pictures

Under **Add your own**, upload a GIF, picture or short MP4, then say which feeling it shows and which personality it's for (or every personality). Your own are used alongside the others and are never removed to save space.

### Where the GIFs come from (licensing)

Dayspring doesn't include anyone else's memes, GIFs or pictures, and none are in the download. They're found while you use Dayspring, through the GIF sources in [Settings → GIFs](gifs.md) (GIPHY, KLIPY and Imgur with your own free keys, or the keyless web search), under each service's terms. They're kept only on this computer, in `data\expressions`, and nothing is shared anywhere. Point at a GIF on the screen to see its title and where it came from (for example "Powered by GIPHY").

The only pictures that come with Dayspring are its own stickers: 18 small animated faces drawn for Dayspring, one for each feeling. The Default personality uses them when there's nothing else to show, for example with no internet.

### By voice

- "Turn on expression mode" · "express yourself with GIFs" · "stop using GIFs" · "turn off expression mode"

## Switching it all off

**Back to the default look** sets the Default theme and the orb, and turns expression mode off. You can also switch off **Colour themes** or **Avatars and expression mode** in [Settings → Features](features-status.md). A feature that's switched off shows the default look.
