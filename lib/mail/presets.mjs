// Mail servers for the common providers (IMAP to read, SMTP to send), so the owner only types an address and an app
// password. Checked against each provider's own help pages (Sept 2026). "sentAuto": the provider files what's sent over
// SMTP in Sent by itself (so Dayspring doesn't add a second copy). "appPassword": the provider needs an app password
// (a normal password won't work) and "how" says where to make one.
export const PRESETS = {
  yahoo: { name: "Yahoo Mail", domains: ["yahoo.com", "ymail.com", "rocketmail.com", "yahoo.co.uk", "yahoo.ca"], imap: { host: "imap.mail.yahoo.com", port: 993, secure: true }, smtp: { host: "smtp.mail.yahoo.com", port: 465, secure: true }, appPassword: true, sentAuto: false,
    how: "Yahoo: open login.yahoo.com → Account info → Account security → Generate app password (or “Manage app passwords”). Name it Dayspring, press Generate, and copy the 16 letters.", link: "https://login.yahoo.com/account/security" },
  icloud: { name: "iCloud Mail", domains: ["icloud.com", "me.com", "mac.com"], imap: { host: "imap.mail.me.com", port: 993, secure: true }, smtp: { host: "smtp.mail.me.com", port: 587, secure: false }, appPassword: true, sentAuto: false, userIsLocalPart: false,
    how: "iCloud: two-factor authentication must be on. Open account.apple.com → Sign-In and Security → App-Specific Passwords → Generate. Name it Dayspring and copy the password (it looks like abcd-efgh-ijkl-mnop).", link: "https://account.apple.com/account/manage" },
  aol: { name: "AOL Mail", domains: ["aol.com", "aim.com"], imap: { host: "imap.aol.com", port: 993, secure: true }, smtp: { host: "smtp.aol.com", port: 465, secure: true }, appPassword: true, sentAuto: false,
    how: "AOL: open login.aol.com → Account info → Account security → Generate app password. Name it Dayspring and copy it.", link: "https://login.aol.com/account/security" },
  outlookcom: { name: "Outlook.com / Hotmail (by password)", domains: ["outlook.com", "hotmail.com", "live.com", "msn.com"], imap: { host: "outlook.office365.com", port: 993, secure: true }, smtp: { host: "smtp-mail.outlook.com", port: 587, secure: false }, appPassword: true, sentAuto: true,
    how: "Outlook.com: Microsoft now prefers its own sign-in (Settings → Apps → Outlook + Microsoft To Do). If your account allows app passwords: account.microsoft.com → Security → Advanced security options → App passwords → Create.", link: "https://account.microsoft.com/security" },
  zoho: { name: "Zoho Mail", domains: ["zoho.com", "zohomail.com"], imap: { host: "imap.zoho.com", port: 993, secure: true }, smtp: { host: "smtp.zoho.com", port: 465, secure: true }, appPassword: true, sentAuto: false,
    how: "Zoho: turn on IMAP in Zoho Mail → Settings → Mail Accounts → IMAP Access. Then accounts.zoho.com → Security → App Passwords → Generate New Password.", link: "https://accounts.zoho.com/home#security/app_password" },
  gmx: { name: "GMX", domains: ["gmx.com", "gmx.net", "gmx.de", "gmx.us"], imap: { host: "imap.gmx.com", port: 993, secure: true }, smtp: { host: "mail.gmx.com", port: 587, secure: false }, appPassword: false, sentAuto: false,
    how: "GMX: in GMX webmail open Settings → POP3 & IMAP → allow access. Use your GMX password (or an app password if you turned on two-factor).", link: "https://www.gmx.com" },
  fastmail: { name: "Fastmail", domains: ["fastmail.com", "fastmail.fm"], imap: { host: "imap.fastmail.com", port: 993, secure: true }, smtp: { host: "smtp.fastmail.com", port: 465, secure: true }, appPassword: true, sentAuto: true,
    how: "Fastmail: Settings → Privacy & Security → Manage app passwords → New app password, with IMAP and SMTP access.", link: "https://app.fastmail.com/settings/security/apppasswords" },
  other: { name: "Another provider (IMAP + SMTP)", domains: [], imap: { host: "", port: 993, secure: true }, smtp: { host: "", port: 465, secure: true }, appPassword: false, sentAuto: false,
    how: "Your provider's help pages list its IMAP and SMTP servers (search for “<provider> IMAP settings”). Many providers need an app password when two-step sign-in is on." },
};
export const PRESET_IDS = Object.keys(PRESETS);
// which preset an address belongs to (an address at yahoo.com → yahoo), or null
export function presetFor(email) {
  const d = String(email ?? "").toLowerCase().split("@")[1] ?? "";
  return PRESET_IDS.find((k) => PRESETS[k].domains.includes(d)) ?? null;
}
// "yahoo", "Yahoo Mail", "icloud.com" → the preset id
export function findPreset(want) {
  const w = String(want ?? "").toLowerCase().replace(/[^a-z0-9.]/g, "");
  if (!w) return null;
  return PRESET_IDS.find((k) => k === w || PRESETS[k].name.toLowerCase().replace(/[^a-z0-9.]/g, "").startsWith(w) || PRESETS[k].domains.includes(w)) ?? (w === "hotmail" || w === "outlook" ? "outlookcom" : w === "apple" || w === "me" ? "icloud" : null);
}
// public, for Settings: the list with the servers (no secrets here)
export const list = () => PRESET_IDS.map((id) => ({ id, name: PRESETS[id].name, imap: PRESETS[id].imap, smtp: PRESETS[id].smtp, appPassword: PRESETS[id].appPassword, how: PRESETS[id].how, link: PRESETS[id].link ?? null, domains: PRESETS[id].domains }));
