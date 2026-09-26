// "Update Dayspring.cmd": checks GitHub for a newer Dayspring and installs it. Your data and keys are never touched.
// If the Dayspring server is running, it asks the server to do the update (so it restarts cleanly); otherwise it
// updates the files directly and you start Dayspring again afterwards.
import * as updater from "../lib/updater.mjs";

const PORT = process.env.PORT || 4747;
const ask = process.argv.includes("--yes") ? null : async (q) => {
  process.stdout.write(q + " [y/N] ");
  const a = await new Promise((r) => process.stdin.once("data", (d) => r(String(d).trim().toLowerCase())));
  process.stdin.pause();
  return a === "y" || a === "yes";
};

try {
  console.log(`Dayspring ${updater.version()}`);
  const info = await updater.check();
  if (info.off) { console.log(info.message); process.exit(0); }
  if (!info.available) { console.log(`You're up to date (${info.current}).`); process.exit(0); }
  console.log(`\nDayspring ${info.latest} is available.${info.notes ? "\n\nWhat's new:\n" + info.notes : ""}\n`);
  if (ask && !(await ask("Install it now?"))) { console.log("Okay, not now."); process.exit(0); }
  let running = false;
  try { running = (await fetch(`http://127.0.0.1:${PORT}/api/build`, { signal: AbortSignal.timeout(2000) })).ok; } catch { /* not running */ }
  if (running) {
    console.log("Dayspring is running; asking it to update itself…");
    const r = await fetch(`http://127.0.0.1:${PORT}/api/update/apply`, { method: "POST" });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? `the server answered ${r.status}`);
    console.log(j.message ?? "Updated. Dayspring is restarting.");
  } else {
    const r = await updater.apply({ restart: () => {} });
    console.log(r.updated ? `Updated from ${r.from} to ${r.to}. Your old version is saved in ${r.backup}.\nStart Dayspring again with "Start Dayspring.cmd".` : r.message);
    setTimeout(() => process.exit(0), 2000);
  }
} catch (e) {
  console.error("Update failed: " + e.message);
  process.exit(1);
}
