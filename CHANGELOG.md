# Changelog

All notable changes to Dayspring. Versions follow [semantic versioning](https://semver.org).

## 1.6.0 (2026-09-27)

**After you update: please confirm your file access once.** A small card on the Dayspring screen asks you to confirm what Dayspring may do with your files (or review it in Settings → Permissions). Your old setting is kept exactly as it was, nothing is widened, and **deleting files is now off until you turn it on** (Settings → Permissions → **Can delete files**).

**Meetings.** Dayspring can take notes (it tells everyone first, shows a ● Notes sign, and skips anything you mark off the record) and writes a summary when the meeting ends; find them under Past meetings. It knows who's in the call and who's talking more reliably. Fixes: nothing is said or kept after leaving, no second meeting window, Tune in turns back off, and only you can give meeting commands.
- With **Save call history** on (Settings → Photos & people; off by default), the people who were in a meeting are added to their profiles' call history when it ends. Rehearsals never are.

**Money review (read-only).** Dayspring can go through your bank, Venmo or Cash App transactions and tell you where the money went. See the guide's "Money review" page.
- Say "import my bank statement" and drop in a CSV or OFX/QFX file you downloaded from your bank (the most reliable way). Or turn on **Money review (read-only)** on the new Money page, say "open my bank", "open Venmo" or "open Cash App", sign in yourself in Dayspring's separate money window, and say "review my transactions for the last three months".
- The report shows every transaction in a sortable table, money in and out by month, spending by category, top merchants, repeating charges and subscriptions (with the next expected date and yearly cost), price increases, possible duplicate charges, unusual charges, fees and interest, and "things you might want to cancel" with the reasons and how to cancel. It's saved as Markdown and CSV. The spoken summary is short.
- Ask "what's my Venmo balance?", "what subscriptions do I have?", "what should I cancel?", "how much did I spend on food?", "what did I pay Josh last week?", "when did Netflix last charge me?" or "help me make a budget". All of these work without an AI.
- It only reads, and the rules are in the code: it can't send, pay, transfer, change settings or cancel anything, never types into anything but the site's own date filter and search box, never submits forms or downloads files, and stops at sign-in pages, codes and robot checks so you can finish them. It never types, stores or reads passwords or codes.
- Transactions stay on your computer, encrypted with your Windows account, with account numbers masked to the last 4 digits. Raw data is deleted after 90 days (a setting), and **Delete all my money data** removes everything. Nothing is sent to an AI until you say yes to a one-time question.
- The Money review permission is off by default. Turning it on explains that some banks' terms don't allow automated access, so a downloaded statement is preferred where there is one.
- Money answers (amounts, payees, balances) are never kept in your conversation history or the activity log; they show as "(a money review answer; not kept)".

**Photos and people.** Dayspring can describe pictures, read the text in them, and (if you turn it on) recognise the people in your own photos. See the guide's "Photos and people" page.
- "Describe this picture", "what does this say?" and "who is in this picture?" work for your photos, the photo on the screen, and pictures from a web search. Windows reads the text on your computer; with **Describe images with AI** on (it asks once), an AI that can see pictures describes the scene using the names you've taught it.
- **Recognise faces in my photos** (Settings → Photos & people) is off by default and runs entirely on your computer: a one-time 72 MB download of open face models, checked before use, then a slow, pausable look through your photo folders. Faces are grouped as "Unknown person 1, 2…" until you name them. Face data is encrypted with your Windows account and never exported.
- Now and then (once or twice a day, your choice; never in Quiet or Off, meetings or calls) Dayspring asks "Who's in this picture?". Answer naturally, like "me, Sarah and her husband Tom" or "Sarah's on the left". When a photo also needs a description, it's one question.
- Naming a face names everyone in its group; likely matches are asked about ("Is this also Sarah? 74% sure"), never labelled silently. Merge, ignore, "not a person" and delete are on the new People page.
- Each person now has a page: photos, relationship and connections, prayer requests (private ones by title), goals, past and upcoming plans, notes, and, if you turn it on, texts and calls. Say "tell me about Sarah", "when did I last talk to Mike?", "what's going on with Sarah lately?" or "remind me to check on Tom".
- **Save my text messages to people's profiles** and **Save call history** are off by default (off means nothing is written), encrypted, with a keep-for setting and **Delete all saved messages**. When a sender is unclear, Dayspring asks instead of guessing.
- Faces are never identified in pictures from the web, and nobody is ever looked up online.

**Pictures from the web.** Say "show me pictures of golden retrievers", "image search for mid-century desk" or "find a transparent PNG of a lantern". You don't need an AI or a key.
- A numbered grid of about 12 pictures appears on the Dayspring screen, with each picture's title and site underneath.
- Say "show number 3" (or click it) to see it big, with a link to its page. Then "describe this picture" or "what does this say?" works on it (people in web pictures are described, never identified). Say "more" for the next ones, "more like number 4" for similar pictures, and "close images" when you're done.
- Narrow the results by saying "only photos", "bigger ones", "only red ones" or "from Wikipedia".
- "Save that one" puts the picture in Pictures › Dayspring if Dayspring may change files there, and otherwise in Dayspring's `data\images`. A note beside each picture says where it came from.
- With an AI, the new `image_search` tool shows pictures while you talk. A model that can see (Claude) can answer "which of these has a red door?". It describes people but never says who they are.
- SafeSearch is on (moderate). Say "set safe search to strict" or "turn safe search off" to change it.
- The screen never loads pictures from other sites directly. Dayspring fetches each one itself. It refuses addresses on your computer or home network, even after a redirect or a site that changes its address mid-way, and only accepts real images up to 8 MB.
- Searches try DuckDuckGo, then Bing, with Dayspring's hidden search browser as a last resort. A Brave, Google or Bing search key in `.env` is used first when you have one.

**You choose what Dayspring may do with your files, and it keeps a log of everything.**
- The setup's **Permissions** step can't be skipped: **Next** stays grey until you pick **No file access** (recommended), **Only the folders and files I choose**, or **Everything on this computer**. Nothing is picked for you.
- For chosen places, type a path, use a quick pick, or **Browse…**, then set each to **Read only**, **Read & write** or **Blocked**, with or without its subfolders. "Everything" can be read only or read & write.
- **Ask me before every change** starts on. **Can delete files** starts off: deleting is now its own permission (read & write never includes it), always goes to the Recycle Bin, and always asks. Creating, editing, and renaming or moving can each be turned off too.
- A plain-words summary shows what Dayspring **will** and **won't** be able to do. Settings → Permissions has the same controls.
- Updating from an older version keeps your setting exactly as it was (nothing is widened; deleting stays off until you turn it on), and a one-time **Please confirm what Dayspring may do with your files** card asks you to confirm it.

**Fail-safes that hold whatever you allow.** Dayspring never changes or deletes Windows, Program Files, Windows' parts of ProgramData, boot and recovery files, the registry, page and hibernation files, files at the top of a drive, other people's profiles, `.git` internals, secret files, or Dayspring's own code, data, permissions and activity log.
- It checks where links and junctions really lead, and refuses path tricks (`..`, network paths, `\\?\`, short names like `PROGRA~1`, names ending in a dot or space, hidden streams).
- Important files that are allowed (start-up files, hosts, shell profiles, Git settings, `package.json` and lockfiles, project and CI files, databases, large or old files, whole project folders, anything outside your usual folders, anything you mark) get a warning that says what could break, that a backup will be made, and "Are you sure?".
- Only your own clear yes counts, by voice or typed, for that exact change, within two minutes. The AI can't confirm for itself. The same rules apply without an AI.
- A change that touches more than 25 files, or deleting a folder, always asks with the count.
- Opening something that would run (a script, an installer, a `.reg` file), a terminal or Claude Code now needs the Programs permission. Dayspring's browser won't open its own Settings pages.

**The activity log.** Every command (said or typed), every tool call, every file read, created, changed, moved or deleted (with size and fingerprint before and after, and the backup), programs opened, permission changes, your yeses and nos, and blocked attempts.
- Kept on this computer for at least 120 days (180 to start with), with file backups kept as long. Keys and passwords are blanked out, and file contents are never logged.
- Each line is chained to the one before, so **Check the log** shows if anything was changed or removed. Dayspring can't edit or erase it.
- Settings → **Activity log**: dates, filters, search, **Export CSV**, and **Restore this version** for any backed-up change.
- Say "what did you change today?", "undo that last change" (it asks first) or "show the activity log". With an AI, Dayspring can search the log itself to check what it changed or recall something.

**Music and videos play on Dayspring's speaker, not the Windows default.** YouTube, Spotify (on the screen and in the music window), the morning music and your video lists now play on the exact device Dayspring is set to in the Sound panel. When you switch between the TV, the laptop and your headset, whatever's playing moves within a second. With several ticked, music uses the first connected one: TV, then headphones, then speakers. Dayspring never changes your Windows default to do this. It works in Dayspring's own window in Chrome, Edge, Brave or Vivaldi, not in a browser tab or Firefox. After updating, close the Dayspring screen and open it again once.

**Spotify plays what you ask for.** "Play christian folk music" used to start a random pop playlist: Dayspring took Spotify's first search result without checking it (and passed typos like "christian fold" along as they were). Now it understands songs, artists, albums, playlists, your own playlists, Liked Songs, genres, moods and "more like this". It fixes typing and hearing mistakes ("christian fold", "worhsip", "jonny cash"), checks a genre playlist's artists against their Spotify genres, makes a mix from a genre's top artists when no playlist fits, and says what it picked ("Playing Christian Folk, a playlist with The Gray Havens and Josh Garrels."). Afterwards it reads what's actually playing and tells you if Spotify started something else. When it isn't sure, it offers three choices. Say "not that" or "try another" for the next-best match; it remembers for next time. Also new without an AI: "what's playing", "save this song", "add this to my Road Trip playlist", "queue Gratitude by Hollow Pines" and "play my Discover Weekly". The music window picks by the same rules. See the guide's "Asking for music on Spotify".

**Your requests come first.** When you start talking to Dayspring (the wake word, 🎙 Talk, typing, or a message from the desk panel, Discord, a text or a call), anything it was about to say on its own waits until your request is fully done: the answer said, any follow-up question answered, then about 4 seconds of quiet. Reminders, check-ins, questions, joke offers and the rest then come out one at a time, most important first, and wait again if you start talking. Nothing is skipped; out-of-date items are re-worded ("leave in 10 minutes" becomes "leave at 3:15 p.m.") or dropped (a joke offer after 30 minutes). If you speak just as it starts, it stops and says it afterwards. It asks only one question of its own at a time. A sign shows **1 thing to tell you after this**; tap it or ask "what were you going to say?" to hear it now. Alarms and timers still ring on time (only their words wait for the answer, 20 seconds at most), and an official Extreme weather alert still interrupts.

**Your own music and videos.** Say "play the song Holy Forever from my computer", "play my Johnny Cash mp3s", "find the video from Sarah's wedding", "play the latest video in Downloads", "shuffle my music folder" or "what audio files do I have from 2019?". No AI needed. See the guide's "Your own music and videos" page.
- Dayspring looks in your Music, Videos and Downloads folders and the places you picked, only where file access lets it read (with file access off, it tells you how to allow a folder). It skips folders and files that look private, reads each file's tags, and keeps looking for new files in the background, slowly.
- A numbered list shows what it found: say a number, "play them all" or "shuffle them". Music plays with the normal controls, a queue, shuffle and repeat; videos play full screen. Everything plays on Dayspring's speaker.
- "Open it in the default app" plays a file on this PC instead (it needs the Open programs permission). WMA, WMV and AVI files are converted as they play with the ffmpeg Dayspring already has, or opened in your default player.
- The screen only gets a numbered address, never a file path, and permissions are checked again every time a file plays. Every play is in the activity log.

**Google Drive, and several Google accounts.** Connect as many Google accounts as you like (a work and a personal one), each with its own Calendar, Gmail and Drive switches and a nickname. Your existing Google account carries on as account 1 with the same access, and every Google sign-in is now encrypted with your Windows account. See the guide's "Google Drive" page.
- Search every Drive at once or one ("search my work drive for the report"), including shared drives and files shared with you; "what changed in my Drive this week?".
- Dayspring reads Docs, Sheets, Slides, PDFs and text files to summarise them, plays Drive's audio and video on the screen (your Google sign-in never reaches the page), and shows pictures. Drive songs and videos show up in "play …" searches, after your own files.
- Changing a Drive is off until you turn on **Let Dayspring add and change files in this Drive** for it. Then "save this to my Drive", "make a folder" and "move it to Archive" work, each only after your yes, and deleting only moves things to Drive's trash. Downloading a Drive file to your computer needs file access and your yes. Everything is in the activity log.
- To add Drive to an existing setup: enable the Google Drive API in your Google Cloud project, add the Drive scope on the consent screen, and tick Drive in Settings → Apps & connections → Google.

**Fixes.** Asking "what did Sarah text me?" or "any new messages?" answers the question and no longer switches your texts to being read aloud (only "read my texts out loud" or "stop reading texts" changes that). "Show number 3" with nothing numbered on the screen says so instead of reading the book of Numbers (say "read Numbers 3" for that). "Play … on Spotify" is understood again.

**Not switched on yet.** The groundwork for sharing memories with friends is included but switched off: none of it runs, and nothing is shared.

**Developer preview tools, only for the app's developer.** On the developer's own computer (checked with a signed, computer-bound token), he can look at every badge and hear every character before earning them. Nothing changes for anyone else: you still earn every badge and find every character yourself, and none of it is shown on your computer. See the guide's "Developer preview" page.

## 1.5.0: Meetings with Dayspring and Lantern

**Dayspring joins your Google Meet.** Paste the Meet link on the screen, or say "Dayspring, join my meeting".
- The meeting opens in its own window. Google doesn't allow Meet inside another page.
- While you use Dayspring, it sits as a small tile in the bottom-right corner, in front of other windows. Click it, press the **Meeting** chip, or say "bring the meeting back" to make it big.
- Your commands work by voice: "mute", "unmute", "turn off my camera", "turn on captions", "open the chat", "who's in the meeting?", "share my screen" (it explains Meet's picker), and "leave the meeting" (it asks first).
- Dayspring never signs in for you: sign in to Google once in the meeting window.

**It knows who's talking.** Dayspring turns on Meet's captions and reads them, so it knows who asked.
- The Meetings panel shows **Captions detected ✓**. If captions can't be read, Tune in listens instead.
- While the meeting reads captions, Tune in stands down, so nobody gets two answers.

**You choose who can ask.**
- Say "let Rich and Jess ask", "let Rich ask Lantern", "let everyone ask" or "only listen to me".
- Or use the **Who can ask** list: **Can ask Dayspring** and **Can ask Lantern** for each person.
- You can always ask. Everyone else can ask questions, but can't change anything.
- Speech that isn't for Dayspring or Lantern is never kept. What people asked is forgotten when the meeting ends.

**Answers out loud and in the chat.**
- People say "Dayspring, …" or "Lantern, …", or type @Dayspring or @Lantern in Meet's chat.
- Spoken answers go into the call. A spoken course question also gets a detailed answer in the chat, signed "Dayspring:" or "Lantern:".
- One voice at a time.

**Lantern answers course questions**, in its own voice (warm, male) and its own style.
- It finds the lessons that teach the answer in your installed course.
- It answers from them, then says where it's covered: "It's covered in Unit 4, Lesson 2, …, and I've put the link in the chat."
- The chat gets the detail and a link to each lesson. The screen shows a results card with **Open in Lantern**.
- When Lantern offers its own answers, it answers itself. Otherwise Dayspring answers for it from the installed course.
- In Demo mode, course questions asked of Dayspring are handed over: "Great question, Jess. Lantern, want to take that one?"

**Names, now and then.**
- Dayspring and Lantern use people's names: the first time they answer someone, then about one answer in three. Never twice in a row within two minutes, and never in both the voice and the chat.
- Names are said exactly as Meet shows them, in your personality's style ("Well howdy, Rich!").
- When two people share a first name, it uses their full name. When it can't tell who's talking, it doesn't guess.
- In a meeting it remembers who asked what, so it can say "Building on Jess's question about sessions…". That memory is gone when the meeting ends.

**Demo mode and a rehearsal.** The Meetings panel (📹 on the talk bar) has:
- **Demo mode**: anyone can ask, and course questions go to Lantern.
- A **pre-flight checklist**: Google sign-in, Meet's microphone, a sound test, captions, Lantern and the course, the course index, the AI, the public lesson link, and the Dayspring screen.
- **▶ Rehearse**: a pretend meeting with pretend people, captions, chat and a scripted course question.
- The step-by-step script with fixes is in [Meetings](docs/meeting-demo.md).

## 1.4.0: Personalities, XP and badges

**Give Dayspring a personality.** In Settings → Personality, pick a character:
- 20 cards, from Cowboy, Pirate and Noble Knight to Grandma, Robot, Zen Monk and Bard.
- Each has its own sliders and dozens of lines that change with them.
- Fine-tune twelve sliders (Warmth, Humour, Bite…), or describe your own ("a grumpy lighthouse keeper who secretly loves people").
- Save up to 50 favourites.
- Say "be a cowboy", "be more brief", or "be normal".
- Times, alarms, health and your schedule always come first and plain.

**15 secret characters to find.** Say the right thing, set the sliders just so, or use Dayspring at the right time. The cards show a riddle until you find one. Then unlock it with XP.

**XP: earned for real.** Tell Dayspring what you finished ("I did the dishes", "I studied for an hour", "I went to church"), or answer when a scheduled block ends. One quick question makes it count; for studying, it's one thing you learned. Prayer and worship are never quizzed.
- 18 kinds of task.
- At most 80 XP a day.
- Check-ins you start yourself count 70%; scheduled ones count in full.
- Today or yesterday only.
- Undo within 10 minutes.
- Levels every 300 XP, and streaks with a +10% bonus from day 7.
- The first secret character costs 500 XP: at least a week of real effort.

**Badges.** 18 badges in each of 18 categories (Fitness, Prayer, Reading, Cooking, Service…), collected over years of steady habits. The first comes within a week.
- **Unique art:** all 324 are different, and every part carries its category: the emblem's story, an engraved rim (chain links, a musical staff, stained glass, moon phases…), little category tokens instead of stars, and frames that grow from a plain disc to winged legends.
- **Gentle motion,** like Dayspring's orb at rest.
- **Coin-flip entrance:** a new badge spins in, lands with a gleam, and tells its story: "Jordan achieved this milestone by running for 30 minutes on July 2nd, 2027!"
- **The next badge is a mystery:** a "?" card with how close you are and about how long at your recent pace.
- **Kind nudges** when you're close: at most once a day per category, never when Off or Quiet.
- **Progress → Badges:** the gallery and a badge case of 3 favourites, which also shows on the screen.
- **Ask:** "what badges do I have?", "how close am I to my next fitness badge?", "what did I do to earn my last badge?"

**Lantern learning counts.** Every lesson, exercise, practice session, unit check, project milestone and finished unit or course that Lantern verifies becomes XP, once, even when finished on another computer.
- It fills your Study & Learning badges.
- "I finished lesson 3" is checked with Lantern first.
- **Progress → Learning** shows each course's progress, the XP it has earned, the week's learning and recent completions. The study cards on the screen show XP too.
- Ask: "how much XP have I earned from Python?", "what did I finish this week?"

**Calls are much quicker.** On a call, Dayspring now starts answering about 1.3 seconds after you stop talking (it used to be about 4.4). It hears each person separately, notices the end of a sentence sooner, and starts speaking the first sentence of its answer while it's still thinking of the rest. Talk over it for a moment and it stops to listen.

**Dayspring on Discord.** Add Dayspring as a bot (Settings → Discord) and it becomes someone to chat with:
- @mention it, send it a direct message, or give it its own channel. Answers appear as they're written.
- Quick commands: /ask, /joke, /time, /weather, /remind and /help.
- Say "Dayspring, join my Discord" and it joins your voice channel, says hello, and answers out loud when someone says its name.
- You get the full assistant. Friends get friendly general answers, with no access to your schedule, files or personal details.
- Nothing anyone says on a call is saved.

**Call setup, step by step.** Settings → Calls shows a card for Discord, Zoom, Google Meet, Microsoft Teams and any other app, with exactly where to pick the microphone and speaker in that app. Dayspring notices which one you're using.

**Fixes**
- **Crash-safe saving.** Your schedule, settings and progress are written safely, so a crash or power cut can't leave a half-written file. If a file is ever damaged, Dayspring restores the last good copy by itself and tells you.
- **More than one screen:** sound plays in the right place, and an alarm rings, snoozes and stops together on every Dayspring screen.
- **Snooze** works reliably for alarms, timers and reminders, for the time you picked.
- **Timed modes** ("quiet for an hour", "off until 3") end on time, even across a restart.
- **Tune-in privacy:** tuning in to Dayspring from another device is tighter about who can see and hear what.
- **Missed reminders:** if the computer was asleep or off, the reminders you missed are shown when it comes back, instead of being skipped.
- **Helpers restart themselves:** if a background helper (voice, sound, the window) stops, Dayspring starts it again.
- **XP is fair:** closed loopholes that could earn the same XP twice, earn XP for future days, or go past the daily limit.
- **Notifications never cover the talk buttons.** Pop-ups like "Night mode", timers, XP and badge cards now stay clear of ✋ Stop, 🎤, ⌨ Type, 🎙 Talk and the Active/Quiet/Off badge on the full screen, in Dayspring mini and in a browser tab, at any window size. A long stack scrolls instead.

## 1.3.0: Dayspring works great without an AI key

**Understands hundreds of everyday requests without AI.** A built-in understanding of 185 kinds of request, in 29 groups, spelled out in more than 8,000 ways. It copes with small slips and sound-alikes ("calender", "set a time her") and picks out the details ("in a bit", "first thing tomorrow", "after lunch", "the end of the month", "Romans 8 28"). It answers in a few milliseconds, on your computer. When an AI brain is set up, the quick things (timers, math, jokes) are still answered instantly, at no cost.

- **When it isn't sure**, it shows "Here's what I can do that sounds close:" with up to 7 numbered choices and **None of these**, and reads out the first three. Answer by number, by the words, with a tap or with keys 1–7. It learns from your picks. After a few misses in a row, it links to how to add AI.
- **Teach it:** Settings → AI brain → **Without AI** has a **Try it** box and the phrases it didn't understand (words only, on this computer, and you can turn the list off). Pick what a phrase means and press Teach, or use **Forget what you learned**.

**Timers**
- Up to 7 at once, each with a name.
- A timer without a name starts right away, then Dayspring asks "What's it for?".
- Say "how long left on the pasta", "add 2 minutes to the oven timer", "pause all timers" or "call the second timer oven".
- When one finishes, Dayspring says its name. Timers that finish together are said together. A card appears with Dismiss / +5 min / Snooze, and there's a reminder every minute (5 at most).
- They ring with the window closed. They also ring when Dayspring is Quiet or Off, unless you turn that off in Settings.
- There's a compact countdown stack on the screen and in the mini.
- Also new: a stopwatch; alarms by voice; repeating reminders ("every Tuesday night"); medicine and water reminders; stretch breaks; a guided breathing exercise; and focus sessions (25/5 pomodoro rounds that switch between focus and break by themselves).

**Recipes and cooking**
- A new Recipes page. Add a recipe by pasting it, from a web address, or by voice. Tags, favourites and search. Five example recipes to start.
- **Find recipes online:** "find a recipe for chili" shows up to 6 cards with photos, then "the second one", "the quickest one", "save the first one" or "more options". Pictures are saved on your computer. Pages on your own network are never read.
- **Easy steps:** Prep / Cooking / Finish, with a timer button for each time mentioned, °F/°C, and the ingredients each step uses.
- **Cooking mode:** big text, and the screen stays awake. "next", "go back", "how much flour", "double the recipe", "start the timer" (several step timers can run at once).

**Jokes and fun**
- More than a thousand jokes in 38 categories. You can tell Dayspring a knock-knock joke, and it can tell you one.
- A pause before the punchline. A typed joke comes all at once.
- With a playful personality (Humour 60+), a joke offer now and then: 3 a day at most, and never during calls, alarms, timers, cooking or focus time.
- "Count to 100" (by twos, backwards), trivia, rock paper scissors, would you rather, the magic 8-ball.

**Everyday and small talk**
- Calculator, unit and cooking conversions, spelling, coin, dice, random numbers.
- Time around the world. Days until a date, the day of the week for a date, leap years, US holidays.
- Capitals of US states and countries, the planets, times tables.
- Shopping and other lists, notes, to-dos. "What should I have for dinner?"
- Kind replies when you're tired, stressed, sad or lonely. If you say something that sounds like you might hurt yourself, Dayspring gives you the 988 Suicide and Crisis Lifeline.
- "What did you hear?", "That's wrong" (undoes the last thing it did), "Never mind".

**Fixes**
- ✋ Stop now also cancels an answer that's still on its way, so a late answer is never shown or spoken. Saying "Dayspring" while it's thinking no longer gives two answers.
- Stop also ends an answer playing into a call.
- Only the Dayspring screen that speaks fetches the voice.
- Questions to the same screen are answered one at a time, so two answers can't overwrite each other's conversation.
- An address that isn't this computer gets 421 (Misdirected Request), as the ecosystem contract says.

**Guide:** new pages [Using Dayspring without AI](docs/using-without-ai.md) (with the full, searchable list of what you can say) and [Recipes and cooking](docs/recipes-and-cooking.md), plus new FAQ answers and new Settings entries.

## 1.2.3 — a security fix

**Fixed**
- **Other websites can no longer control Dayspring.** Dayspring runs a small server on your computer. Before this fix, a web page open in your browser could quietly send it commands. Now Dayspring only answers its own pages and the programs on your computer, and refuses everything else.

## 1.2.2 — no more waiting on an answer

**Fixed**
- **Dayspring no longer gets stuck waiting for your answer.** After it asks a question it listens for at most 7 seconds (a few seconds more only while you are still talking), then goes back to Ready. Background noise like a TV can no longer keep it waiting.
- **With listening stopped, it never waits for an answer.** A question it asks just goes back to "Not listening" instead of looking stuck.

## 1.2.1 — alarms ring even when the Dayspring window is closed

**Fixed**
- **Alarms ring even when the Dayspring window is closed.** With no Dayspring screen open, the alarm shows a larger card at the top-right of your screen, in front of every window, and rings on a loop, starting gently and rising over half a minute to your alarm volume. It has **Snooze 9 min**, **Dismiss** and **Open Dayspring**, and it stops as soon as you answer the alarm anywhere (on the card, on a Dayspring screen, or by voice). Dayspring's window is not reopened for it.
- **Chimes with the window closed:** notifications set to **Chime** still chime, and ones set to **Speak** chime too (turn on Settings → Notifications → **Speak announcements even when the screen is closed** to hear them in Windows' own voice). **Silent** stays silent.
- With a Dayspring screen open, the screen plays the sounds as before, so nothing sounds twice.

## 1.2.0 — your way: app window, mini, browser, quiet

**New**
- **Choose how Dayspring opens** (Settings → Screen, or the guided setup): an **app window**, **Dayspring mini**, **full screen** like the TV, or a normal **browser tab**. It's the same Dayspring every way. Say "open Dayspring in my browser", "open in its own window" or "go full screen". The Start menu has "Dayspring (full screen)", "Dayspring mini" and "Dayspring in browser" for a one-off.
- **Dayspring mini**: a small window with the time, what's on now and next, the weather, a chat box and the voice buttons. **⤡** shrinks the window, **⤢** (or maximizing) brings the full view back, and it can stay on top. Say "make Dayspring small".
- **Active, Quiet or Off** in one click on the new badge, or **Ctrl+Alt+Shift+D** from anywhere. Off really lets go of the microphone. Alarms still ring (you can change that).
- **Notification modes**: speak, chime or silent for reminders, your schedule, texts, Lantern, Discover and updates, plus a quick switch for everything.
- **Desktop notifications**: small cards at the top-right, in front of every window, that never steal the keyboard. Snooze or click to open.
- **Any browser, fully**: the browser you pick is used everywhere (with **Reopen now**), and Brave and Firefox can listen too, with a private speech recognizer that runs on your computer (Settings → Screen → Speech recognition). Say "use Brave for Dayspring".
- **Uninstall button** in Settings → About: keep or remove your data, with an optional backup; you confirm by typing your name.
- **Task Manager** shows **Dayspring** (and Dayspring Speech, Notifications, Keep Awake, Audio Capture). Settings → About → **Running parts** lists them, with **Stop all**.
- New guide page: [Compact mode, quiet mode and notifications](docs/quiet-and-notifications.md).

**Fixed**
- **Updates are found and installed from inside Dayspring.** "Check for updates" shows the answer right away (or what went wrong, with **Retry**), and a ⬆ appears at the top of the screen when a new version is ready.
- **Closed means closed.** Dayspring no longer reopens its screen by itself after you close it. For a TV, turn on Settings → Screen → **Keep the Dayspring screen open**. When it starts with Windows, it starts hidden unless you choose **Open the screen when Windows starts**.
- **Stop listening really stops.** 🎤 (or ✋ pressed twice) releases the microphone and stays stopped, even after a reload, until you tap 🎤 again.
- Works on **Windows 10** (1809 or newer) as well as Windows 11, with fallbacks when tar or winget isn't there.

## 1.1.2 — AI answers are back

**Fixed**
- **Dayspring answers with its AI again.** Two of its abilities had the same name ("resolve_conflict"), and Claude, ChatGPT and Grok refuse a request when that happens, so every question that needed the AI failed. The calendar one is now called "resolve_calendar_conflict", and Dayspring now skips a duplicate instead of letting it break every answer.

## 1.1.1 — no more YouTube windows

**Fixed**
- **No more YouTube windows popping up.** Discover (the "something new about your interests" feed) used to search YouTube in a browser window that flashed open on screen, a couple of minutes after Dayspring started and every so often after that. Now Dayspring reads YouTube's search results quietly in the background: no window opens, ever, for searching or looking things up.
- **You don't need a YouTube key.** Search works without one. A key is still optional (Settings → Features & apps → Extra keys) and only makes searches a little faster.

**New**
- **↗ Pop out**: videos play inside Dayspring, and the new ↗ button on the video controls (or saying "pop it out" / "open this in my browser") pauses it and opens it in your own browser at the same second.
- A video whose owner blocks playing inside other apps now shows a card, "This video can't play inside Dayspring. Pop it out?", instead of opening a window by itself.

## 1.1.0 — works with Lantern

**New**
- **Works with Lantern**, the free learning app from the same family. If both are on your computer:
  - Lantern's courses show next to Dayspring's study rings, with how far you are and your next lesson. Click one to open that lesson.
  - Ask "what's my next lesson?", "how far am I in Python?", "open Python" or "remind me to study at 7".
  - Course invitations and friend requests are read out, with Accept, Decline (and Ignore) on a card. Just say "yes", "no" or "later".
  - The hub's owner can say "send the Python course to Sam" or "add Sam as a friend".
  - The two apps take turns speaking, and an alarm always goes first. Only one listens for its name at a time ("let Lantern listen", "take the mic back").
- **Install Lantern for you**: say "install Lantern" or press the button. Dayspring asks first, installs it quietly and opens it.
- **Connect to Lantern** (Settings → Lantern): use Lantern's own sign-in if it's on this computer, or your email and a password, or an emailed sign-in link (no password). Then invitations and friend requests reach you in Dayspring, even before Lantern is installed.
- Copies of Dayspring from the owner's download already know their Lantern hub, so there's nothing to paste.
- **Set up the AI once**: share Dayspring's AI key with Lantern, or use Lantern's, with your OK. It's stored encrypted for your Windows account only.
- New page in Help: [Dayspring and Lantern](docs/lantern.md).

Nothing changes if you don't use Lantern.

## 1.0.2 — a smoother Schedule, Settings and screen

**Fixed**
- **The Schedule** no longer slides sideways when you press Add, and a closed side panel can't be tabbed into.
- Double-clicking **Save** adds an item once, not twice.
- Clicking through Day, Week, Month and Year quickly always shows the view you picked. The year view loads much faster and says "Loading…" if it takes a moment.
- A message that has faded away no longer blocks the buttons underneath it.
- **Fit to screen** by keyboard: pressing Enter on a button presses that button again. It never saves by surprise.
- **The guided setup**: after you skip a step, its spoken line no longer plays over the next step.
- **Settings**: a change is saved when you move to another section, so nothing is lost. Things a section started (like waiting for Spotify) stop when you leave it.
- **Esc** closes only what's on top, one thing at a time.
- Asking "what's the weather?" before you've set your town now tells you how to add it, instead of saying nothing.
- Long names and interests wrap neatly instead of running off the edge. Nicknames can't be added twice.
- **Church** and **Scripture memory** can't be switched on while Faith is off. "Add meal times" remembers what you chose.
- **Help**: typing one letter clears the old results, and a link to a page that doesn't exist says so and suggests close matches.
- The status says **Reconnecting…** while Dayspring itself can't be reached, instead of "Ready".
- The first time the screen opens (often right after setup, maybe at night), it stays bright for a while and explains night mode.
- Links like "Open on the laptop" work even when Dayspring runs on a different port.
- Small labels are easier to read.

**New**
- **Overnight items**: set an end time before the start (11pm to 1am) and it runs past midnight. It shows on both days with its real times, and editing or deleting either day changes the whole thing. You can also drag an item's bottom edge past midnight.
- Dayspring's typeface now comes with it, so every page looks right even without internet.
- The Sound panel opens straight away: the list of speakers and microphones is looked up in the background.

## 1.0.1 — quieter, one window, and updates that look after themselves

**Fixed**
- Dayspring no longer opens extra copies of itself during the guided setup (or afterwards). Starting it again brings its window back instead of opening a new one.
- No more black command windows popping up. Dayspring now runs quietly in the background, with no command window to keep open.
- The guided setup opens once, in your own browser, and at the end Dayspring opens in its own window.
- **One voice at a time**: if more than one Dayspring page is open, only one speaks and listens, and the setup guide goes quiet once Dayspring's screen opens. Saying "stop" now stops the whole answer, and dismissing the wake-up stops the rest of the morning greeting.
- **No freezing**: slow checks (coding tools, Voicemeeter, photos, updates) now run in the background, a missing photo or course file can no longer stop Dayspring, and an unexpected error is logged instead of stopping the server.
- Dayspring now needs Node.js 22.13 or newer (the installer checks and offers to update it).

**New**
- **Pick your browser**: Dayspring uses your default browser, or any other browser on your computer (Edge, Chrome, Brave, Firefox, Opera, Vivaldi and more). Choose in the guided setup or in Settings → Screen. It no longer forces Microsoft Edge.
- **Automatic updates**: Dayspring checks for new versions when it starts and every few hours. A card shows what's new, with **Update now**, **Next time I open Dayspring**, **When I'm not using it** and **Not now**. You can also set it to always do one of these (Settings → Updates).
- **Safe updates**: your data and keys are backed up before every update and never replaced. If a new version doesn't start, the previous one comes back by itself.
- **What changed**: Settings → Updates lists every update with its notes. Or ask "what's new in Dayspring?"
- **Stopping Dayspring**: the ✕ at the top of the screen now offers **Close the screen** or **Quit Dayspring**. There's also **Stop Dayspring** in the Start menu.
- Say **"update Dayspring"** to install a new version right away.
- **A warm default voice**: until you pick one, Dayspring speaks with a friendly, warm female voice (Matilda with ElevenLabs, coral with OpenAI, and Edge's Ava, Jenny or Aria for free). The setup guide keeps its own warm male voice. A voice you already chose never changes.

**Updating from 1.0.0**: double-click **Update Dayspring.cmd** in the Dayspring folder once and type **Y**. Your data, keys and downloaded helpers carry over, and from then on updates come to you.

## 1.0.0 — first public release

**Getting started**
- A guided, spoken first-run setup (`/welcome`). A friendly guide voice walks through each step, with mute, repeat and captions. It covers:
  - AI choice (Claude, ChatGPT, Grok, Ollama or none) with step-by-step key walkthroughs
  - ElevenLabs or free voices
  - interests (pick from a list or type your own)
  - your week, permissions, a coding tool (Claude Code / Codex), apps, sound (Voicemeeter) and the screen
- An installer, a start launcher, update checks (GitHub releases) and a complete guide at `/help`.

**Your day**
- The Schedule app: day, week, month and year views. Drag to move or resize, importance levels, and live updates as the assistant makes changes.
- Repeating items: daily, every N days, weekdays, chosen days, every N weeks, monthly (a date or "the 2nd Tuesday"), yearly, with end dates. Change one day or every time.
- Reminders, a gentle wake-up alarm, snooze (buttons and "snooze 10 minutes"), morning rundowns and night mode.
- Study courses you add by link, with the next lesson and optional progress checks.

**Talking to it**
- A wake word, typed chat, and many commands that work without any AI.
- An optional AI brain: Claude, ChatGPT, Grok or Ollama, with web lookup, research, lists and results shown on screen.
- Voices: free Windows and Edge Natural voices, ElevenLabs (including your own library) and OpenAI.
- Awareness of what's on its own screen: "read me that quote".
- Documents read aloud, summarized and explained: Word, PDF, PowerPoint, Excel, CSV, OpenDocument, RTF and pictures of text.
- Files and folders: organize, open and save plans, all within the permissions you set.

**Your screen**
- The living sky: the real time of day, season, weather and wind, with landscapes, and a full vibe control panel.
- Fits any screen: size and margin controls, Fit to screen calibration, and automatic layouts that never spill.
- A hover window bar (minimize, maximize, hide, close, sound), keep-awake while plugged in, and a unified Sound panel with separate volumes.
- Discover: popular videos and articles about your interests, now and then.

**Music, calls and apps**
- Music inside Dayspring: Spotify (Premium) and YouTube with full controls, a queue, playlists and browsing.
- 🎧 Tune in: listens to calls in your headset and answers when called by name, even into the call (Voicemeeter).
- A Discord bot, phone texts through Phone Link, and connections to Google Calendar + Gmail, Outlook + Microsoft To Do, and Notion.
- Optional faith features: reading plan, prayer list, Scripture memory and church helpers.
