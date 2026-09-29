// The Discord bot goes by the assistant's name: its nickname in each server is set to it ("Nova"), or cleared back to
// the bot's own name when the assistant is Dayspring again. Needs the "Change Nickname" permission in that server; where
// it's missing, that server keeps the old nickname and the reason is reported (Settings → Discord shows it).
// Plain objects in, so it's tested with a stand-in client (scripts/qa/wakeword.mjs).
//   applyBotName(client, name) → [{ guild, ok, same?, why? }]
export async function applyBotName(client, name, { product = "Dayspring" } = {}) {
  const nick = !name || name === product ? null : String(name).slice(0, 32);
  const out = [];
  for (const g of client?.guilds?.cache?.values?.() ?? []) {
    try {
      const me = g.members?.me ?? (await g.members?.fetchMe?.().catch(() => null));
      if (!me) { out.push({ guild: g.id, ok: false, why: "the bot isn't a member there" }); continue; }
      if ((me.nickname ?? null) === nick) { out.push({ guild: g.id, ok: true, same: true }); continue; }
      await me.setNickname(nick, "The owner renamed their assistant in Dayspring");
      out.push({ guild: g.id, ok: true });
    } catch (e) {
      out.push({ guild: g.id, ok: false, why: /permission|missing access|50013/i.test(String(e?.message ?? e) + (e?.code ?? "")) ? "it needs the Change Nickname permission there" : String(e?.message ?? e) });
    }
  }
  return out;
}
