# Dayspring and Lantern

**Lantern** is a free learning app from the same family as Dayspring. It holds courses, grades your exercises, and works offline. You don't need it to use Dayspring. If both are on your computer, they work together like one app.

## What works together

- **Your courses on the Dayspring screen.** Lantern's courses show next to Dayspring's study rings, with a small amber **Lantern** tag. Each one shows how far you are (for example *13 of 109 steps · 7 of 54 lessons*) and your next lesson. Click one and Lantern opens right at that lesson.
- **Ask Dayspring about your studies:**
  - "What's my next lesson?"
  - "How far am I in Python?"
  - "What courses do I have?"
  - "Open Python." / "Open Lantern."
  - "Remind me to study Python at 7." This puts a study block on your schedule. When it starts, Lantern offers to open the lesson.
  - "I finished lesson 3." Lantern checks its own record and tells you what's next.
- **Invitations and friend requests.** When someone sends you a course or a friend request on Lantern, Dayspring says so out loud and shows a card with the Lantern tag:
  - a course: **Accept**, **Decline** or **Open Lantern** (or **Install Lantern** if you don't have it yet)
  - a friend request: **Accept**, **Decline** or **Ignore** (Ignore keeps it for later)
  - You can also just answer out loud: "yes", "no", or "later".
- **Sending courses (the hub's owner):** "Send the Python course to Sam." Dayspring finds Sam among your Lantern people, asks you to confirm, and sends it. "Add Sam as a friend" or "send a friend request to LNT-7K3Q" work too, and "who are my Lantern friends?" tells you who's online and what they're studying.
- **Celebrations and reminders.** Finish a unit and Dayspring congratulates you. Lantern's study reminders show up as Dayspring reminders, so **Snooze** works on them.
- **"Add study time to Dayspring"** in Lantern puts a repeating study block on your Dayspring schedule.

## One voice, one ear

The two apps never talk over each other:
- Each app has its own voice: Dayspring's is warm and female, Lantern's is warm and male.
- When one is speaking, the other waits its turn. An alarm always goes first, and Lantern goes quiet for it.
- Lantern stays quiet during your quiet time (silent mode) and during calls.

Only one app listens for its name at a time. **Dayspring listens while it's running.** To let Lantern listen instead, say "Dayspring, let Lantern listen" (or use **Settings → Lantern**). Say "take the mic back" to return it. If no Dayspring screen is open and Tune in is off, Lantern listens by itself until a screen opens again.

## Installing Lantern from Dayspring

Say **"install Lantern"**, or press **Install Lantern** on an invitation or in **Settings → Lantern**. Dayspring:
1. Tells you where it will go (normally `%LOCALAPPDATA%\Programs\Lantern`) and waits for your OK.
2. Downloads Lantern from its GitHub releases page and unpacks it. Nothing is run from the download itself.
3. Runs Lantern's installer quietly, with no black window, and shows the progress on screen.
4. Opens Lantern, already signed in if you connected Dayspring to Lantern first.

If Lantern needs **Node.js** and it's missing, Dayspring asks before installing it. If it can't install it by itself, it opens nodejs.org for you. Something went wrong? Press **Show me the steps** to install Lantern by hand.

## Connecting before Lantern is installed

Someone invited you? Go to **Settings → Lantern** and use whichever is easiest:
- **I already have Lantern on this computer**: Dayspring uses Lantern's own sign-in (it opens Lantern if it isn't running). Nothing else to type.
- **Email and password**: type your email and a password, then **Sign in**, or **Create an account** if you don't have one yet. Use the email you were invited with, so the invitation finds you. The password is only used to sign in; Dayspring never saves it.
- **Email me a sign-in link**: no password needed. Open the email **on this computer** and press its link; a Dayspring page opens, says "Connected", and goes back to Settings. The link works once. (Some hubs also put a 6-digit code in that email; then you can type the code instead.)

If Dayspring asks for **Your Lantern hub**, paste the hub address and its **public** key from the person who invited you (never a secret key). Copies of Dayspring from the owner's download usually know the hub already.

Dayspring then checks for invitations and friend requests every minute or so and tells you about them. When Lantern is installed, Dayspring hands your sign-in over to it once, so you don't sign in twice, and from then on Lantern looks after your account. The sign-in is kept in Dayspring's `data` folder, never in `.env`.

## The AI key

Set up your AI once and use it in both apps. In **Settings → Lantern**:
- **Use Dayspring's AI key in Lantern** saves it for Lantern too. Lantern still asks you before it uses it.
- **Use the AI key from Lantern** does the reverse.

The key is stored encrypted for your Windows account only. It's never sent between the apps, never logged, and never uploaded.

## Privacy and safety

- The two apps only talk to each other on your own computer (127.0.0.1). Websites can't reach them.
- Anything that changes something needs a secret token that only your Windows account can read, and it's new every time the app starts.
- Everything is optional. Without Lantern, nothing here shows at all.

## Related

[Talking to Dayspring](talking-to-dayspring.md) · [Settings](settings-reference.md) · [FAQ](faq.md) · [Learning and study](learning.md)
