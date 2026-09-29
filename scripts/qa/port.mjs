// A port for a QA script's throwaway server, so two checks (or two people) running at once never collide.
//   const PORT = await qaPort(4771);            QA_PORT=4900 node scripts/qa/overlay-fit.mjs  → 4900
//   const MOCK = await qaPort(4797, { env: null });   a second server in the same script (never the same port twice)
// The order: the QA_PORT environment variable (the first call in a script only; later calls get their own), the
// script's usual port when it's free, otherwise any free port the system hands out. The owner's Dayspring (4747) is
// never handed out.
import { createServer } from "node:net";

const given = new Set();
let envUsed = false;
const OWNER = 4747;

export const isFree = (p) => new Promise((ok) => {
  const s = createServer();
  s.once("error", () => ok(false));
  s.once("listening", () => s.close(() => ok(true)));
  s.listen(p, "127.0.0.1");
});
const anyFree = () => new Promise((ok, no) => {
  const s = createServer();
  s.once("error", no);
  s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); });
});

export async function qaPort(preferred, { env = "QA_PORT" } = {}) {
  const fromEnv = env && !envUsed ? Number(process.env[env]) : 0;
  if (fromEnv > 0 && fromEnv < 65536 && fromEnv !== OWNER) { envUsed = true; given.add(fromEnv); return fromEnv; }
  if (preferred && preferred !== OWNER && !given.has(preferred) && await isFree(preferred)) { given.add(preferred); return preferred; }
  for (let i = 0; i < 20; i++) { const p = await anyFree(); if (p !== OWNER && !given.has(p)) { given.add(p); return p; } }
  throw new Error("no free port for the test server");
}
