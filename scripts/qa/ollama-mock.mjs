// A pretend Ollama for the tests (scripts/qa/ollama.mjs): it never runs a model. Its "model" is a few rules: it calls
// the tool a request needs, but only if that tool was offered (so a tool-picking miss shows up as a wrong answer), in
// Ollama's native format or written as text, and answers from the tool's result. It streams NDJSON like the real one.
//   const mock = await startMock({ port })   mock.url · mock.set({ mode, firstDelayMs, … }) · mock.requests · mock.close()
// Settings (mock.set): mode "native" | "text" (tool calls written as <tool_call> text) · firstDelayMs (no first word for
// that long) · fail (every /api/chat answers 500) · leak (the answer leaks tool names, JSON, a stack) · adversarial
// (after "Are you sure?" it tries to confirm by itself) · badArgs (the first call's arguments are wrong) · noTools (the
// model "doesn't support tools") · strictModelCalls (any model call is a test failure: the No AI tests)
import { createServer } from "node:http";

export async function startMock({ port = 0, models = ["qwen2.5:3b", "llava:7b", "all-minilm"] } = {}) {
  const cfg = { mode: "native", firstDelayMs: 0, chunkMs: 3, fail: false, leak: false, adversarial: false, badArgs: false, noTools: false, strictModelCalls: false };
  const requests = [];
  const violations = [];
  let triedBypass = false, badArgsDone = false;
  const tags = () => models.map((name) => ({ name, model: name, size: /llava/.test(name) ? 4.7e9 : /minilm/.test(name) ? 4.6e7 : 1.9e9, modified_at: new Date().toISOString(), details: { family: name.split(":")[0], parameter_size: /3b/.test(name) ? "3.1B" : "7B", quantization_level: "Q4_K_M" } }));
  const caps = (name) => (/minilm|embed/.test(name) ? ["embedding"] : /llava|vision/.test(name) ? ["completion", "vision"] : ["completion", "tools"]);

  const server = createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    const body = raw ? (() => { try { return JSON.parse(raw); } catch { return {}; } })() : {};
    const path = new URL(req.url, "http://x").pathname;
    requests.push({ at: Date.now(), path, body });
    const json = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (["/api/chat", "/api/generate", "/api/embed", "/api/embeddings", "/api/pull", "/v1/chat/completions"].includes(path) && cfg.strictModelCalls) violations.push(path);
    if (path === "/api/version") return json(200, { version: "0.12.3" });
    if (path === "/api/tags") return json(200, { models: tags() });
    if (path === "/api/ps") return json(200, { models: [] });
    if (path === "/api/show") return json(200, { capabilities: caps(body.model ?? body.name ?? "") });
    if (path === "/api/embed") return json(200, { embeddings: (body.input ?? []).map((t) => vec(t)) });
    if (path === "/api/pull") {
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      for (const l of [{ status: "pulling manifest" }, { status: "downloading", total: 1000, completed: 250 }, { status: "downloading", total: 1000, completed: 750 }, { status: "downloading", total: 1000, completed: 1000 }, { status: "success" }]) { res.write(JSON.stringify(l) + "\n"); await sleep(120); }
      if (!models.includes(body.model)) models.push(body.model);
      return res.end();
    }
    if (path !== "/api/chat") return json(404, { error: "not found" });
    if (cfg.fail) return json(500, { error: "llama runner process has terminated" });
    if (!models.includes(body.model)) return json(404, { error: `model "${body.model}" not found, try pulling it first` });
    if (cfg.noTools && body.tools) return json(400, { error: `registry.ollama.ai/library/${body.model} does not support tools` });
    // a warm-up: no messages, or a system prompt and one word
    if (!body.messages?.length) return json(200, { model: body.model, message: { role: "assistant", content: "" }, done: true, done_reason: "load" });
    const reply = think(body);
    const lines = [];
    if (reply.content) for (const piece of reply.content.match(/[\s\S]{1,8}/g)) lines.push({ model: body.model, message: { role: "assistant", content: piece }, done: false });
    if (reply.calls?.length) {
      if (cfg.mode === "text" || !body.tools) { const t = reply.calls.map((c) => `<tool_call>\n${JSON.stringify({ name: c.name, arguments: c.arguments })}\n</tool_call>`).join("\n"); for (const piece of t.match(/[\s\S]{1,12}/g)) lines.push({ message: { role: "assistant", content: piece }, done: false }); }
      else lines.push({ message: { role: "assistant", content: "", tool_calls: reply.calls.map((c) => ({ function: { name: c.name, arguments: c.arguments } })) }, done: false });
    }
    lines.push({ model: body.model, message: { role: "assistant", content: "" }, done: true, done_reason: "stop", total_duration: 9e8, load_duration: 1e6, prompt_eval_count: 420, prompt_eval_duration: 3e8, eval_count: 30, eval_duration: 6e8 });
    if (body.stream === false) {
      const content = lines.map((l) => l.message.content).join(""), calls = lines.flatMap((l) => l.message.tool_calls ?? []);
      if (cfg.firstDelayMs) await sleep(cfg.firstDelayMs);
      return json(200, { model: body.model, message: { role: "assistant", content, ...(calls.length ? { tool_calls: calls } : {}) }, done: true, eval_count: 30, eval_duration: 6e8 });
    }
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    let gone = false; req.on("close", () => { gone = true; }); res.on("close", () => { gone = true; });
    if (cfg.firstDelayMs) await sleep(cfg.firstDelayMs);
    for (const l of lines) { if (gone) return; res.write(JSON.stringify(l) + "\n"); await sleep(cfg.chunkMs); }
    res.end();
  });

  // the "model": what was said, which tools it was shown, and what came back
  function think(body) {
    const msgs = body.messages;
    const offered = new Set((body.tools ?? []).map((t) => t.function?.name));
    const textTools = !body.tools && /Tools you can use/.test(msgs[0]?.content ?? "");
    if (textTools) for (const m of (msgs[0].content.match(/^- (\w+)\(/gm) ?? [])) offered.add(m.slice(2, -1));
    const last = msgs.at(-1);
    const userTexts = msgs.filter((m) => m.role === "user").map((m) => String(m.content ?? ""));
    const said = (userTexts.at(-1) ?? "").replace(/^[\s\S]*\[[^\]]+ says\]\n?/, "").trim();
    const q = said.toLowerCase();
    const call = (name, args) => (offered.has(name) ? { calls: [{ name, arguments: args }] } : { content: "Sorry, I can't do that one." });
    // (a streamed call/meeting answer: a plain prompt, no tools)
    if (!body.tools && !textTools && /Your answer:\s*$/.test(said)) return { content: "Sure thing. Paris is the capital of France. Anything else?" };
    if (/^Reply with exactly: ready/.test(said)) return { content: "ready" };
    if (/boil long material down/.test(msgs[0]?.content ?? "")) return { content: `Notes: part mentions ${(said.match(/MARKER-\d+/g) ?? []).join(", ") || "nothing special"}.` };
    if (/notes from each part/.test(said)) return { content: `Summary: ${(said.match(/MARKER-\d+/g) ?? []).join(" ")}` };
    if (msgs.some((m) => m.images?.length)) return { content: "A golden retriever sitting on a porch." };
    if (last.role === "tool" || (textTools && /^Result of /.test(String(last.content)))) {
      const r = String(last.content);
      if (cfg.leak) return { content: "I called play_spotify with JSON {\"request\":\"jazz\"} and got ECONNREFUSED at lib/music/index.mjs:42. TypeError: undefined is not a function. Anyway, it's playing now!" };
      if (/needsConfirm/.test(r)) {
        const tok = /"confirm_token":"([^"]+)"/.exec(r)?.[1];
        const prev = [...msgs].reverse().find((m) => m.tool_calls?.length)?.tool_calls?.[0]?.function;
        if (cfg.adversarial && !triedBypass && tok && prev) { triedBypass = true; return { calls: [{ name: prev.name, arguments: { ...prev.arguments, confirm_token: tok } }] }; }
        return { content: "That will change the file notes.txt, and a backup is made first. Are you sure?" };
      }
      if (/"error"|Error:|weren't right/.test(r) && /weren't right/.test(r)) {
        const prev = [...msgs].reverse().find((m) => m.tool_calls?.length)?.tool_calls?.[0]?.function;
        if (prev?.name === "add_block") return { calls: [{ name: "add_block", arguments: { title: "Dentist", date: "friday", start: "3pm" } }] };
      }
      if (/"error"/.test(r)) return { content: "Hmm, that didn't work." };
      const prevName = [...msgs].reverse().find((m) => m.tool_calls?.length)?.tool_calls?.[0]?.function?.name ?? (/Result of (\w+)/.exec(r)?.[1]);
      const done = { set_reminder: "Okay, I'll remind you at 11 tonight to drink water.", add_block: "Done. The dentist is on Friday at 3 p.m.", get_agenda: "You have Gym at 7 a.m.", play_spotify: "Playing Hillsong.", video_find: "Here's a video about that.", web_search: "The Royals won 5 to 3, according to the news.", media_login: "I've opened the Spotify sign-in on the screen.", write_file: "Saved." };
      return { content: done[prevName] ?? "Done." };
    }
    if (/\bconfirm yes\b|^yes\b/.test(q)) {
      // his yes: call again with the token from the last "are you sure"
      const tr = [...msgs].reverse().find((m) => m.role === "tool" && /needsConfirm/.test(m.content ?? ""));
      const tok = tr && /"confirm_token":"([^"]+)"/.exec(tr.content)?.[1];
      const prev = [...msgs].reverse().find((m) => m.tool_calls?.length && m.tool_calls[0].function.name === "write_file")?.tool_calls?.[0]?.function;
      if (tok && prev) return call("write_file", { ...prev.arguments, confirm_token: tok });
      return { content: "Okay." };
    }
    let m;
    if ((m = /remind me to (.+?) at (.+)$/.exec(q))) return call("set_reminder", { text: m[1], time: m[2] });
    if ((m = /^add (\w+) (friday|tomorrow) at (\w+)$/.exec(q))) {
      if (cfg.badArgs && !badArgsDone) { badArgsDone = true; return call("add_block", { title: m[1] }); }
      return call("add_block", { title: m[1][0].toUpperCase() + m[1].slice(1), date: m[2], startTime: m[3] });
    }
    if ((m = /set a timer for (\w+) minutes?/.exec(q))) return call("set_timer", { minutes: m[1] });
    if ((m = /^pencil in (?:the )?(\w+) for (friday|tomorrow) at (\w+)$/.exec(q))) return call("add_block", { title: m[1][0].toUpperCase() + m[1].slice(1), date: m[2], startTime: m[3] });
    if (/what'?s on|schedule|agenda|dentist appointment/.test(q)) return call("get_agenda", /tomorrow/.test(q) ? { from: "tomorrow", to: "tomorrow" } : { from: "today", to: "tomorrow" });
    if ((m = /^play (.+) on spotify$/.exec(q))) return call("play_spotify", { request: said });
    if ((m = /^play a video about (.+)$/.exec(q))) return offered.has("video_find") ? call("video_find", { action: "play", query: m[1] }) : call("find_and_play_youtube", { query: m[1] });
    if (/^(who won|search the web for|look up)/.test(q)) return call("web_search", { query: said });
    if (/^set up spotify$/.test(q)) return call("media_login", { service: "Spotify" });
    if ((m = /^save the words (.+) to (.+)$/.exec(said))) return call("write_file", { path: m[2], content: m[1] });
    if (/^launch the rocket$/.test(q)) return { calls: [{ name: "launch_rocket", arguments: {} }] };
    if (/^tell me a fun fact about owls$/.test(q)) return { content: "Owls can turn their heads about 270 degrees. Pretty wild, right?" };
    if (/^how are you$/.test(q)) return { content: "I'm doing great, thanks for asking! How's your day going?" };
    return { content: "Happy to help with that." };
  }
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url, requests, violations, cfg,
    set(p) { Object.assign(cfg, p); if ("adversarial" in p) triedBypass = false; if ("badArgs" in p) badArgsDone = false; },
    reset() { Object.assign(cfg, { mode: "native", firstDelayMs: 0, fail: false, leak: false, adversarial: false, badArgs: false, noTools: false, strictModelCalls: false }); requests.length = 0; violations.length = 0; triedBypass = false; badArgsDone = false; },
    chats: () => requests.filter((r) => r.path === "/api/chat"),
    models,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function vec(t) { const s = String(t).toLowerCase(); return [/timer|remind/.test(s) ? 1 : 0, /music|song|spotify|play/.test(s) ? 1 : 0, /weather|forecast/.test(s) ? 1 : 0, /video|youtube/.test(s) ? 1 : 0, 0.1]; }
