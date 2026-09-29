# Photos and people

Dayspring can describe pictures, read the text in them, and, if you turn it on, recognise the people in your own photos. It keeps a page for each person in your life: their photos, how you're connected, prayer requests, goals, plans together, and (if you want) your texts and calls with them.

Everything about faces stays on your computer. Face recognition is off until you turn it on.

## Describing pictures

Works for your own photos, the photo on the Dayspring screen, and pictures from a web image search.

- "Describe this picture" · "Describe it in detail"
- "What does this say?" · "Read the text in this image"
- "Who is in this picture?"

Without an AI, Dayspring puts together what it can work out on your computer:

- the text in the picture, read by Windows' own text recognition
- when it was taken and with which camera
- how many faces there are, and the names of the people you've named (your own photos only)
- the main colours and the size
- what you told it about the photo before

With an AI that can see pictures (Claude, ChatGPT or Grok, or a vision model in Ollama), you can turn on **Describe images with AI** in Settings → Photos & people. Then the AI looks at the picture too and describes the scene, what people are doing, the mood and the setting. Dayspring gives it the names you've taught it, so it says "Sam and Riley at a lake" instead of "two people". The first time, Dayspring asks before sending any picture.

> **Where it was taken:** if a photo has its location saved in it, Dayspring notes that it does, but keeps the coordinates to itself. It never looks the place up online, and never sends the location to the AI.

## Recognising faces in your photos

Turn it on in Settings → **Photos & people** → **Recognise faces in my photos**. Dayspring explains what happens first:

- **It stays on this computer.** Faces are found and compared here. Nothing about a face is uploaded, and nobody is ever looked up online.
- **What's stored:** where each face is in each photo, a "fingerprint" of it (128 numbers), and a small thumbnail for each person. It's encrypted with your Windows account (in `data\people\faces.bin`) and never exported.
- **How to delete it:** **Delete all face data** removes all of it. Deleting one person removes their faces too.
- **Ask first.** Please get people's OK before you name and catalogue them.

The first time, Dayspring downloads the face models, about 72 MB (54 MB on disk). They come from OpenCV and Microsoft's ONNX Runtime, and each file is checked against its fingerprint before it's used. Then Dayspring looks through your photo folders slowly in the background. It uses the same folders and the same privacy filter as the photos on the screen, so screenshots, IDs, bank statements and similar files are never looked at. You can **Pause** and **Resume** it. After a restart it picks up where it stopped.

Faces that look alike are grouped as "Unknown person 1", "Unknown person 2" and so on, until you name them.

### Naming people

When a photo with people you haven't named is on the Dayspring screen, Dayspring sometimes asks **"Who's in this picture?"**. Just answer:

- "Me, Sarah and her husband Tom"
- "Sarah's on the left, Tom's on the right"
- "That's my cousin Sarah at her wedding"
- "From left to right: Tom, Sarah and Mike. We were camping."

Dayspring matches the names to the faces from left to right, saves what was going on with the photo, and adds it to each person's page. It tells you what it saved. If it had to guess the order, it says so.

When you name someone, every photo in their group gets their name. If another group looks like the same person but Dayspring isn't sure, it asks: "Is this also Sarah? (74% sure)". It never labels an unsure match by itself.

**When it asks:** only at relaxed times (8 a.m. to 9 p.m., not during study or work blocks), never when Dayspring is Quiet or Off, and never during a meeting or a call. At most once a day, or twice if you choose. If a photo also has no description yet, it's one question: "Who's in this picture, and what was going on?"

Turn the questions off with **Ask who's in pictures**.

### Fixing mistakes

On the **People** page (Settings → Photos & people → Open the People page):

- **Name** a group, or **Ignore** it so Dayspring never asks about it
- **Merge** two people who are the same person
- **Delete** a person: their page, their faces (fingerprints and thumbnails), and saved messages and calls

You can also say "the one on the left is Sarah" while a photo is showing, or "delete Sarah from my people" (it asks before deleting). With an AI, you can say things like "that's not a person, it's a statue" or "those two are the same person".

### Things you can say

- "Who is in this picture?"
- "Show me photos of Sarah"
- "When did I last see Mike in a photo?"
- "Tell me about Sarah"

## People's pages

Each person's page brings together:

- their photos and faces, and when they first and last appear
- their relationship to you, their nickname, and how they're connected to other people
- prayer requests about them, open and answered. Private requests show only the title until you open them.
- your goals that mention them
- past and upcoming plans with them from your schedule and calendars ("coffee with Mike"), and their birthday
- your texts and calls with them, if you turned that on
- notes and facts you've told Dayspring

Things you can say:

- "Tell me about Sarah"
- "When did I last talk to Mike?"
- "What's going on with Sarah lately?": recent texts, prayer requests and plans
- "Remind me to check on Tom": a reminder for tomorrow at 10

## Texts and calls on people's pages

Off by default. In Settings → Photos & people:

- **Save my text messages to people's profiles**: new texts Dayspring sees through Phone Link, and texts it sends for you, go on the person's page. Off means nothing is written.
- **Save call history to people's profiles**: who, when, how long, and which app (Phone Link calls, the Discord bot's voice calls).
- **Keep saved messages and calls**: keep them, or 30, 90 or 365 days.
- **Delete all saved messages** removes them all.

They're encrypted with your Windows account (in `data\people\comms.bin`). Announcing a new text and reading it only when you say yes works exactly as before.

When Dayspring isn't sure who a text is from, it asks instead of guessing: "Is 'Mike R' in your texts the same person as Mike from your prayer list?". These questions count toward the same daily limit. If a text mentions someone new ("my husband Tom"), the People page suggests adding them. Nothing is added until you say so.

