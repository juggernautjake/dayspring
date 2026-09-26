// Every tool the AI can be offered must have a unique name: one clash makes the provider refuse every request
// ("tools: Tool names must be unique."). Loads each module that contributes tools and checks the combined list
// the assistant builds (listskills re-exports a few modules' tools, so it stands in for them).
//   node scripts/qa/tool-names.mjs        exit 0 = all unique
process.env.DAYSPRING_NO_ECO = "1"; process.env.DAYSPRING_NO_BROWSER = "1";
const lib = new URL("../../lib/", import.meta.url);
const load = async (m) => (await import(new URL(m + ".mjs", lib))) ;
const a = await load("assistant");
const parts = { assistant: a.tools, abilities: (await load("abilities")).tools?.({ provider: "other" }) ?? [] };
for (const m of ["studyskills", "skyskills", "connectors/index", "listskills", "discover", "conflicts", "helpskills"]) parts[m] = (await load(m)).TOOLS ?? [];
const abil = new Set((await load("abilities")).NAMES ?? []);
const seen = new Map(); let bad = 0;
for (const [m, list] of Object.entries(parts)) for (const t of list) {
  const n = t.name ?? t.type; if (m === "assistant" && (t.type || abil.has(n))) continue;   // replaced by abilities / native
  if (seen.has(n)) { console.log(`✗ "${n}" is in both ${seen.get(n)} and ${m}`); bad++; } else seen.set(n, m);
}
console.log(bad ? `${bad} duplicate tool name(s)` : `✓ ${seen.size} tool names, all unique`);
process.exit(bad ? 1 : 0);
