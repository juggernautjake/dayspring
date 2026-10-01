# Using Dayspring without AI

Dayspring doesn't need an AI brain for everyday things. With no key at all it still understands **hundreds of requests**: timers, the time and date, your schedule, reminders, recipes and cooking, the Bible, the weather, music, math and conversions, lists and notes, jokes, games and more. Everything here works offline except the weather, recipe searches and web searches.

**New in 1.8.0 (development version):** every setting by voice ("make the text bigger", "use 24-hour time", "undo that"), the sky and the screen ("make it rain for 10 minutes", "compact mode"), the schedule with repeats ("gym every Monday Wednesday Friday at 6am"), alarms with days, labels and a gentle wake, and ending the conversation ("thanks, that's all") so Dayspring stops listening right away. See [Things you can say](things-you-can-say.md).

An AI brain (see [AI providers](ai-providers.md)) adds real conversation: questions about anything, planning your day with you, writing, and summaries. When an AI is set up, Dayspring still answers the quick things itself (a timer, "what's 12 times 14"), so they're instant and cost nothing.

## How it understands you

Say things the way you normally would. Dayspring:

- ignores "hey", "please", "can you" and other filler, and understands contractions and numbers said as words ("twenty five minutes")
- fixes small slips and sound-alikes ("set a time her" → timer, "calender" → calendar, "roamns 8 28" → Romans 8:28)
- picks out the details: how long, what time, which day ("first thing tomorrow", "after lunch", "the end of the month", "in a bit"), a Bible passage, a number
- knows what's going on right now: while you're cooking, "next" means the next step; while recipes are on the screen, "the second one" picks a recipe; while a timer is ringing, "okay" turns it off

## When it isn't sure

If Dayspring can't tell what you meant, it shows **"Here's what I can do that sounds close:"** with up to 7 numbered choices and **None of these**, and reads out the first three. Answer by saying the number ("two", "the second one", "number 3"), the words of a choice, or "none of these". You can also tap a choice, or press 1–7 on the keyboard. It remembers your pick, so the same words go straight there next time.

If you say "none of these", Dayspring says its answers are limited without an AI brain and asks you to try another way. After a few misses in a row, it shows a link to this guide and to [AI providers](ai-providers.md).

**Teach it:** Settings → AI brain → **Without AI** shows the phrases Dayspring didn't understand (only the words, never audio, and only on your computer). Pick what each one means and press **Teach**. You can turn this list off, and **Forget what you learned** clears everything it learned from your picks. The **Try it** box shows what Dayspring would do with any phrase, without doing it.

## Questions it asks you

- **"Got it, 10 minutes. What's it for?"**: when you set a timer without a name. Answer "pasta" (or "it's for the laundry"), or say "nothing" and it becomes Timer 1.
- **"Just to check: …? Say yes to go ahead."**: before anything that removes something (deleting an event, a recipe or a note, clearing a list, closing a program).
- **"For how long?" / "What time?" / "Which day?"**: when a detail is missing.

You have about 7 seconds to answer, with no wake word needed.

## Timers

Up to **7 timers at once**, each with a name. Try: "set a pasta timer for 8 minutes", "10 minute timer for the laundry", "remind me in 20 minutes to flip the chicken" (a timer named *flip the chicken*), "how long left on the pasta", "add 2 minutes to the oven timer", "pause all timers", "call the second timer oven", "cancel the rice timer", "what timers do I have".

When a timer ends, Dayspring says its name ("Your pasta timer is done"), plays the timer sound and shows a card with **Dismiss**, **+5 min** and **Snooze**. Timers that end together are said together. If you don't answer, it reminds you once a minute, five times at most. With the Dayspring window closed, the desktop card rings instead. When Dayspring is Quiet or Off, a timer you set still rings, unless you turn off **Settings → Notifications → Timers still ring when Dayspring is quiet or off**.

