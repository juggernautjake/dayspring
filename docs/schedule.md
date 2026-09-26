# Your schedule

Dayspring's schedule is made of **blocks**: "Work 9–5", "Gym 6–7 pm", "Dentist Friday at 2". You can manage it three ways, and they all stay in sync:

- **By voice or typing**: "add haircut Saturday at 10" (see [Talking to Dayspring](talking-to-dayspring.md#your-schedule))
- **In the Schedule app**: click and edit, like a normal calendar
- **In the carousel**: the Dayspring screen shows your day, week, month and more in turn

## The Schedule app

![The week view](images/schedule-week.png)

Open it any of these ways:

- Click the 📅 button by the clock on the Dayspring screen.
- Say "open my schedule", "show me my schedule for Saturday" or "show me next week".
- Click a day or week slide in the carousel.
- Go to `http://localhost:4747/calendar.html` in any browser on the computer.

### Views

| View | Shows | Keyboard |
|---|---|---|
| **Day** | One day, hour by hour | **D** |
| **Week** | Seven days side by side | **W** |
| **Month** | The whole month, with important items highlighted | **M** |
| **Year** | Twelve months, plus a list of major items | **Y** |

Use **‹** and **›** (or the arrow keys) to move back and forward, and **Today** to jump back. Click a day's heading to open that day.

Short items show their time next to the title, so nothing gets cut off.

### Adding

1. Click **+ Add** (or press **N**), or click an empty time slot.
2. Fill in the **title**, **date**, **start** and **end**.
3. Pick a **category**: faith, home, body, work, study, rest, meal or flex. The colour follows the category.
4. Pick an **importance**: normal, notable, important or major.
5. Click **Save**.

### Editing and deleting

- Click any block to open the editor. Change anything and click **Save**.
- To delete, click **Delete**, then click **Tap again to delete** within a few seconds. The second click is there to stop accidents.
- Repeating items show **↻**. When you open one, choose **Just this day** (the default) or **Every time** before you change it. With **Every time**, **Delete** becomes **Delete this and all after**. Earlier days stay as history.

Press **Esc** or click **✕** to close the Schedule app. **↗ Laptop** opens the same view in a normal browser window on your main screen.

## Importance

| Level | Where it stands out |
|---|---|
| Normal | Nowhere special |
| Notable | A subtle marker |
| Important ★ | Highlighted in the week view |
| Major ★★ | Highlighted in the week, month **and** year views, with a suggested night-before reminder |

When you add something that sounds important (meetings, appointments, interviews, exams, trips, weddings, deadlines…), Dayspring asks how important it is. You can change it any time: "make the dentist major".

## Repeating items

Anything can repeat. In the editor, pick an option under **Repeats**. The choices follow the item's date:

| Option | Example |
|---|---|
| Every day / Every other day | Water the plants |
| Every weekday (Mon–Fri) / Weekends | Team standup |
| Weekly on … / Every other week on … | Pick the days: tap S M T W T F S |
| Monthly on the 15th / on the second Tuesday / on the last Friday | Pay rent, book club |
| Every year on … | An anniversary |
| Custom… | Every *N* days, weeks, months or years, on the days you pick |

**Repeat until** is optional. Leave it empty to repeat forever. To make something you already added repeat, open it, pick a **Repeats** option and **Save**.

Or just say it (works without an AI brain too):

- "add water the plants every other day at 5pm"
- "add standup on weekdays at 9am"
- "add soccer practice every monday and wednesday at 7pm"
- "add trash day every other week on friday at 8am"
- "add pay rent on the 1st of every month at 10am"
- "add book club the first monday of every month at 7pm"
- "add run every day at 6am until december 1"

With an AI brain you can also say:

- "make my Tuesday lunch with Sam repeat every week"
- "move gym to 6 every time"
- "stop repeating piano after this week"
- "delete soccer practice from next Monday on"

## Routine and fixed blocks

- Your **routine** is your usual week: work, meals, sleep and regular commitments. Set it up in Settings → Your week, or tell Dayspring: "every weekday I work 9 to 5".
- **Fixed** blocks never move when Dayspring reshuffles your day. These are things like work and worship. Everything else is flexible.
- When something new has to fit, Dayspring suggests moving flexible blocks and asks before it moves anything: "I can move reading to 8 pm. Want me to do that?"

## Live updates

Changes show up everywhere right away. If you ask Dayspring to move something while the Schedule app is open, the app jumps to that day, shows the change, and says **"Updated by Dayspring"**.

> **If it doesn't work:**
> - **A block I added isn't there**: check the date at the top of the Schedule app. "Saturday" means the *coming* Saturday. Say "show me my schedule for Saturday" to jump there.
> - **"At 7" became 7 pm**: bare hours from 1 to 7 are treated as p.m. Say "7 am" to be exact.
> - **The editor won't save**: the end time must be after the start time. Items that cross midnight need two blocks.

## All your calendars in one place

If you use more than one calendar, the Schedule app shows them together with your Dayspring schedule. You don't have to move anything over. Connect them in **Settings → Apps** (see [Connecting apps](connections.md)):

| Source | Shows as | Can Dayspring change it? |
|---|---|---|
| **Dayspring** | Category colours, like always | Yes |
| **Google Calendar** (each calendar you have ticked in Google) | Its own colour and a **G** badge, or the calendar's name | Only after you say yes |
| **Outlook** | Outlook blue, with an **Outlook** badge | Only after you say yes |
| **Calendar subscriptions** (iCloud, school, team, holidays) | Its own colour and name | No. They're read-only. |
| **Microsoft To Do** and **Todoist** items with a due date | A ☐ chip in the all-day row (Todoist tasks with a time go in the time grid) | No. Tick them off in their app. |

- **The strip under the top bar** lists each source with its colour. Click one to **hide** it or show it again. Dayspring remembers this, so the TV and the laptop agree. Hidden calendars aren't checked for clashes.
- **All-day items** (holidays, birthdays, "out of office", tasks) sit in a row above the hours, not on top of your day.
- **Click an outside event** to open its card. It shows the title, time, place, calendar, whether you're invited, and a button to **Open in Google Calendar** (or Outlook, or Todoist). On the TV that button opens it in the computer's browser.
- **The same event on two calendars** (the dentist on both Google and Outlook, or on Google and in Dayspring) shows once, with **⧉**. Hover over it to see where else it is.
- **Time zones:** everything shows in your computer's time. An event set in another zone ("10 am New York time") is converted, and its card says which zone it was set in.
- **☰ Calendars** shows every source with how it's doing and when it last updated. Press **⟳ Refresh** to fetch them all again now. Outside calendars also refresh on their own every few minutes. If one has a problem, it shows **⚠** and a short reason, and the rest keep working.

### Put your Dayspring schedule on Google or Outlook (optional)

Want your Dayspring schedule on your phone's calendar app? In **☰ Calendars**, under **Put your Dayspring schedule on another calendar**, turn on Google Calendar or Outlook.

- It's **off until you turn it on**, separately for each account.
- It goes **one way**: the next two weeks of your Dayspring schedule are copied there and kept up to date every 15 minutes. Change things in Dayspring. Changes made to the copies are replaced.
- Nothing is copied twice. Copies have no reminders of their own, so your phone doesn't ping twice. Dayspring doesn't show its own copies back to you or count them as clashes.
- **Turning it off removes every copy it made.** Nothing else on that calendar is touched.

## Conflicts

Dayspring checks all your calendars for clashes:

- **Double-bookings:** two things at the same time, on any mix of calendars.
- **Too little travel time** (optional): two things in different places too close together. Turn it on in **☰ Calendars → Leave travel time between places** and pick the minutes (15 by default). Video calls (Zoom, Teams, Meet) never need travel time.
- **Busy all-day items:** something lands on a day marked busy, such as "Out of office". All-day items count only when they're marked busy. To mark one, open its card and turn on **Counts as busy**.

These are **not** clashes: tasks; hidden calendars; invitations you declined; the same event on two calendars; and a short item inside a long work, school or shift block (lunch during the workday). Anything under 10 minutes of overlap is shown as a light clash.

### Where you'll see them

- A **red outline and ⚠** on each item that clashes, in the day, week and month views.
- The **⚠ 2** button in the top bar: this week's clashes. Click it for the list, with **Today** and **This week** tabs.
- In the **morning rundown**: "One clash to sort out: at 3 pm, Study overlaps Team sync on Google."
- A **heads-up** on the Dayspring screen when a new clash appears. It comes at most once every half hour, only between 7 am and 9:30 pm, and follows your notification setting.

### Fixing them

Each clash lists fixes, best first. Tap one:

| Fix | What happens |
|---|---|
| **Shorten** | The Dayspring item gives up the part that clashes (when at least half of it is left). |
| **Move** | The Dayspring item moves to the nearest free slot: later that day if there's room, otherwise the next day with room. It keeps its length. |
| **Swap** | It trades places with another flexible Dayspring item that day, when both fit. |
| **Skip** | It's skipped for that day only. A repeating item carries on as usual. |
| **Move** (an outside event) | Moves your own Google or Outlook event to a free slot. **Asks first**, and tells anyone invited. |
| **Decline** (an invitation) | Declines it in Google or Outlook, and the organizer is told. **Asks first.** |
| **Keep both** | Leaves it, and stops flagging that clash. |

Dayspring changes happen right away and every screen updates. Anything that would change your Google or Outlook calendar shows **"… Should I go ahead?"** and waits for **Yes, do it**. Fixed commitments such as work and church are never moved or shortened. They can only be skipped, and that's listed last. Subscriptions are read-only, so a clash with one is fixed on the Dayspring side.

### By voice

- ⚡ "Do I have any conflicts this week?" · "Any conflicts tomorrow?"
- ⚡ "Fix my conflicts": Dayspring fixes what it can on its own schedule. If a clash can only be fixed on Google or Outlook, it asks first ("Decline Team sync on Google? Say yes or no.").
- ⚡ "What's clashing with my dentist appointment?"
- ⚡ "Move my study block around my meetings"

With an AI brain you can ask in your own words ("can you sort out Thursday?"). It uses the same fixes and asks the same way before changing an outside calendar.

## Snooze

Anything Dayspring alerts you about can come back later: the alarm, reminders, "time for …" and "time's up".

- **The alarm:** tap **💤 Snooze 9 min**. Hold the button (or right-click it) to pick 5, 9, 15 or 30 minutes instead.
- **Pop-ups:** tap **💤 5 min**, **10**, **15**, **30** or **1 hr** on a reminder or schedule pop-up.
- **By voice** (no AI needed): "snooze", "snooze for 15 minutes", "five more minutes" (while the alarm rings), "remind me again in 20 minutes", "what's snoozed?", "cancel the snooze".

A snoozed alarm rings again as the alarm; a snoozed reminder comes back as "Back again: …". Snoozes are saved, so they still go off if Dayspring restarts. Snoozing doesn't move anything on your schedule. To actually move an item, say "push my workout back 30 minutes".
