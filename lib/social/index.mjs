// Sharing memories with friends — the gate. NOT SWITCHED ON.
//
// Everything social in Dayspring goes through this file, and with social.enabled off (the default; see flag.mjs) it is
// inert: no routes (the API answers 404), no tools for the AI, no intents, no background jobs, no keys, no network.
// None of the real code (./engine.mjs, ./integration.mjs, ecosystem-core's lib/social) is even loaded.
// The design and protocol: vendor/ecosystem-core/docs/SOCIAL.md.
//
//   tools()                 the AI tools: [] unless enabled
//   runTool(name, input)    undefined unless enabled and it's one of ours
//   handle(req, res, ctx)   the /api/social/* routes: false (not ours) unless enabled
import { enabled } from "./flag.mjs";

export { enabled };

// Read-only tools, offered only with the feature on. Sharing itself always needs the owner to do it on screen.
const TOOLS = [
  { name: "social_reminders", description: "Reminders from memories and events friends shared with the owner (on this day, birthdays, anniversaries, people they haven't talked to in a while). Only available when sharing with friends is switched on.", input_schema: { type: "object", properties: { days: { type: "number", description: "how many days ahead (default 14)" } } } },
  { name: "social_status", description: "Whether sharing with friends is set up on this computer, and what's waiting to sync. Only available when sharing with friends is switched on.", input_schema: { type: "object", properties: {} } },
];
const NAMES = new Set(TOOLS.map((t) => t.name));

export function tools() { return enabled() ? TOOLS : []; }

export async function runTool(name, input = {}) {
  if (!NAMES.has(name) || !enabled()) return undefined;
  const engine = await import("./engine.mjs");
  return engine.runTool(name, input);
}

export async function handle(req, res, ctx) {
  if (!ctx?.p?.startsWith("/social")) return false;
  if (!enabled()) return false;                      // not ours: the server answers 404 like any unknown path
  const engine = await import("./engine.mjs");
  return engine.handle(req, res, ctx);
}