Also: a stopwatch ("start the stopwatch", "lap"), alarms ("wake me up at 6:30"), repeating reminders ("remind me to take out the trash every Tuesday night"), medicine and water reminders, and focus sessions ("start a pomodoro": 25 minutes of focus, then a 5 minute break, four rounds).

## Jokes and games

"Tell me a joke", "a dad joke", "tell me an animal joke", "another one", "a different kind", and knock-knock jokes both ways: say "knock knock" and Dayspring answers "Who's there?". Games: trivia ("quiz me"), rock paper scissors, would you rather, and the magic 8-ball. With a playful personality (Settings → [Personality](personality.md), Humour 60 or more), Dayspring may offer a joke now and then (at most 3 a day by default, never during calls, alarms, timers, cooking or focus time). Say "stop asking me about jokes" to turn that off.

## If you're having a hard time

Tell Dayspring how you feel ("I'm stressed", "I'm sad", "I'm lonely") and it answers kindly, with a gentle idea like a breathing exercise. It isn't a counselor. If you say something that sounds like you might hurt yourself, it gives you the **988 Suicide and Crisis Lifeline** (call or text 988 in the US) and encourages you to reach out to someone you trust.

## Everything you can say

This list is made from what Dayspring actually understands. Use the guide's search box to find something.

<!-- list:start -->
<!-- generated by scripts/gen-intents-doc.mjs: 245 things Dayspring understands without AI -->

### Time and dates

| What it does | Try saying |
|---|---|
| Tell you the time | “What time is it” · “Current time” · “Whats the time” |
| Tell you today's date | “What's today's date” · “What is today” · “Which day is it” |
| Count the days until a date | “How many days until christmas” |
| Tell you the time somewhere else | “What time is it in tokyo” |
| Tell you when a holiday is | “When is thanksgiving” · “Is today a holiday” · “Whats the next holiday” |
| Tell you the day of the week for a date | “What day of the week is july 4” |
| Tell you if it's a leap year | “Is it a leap year” · “Leap year” |
| Tell you the date of a day | “What's the date next friday” |

### Your schedule

| What it does | Try saying |
|---|---|
| Tell you what's next | “What's next” · “What am i doing next” · “What should i do next” |
| Tell you what's on right now | “What should I be doing right now” · “What am i supposed to be doing” · “Where should i be” |
| Read the schedule for a day | “What's on tomorrow” · “What do i have today” · “What is on the agenda” |
| Show this week's schedule | “Show me my week” · “Whats my week” · “Week view” |
| Show the month | “Show me the month” · “Month view” |
| Show the year | “Show me the year” · “Year view” |
| Open the calendar | “Open my calendar” |
| sched.add | “Add dentist on friday at 3” |
| sched.move | “Move the dentist to 4” |
| Push something later | “Push dinner back 30 minutes” |
| Rename something on your schedule | “Rename gym to workout” |
| sched.delete | “Cancel the dentist” |
| Make something longer or shorter | “Make the meeting 30 minutes longer” |
| Find free time | “When am I free tomorrow” |
| Check for conflicts | “Do I have any conflicts this week” · “Is anything overlapping” |
| Clear part of your day | “Clear my evening” |
| Make something repeat | “Make gym repeat every weekday” |
| Check something off | “Mark gym done” |
| Undo the last change | “Undo that” · “Put it back” · “Take that back” |
| Give you the day's rundown | “Give me my rundown” · “Brief me” · “How does my day look” |
| Tell you what you did today | “What did i do today” · “What have i done so far” |
| Tell you what's left today | “What's left today” |

### Timers, alarms and reminders

