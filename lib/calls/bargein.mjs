// Talking over Dayspring stops it: someone (not a bot) speaks for `ms` while Dayspring is talking → onBarge().
// A short "mm-hm" or a laugh (shorter than `ms`) doesn't. Used by the Discord bot, which hears each person separately.
//
//   const b = createBargeIn({ ms: () => 600, enabled: () => true, isPlaying: () => bool, onBarge(userId) })
//   b.start(userId)   someone started talking      b.end(userId)   they stopped
export function createBargeIn({ ms = () => 600, enabled = () => true, isPlaying = () => false, onBarge = () => {}, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const timers = new Map();
  const talking = new Set();
  return {
    start(userId) {
      talking.add(userId);
      if (!enabled() || !isPlaying()) return false;
      clearTimer(timers.get(userId));
      timers.set(userId, setTimer(() => {
        timers.delete(userId);
        if (talking.has(userId) && isPlaying()) onBarge(userId);
      }, ms()));
      return true;
    },
    end(userId) { talking.delete(userId); clearTimer(timers.get(userId)); timers.delete(userId); },
    clear() { for (const t of timers.values()) clearTimer(t); timers.clear(); talking.clear(); },
    get pending() { return timers.size; },
  };
}
