# Dayspring on more than one computer

Run Dayspring on several computers, such as the TV at home, your laptop and the office PC, and sign in on each with the same account. Then any of them can ask the others for things over the internet:

- "Turn on my computer at home."
- "On my office PC, turn on fan 2."
- "How's printer 3 doing?" or "Show me printer 1's camera."
- "Tell the living room TV dinner's ready."
- "Which of my Dayspring devices are online?"

You don't need to change any router settings or open ports.

> **Still being built.** This is in the development version of Dayspring only. If you don't see **Settings → Devices & sign-in**, your version doesn't have it yet.

## What you need

- **Dayspring on each computer.** Each one must be able to reach the internet.
- **Your Lantern account** (the same email and password, or an emailed sign-in link). Dayspring uses the account you already have and never creates one. If Dayspring doesn't know your account's hub yet, add it first in **Settings → Lantern → Your Lantern hub**.

## The first computer

1. Open **Settings → Devices & sign-in**.
2. Type a name for this computer, for example *Living room TV*.
3. Enter your email and password and press **Sign in**. You can press **Email me a sign-in link** instead; open the email **on this computer** and press its link.

The first computer you sign in on is approved straight away. Choose it well: it's usually the one at home that's always on.

## Adding another computer

A new computer only joins after you approve it on one you already have. You check that by comparing a code on both screens, so someone who only knows your password can't add a computer of their own.

1. **On the new computer**, open **Settings → Devices & sign-in**, give it a name (for example *Laptop*) and sign in with the same account. It says **Waiting for approval**.
2. **On a computer you already have**, open **Settings → Devices & sign-in**. Under **Asking to join** you'll see the new one. Press **Review**. A 6-digit code appears. (Dayspring also says out loud that a new device is asking.)
3. **On the new computer**, the same code appears. If both screens show the same code, press **The codes match**.
4. **Back on the first computer**, choose what the new one may do (see below) and press **Approve**.

If the codes are different, press **They don't match** (or **The codes don't match**). The request is cancelled and a new one starts. A request lasts 10 minutes.

## What each computer may do

Under **Your devices**, open a device to choose what it may ask your other computers to do:

- **View status** (online, what's running, printer progress)
- **See the schedule** and recent notifications
- **Say things and set reminders** on the other devices
- **Control smart devices** (outlets, computers, fans)
- **See cameras** (printer cameras and home cameras)
- **Start 3D prints** (off unless you turn it on)

Press **Save what it may do**. You can change this from any of your approved computers, but a computer can't change its own permissions.

There's also a switch for **this** computer: **Let my other devices ask this one to do things**. Turn it off and it refuses every request from the others.

## Things that need your OK

Some commands can't be undone, or aren't safe to do by accident: switching a computer or a heater on or off, unlocking, shutting down, and starting a print. For these, the computer you're talking to asks you first ("That will turn on my computer through Living room TV. Are you sure?"). Say **yes** to that computer, on its screen or at its desk. A yes from someone on a call doesn't count. The other computer also applies its own safety rules and writes everything in its **activity log**.

## Cameras

"Show me printer 1's camera" or "show the front door camera" opens a picture from the computer that has that camera. Press **New picture** for another, or **Live** for a new picture every few seconds. Live pauses by itself after two minutes, to save your internet data.

Camera alerts (like motion at the front door) can also be sent to your other computers, with the picture.

## When a computer is off or offline

- If the computer you ask is offline, Dayspring tells you when it was last seen, and doesn't send anything.
- If it's online but doesn't answer within 20 seconds, Dayspring tells you. The request expires within a minute, so it won't suddenly happen later. Dayspring never keeps retrying.
- Announcements and alerts can wait up to 5 minutes for a computer to pick them up. After that, they're gone.
- With no internet at all, everything on the computer in front of you still works as usual. Only asking your *other* computers has to wait.

## Rename, sign out, remove

- **Rename:** open the device and press **Rename**.
- **Sign it out remotely:** open the device and press **Sign it out remotely**. Its sign-in ends straight away, it deletes its own keys the next time it's online, and your other computers refuse it from then on. Use this if a laptop is lost or stolen.
- **Sign out on this computer:** the button at the bottom. To add it back later, sign in again and approve it again.
- A signed-out device stays in the list, marked **Signed out**, until you press **Remove from the list**.

## Is it private?

Every request is **signed** by the computer that sends it and **encrypted** so that only the computer it's for can read it. The hub in between (the same one Lantern uses) passes the messages along but can't read or change them, and can't pretend to be one of your computers. Messages are deleted as soon as they're picked up, and after 5 minutes at the latest. Each computer's keys are stored encrypted for your Windows account only. Your password isn't kept on any computer.

The people who look after Dayspring wrote up how this works and what it protects against in [Remote control: security](dev/remote-security.md).

## Troubleshooting

- **"Dayspring doesn't know your account's hub yet":** add it in **Settings → Lantern → Your Lantern hub**.
- **The new computer keeps saying "Waiting for approval":** open **Settings → Devices & sign-in** on a computer you already have and press **Review**. If nothing is listed there, the request may have expired; the new computer starts a new one by itself.
- **"Another device already answered this request":** turn it down, and start again on the new computer. If you didn't do it, someone else may know your password: change it, and look for devices you don't recognise.
- **A device shows "Keys changed (ignored)":** something changed its keys on the hub. It's ignored until you sign it out and add it again.