| What it does | Try saying |
|---|---|
| timer.start | “Set a timer for 10 minutes” · “Set an egg timer” |
| List your timers | “What timers do I have” · “Timers status” |
| Tell you how long is left on a timer | “How long is left on the pasta” · “How much time do i have left” |
| timer.cancel | “Cancel the pasta timer” |
| Pause a timer | “Pause the timer” · “Stop the clock” |
| Resume a timer | “Resume the timer” |
| Add time to a timer | “Add 2 minutes to the oven timer” |
| Rename a timer | “Rename the laundry timer to dryer” |
| Stop the ringing timer | “Stop the timer” · “I know the timer is done” |
| Use the stopwatch | “Start the stopwatch” |
| alarm.set | “Set an alarm for 6:30 am” |
| List your alarms | “What alarms do I have” · “Is my alarm set” |
| Cancel an alarm | “Cancel my alarm” |
| reminder.set | “Remind me to call mom tomorrow at 5” |
| List your reminders | “What are my reminders” · “What am i supposed to remember” · “What did i ask you to remind me” |
| Cancel a reminder | “Cancel the reminder about the trash” · “No more reminders” |
| Snooze | “Snooze for 10 minutes” |
| Set a repeating reminder | “Remind me to take out the trash every tuesday night” |

### Focus sessions

| What it does | Try saying |
|---|---|
| Start a focus session | “Start a pomodoro” |
| End the focus session | “Stop the pomodoro” · “End focus” · “Take me out of focus mode” |

### Health reminders and breaks

| What it does | Try saying |
|---|---|
| Remind you to take medicine | “Remind me to take my medicine at 8” |
| Remind you to drink water | “Remind me to drink water every hour” · “Hydration reminder” · “No more water reminders” |
| Start a stretch break | “Start a stretch break” · “Remind me to stretch” |
| Do a breathing exercise with you | “Breathing exercise” · “Box breathing” · “Breathe with me” |

### Home and meals

| What it does | Try saying |
|---|---|
| Suggest something for dinner | “What should i have for dinner” |

### Recipes

| What it does | Try saying |
|---|---|
| recipe.find | “Find me a recipe for chicken enchiladas” |
| Show more recipe options | “More options” |
| Choose one of the recipes | “Use the second one” |
| recipe.cook | “Let's make the chili” · “Cooking mode” |
| List your saved recipes | “What recipes do I have” · “My recipes” |
| Save a new recipe by voice | “New recipe called grandma's cookies” · “Start a new recipe” |
| Save a recipe from a web page | “Save the recipe from allrecipes.com/...” · “Save this recipe link” |
| Delete a saved recipe | “Delete the pancake recipe” |

### While you're cooking

| What it does | Try saying |
|---|---|
| Go to the next step | “Next step” · “Continue” · “Next” |
| Go back a step | “Previous step” · “Back one step” · “The step before” |
| Repeat this step | “Repeat the step” |
| Tell you which step you're on | “What step am I on” · “Which step is this” |
| Read the ingredients | “Read the ingredients” |
| Tell you how much of an ingredient | “How much flour do I need” |
| Scale the recipe | “Double the recipe” |
| Stop cooking mode | “Stop cooking” · “All done cooking” |
| Jump to a step | “Go to step 4” |
| Start this step's timer | “Start the timer for this step” |

### Math, conversions and quick tools

| What it does | Try saying |
|---|---|
| Do the math | “What's 15% of 80” |
| Convert units | “Convert 5 miles to kilometers” |
| Spell a word | “How do you spell necessary” |
| Flip a coin | “Flip a coin” · “Heads or tails” · “Call it heads or tails” |
| Roll dice | “Roll a die” · “Dice roll” |
| Pick a random number | “Pick a number between 1 and 10” |
| count | “Count to 10” · “Count” |

### Quick facts

| What it does | Try saying |
|---|---|
| Tell you a capital city | “What's the capital of france” |
| Tell you about the planets | “How many planets are there” · “Is pluto a planet” · “Which planet has the most moons” |
| Say a times table | “What's the 7 times table” |
| Look that up for you | “Who invented the telephone” |

### Lists, notes and to-dos

| What it does | Try saying |
|---|---|
| list.add | “Add milk to my shopping list” |
| Read a list | “What's on my shopping list” |
| Take something off a list | “Take milk off the shopping list” |
| Clear a list | “Clear my shopping list” |
| Take a note | “Take a note: call the plumber” |
| Read your notes | “Read my notes” · “Last note” · “Any notes” |
| Delete a note | “Delete the last note” |
| Add a to-do | “Add clean the garage to my to do list” |
| Read your to-do list | “What's on my to do list” |

