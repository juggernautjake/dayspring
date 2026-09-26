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
