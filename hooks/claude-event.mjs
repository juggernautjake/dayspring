// Claude Code hook: tells Dayspring when a Claude Code session finishes a task (Stop) or is
// waiting for the owner (Notification), so the Dayspring screen can say so. Installed in ~/.claude/settings.json.
// It never blocks or fails a Claude session: any problem is ignored and it exits 0.
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => { raw += d; });
process.stdin.on("end", async () => {
  try {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 1500);
    await fetch("http://127.0.0.1:4747/api/claude-event", {
      method: "POST", headers: { "content-type": "application/json" }, body: raw || "{}", signal: ctl.signal,
    });
  } catch { /* Dayspring isn't running: nothing to do */ }
  process.exit(0);
});
setTimeout(() => process.exit(0), 3000);
