// Todoist: the owner's tasks. List, add (with Todoist's natural-language due dates: "tomorrow 5pm", "every friday"),
// complete. The owner pastes their API token (Todoist → Settings → Integrations → Developer). data/connectors/todoist.json.
import * as store from "./store.mjs";

const API = () => process.env.TODOIST_API_BASE || "https://api.todoist.com/api/v1";
const token = () => store.load("todoist").token || "";
export const connected = () => Boolean(token());
export function status() { const s = store.load("todoist"); return { id: "todoist", connected: connected(), who: s.who ?? null }; }
export function disconnect() { store.forget("todoist"); return status(); }

async function call(method, path, body, tok = token()) {
  if (!tok) throw Object.assign(new Error("Todoist isn't connected yet. Add your Todoist token in Settings → Apps."), { code: "not_connected" });
  const res = await fetch(API() + path, { method, headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000) });
  if (res.status === 401 || res.status === 403) throw new Error("Todoist didn't accept that token. Copy it again from Todoist → Settings → Integrations → Developer.");
  if (!res.ok) throw await store.fail(res, "Todoist");
  const t = await res.text(); return t ? JSON.parse(t) : {};
}
export async function connect({ token: tok } = {}) {
  tok = String(tok ?? "").trim();
  if (!/^[0-9a-f]{40}$/i.test(tok)) throw new Error("That doesn't look like a Todoist API token (40 letters and numbers).");
  const p = await call("GET", "/projects", null, tok);
  const projects = p.results ?? p;
  store.save("todoist", { token: tok, who: `${projects.length} project${projects.length === 1 ? "" : "s"}`, at: Date.now() });
  return status();
}
const results = (r) => (Array.isArray(r) ? r : r?.results ?? []);
async function all(path) {   // follows next_cursor pages (at most 5)
  const out = []; let cursor = null;
  for (let i = 0; i < 5; i++) { const r = await call("GET", path + (cursor ? `${path.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}` : "")); out.push(...results(r)); cursor = r?.next_cursor; if (!cursor) break; }
  return out;
}
const shape = (t, projects) => ({ id: t.id, title: t.content, due: t.due?.date ?? null, dueText: t.due?.string ?? null, recurring: Boolean(t.due?.is_recurring), priority: t.priority ?? 1, project: projects?.get(t.project_id) ?? null, url: `https://app.todoist.com/app/task/${t.id}` });
export async function tasks({ project, dueToday = false } = {}) {
  const projects = new Map((await all("/projects")).map((p) => [p.id, p.name]));
  let list = (await all("/tasks")).map((t) => shape(t, projects));
  if (project) list = list.filter((t) => (t.project ?? "").toLowerCase().includes(String(project).toLowerCase()));
  if (dueToday) { const d = new Date().toLocaleDateString("en-CA"); list = list.filter((t) => t.due && t.due.slice(0, 10) <= d); }
  return { tasks: list.sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || b.priority - a.priority).slice(0, 100) };
}
export async function addTask({ title, due }) {
  if (!String(title ?? "").trim()) throw new Error("What's the task?");
  const t = await call("POST", "/tasks", { content: String(title).trim(), ...(due ? { due_string: String(due), due_lang: "en" } : {}) });
  return { added: shape(t) };
}
export async function complete({ match }) {
  const q = String(match ?? "").toLowerCase(), list = (await tasks()).tasks.filter((t) => t.title.toLowerCase().includes(q));
  if (!list.length) return { error: `No open Todoist task matches “${match}”.` };
  if (list.length > 1 && !list.some((t) => t.title.toLowerCase() === q)) return { ambiguous: true, choices: list.slice(0, 5).map((t) => t.title) };
  const t = list.find((x) => x.title.toLowerCase() === q) ?? list[0];
  await call("POST", `/tasks/${t.id}/close`);
  return { completed: t.title };
}