### The Bible

| What it does | Try saying |
|---|---|
| bible.read | “Read John 3:16” |
| Read the verse of the day | “Verse of the day” · “I need a verse” |
| Read the next verse | “Read the next verse” · “Read more” · “Next part” |
| List the Bible versions I can read | “What bible versions do you have” |
| Find verses about a topic | “Find verses about peace” |
| Change your Bible version | “Use the ESV from now on” |

### Prayer list

| What it does | Try saying |
|---|---|
| Read your prayer list | “Read my prayer list” · “Prayer list” |
| Add to your prayer list | “Add my aunt to my prayer list” |

### Weather

| What it does | Try saying |
|---|---|
| Tell you the weather | “What's the weather” · “How windy is it” · “Weekly forecast” |

### Music and videos

| What it does | Try saying |
|---|---|
| Play music or a video | “Play some jazz” · “Music please” |
| Pause the music or video | “Pause” |
| Resume playing | “Resume the music” · “Play again” |
| Skip to the next song | “Next song” · “I do not like this song” |
| Go back a song | “Previous song” |
| Stop the music or video | “Stop the music” · “Enough music” · “No more music” |
| Change the music volume | “Turn the music up” · “Crank it up” |
| Tell you what's playing | “What song is this” |
| Play music or a video from your computer | “Play holy forever from my computer” |
| Shuffle your music folder | “Shuffle my music folder” |
| List the music or videos on your computer | “What audio files do i have from 2019” |
| Find a video or song on your computer | “Find the video from sarah's wedding” |
| Play or find something in your Google Drive | “Play the wedding video from my drive” |
| Find and play a video on YouTube | “Find bible reading in psalms on youtube” |
| Show videos to choose from | “Pull up videos about biking” |
| Queue videos | “Queue 3 videos about dovetails” |
| Show the video queue | “Show the queue” · “What is in this playlist” |
| List your YouTube playlists | “List my youtube playlists” · “What youtube playlists do i have” · “What are my youtube playlists” |
| Play one of your YouTube playlists | “Play my worship playlist on youtube” · “Shuffle my liked videos” |
| Open the Music & Video browser | “Open my music” |
| Show your Spotify playlists | “Show my spotify playlists” · “What playlists do i have on spotify” · “My spotify playlists” |
| Show your Liked Songs | “Show my liked songs” |
| Show the artists you follow | “Show my followed artists” · “My followed artists” |
| Your top songs and artists | “My top songs this month” |
| What you listened to | “What did i listen to yesterday” |
| Your YouTube watch history | “Show my youtube history” · “My youtube history” |
| Search Spotify from the browser | “Search spotify for hillsong” |

### Programs, files and websites

| What it does | Try saying |
|---|---|
| app.open | “Open notepad” |
| Close a program | “Close notepad” |
| Open a website | “Open youtube” |
| Search the web | “Look up how tall mount everest is” |
| Find a file | “Find my resume” |
| Open a file | “Open my resume document” |
| Make a new folder | “Make a folder called taxes” |

### Jokes

| What it does | Try saying |
|---|---|
| Stop or start offering jokes | “Stop asking me about jokes” |
| Tell a joke | “Tell me a joke” · “Make me laugh” · “Another one” |
| Tell me a knock-knock joke | “Knock knock” · “Knock knock dayspring” |

### Games

| What it does | Try saying |
|---|---|
| Ask you a trivia question | “Let's play trivia” · “Quiz me” · “Test my knowledge” |
| Play rock paper scissors | “Rock paper scissors” · “Play roshambo” |
| Shake the magic 8-ball | “Magic 8 ball, will it snow” · “Shake the eight ball” |
| Ask a would-you-rather | “Would you rather” · “Another would you rather” · “Give me a would you rather” |
| Play 20 questions | “Let's play 20 questions” · “Guess what i am thinking” · “I spy” |

