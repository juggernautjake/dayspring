# Faith features (optional)

Dayspring has optional features for people who want to build a daily habit of Scripture and prayer. They're all **off** until you turn them on in Settings → **Features**:

- **Faith & Scripture memory**: morning quiet time, a reading plan, a prayer list, memory verses
- **Church**: your congregation's services, current studies and bulletins

If you leave them off, Dayspring never brings them up.

## Morning quiet time

With Faith on, the morning goes like this:

1. Wake-up music plays (see [Music](music.md#morning-music)).
2. Dayspring greets you, then gives today's reading, your memory verses and who to pray for.
3. It asks: *"Do you want some softer, meditative music while you read, or just quiet for now?"*
4. When your quiet-time block ends, it asks if you're ready for the day, then gives the rundown.

Add a block called something like "Quiet time" to your routine so Dayspring knows how long you have.

## Memory verses

Dayspring helps you memorize whole chapters, a few verses at a time:

- Each chapter is split into small chunks of 2–3 verses. Each chunk gets two days: learn it, then say it together with what came before.
- When a chapter is done, you get two "put it together" days.
- Every 7th day is a **review day**. Finished chapters come back at growing intervals (1 week, 2 weeks, 1 month… then yearly), so nothing fades.
- You choose the books, and the order cycles through them, for example a chapter of a gospel, then a Psalm, then a Proverb. Tell Dayspring: "I want to memorize Romans, Psalms and Proverbs, a chapter each in turn."

Things you can say:

- "What am I memorizing?" · "Read my memory verses"
- "Quiz me": then recite, and it checks word by word and gives you a score
- "I've got it" (move on early) · "I need more time" (stay another day)
- "How am I doing on memorizing?"

## Prayer list

- "Pray for Sam who is starting a new job" · "Add Jordan to my prayer list for her surgery"
- Each morning it shows a few people to pray for, rotating through the list.
- "Show my prayer list" puts it on the screen and reads the names.
- Parts of the list: "What's my **morning** prayer list?" · "Read my **evening** prayer list" · "Pull up my prayer list for the **full day**" (today's picks) · "Read me the **whole** prayer list" · "Show the **church** prayer list" · "What am I praying for Mom about?" · "Show my answered prayers"
- Morning is the first half of today's picks plus one church request; evening is the rest. To change the split, add `"split": { "morning": 3, "morningChurch": 1 }` under `"prayer"` in `data/devotion.json`.
- Changing it: "Take Sam off my prayer list" · "Sam's job was answered" (moves it to your answered prayers with today's date) · with an AI brain, "change Jordan's request to recovery after surgery."
- Entries marked private show "(private)" on the screen. Dayspring names them but doesn't read the details unless you ask about that one.

## Bible versions

Built in, offline: **KJV**, WEB, ASV, Darby, Young's Literal, BBE and others. Say "use the World English Bible by default". For the **ESV** or **NLT**, add their free keys (see [Connecting apps](connections.md#optional-keys-for-extras)).

## Church

Tell Dayspring about your church in Settings → **Features** → **Church**: name, service times, and what each class or service is studying.

- "We're in Acts 3 now" (it keeps track, chapter by chapter)
- "Help me get ready for Sunday": it reads the passage aloud and points out a few things
- "Let's review Wednesday's lesson": a few questions afterwards to help it stick
- "What did we talk about on Acts 2?"
- "Help me prepare a lesson on Romans 12": it starts a lesson outline in your notes

Before and after services, Dayspring may gently offer to help you prepare or reflect.

**Bulletins:** with an AI brain and file permission, say "read my church bulletin in Downloads and add the prayer requests and verses." It pulls out the prayer list, memory verses, speakers, events and birthdays.

A monthly meal or event can be added as a rule, for example "the church potluck is the fourth Sunday of every month".
