// Which free voice speaks when nobody has chosen one: one list, used by the Dayspring screen (tv.js), the guided setup
// (welcome.js) and Settings. The owner's own choice (Settings → Voice) always wins; these are only the defaults.
//
//   Dayspring's voice (assistant): a friendly, warm female voice.
//     Edge "Ava (Natural)" → "Jenny (Natural)" → "Aria (Natural)" → any English Natural voice named Emma, Michelle, Sonia,
//     Libby or Natasha → Windows "Zira" → the first US-English voice → the first English voice → any voice
//   The guided setup's guide (guide): a warm male voice, kept separate from Dayspring's own.
//     Edge "Andrew (Natural)" → "Brian (Natural)" → "Guy (Natural)" → Windows "David" → the first US-English voice
// With an ElevenLabs key, Dayspring's default is Matilda and the guide's is Will; with OpenAI, Dayspring's is "coral".
// (Those are chosen on the server: lib/voice.mjs.) Kept in sync with docs/voices.md.
(() => {
  const EN = (v) => /^en([-_]|$)/i.test(v.lang ?? "");
  const US = (v) => /^en[-_]US/i.test(v.lang ?? "");
  const natural = (v) => /natural|online|neural/i.test(v.name ?? "");
  const LISTS = {
    assistant: [
      (v) => /\bAva\b.*natural/i.test(v.name) && EN(v),
      (v) => /\bJenny\b.*natural/i.test(v.name) && EN(v),
      (v) => /\bAria\b.*natural/i.test(v.name) && EN(v),
      (v) => natural(v) && EN(v) && /\b(Ava|Jenny|Aria|Emma|Michelle|Sonia|Libby|Natasha)\b/i.test(v.name),
      (v) => /\bZira\b/i.test(v.name),
    ],
    guide: [
      (v) => /\bAndrew\b.*natural/i.test(v.name) && EN(v),
      (v) => /\bBrian\b.*natural/i.test(v.name) && EN(v),
      (v) => /\bGuy\b.*natural/i.test(v.name) && EN(v),
      (v) => /\bDavid\b/i.test(v.name) && EN(v),
    ],
  };
  // pick("assistant" | "guide", voices?) → a SpeechSynthesisVoice (or null when the browser has none)
  function pick(kind = "assistant", voices = window.speechSynthesis?.getVoices?.() ?? []) {
    const vs = [...voices];
    for (const test of LISTS[kind] ?? LISTS.assistant) { const v = vs.find((x) => { try { return test(x); } catch { return false; } }); if (v) return v; }
    return vs.find(US) ?? vs.find(EN) ?? vs[0] ?? null;
  }
  window.dsVoicePrefs = { pick, LISTS, ELEVEN: { assistant: "Matilda", guide: "Will" }, OPENAI: { assistant: "coral", fallback: "shimmer" } };
})();
