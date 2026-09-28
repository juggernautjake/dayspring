// Email, for the no-AI intent catalogue (catalog.mjs), in its template language: (a|b) one of, [x] optional, {text} free
// words. Every one plans { do: "mail", id, text } and the runner hands the words to lib/mail/skills.mjs (which also answers
// these directly, before anything else, when it's sure). The optional 5th item boosts the score when the words clearly mean it.
const MAILWORD = /\b(e-?mails?|inbox|gmail|outlook|yahoo mail)\b/;
export const MAIL_INTENTS = [
  ["mail.new", "Check your email", "read my new emails", [
    "(read|check) my [new|unread|latest] (emails|email|mail|inbox)", "(any|do i have any) (new|unread) (emails|email)", "check my (email|inbox|gmail|outlook)", "what is new in my (email|inbox)", "read me my (emails|email)",
  ], (c) => (MAILWORD.test(c.q) && !/\bremind\b/.test(c.q) ? 1.3 : 1)],
  ["mail.from", "Check for emails from someone", "any emails from sam", ["(any|are there any) (emails|email|messages) from {text}", "did {text} (email|write to) me", "(emails|email) from {text}"], (c) => (/\b(e-?mails?)\b/.test(c.q) && /\bfrom\b/.test(c.q) ? 1.3 : 1)],
  ["mail.read", "Read an email", "read the one from the bank", ["read the (one|email|message) (from|about) {text}", "read the (first|second|third|last|latest) (one|email)", "read that email"], (c) => (/\bread\b/.test(c.q) && /\b(one|e-?mail)\b/.test(c.q) ? 1.2 : 1)],
  ["mail.summary", "Summarize your inbox", "summarize my inbox", ["(summarize|summarise|sum up) my (inbox|email|emails)", "(give me a summary of|what is in) my inbox"], (c) => (MAILWORD.test(c.q) ? 1.3 : 1)],
  ["mail.open", "Open the Mail window", "open my email", ["(open|show) my (email|inbox|mail)", "(open|show) the mail (window|app)"], (c) => (/\b(email|inbox|mail)\b/.test(c.q) && /\b(open|show)\b/.test(c.q) ? 1.25 : 1)],
  ["mail.write", "Write an email", "write an email to sam", ["(write|compose|draft|start) (an|a new) (email|e-mail) to {text}", "email {text} (saying|about) {text}", "(write|send) an email"], (c) => (/\b(e-?mail)\b/.test(c.q) && /\b(write|compose|draft)\b/.test(c.q) ? 1.3 : 1)],
  ["mail.undo", "Undo sending an email", "undo send", ["undo send", "(unsend|cancel sending) (it|that|the email)", "(do not|don't) send (it|that email)"], (c) => (/\bsend\b/.test(c.q) && /\b(undo|unsend|cancel|don'?t|do not)\b/.test(c.q) ? 1.35 : 1)],
];
