// What happened in THIS meeting: who asked what (only questions addressed to an assistant). It lives in memory and is
// cleared when the meeting ends; nothing here is ever written to disk.
//
//   const mem = createMeetingMemory();
//   mem.add({ name: "Jess", key: "jess park", question, topic: "Sessions and the application scope", ref: "u5l3", group: "u5", assistant: "lantern" });
//   mem.related({ ref: "u5l4", group: "u5", notKey: "rich alvarez" }) → Jess's entry (the same lesson first, then the same unit)
//   mem.summary() → "Jess asked about Sessions and the application scope. Rich asked about …"   (for an AI prompt)
//   mem.clear()

export function createMeetingMemory({ max = 40, now = () => Date.now() } = {}) {
  let items = [];
  return {
    add(e) {
      if (!e || !e.question) return;
      items.push({ name: e.name ?? null, key: String(e.key ?? e.name ?? "").toLowerCase(), question: String(e.question).slice(0, 300), topic: e.topic ?? null, ref: e.ref ?? null, group: e.group ?? null, assistant: e.assistant ?? null, at: now() });
      if (items.length > max) items = items.slice(-max);
    },
    // An earlier question by someone else on the same lesson (or, failing that, the same unit), newest first
    related({ ref = null, group = null, notKey = "" } = {}) {
      const others = items.filter((i) => i.name && i.key !== String(notKey).toLowerCase() && i.topic).reverse();
      return (ref && others.find((i) => i.ref === ref)) || (group && others.find((i) => i.group === group)) || null;
    },
    people() { return [...new Set(items.map((i) => i.name).filter(Boolean))]; },
    byPerson(key) { return items.filter((i) => i.key === String(key).toLowerCase()); },
    recent(n = 6) { return items.slice(-n); },
    summary(n = 6) { return items.slice(-n).map((i) => `${i.name ?? "Someone"} asked ${i.topic ? `about ${i.topic}` : `"${i.question}"`}.`).join(" "); },
    size: () => items.length,
    clear() { items = []; },
  };
}
