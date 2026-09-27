// Personality commands for the no-AI intent catalogue (lib/intents/catalog.mjs), in its template language:
// (a|b) one of, [x] optional, {text} free words. Every one plans { do: "persona", text } and the runner calls
// persona.handle(text), which does the work (and answers the yes/no of a delete or a voice offer).
// Usage in catalog.mjs:  ...PERSONA_INTENTS.map(([id, label, ex, say]) => I(id, "personality", label, ex, say, (c) => ({ do: "persona", text: c.q }), { instant: true }))
export const PERSONA_INTENTS = [
  ["persona.be", "Switch to a character or saved personality", "be a cowboy", [
    "(be|become|act like|talk like|speak like|sound like|pretend to be|turn into) (a|an|the|my)? {text}",
    "(switch|change) (to|into) (the|my)? {text} (personality|character|persona|mode)",
    "use (my|the)? {text} (personality|character|persona)", "(put on|go) (the|my)? {text} (personality|character|mode)",
    "talk like a pirate", "be a pirate", "be a cowboy", "be a knight", "be a robot", "be a wizard", "be a professor", "be my butler", "be a game show host",
  ]],
  ["persona.normal", "Go back to the normal personality", "be normal", [
    "be normal", "(go )?back to normal", "drop the act", "be yourself", "normal mode", "stop acting", "just be (normal|you|yourself)", "turn off (the )?personality", "regular mode",
  ]],
  ["persona.what", "Say which personality is on", "what personality are you", [
    "(what|which) (personality|character|persona) (are you|is this|is on|are you using)", "who are you (right now|being)", "what are you pretending to be",
  ]],
  ["persona.list", "List the personalities", "what personalities are available", [
    "(what|which) (personalities|characters|personas) (are there|are available|do you have|can you do|can you be)", "list (my|the|all)? (personalities|characters|personas)", "(show me|show) (my|the)? (personalities|characters)",
  ]],
  ["persona.more", "Turn a personality trait up or down", "be more sassy", [
    "(be|act|get|sound) (a little|a lot|much|a bit)? (more|less) {text}",
    "be more (sassy|funny|formal|casual|brief|detailed|warm|serious|gentle|energetic|calm|cheerful|curious)", "be less (formal|sassy|serious|chatty|wordy|goofy)",
  ]],
  ["persona.save", "Save this personality", "save this personality as grumpy captain", [
    "save (this|the current|my current)? (personality|character|persona|one)? (as|called|named) {text}",
  ]],
  ["persona.delete", "Delete a saved personality", "delete my grumpy captain personality", [
    "(delete|remove) (my|the)? {text} (personality|character|persona)",
  ]],
  ["persona.rename", "Rename a saved personality", "rename grumpy captain to captain sam", [
    "rename (my|the)? {text} to {text}", "rename (my|the)? {text} (personality|character|persona) to {text}",
  ]],
  ["persona.secrets", "Say which secret characters you've found", "what secret characters have i found", [
    "(what|which) secret (characters|personalities) (have i|did i)? (found|discovered|unlocked)", "(list|show) (my)? secret (characters|personalities)", "how many secrets (have i|did i) (found|find)",
  ]],
  ["persona.secretHint", "Get a hint for a secret character", "give me a hint for a secret character", [
    "(give me|got|can i get|can i have)? a hint (for|about)? (a|the)? secret (character|personality)", "secret (character)? hint",
  ]],
  ["persona.surprise", "Pick a random personality", "surprise me with a personality", [
    "surprise me with a (personality|character)", "random (personality|character)", "pick a (random)? (personality|character) (for me)?",
  ]],
];
