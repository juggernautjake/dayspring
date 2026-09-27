// ecosystem-core/lib/meet: a Google Meet call that the assistants take part in (Dayspring now; Lantern can adopt it).
// Everything app-specific (how an answer is made, spoken and shown) stays in the app; this is the meeting itself.
//
//   session.mjs      the managed Meet window (Playwright is passed in): join, captions, chat, mic/camera, tile
//   selectors.mjs    where things are on Meet's page (with fallbacks), and the in-page watcher
//   listener.mjs     caption lines and chat → "Rich asked Lantern: …" (addressing, permissions, echo filtering)
//   address.mjs      "Dayspring, …" / "Lantern, …" / "@Lantern …", with the usual mishearings
//   permissions.mjs  who may ask which assistant; "let Rich and Jess ask", "only listen to me"
//   names.mjs        what to call someone and when (first answer, then about one in three), in each personality
//   roster.mjs       who is in the call and who is talking, from several sources merged (People list, tiles, captions, chat, notices)
//   memory.mjs       who asked what in this meeting (in memory only; cleared when it ends)
//   chat.mjs         "Dayspring: …" messages split to fit the chat box
//   mock/meet-mock.html  a stand-in Meet page for rehearsals and tests
export * from "./address.mjs";
export * from "./names.mjs";
export * from "./memory.mjs";
export * from "./permissions.mjs";
export * from "./chat.mjs";
export * from "./selectors.mjs";
export * from "./listener.mjs";
export * from "./session.mjs";
export * from "./roster.mjs";
import { fileURLToPath } from "node:url";
export const MOCK_PAGE = fileURLToPath(new URL("./mock/meet-mock.html", import.meta.url));
