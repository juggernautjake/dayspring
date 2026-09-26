// Manage the Dayspring phone number on the Twilio account.
//   node scripts/twilio-number.mjs list              numbers on the account + their webhooks
//   node scripts/twilio-number.mjs search [AREA]     available local numbers (default area code 254)
//   node scripts/twilio-number.mjs buy +1XXXXXXXXXX  buy one and write it to .env as DAYSPRING_TWILIO_NUMBER
//   node scripts/twilio-number.mjs point URL         point the number's webhooks at a public URL
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as tw from "../lib/twilio.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ENV = join(here, "..", ".env");
const [cmd, arg] = process.argv.slice(2);

try {
  if (!tw.twilioReady().creds) throw new Error("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN missing in .env (run with --env-file-if-exists=.env)");
  if (cmd === "list") {
    const n = await tw.listNumbers();
    console.log(n.length ? n.map((x) => `${x.number}  "${x.name}"\n  voice: ${x.voiceUrl || "(none)"}\n  sms:   ${x.smsUrl || "(none)"}`).join("\n") : "No phone numbers on this account yet. Run: search");
  } else if (cmd === "search") {
    const n = await tw.searchNumbers(arg || "254");
    console.log(n.length ? n.map((x) => `${x.number}  ${x.locality ?? ""}, ${x.region ?? ""}`).join("\n") : "Nothing available in that area code. Try another, e.g. search 512");
  } else if (cmd === "buy") {
    if (!/^\+1\d{10}$/.test(arg ?? "")) throw new Error("give the number in E.164, e.g. buy +1XXXXXXXXXX (your country code and number)");
    const r = await tw.buyNumber(arg);
    let env = readFileSync(ENV, "utf8");
    env = /^DAYSPRING_TWILIO_NUMBER=.*$/m.test(env) ? env.replace(/^DAYSPRING_TWILIO_NUMBER=.*$/m, `DAYSPRING_TWILIO_NUMBER=${r.number}`) : env + `\nDAYSPRING_TWILIO_NUMBER=${r.number}\n`;
    writeFileSync(ENV, env);
    console.log(`Bought ${r.number} and saved it to .env. Now run: npm run voice`);
  } else if (cmd === "point") {
    if (!/^https:\/\//.test(arg ?? "")) throw new Error("give a public https URL");
    const r = await tw.pointWebhooks(arg.replace(/\/$/, ""));
    console.log(`${r.number}\n  voice → ${r.voice}\n  sms   → ${r.sms}\nSet PUBLIC_URL=${arg} in .env so signatures validate.`);
  } else {
    console.log("usage: list | search [AREA] | buy +1XXXXXXXXXX | point https://...");
  }
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
}
