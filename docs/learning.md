# Study courses

Dayspring can keep track of courses you're working through: an online class, a certification's study plan, a self-paced coding course. On the Dayspring screen each course shows as a ring with how far along you are, what's next, and how many sessions you're behind. If you have an exam date, a countdown card shows it too.

Click a ring (or the exam card) and you can:

- **Open next**: Dayspring opens the next lesson in its **study window** on your main screen, right where you need to start.
- **I finished it, check it**: Dayspring looks at the course's **real progress** (quiz scores, finished exercises, sections read) and only marks it done if it really is. If something's missing, it tells you exactly what ("the Module 2 quiz isn't passed yet, best 60%, you need 70%") and offers to open it.
- **See all lessons**: the whole checklist: ✓ done, ▶ next, ! behind schedule, ○ coming up. Click any lesson to open it.
- **Bring in progress** (courses that keep progress in the browser): move progress you made in another browser into the study window.

> **Tip:** You can also use the keyboard: Tab to a ring and press Enter.

## Things you can say

- "What should I study next?"
- "Open my Spanish course" · "Let's study guitar" · "Open the next lesson" · "Open module 3"
- "I finished module 2" · "I'm done with unit 1 lesson 3" · "I finished the unit 2 check" · "I'm done studying"
- "Mark it done anyway" (when Dayspring can't check, or you know it's done)
- "Sync my study progress" (pulls in everything you finished in the study window)

When Dayspring offers to open the next lesson, just say "yes".

## The study window

Dayspring opens courses in its own Chrome window (a separate profile called **DayspringStudy**), on your main screen, never on the Dayspring display. It's separate from your everyday browser so Dayspring can read the course's progress. It remembers sign-ins, so:

1. The first time you open a course that needs an account, the window shows that site's sign-in page.
2. Sign in there once.
3. From then on, Dayspring opens lessons directly and can check your progress.

While the study window is open, Dayspring pulls in your checked progress every few minutes and again when you close a course's tab.

> **If it doesn't work:** If Dayspring says it "can't see your progress", the study window isn't signed in to that site. Open the course from the ring, sign in, and ask again. You can always say "mark it done anyway".

## Adding your own course

A new Dayspring has no courses. Add one by saying or typing it (no AI needed):

- "Add a course called Spanish at duolingo.com with 30 lessons"
- "Add a course called Guitar basics with 12 lessons" (no web address yet)
- "Guitar basics is at justinguitar.com" (give a course its address later)

Dayspring makes a checklist of lessons ("Lesson 1", "Lesson 2"…) and a ring on the screen. Click the ring, or say "open Spanish", and the course opens in the study window. Say "I finished lesson 1" to check lessons off. With an AI brain you can also say "add my Coursera Python course with these modules: …" to name each lesson, or "stop tracking Guitar basics".

Courses you add this way are checked off on your word. Dayspring checking a site's real progress needs the advanced setup below.

**Advanced: the course files.** Courses have two parts. You can edit both files in the `data` folder with any text editor. Stop Dayspring first, then start it again afterwards.

### 1. The checklist: `data/learning.json`

This is the list of lessons, each planned for a day, plus an optional exam. The simplest way to fill it is to put study blocks on your schedule and let Dayspring build the list from them. You can also write it by hand:

```json
{
  "exam": { "name": "Spanish B1 exam", "spoken": "the Spanish exam", "date": "2027-03-14", "time": "09:00", "place": "Community College" },
  "courseDefs": { "spanish": { "title": "Spanish course", "titleStartsWith": "Spanish study" } },
  "courses": {
    "spanish": { "title": "Spanish course", "items": [
      { "id": "spanish-01", "title": "Unit 1, lesson 1: Greetings", "detail": "Unit 1, lesson 1: Greetings",
        "planned": { "date": "2026-10-01", "start": "18:00", "block": "Spanish study" }, "done": false, "doneAt": null, "note": "" }
    ] }
  },
  "log": []
}
```

### 2. Where it lives and how to check it: `data/study.json`

```json
{
  "courses": {
    "spanish": {
      "aliases": ["spanish", "spanish course"],
      "forExam": true,
      "open": { "base": "https://learn.example.com", "home": "/courses/spanish", "signInPath": "/login", "signInName": "Example Learn" },
      "verify": { "type": "none" },
      "items": {
        "spanish-01": { "path": "/courses/spanish/unit-1/lesson-1", "match": { "unit": 1, "lesson": 1 } }
      }
    }
  }
}
```

- **aliases**: the words you use for the course when you talk.
- **forExam**: the exam card opens this course.
- **open**: either a website (`base` + `home`, with `path` per lesson), a single `url`, or a course saved as a file on your computer (`file`, served to the study window so it needs no sign-in). `signInPath` is how Dayspring notices a sign-in page.
- **items → match**: the numbers you'd say ("module 2", "unit 1 lesson 3", "the unit 2 check"), so "I finished module 2" finds the right lessons.
- **verify**: how Dayspring checks your work:
  - `"none"`: you confirm it yourself ("I finished it" marks it done after you say "mark it done anyway").
  - `"localstorage"`: for a course that saves progress in the browser. Set `"key"` to the name it saves under. Each item's `check` is either `{ "kind": "all", "paths": ["lessons.l1.done"], "names": ["what's missing when it isn't"] }` or `{ "kind": "min", "path": "exams.u1", "field": "percent", "min": 80, "name": "the Unit 1 test" }`. `"importKeys"` lists what "Bring in progress" may copy.
  - `"api-progress"`: for a learning site with a progress address the signed-in study window can read (`"api"`). Each item's `check` is `{ "kind": "quiz", "moduleId": "…" }`, `{ "kind": "sections", "moduleId": "…", "need": 3 }` or `{ "kind": "mock", "min": 1 }`.

> **Note:** Dayspring never types passwords and never submits anything on a course site. It only opens pages and reads your progress.

## What "checked" means

- A **quiz** counts when your best score reaches the course's pass mark.
- An **exercise** counts when the course says it passed.
- **Reading** counts when the course records that you opened the sections. It can't tell how carefully you read them.
- Items marked "anyway" are saved as *marked done by you (not checked)*, so your record stays honest.
