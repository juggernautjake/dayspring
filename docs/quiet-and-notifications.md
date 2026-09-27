# Compact mode, quiet mode and notifications

Dayspring can be small, quiet or completely off, and you choose how each kind of notification reaches you.

- **Compact mode (Dayspring mini)**: a small window for a corner of your desktop. See [Display setup → Dayspring mini](display-setup.md#dayspring-mini-compact-mode).
- **Active, Quiet or Off**: one click to stop Dayspring listening and talking.
- **Notification modes**: speak, chime or silent, for each kind of notification.
- **Desktop notifications**: small cards in front of every window, even when Dayspring's screen is closed.

## Active, Quiet or Off

The coloured badge on the Dayspring screen (top of the talk panel, and in Dayspring mini) shows what Dayspring is doing. Click it to change it:

| | Listening | Speaking | Notifications |
|---|---|---|---|
| **Active** (green) | Listens for "Dayspring". | Yes. | As you set them below. |
| **Quiet** (amber) | Still hears "Dayspring". | No: answers and notifications show on screen. | On screen only. Alarms still ring. |
| **Off** (red) | Not at all. The microphone is released (Windows' mic icon goes away) and Tune in pauses. | No. | Desktop cards only. Alarms still ring (unless you turn that off). |

Your schedule, reminders and alarms keep going in every state, and the choice is kept when Dayspring restarts.

**Other ways to switch:**

- **Ctrl+Alt+Shift+D** anywhere in Windows turns Dayspring off, and on again.
- Say "Dayspring, go quiet", "turn off listening" or "stop listening". Type "turn back on" or "start listening" (Dayspring isn't listening when it's off, so type it or click the badge).
- Settings → **Notifications** → **Dayspring is**.

**Alarms still ring when Off** (Settings → **Notifications**) is on unless you turn it off: your wake-up alarm and alarm reminders ring even when Dayspring is off.

## Stop listening: ✋ and 🎤

- **✋ Stop** stops Dayspring talking. Press it again (or hold it) and Dayspring stops listening too.
- **🎤** stops listening straight away. It stays stopped, even after reloading the screen, until you tap 🎤 again or type "start listening". While it's stopped, the microphone is fully released: nothing is heard, not even "Dayspring".

## Your requests come first

When you start talking to Dayspring (saying "Dayspring", pressing **🎙 Talk**, typing on its screen, or sending a message from the desk panel, Discord, a text or a phone call), anything Dayspring was about to say on its own waits. That includes reminders, check-ins, "Who's in this picture?", joke offers, "Incoming text… want me to read it?", badges and update notes. Dayspring waits until your request is fully done:

- its answer has been said,
- any follow-up is finished (it asked you something and you answered, you confirmed or cancelled a change, or the answer window closed),
- and about 4 seconds have passed without you saying anything new.

Then the waiting items come out one at a time, most important first (reminders before questions, questions before jokes), with a short pause between them. If you start talking again, the rest waits again. Nothing is skipped. Anything that has gone out of date is re-worded or dropped: "leave in 10 minutes" becomes "leave at 3:15 p.m.", a late reminder says when it was due, a block that has already ended isn't announced, and a joke offer is dropped after 30 minutes.

If Dayspring had just started (its chime was playing, or it had said only its first word) when you spoke, it stops and says that thing after your request instead. It only asks one question of its own at a time, and never while you're talking.

While something is waiting, a small sign next to the status shows **1 thing to tell you after this**. Tap the sign, or ask **"what were you going to say?"**, to hear it straight away.

Some things don't wait:

- **Alarms and timers** ring on time, with their sound and their banner. Only their spoken words wait for Dayspring to finish answering you, and never more than about 20 seconds.
- **Emergencies**: an official Extreme weather alert (a tornado warning, for example) interrupts right away.
- **Things you asked for**: your answer, a timer you just set, music you asked for, and "What's now?".

Quiet, Off, ✋ Stop, 🎤 (stop listening), meetings and calls work the same as before.

## How each kind of notification arrives

Settings → **Notifications** → **How each kind arrives** has a choice for each kind:

| Kind | What it covers |
|---|---|
| **Reminders** | Your reminders and snoozed reminders. |
| **Schedule** | Start times, changes to your day and check-ins. |
| **Texts and phone** | Texts and calls from your phone. |
| **Lantern** | Course invitations, friend requests and lesson reminders. |
| **Discover** | New videos and articles about your interests. |
| **Updates, alerts and system** | New versions, problems, and notes from Dayspring itself. |

Each can be **Usual** (your normal voice setting), **Speak**, **Chime only** or **Silent** (shown on screen with no sound). **Quick switch for everything** overrides them all at once ("Everything silent" for a meeting, say), and **Use the settings above** puts them back. The same quick switch is in the badge's menu on the Dayspring screen.

By voice: "make texts silent", "chime only for Discover", "everything silent", "notifications back to normal".

## Desktop notifications

Dayspring shows small cards at the top-right of your screen, in front of every window (even full-screen apps and games). They never take the keyboard or mouse away from what you're doing, and they go away by themselves.

- **Click a card** to open Dayspring at that item. **Snooze** puts it off for your usual snooze time; **✕** closes the card.
- **No doubles**: while the Dayspring window itself is in front, the cards are skipped (you already see it there).
- **Quiet and Off**: cards still show in Quiet. In Off they show unless you untick **Show them when Dayspring is off**.
- **Settings → Notifications → Desktop notifications**: turn them on or off, choose how long they stay (3 to 30 seconds) and which screen they show on, and press **Show a test notification**.

The cards are shown by a small program called **Dayspring Notifications**, which Dayspring builds on your computer the first time, from parts that come with Windows. On a computer where it can't be built, Dayspring falls back to its usual on-screen cards and says so in Settings.

## When the Dayspring screen is closed

Closing the Dayspring screen doesn't stop Dayspring: it keeps running in the background, and reminders and texts still arrive as desktop cards.

**Alarms with the screen closed.** From 1.2.1 the alarm still rings. A larger card appears at the top-right of your screen, in front of every window (full-screen apps too), and the alarm sound plays on a loop, starting at a quarter of your alarm volume and rising to the full level over about 30 seconds. The card has:

- **Snooze 9 min**: it comes back in nine minutes, like the Snooze on the Dayspring screen.
- **Dismiss**: the alarm stops.
- **Open Dayspring**: opens the Dayspring screen (the alarm stops ringing on the card).

Answering the alarm anywhere else (on a Dayspring screen, or by saying "I'm up") stops the card too. If nobody answers, it stops by itself after 30 minutes. Dayspring's window is never reopened for an alarm.

The sound plays on your computer's **default** speakers, at the level set in Settings → Sound → **Alarm** (never below 20). It appears as "Dayspring Notifications" in the Windows volume mixer. If you chose a different output for Dayspring in Settings → Sound, that applies to the Dayspring screen; the closed-screen alarm uses the default speakers, so make sure they're on if you rely on the alarm.

**Other notifications with the screen closed:** **Chime** chimes, **Silent** stays silent, and **Speak** chimes instead, unless you turn on Settings → **Notifications** → **Speak announcements even when the screen is closed**, which reads them in Windows' own voice. When a Dayspring screen is open (full, mini or a tab), it plays everything itself and the desktop cards stay silent, so nothing sounds twice.

If Dayspring is **Off** and **Alarms still ring when Off** is off, the alarm only shows a card.

## Related

- [Display setup](display-setup.md): how Dayspring opens, Dayspring mini, the window bar.
- [Settings reference](settings-reference.md#notifications)
- [Talking to Dayspring](talking-to-dayspring.md)
