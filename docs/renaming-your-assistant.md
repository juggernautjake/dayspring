# Renaming your assistant and wake words

Your assistant starts out as **Dayspring**, and it answers to "Dayspring". You can give it any name you like, tell it how the name is said, and pick up to three wake words of your own (the words that get its attention). The app itself is still called Dayspring: you'll see that name in About, Help and Updates, next to "your assistant, Nova".

## Give it a new name

**By voice**, in any of the usual ways:

- "Your name is Nova" · "Your name is now Nova" · "Your new name is Nova"
- "I'm going to call you Nova" · "I'll call you Nova" · "Can I call you Nova?" · "Let's name you Nova"
- "Call yourself Nova" · "From now on you're Nova" · "Change your name to Nova" · "Rename yourself Nova"

It reads the name back first: *"Okay, call me Nova from now on? Say yes."* Say **yes** (or "sure", "yep", "that's right") and it answers in its new name: *"Great, I'm Nova now!"* Say **no** and nothing changes.

"Call Nova" (a phone call), "call me Nova" (your own name) and "my friend's name is Nova" don't rename it.

**In Settings**, open **Settings → Your assistant** and type the name in **Assistant's name**. See [Settings reference](settings-reference.md#your-assistant).

The rules for a name:

- 1 to 19 characters.
- Letters (any language), numbers, spaces, apostrophes (') and hyphens (-). "Big Mike", "D'Arcy", "Jean-Luc" and "Zoë" all work.
- Not "Lantern", and nothing that sounds like it (see [Lantern keeps its name](#lantern-keeps-its-name)).

If something isn't allowed, it tells you why straight away, both in Settings and by voice.

### How to say it

If the name isn't said the way it's spelled, fill in **How to say it** (for example "Aoife", said "Ee-fa"; or "Computa", said "compootah"), then press **▶ Hear it**. By voice: "Your new name is Computa, it's said compootah."

The voice then says the name that way everywhere, and the pronunciation also helps it hear the name when you say it.

### Asking about its name

- "What's your name?" → "I'm Nova."
- "What were you called before?" or "What's your original name?" → "I started out as Dayspring."
- "Go back to Dayspring", "Change your name back" or "You're not Nova anymore" → it asks, then goes back to Dayspring.

## Wake words

A wake word is what you say first, so it knows you're talking to it: "**Nova**, what's on today?"

- At first the wake word **is the name**, and it follows the name: rename it to Nova and it answers to "Nova".
- You can choose **up to three wake words** of your own instead, like "Hey Nova", "Computer" or "Jarvis". Each can be up to 19 characters.
- Once you've picked your own, renaming it doesn't change them. It asks instead: *"Want me to answer to 'Nova' too?"*
- "Hey", "Okay", "Hi" or "Yo" in front of any wake word always works. If you make the wake word "Hey Nova", the "hey" is needed.

**By voice:**

- "Set your wake word to Computa" · "Change your wake word to Jarvis" · "Only answer to Jarvis"
- "Add Computer as a wake word" · "Add a wake word Computer" · "Answer to Jarvis"
- "Remove Hey Nova" · "Stop answering to Jarvis"
- "What's your wake word?" · "What are your wake words?"
- "Make the wake word more sensitive" / "less sensitive"

A change to the wake words is read back and only happens after your yes.

**In Settings → Your assistant:** turn off **Wake up to its name** to choose your own. Each wake word has:

- **Sounds like** (optional): how it's said, if that's different from the spelling.
- **Also accept**: words the speech recognizer writes instead, separated by commas ("computer, compute a").
- The quick picks: "Hey <name>", "<name>", "Computer", "Jarvis".

### How it hears the wake word

Speech recognition writes down what it thinks you said, and it doesn't know made-up words. So for "Computa" it usually writes "computer", "compute a" or "come puta". Dayspring compares the *sound* of what was written with the sound of your wake words (and how you said they're pronounced), so all of those still wake it.

To keep it from waking up by accident:

- A wake word only counts **at the start** of what you say (after "hey", "okay" or "um" at most), or right after a pause the recognizer marked. "Computer, what time is it?" wakes it; "my computer is slow" never does.
- An everyday word that only *sounds* like your wake word ("computer" for "Computa") counts only at the very start, and only when it's a close match.
- Very common words ("the", "okay", "hey", "super") never count unless you taught them.

**How easily it wakes** (Settings → Your assistant):

| Setting | What it does |
|---|---|
| **Strict** | Only the wake word itself and what training taught it. Fewest accidents. |
| **Normal** | Also words that sound close, at the start of what you say. The default. |
| **Relaxed** | Wakes more easily ("commuter" for "Computa"). Try it if it often misses you. |

**Try it** in Settings: type what the recognizer might write, and it tells you whether that would wake it and what the request would be.

### Train my wake word

If it often misses your wake word, train it:

1. Say "**train my wake word**", or press **Train on the Dayspring screen** in Settings → Your assistant.
2. When the card on the Dayspring screen says **Now**, say the wake word on its own. Do this five times, with a short pause in between.

It shows how many times it understood you, and keeps what the recognizer wrote each time as accepted spellings (you can remove any of them in Settings). It warns you when:

- the wake word is short (one syllable) or a very common word, and suggests easier ones ("Hey Ed" instead of "Ed");
- something it heard is made of everyday words ("if a" for "Ee-fa"), because that could wake it by accident.

Training uses the Dayspring screen's microphone, so open the screen first. Nothing you say during training is sent anywhere or kept, only the spellings it learned.

### Lantern keeps its name

Lantern (the learning app) answers to "Lantern". If Dayspring's name or wake word sounded like it, both apps would answer, or the wrong one would. So "Lantern", "Lanterns", "Lan tern" and other sound-alikes are refused, with that reason. See [Lantern](lantern.md).

## Where the new name shows up

- On the Dayspring screen and the mini: the label on the talk panel, the hints ("Say 'Nova' and ask me anything"), the window title ("Nova · Dayspring").
- In what it says: "I'm Nova", "Nova here", greetings, and every AI's answers (Claude, ChatGPT, Grok, Ollama). If an AI still calls itself Dayspring, that's corrected before you see or hear it.
- In desktop notifications ("Nova is quiet").
- **Tune in** and calls: friends on the call can say "Nova, …". See [Discord calls](discord-calls.md).
- **Discord bot**: its nickname in your servers becomes the new name. The bot needs the **Change Nickname** permission there; if it doesn't have it, the old nickname stays and Settings → Discord says why. The bot's own username doesn't change. See [Discord bot](discord-bot.md).
- **Meetings**: it greets the meeting as "I'm Nova", signs its chat messages "Nova:", and answers "Nova, …" in the captions or "@Nova" in the chat. "Dayspring, …" still works in meetings too.

A **personality** (Settings → Personality) is only a style of speaking: a pirate Nova is still Nova. See [Personality](personality.md).

## What stays "Dayspring"

The app's own name stays Dayspring: in About, Help and Updates, the shortcuts, the program and folder names, and the end of the window title (so Dayspring can still find its own window). Existing installs keep "Dayspring" as both the name and the wake word until you change them.

## If it doesn't hear the new name

- Fill in **How to say it** if the spelling isn't how it sounds.
- Run **Train my wake word**.
- Pick a longer wake word (two or three syllables), or add "Hey" in front of a short one.
- Choose **Relaxed** for a while and see whether it wakes by accident.
- Browsers' speech recognition only writes real words, so a made-up name is heard as the nearest real word. Dayspring's private speech recognition on this computer (Settings → Speakers & mic → Speech recognition → On this computer) is given your wake words as a hint, so it tends to write them the way you spell them.

See also [Talking to Dayspring](talking-to-dayspring.md) and [Troubleshooting](troubleshooting.md).
