// A very small Chrome DevTools Protocol client over --remote-debugging-pipe (Chrome reads commands on its file
// descriptor 3 and answers on 4, each message JSON ending in a NUL byte). A pipe belongs only to the process that
// started the browser: no port is opened, so no other program or web page on the computer can drive it. When the pipe
// closes (Dayspring stops), Chrome closes too.
//   const c = attach(child)            child from spawn(exe, [...args, "--remote-debugging-pipe"], { stdio: [.., .., .., "pipe", "pipe"] })
//   await c.send(method, params, sessionId) · c.on(method, fn(params, sessionId)) · c.onClose(fn) · c.close()
export function attach(child, { timeout = 10_000 } = {}) {
  const out = child.stdio[3], inp = child.stdio[4];
  let id = 0, closed = false, buf = Buffer.alloc(0);
  const waiting = new Map(), handlers = new Map(), closers = [];
  const finish = () => {
    if (closed) return;
    closed = true;
    for (const { reject, timer } of waiting.values()) { clearTimeout(timer); reject(new Error("the browser closed")); }
    waiting.clear();
    for (const fn of closers) { try { fn(); } catch { /* a listener's problem */ } }
  };
  inp.on("data", (chunk) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    let at;
    while ((at = buf.indexOf(0)) >= 0) {
      const raw = buf.subarray(0, at).toString("utf8");
      buf = buf.subarray(at + 1);
      let m; try { m = JSON.parse(raw); } catch { continue; }
      if (m.id !== undefined) {
        const w = waiting.get(m.id);
        if (!w) continue;
        waiting.delete(m.id); clearTimeout(w.timer);
        if (m.error) w.reject(Object.assign(new Error(m.error.message ?? "CDP error"), { code: m.error.code })); else w.resolve(m.result ?? {});
      } else if (m.method) for (const fn of handlers.get(m.method) ?? []) { try { fn(m.params ?? {}, m.sessionId); } catch { /* a listener's problem */ } }
    }
  });
  for (const s of [inp, out]) { s.on("error", finish); s.on("close", finish); }
  child.on?.("exit", finish);
  return {
    send(method, params = {}, sessionId) {
      if (closed) return Promise.reject(new Error("the browser closed"));
      return new Promise((resolve, reject) => {
        const n = ++id;
        const timer = setTimeout(() => { waiting.delete(n); reject(new Error(`${method} timed out`)); }, timeout);
        timer.unref?.();
        waiting.set(n, { resolve, reject, timer });
        out.write(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
      });
    },
    on(method, fn) { if (!handlers.has(method)) handlers.set(method, []); handlers.get(method).push(fn); },
    onClose(fn) { if (closed) fn(); else closers.push(fn); },
    get closed() { return closed; },
    close() { try { out.end(); } catch { /* gone */ } finish(); },
    unref() { for (const s of [inp, out]) s.unref?.(); },
  };
}
