// A live check of meeting course answers with the real AI (keys from .env; never printed). No meeting is joined.
//   node --env-file=.env scripts/qa/meet-live.mjs [bank.json] [how many, default 3] [--as lantern]
// Prints each question's spoken answer, where it's covered, the chat detail and the lesson links.
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { readFileSync, existsSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const as = process.argv.includes("--as") ? process.argv[process.argv.indexOf("--as") + 1] : "lantern";
const bankFile = args[0] && args[0].endsWith(".json") ? args[0] : join(here, "private", "meet-bank.json");
const count = Number(args.find((a) => /^\d+$/.test(a)) ?? 3);
if (!existsSync(bankFile)) { console.log("meet-live: no question bank here (it's private); skipped"); process.exit(0); }
// the course's public lesson link comes from the real settings (read only), used in a scratch copy
const real = join(here, "..", "..", "data", "meet.json");
const tmp = mkdtempSync(join(tmpdir(), "ds-meet-live-"));
process.env.DAYSPRING_MEET_FILE = join(tmp, "meet.json");
const settings = await import("../../lib/meet/settings.mjs");
if (existsSync(real)) settings.set(JSON.parse(readFileSync(real, "utf8")));
const llm = await import("../../lib/llm.mjs");
if (!llm.ready()) { console.log("meet-live: no AI key set up; skipped"); process.exit(0); }
const ca = await import("../../lib/meet/course-answer.mjs");
ca.setDeps({ lanternCall: async () => ({ ok: false, status: 0 }) });
const bank = JSON.parse(readFileSync(bankFile, "utf8"));
const picks = bank.live?.length ? bank.live.slice(0, count) : bank.questions.slice(0, count);
for (const { q, expect } of picks) {
  const t0 = Date.now(); let first = null;
  const { hits } = await ca.retrieve(q, { course: bank.course });
  const a = await ca.answer({ question: q, course: bank.course, hits, as, onSpoken: () => { first ??= Date.now() - t0; } });
  console.log(`\n=== ${q}`);
  console.log(`(${a.offline ? "no AI" : a.model}; spoken part ready in ${first ?? "?"} ms, whole answer ${Date.now() - t0} ms; expected ${expect?.join("/") ?? "?"}, cited ${a.citations.map((c) => c.lessonId).join(", ")})`);
  console.log(`SPOKEN: ${a.spoken} ${ca.whereSpoken(a.citations)}`);
  console.log(`CHAT:\n${a.detail}\n${ca.whereChat(a.citations)}`);
}