The AI only reads your saved messages if you turn on **Let the AI read saved messages when I ask about someone**, and then only when you ask something that needs them.

## The photo gallery

Every photo Dayspring may show, in one place: the photos in your photo folders (the same ones the rotating photo card uses, with screenshots, private-looking folders and names, and the photos you hid left out) and the pictures in the folders you've allowed in **Settings → Permissions**.

> **New:** this is a beta feature. You can switch it off in **Settings → This app → Features** ("The photo gallery").

Say **"open the photo gallery"** (or "show my photos"), or press **🖼 View in gallery** on any photo.

- **The grid.** Scroll through all of it, however many thousands of photos you have: only what's on the screen is drawn, and the small pictures are made on this computer and kept in Dayspring's `data\thumbs` folder (it never grows past its limit; the oldest go first). HEIC and TIFF photos from a phone are decoded by Windows.
- **Group** by month, folder or album (the category from what you've told Dayspring about a photo), or not at all. **Sort** by date (the date the photo was taken when the camera saved it, else when the file changed), name or size, and **↓/↑** flips the order.
- **Filters:** a person (when face recognition is on), **★ only** your favourites, **Has text** (pictures the viewer has read text in), **🎬 Videos too**, and the search box (a file or folder name, or your own words about a photo).
- **🎲 Random:** a shuffled mix from all your photo folders. Scroll or press **More** for more, never the same photo twice; **Shuffle again** starts with the ones you haven't seen yet. Hidden photos never come up.
- **★ Favourites:** press **☆** on a photo to keep it there.
- **▶ Slideshow:** from the gallery or from any photo.

### One photo at a time

Click a photo (or press Enter on it) to see it big.

- **◀ Back** and **Next ▶** on its edges, the ← → keys, the mouse wheel over the photo, or a swipe or drag go through the **whole** collection you're looking at (all your photos, a folder, a month, a search, a person, the random mix), loading more as you go, with "124 of 3,208" at the top. At the last photo it says so; press Next once more to start over from the first.
- **The filmstrip** along the bottom shows the photos around it. Scroll it sideways (the wheel, dragging, or your finger) to see more; it keeps loading as far as you go. Click one to show it big. The filmstrip and the big photo always stay in step.
- **Where it's saved** is always shown under the photo: **📂 Pictures › Family › 2026** and the full path. Click a folder name to see that folder's photos in the gallery (tick **This folder only** to leave out its subfolders). Click the full path, or **📂 Open in File Explorer**, and File Explorer opens on this computer with that photo selected.
- **ℹ Info:** the date, the camera, the size, the dimensions, the people in it, the album, your words about it, its description and the text in it, and its folder.
- **🔍** (or double-click) opens it in the [file viewer](files-and-viewer.md) to zoom, rotate or flip it.

Keys: ← → Back/Next · Home/End the first/last · S slideshow · I info · F favourite · Esc back to the grid (again: close).

### 📂 Open file location and 🖼 View in gallery

Wherever one of your photos shows up, it has these two buttons:

- the rotating photo card on the Dayspring screen, and the photo's own card (where "What's this one?" is asked)
- the [file viewer](files-and-viewer.md) (the 📂 bar under a picture), and the list of files it found
- your own pictures in the media list, and the People page (each person's photos)
- a picture from the web, once you've pressed **Save to my photos** (before that it isn't on your computer, so there's no location to open)

**📂 Open file location** opens File Explorer with that exact photo selected. **🖼 View in gallery** opens the gallery on that photo, with the other photos from its folder (or that person's photos, or the files that were found), and Back / Next through them. A picture in Google Drive has neither: it isn't saved on this computer.

Opening File Explorer never opens or runs the photo, only shows where it is, so it doesn't ask first and doesn't need the "open programs" permission. It only works for photos in your photo folders or the places file access allows (never a place you've kept out), and each one is written to the activity log.

### Things you can say (no AI needed)

- "Open the photo gallery", "show my photos", "show my favourite photos"
- "Show my photos from last summer", "… from June 2024", "… from last year", "… from 2023", "show my photos of Sarah" (face recognition on)
- "Show photos in the Family folder"
- "Show me random photos", "shuffle my photos", "surprise me with a photo"
- "View this in the gallery" (the photo on the screen), "open this photo's folder", "show me where this is saved", "open file location"
- While it's open: "next", "previous", "scroll right", "scroll left", "start a slideshow", "stop the slideshow", "shuffle again", "more", "back to the grid", "close the gallery"
- The window: "minimize the gallery", "make the gallery small", "maximize the gallery" (like every other window)

## Privacy

- Nothing about faces leaves your computer. Pictures from the web are described, but Dayspring never tries to identify anyone in them, even with an AI.
- Faces are only compared with your own photos and the people you've named.
- Face data, saved messages and the face models live in Dayspring's `data` folder, which is never exported or included in a release.
- Naming, merging and deleting people is written to the activity log (by id, never names or faces).

## Licences of the downloaded parts

| Part | What it does | Licence |
|---|---|---|
| YuNet (`face_detection_yunet_2023mar.onnx`, 0.2 MB) | finds faces and 5 points on each | MIT (OpenCV Zoo) |
| SFace (`face_recognition_sface_2021dec.onnx`, 37 MB) | a face's fingerprint | Apache 2.0 (OpenCV Zoo) |
| ONNX Runtime Web 1.30 | runs them on the processor, no graphics card needed | MIT (Microsoft) |

A list is also saved beside the models, in `data\vision-cache\LICENCES.txt`.
