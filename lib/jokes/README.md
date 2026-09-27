# Dayspring jokes

A catalogue of clean, family-friendly jokes for Dayspring to tell out loud: corny puns, dad jokes, riddles and knock-knocks. It has **1039 jokes** in **38 categories**: 735 question-and-answer, 137 one-liners and 167 knock-knocks.

## Files

- `catalogue.mjs` exports `JOKES`, which is an array of `{ id, category, type, setup, punchline, tags }`. It also exports `CATEGORY_LABELS` and `MIN_PER_CATEGORY`.
  - `type` is one of these:
    - `"qa"`: a question and its answer.
    - `"oneliner"`: the setup alone, or the setup and a punchline.
    - `"knock"`: `setup` is the name after "Who's there?" and `punchline` is the payoff line.
  - `id` is stable, such as `food-012`. Don't renumber ids. Add new jokes at the end of a category with the next free number.
  - `tags` is optional and can hold `"pun"`, `"kids"` or `"dad-joke"`.
- `index.mjs` has these helpers:
  - `pick({ category, type, exclude })` returns a random joke and records it as told. It avoids the last 50 told ids, which it keeps in `data/jokes-told.json`. It writes that file atomically (temp file, then rename), and a missing or corrupt file counts as empty. If a filter has nothing fresh left, it reuses the joke told longest ago. Pass `record: false` to peek without recording.
  - `categories()` returns `[{ id, label, count, types: { qa, oneliner, knock } }]`.
  - `find(text)` turns a request into `{ category, type }`, or `null` when the text names no topic or type. For example, "space" gives `space`, "food" or "cooking" gives `food`, "politics" or "politician" gives `politics`, and "knock knock" gives the type `knock`.
  - `speakable(joke)` returns `{ id, setup, pause_ms, punchline, text }` for TTS. The pause is 1200 ms for Q&A and 900 ms for one-liners and knock-knocks. A knock-knock comes back as the whole routine, with Dayspring voicing both sides. `knockLines(joke)` returns the five lines separately.
  - `recent()`, `markTold(id)`, `resetTold()`, `get(id)` and `configure({ toldPath })` are also available.
- `test.mjs`: run it from `apps/desk` with `node --test lib/jokes/test.mjs`.

```js
import { find, pick, speakable } from "./lib/jokes/index.mjs";
const want = find(userText) || {};        // { category, type }
const joke = pick(want);                  // fresh, recorded as told
const { setup, pause_ms, punchline } = speakable(joke);
```

## Categories

| id | Category | Total | Q&A | One-liner | Knock-knock |
|---|---|---:|---:|---:|---:|
| `food` | Food | 27 | 19 | 4 | 4 |
| `animals` | Animals | 27 | 20 | 2 | 5 |
| `space` | Space and astronomy | 26 | 21 | 1 | 4 |
| `math` | Numbers and math | 28 | 20 | 4 | 4 |
| `science` | Science | 29 | 21 | 4 | 4 |
| `school` | School and teachers | 27 | 19 | 4 | 4 |
| `sports` | Sports | 28 | 22 | 2 | 4 |
| `music` | Music | 27 | 21 | 2 | 4 |
| `weather` | Weather | 27 | 22 | 1 | 4 |
| `seasons` | Holidays and seasons | 28 | 21 | 3 | 4 |
| `tech` | Computers and technology | 27 | 19 | 3 | 5 |
| `health` | Doctors and health | 27 | 17 | 6 | 4 |
| `jobs` | Jobs and work | 27 | 17 | 6 | 4 |
| `history` | History | 27 | 19 | 4 | 4 |
| `geography` | Geography and international | 29 | 19 | 4 | 6 |
| `politics` | Politics and government | 27 | 19 | 4 | 4 |
| `showbiz` | Celebrities and show business | 27 | 18 | 5 | 4 |
| `farm` | Farm | 28 | 24 | 1 | 3 |
| `ocean` | Ocean | 27 | 20 | 3 | 4 |
| `dinosaurs` | Dinosaurs | 27 | 19 | 4 | 4 |
| `bugs` | Bugs | 27 | 19 | 3 | 5 |
| `travel` | Cars and travel | 26 | 19 | 2 | 5 |
| `family` | Family and parents | 27 | 8 | 14 | 5 |
| `books` | Books and reading | 26 | 19 | 3 | 4 |
| `art` | Art | 27 | 18 | 5 | 4 |
| `kitchen` | Kitchen and cooking | 27 | 18 | 4 | 5 |
| `birthdays` | Birthdays | 27 | 19 | 3 | 5 |
| `christmas` | Christmas | 28 | 19 | 4 | 5 |
| `thanksgiving` | Thanksgiving | 28 | 19 | 4 | 5 |
| `halloween` | Halloween | 27 | 19 | 2 | 6 |
| `valentines` | Valentine's Day | 27 | 20 | 3 | 4 |
| `garden` | Plants and gardening | 26 | 20 | 3 | 3 |
| `time` | Time and clocks | 28 | 17 | 6 | 5 |
| `money` | Money | 27 | 18 | 4 | 5 |
| `pirates` | Pirates | 28 | 22 | 2 | 4 |
| `monsters` | Monsters | 27 | 21 | 2 | 4 |
| `robots` | Robots | 28 | 21 | 3 | 4 |
| `church` | The Bible and church | 31 | 22 | 3 | 6 |

## Guidelines for adding jokes

- **Keep them clean.** Nothing crude, mean, sexual or violent. Keep bathroom humor out too. There are no insults about groups, bodies, disabilities, religions or nationalities, and nothing about drinking or drugs.
- **Keep politics nonpartisan.** Joke about politics in general, such as meetings, speeches, votes, taxes or "a politician" as a generic type. Don't name real politicians, parties or ideologies.
- **Keep show business gentle.** Joke about the fame life, movies and awards. Prefer "a famous actor" to a real name, and never mock a living person or their private life.
- **Geography should never mock a nationality or culture.** Puns on place names are great.
- **Bible and church jokes stay reverent.** Use clean, well-known church puns suitable for a Christian family, and never mock faith.
- **Aim for a groan, not a wince.** Corny puns and dad jokes are the point, and punchlines should land when heard, not just when read. Vary the shapes between Q&A, one-liners and knock-knocks.
- **No duplicates.** That includes near-duplicates with the same punchline in different words, and the tests check exact repeats of a setup or punchline. Classic clean folk jokes are fine alongside originals.
- **Knock-knocks follow this pattern:** "Knock knock." / "Who's there?" / "<setup>." / "<setup> who?" / "<punchline>". Store only the setup word or name and the payoff line.
- **Minimums:** every category keeps at least 25 jokes, the catalogue keeps at least 600 jokes, and at least 120 of them are knock-knocks.
- **Run the tests after any edit.** They check ids, empty fields, minimums, duplicates, a small banned-word list, the knock-knock shape and that `pick` doesn't repeat.