### Chatting

| What it does | Try saying |
|---|---|
| Tell you about me | “Who are you” · “What is your name” · “What are you” |
| Share a fun fact | “Tell me a fun fact” · “Did you know” · “Give me some trivia” |
| Say good morning | “Good morning” · “Morning” · “Top of the morning” |
| Say good night | “Good night” · “I am going to bed” · “Going to sleep now” |
| Say hello | “Hello” · “Howdy” · “Yo” |
| Say you're welcome | “Thank you” · “Perfect thanks” · “Cheers” |
| Tell you how I'm doing | “How are you” · “How are things” |
| Answer kindly | “I love you” · “I like you” · “Are we friends” |
| Say thanks for the kind words | “Good job” · “Well done” · “You rock” |
| Take it in stride | “You're dumb” · “I hate you” · “Shut up” |
| Accept an apology | “Sorry” · “My bad” · “I apologize” |
| Say what's up | “What's up” · “What is up” · “Whats up” |
| Say good afternoon or evening | “Good evening” · “Top of the morning” |

### How you're feeling

| What it does | Try saying |
|---|---|
| Get support right now | “I want to hurt myself” · “Suicide” · “I am going to end it” |
| Help when you're bored | “I'm bored” · “Give me something to do” · “Entertain me” |
| Say something kind when you're tired | “I'm tired” · “Long day” · “I am beat” |
| Help when you're stressed | “I'm stressed” |
| Be there when you're sad | “I'm sad” · “I want to cry” · “Nothing is going right” |
| Keep you company | “I'm lonely” · “Talk to me” · “Keep me company” |
| Celebrate with you | “I'm happy” · “I got the job” · “Good news” |

### About the conversation

| What it does | Try saying |
|---|---|
| Tell you what I heard | “What did you hear” · “Repeat what i said” |
| Undo what I got wrong | “That's wrong” · “You misheard me” · “Wrong” |
| Never mind | “Never mind” · “Never ?mind” · “Start over” |

### Dayspring itself

| What it does | Try saying |
|---|---|
| Stop listening | “Stop listening” · “Quit listening” · “You can stop listening” |
| Go quiet | “Go quiet” · “Do not disturb” |
| Turn Dayspring off | “Turn yourself off” · “Go to sleep” · “Take a break” |
| Turn Dayspring back on | “Wake up” |
| Switch to the small window | “Compact mode” · “Make dayspring small” |
| Go full screen | “Go full screen” |
| Open Settings | “Open settings” · “Settings” |
| Open the guide | “Open help” · “I need help” · “Show me the guide” |
| Show how to do something in Dayspring | “How do I connect spotify” |
| Tell you what I can do | “What can you do” |
| Change the voice | “Change your voice” |
| Talk faster or slower | “Talk slower” |
| Talk louder or softer | “Speak louder” |
| Say that again | “Repeat that” · “One more time” |
| Check for updates | “Check for updates” |
| Change the sky and scenery | “Make it rain” · “Back to the real weather” |
| Switch to text only | “Text only” · “Silent chat” |
| Keep the computer awake | “Keep the laptop awake” |
| Move a window | “Move the window to the left” |
| Restart Dayspring | “Restart” · “Can you restart” |
| Explain screen brightness | “Turn up the brightness” · “Dim the screen” |
| Give you examples of what to say | “Give me some examples” · “What should i try” |

### Personality

| What it does | Try saying |
|---|---|
| Switch to a character or saved personality | “Be a cowboy” · “Talk like a pirate” · “Be a pirate” |
| Go back to the normal personality | “Be normal” · “Drop the act” · “Be yourself” |
| Say which personality is on | “What personality are you” · “What are you pretending to be” |
| List the personalities | “What personalities are available” |
| Turn a personality trait up or down | “Be more sassy” |
| Save this personality | “Save this personality as grumpy captain” |
| Delete a saved personality | “Delete my grumpy captain personality” |
| Rename a saved personality | “Rename grumpy captain to captain sam” |
| Say which secret characters you've found | “What secret characters have i found” |
| Get a hint for a secret character | “Give me a hint for a secret character” |
| Pick a random personality | “Surprise me with a personality” |

