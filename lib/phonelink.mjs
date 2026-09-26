// Sending texts through Microsoft Phone Link (iPhone over Bluetooth).
// Not wired yet: Phone Link has to be paired with the owner's phone first, and the send step (typing into Phone Link's message
// box by UI automation) has to be built against the real window and tested. Until then send() says so honestly and the
// caller keeps the draft. Nothing is ever sent without their spoken yes (see messages.mjs).
export async function send(to, body) {
  return { sent: false, why: "your iPhone isn't connected through Phone Link yet." };
}
export function ready() { return false; }
