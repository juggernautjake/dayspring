// Easter eggs. The backwards-talking sage: the Star Sage with Light ≥ 60, Wise ≥ 70, Ancient ≥ 85 and Peaceful ≥ 50.
export const SAGE = { preset: "sage", need: { light: 60, wise: 70, ancient: 85, peaceful: 50 } };

export function sageActive(state) {
  if (!state || state.preset !== SAGE.preset) return false;
  const r = state.role ?? {};
  return Object.entries(SAGE.need).every(([k, v]) => Number(r[k] ?? -999) >= v);
}

// After a change: is this the first time the egg has hatched? (the caller shows "✨ Something awakens…" once)
export function check(prev, next) {
  const was = sageActive(prev), now = sageActive(next);
  const seen = new Set(next.easterEggs ?? []);
  const first = now && !was && !seen.has("sage");
  return { sage: now, firstTime: first, toast: first ? "✨ Something awakens…" : null };
}