### Studying

| What it does | Try saying |
|---|---|
| Tell you your next lesson | “What's my next lesson” · “Start studying” · “Time to study” |

### Discover

| What it does | Try saying |
|---|---|
| Show something new about your interests | “Show me something new” · “Surprise me” · “What is new in my interests” |

### Documents

| What it does | Try saying |
|---|---|
| Read a document aloud | “Read my lease to me” |
| Summarize a document | “Summarize my lease” |

### Photos

| What it does | Try saying |
|---|---|
| Show a photo | “Show me a photo” · “Photo slideshow” |

### Texts

| What it does | Try saying |
|---|---|
| Read your texts | “Read my texts” |

### Images

| What it does | Try saying |
|---|---|
| Show pictures of something from the web | “Show me pictures of golden retrievers” |
| Show one of the pictures bigger | “Show number 3 bigger” |
| Show more pictures | “More pictures” |
| Save one of the pictures | “Save that picture” |
| Close the pictures | “Close images” |

### Gifs

| What it does | Try saying |
|---|---|
| Find a GIF | “Show me a gif of a dancing cat” |
| Show trending GIFs | “Trending gifs” · “What gifs are trending” |
| Show more GIFs | “More gifs” · “Load more gifs” |
| Save a GIF to your computer | “Save that gif” |
| Copy a GIF | “Copy that gif” · “Copy the gif link” |
| Show only stickers | “Only stickers” · “Stickers only” · “Switch to stickers” |
| Only clean GIFs | “Clean gifs only” · “Family friendly gifs” |
| Close the GIFs | “Close the gifs” · “No more gifs” |

### Mail

| What it does | Try saying |
|---|---|
| Check your email | “Read my new emails” |
| Check for emails from someone | “Any emails from sam” |
| Read an email | “Read the one from the bank” · “Read that email” |
| Summarize your inbox | “Summarize my inbox” |
| Open the Mail window | “Open my email” |
| Write an email | “Write an email to sam” |
| Undo sending an email | “Undo send” |

### Devices

| What it does | Try saying |
|---|---|
| Turn a device on | “Turn on fan 2” |
| Turn a device off | “Turn off the tv” |
| Is a device on? | “Are the lights off” |
| Open the Devices page | “Show my smart devices” · “List my smart devices” |

### Printers

| What it does | Try saying |
|---|---|
| How's a printer doing? | “How is printer 3 doing” |
| Pause or resume a print | “Pause printer 3” |
| Show a printer's camera | “Show me printer 3's camera” |
| Is the print bed clear? | “Is the bed clear on printer 2” |

### Cameras

| What it does | Try saying |
|---|---|
| Show a camera | “Show me the front camera” |
| Say what the cameras saw | “Any activity on the trail cam?” |
| Play a camera clip | “Play last night's deer clip” |

### Shopping

| What it does | Try saying |
|---|---|
| Find something for sale on Amazon | “Find a waterproof work boot on amazon” |
| Show your Amazon orders | “Show my amazon orders” · “My amazon order history” · “What did i order on amazon” |
| When you last bought something on Amazon | “When did i last buy coffee filters on amazon” |
| Buy something again on Amazon | “Buy coffee filters again on amazon” |
| Your Subscribe & Save deliveries | “Show my subscribe and save” · “What is coming from subscribe and save” · “My amazon subscriptions” |
| Your Amazon account (read-only) | “Show my amazon account” · “Am i a prime member” |
| Open Shopping | “Open shopping” · “Open amazon shopping” |
| Sign in to Amazon in Dayspring | “Sign in to amazon” · “Am i signed in to amazon” |

<!-- list:end -->
