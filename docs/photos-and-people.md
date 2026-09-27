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
