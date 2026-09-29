// How often something repeats. A routine carries `repeat`:
//   { freq: "daily" | "weekly" | "monthly" | "yearly", interval: 1…99, days: ["mon","wed"] (weekly),
//     monthDay: 1…31 | nth: { n: 1…4 | -1 (last), day: "tue" } (monthly), start: "YYYY-MM-DD", until: "YYYY-MM-DD" | null }
// Older routines only have `days` (every week on those days); they read as weekly, interval 1.
// occursOn() decides a date, describe() says it in words, parse() understands how people say it.
export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_NAMES = { sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dateRe = /^\d{4}-\d{2}-\d{2}$/;

const parts = (iso) => iso.split("-").map(Number);
const dayNum = (iso) => { const [y, m, d] = parts(iso); return Math.round(Date.UTC(y, m - 1, d) / 86_400_000); };
const weekday = (iso) => { const [y, m, d] = parts(iso); return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]; };
const ord = (n) => n + (["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// A clean repeat rule from whatever came in (a routine's old `days`, a form, the AI, a voice parse).
export function normalize(rep, fallbackDays) {
  const r = rep && typeof rep === "object" ? rep : {};
  const freq = ["daily", "weekly", "monthly", "yearly"].includes(r.freq) ? r.freq : "weekly";
  const interval = Math.max(1, Math.min(99, Math.round(Number(r.interval) || 1)));
  const out = { freq, interval };
  if (freq === "weekly") {
    const days = (Array.isArray(r.days) && r.days.length ? r.days : r.start && dateRe.test(r.start) ? [weekday(r.start)] : fallbackDays ?? WEEKDAYS).map((d) => String(d).toLowerCase().slice(0, 3)).filter((d) => WEEKDAYS.includes(d));
    out.days = WEEKDAYS.filter((d) => days.includes(d));
    if (!out.days.length) throw new Error("pick at least one day of the week");
  }
  if (freq === "monthly") {
    if (r.nth && WEEKDAYS.includes(String(r.nth.day).slice(0, 3))) out.nth = { n: Number(r.nth.n) === -1 ? -1 : Math.max(1, Math.min(4, Number(r.nth.n) || 1)), day: String(r.nth.day).slice(0, 3) };
    else out.monthDay = Math.max(1, Math.min(31, Math.round(Number(r.monthDay) || (r.start ? parts(r.start)[2] : 1))));
  }
  if (r.start && dateRe.test(r.start)) out.start = r.start;
  if (r.until && dateRe.test(r.until)) out.until = r.until;
  if (r.exceptHolidays === true) out.exceptHolidays = true;
  if ((freq !== "weekly" || interval > 1) && !out.start) out.start = todayISO();   // every-other counts from a start
  if (freq === "yearly" && !out.start) out.start = todayISO();
  return out;
}
const todayISO = () => new Date().toLocaleDateString("en-CA");

// The rule for a routine (old ones: weekly on their days).
export const ruleOf = (routine) => normalize(routine.repeat ?? { freq: "weekly", days: routine.days }, routine.days);

// Does this routine happen on this date?
export function occursOn(routine, iso) {
  if (!routine || routine.active === false) return false;
  const r = ruleOf(routine);
  if (r.start && iso < r.start) return false;
  if (r.until && iso > r.until) return false;
  if (r.exceptHolidays && isHoliday(iso)) return false;
  const [y, m, d] = parts(iso);
  switch (r.freq) {
    case "daily": return r.interval === 1 || (dayNum(iso) - dayNum(r.start)) % r.interval === 0;
    case "weekly": {
      if (!r.days.includes(weekday(iso))) return false;
      if (r.interval === 1) return true;
      const wk = (x) => Math.floor((dayNum(x) + 4) / 7);          // weeks counted Sunday to Saturday
      return (wk(iso) - wk(r.start)) % r.interval === 0;
    }
    case "monthly": {
      const [sy, sm] = parts(r.start ?? iso);
      if (((y - sy) * 12 + (m - sm)) % r.interval !== 0) return false;
      if (r.nth) {
        if (weekday(iso) !== r.nth.day) return false;
        return r.nth.n === -1 ? d + 7 > daysInMonth(y, m) : Math.ceil(d / 7) === r.nth.n;
      }
      return d === Math.min(r.monthDay, daysInMonth(y, m));      // the 31st in a short month: its last day
    }
    case "yearly": {
      const [sy, sm, sd] = parts(r.start);
      return m === sm && d === Math.min(sd, daysInMonth(y, m)) && (y - sy) % r.interval === 0;
    }
  }
  return false;
}

// "Every day", "Every other day", "Weekdays", "Mon, Wed & Fri", "Every 2 weeks on Tuesday", "Monthly on the 2nd Tuesday"…
export function describe(routine) {
  const r = ruleOf(routine);
  const every = (unit, plural) => (r.interval === 1 ? `Every ${unit}` : r.interval === 2 ? `Every other ${unit}` : `Every ${r.interval} ${plural}`);
  let s;
  if (r.freq === "daily") s = every("day", "days");
  else if (r.freq === "weekly") {
    const set = r.days.join(",");
    const names = set === "mon,tue,wed,thu,fri" ? "weekdays" : set === "sun,sat" ? "weekends" : r.days.length === 7 ? "every day" : r.days.map((x) => (r.days.length > 2 ? DAY_NAMES[x].slice(0, 3) : DAY_NAMES[x])).join(r.days.length > 2 ? ", " : " & ");
    s = r.interval === 1 ? (names === "every day" ? "Every day" : names === "weekdays" ? "Weekdays" : names === "weekends" ? "Weekends" : `Every ${names}`) : `${every("week", "weeks")} on ${names}`;
  } else if (r.freq === "monthly") s = `${r.interval === 1 ? "Monthly" : every("month", "months")} on the ${r.nth ? `${r.nth.n === -1 ? "last" : ["first", "second", "third", "fourth"][r.nth.n - 1]} ${DAY_NAMES[r.nth.day]}` : ord(r.monthDay)}`;
  else { const [, sm, sd] = parts(r.start); s = `${r.interval === 1 ? "Every year" : every("year", "years")} on ${MONTHS[sm - 1]} ${sd}`; }
  if (r.until) { const [uy, um, ud] = parts(r.until); s += ` until ${MONTHS[um - 1].slice(0, 3)} ${ud}${uy !== new Date().getFullYear() ? ", " + uy : ""}`; }
  if (r.exceptHolidays) s += " (not on holidays)";
  return s;
}

// US federal holidays ("except holidays"): New Year's Day, Martin Luther King Jr. Day, Presidents' Day, Memorial Day,
// Juneteenth, Independence Day, Labor Day, Columbus Day, Veterans Day, Thanksgiving and Christmas (on the day itself)
const nthDay = (y, m, wd, n) => { const first = new Date(Date.UTC(y, m, 1)).getUTCDay(); return 1 + ((wd - first + 7) % 7) + (n - 1) * 7; };
const lastDay = (y, m, wd) => { const dim = daysInMonth(y, m + 1), last = new Date(Date.UTC(y, m, dim)).getUTCDay(); return dim - ((last - wd + 7) % 7); };
export function holidaysOf(y) {
  const iso = (m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return [iso(0, 1), iso(0, nthDay(y, 0, 1, 3)), iso(1, nthDay(y, 1, 1, 3)), iso(4, lastDay(y, 4, 1)), iso(5, 19), iso(6, 4), iso(8, nthDay(y, 8, 1, 1)), iso(9, nthDay(y, 9, 1, 2)), iso(10, 11), iso(10, nthDay(y, 10, 4, 4)), iso(11, 25)];
}
export const isHoliday = (iso) => holidaysOf(Number(iso.slice(0, 4))).includes(iso);

// How people say it. Returns { repeat, rest } (rest = the text with the repeat words taken out) or null.
//   every day · daily · every other day · every 3 days · weekdays · weekends · every monday · mondays and wednesdays ·
//   every tuesday and thursday · every other week · every 2 weeks on friday · monthly · every month on the 15th ·
//   the first monday of every month · the last friday of the month · every year · yearly · … until december 1
const NUMS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, other: 2, second: 2, third: 3, fourth: 4 };
const DAY_RX = "(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|rsday|urday|sday)?s?";
const dayKey = (w) => WEEKDAYS.find((d) => String(w).toLowerCase().startsWith(d));
export function parse(text, { today = todayISO() } = {}) {
  let t = ` ${String(text).toLowerCase().replace(/[.,!?]/g, " ").replace(/\s+/g, " ")} `, m, rep = null;
  const cut = (x) => { t = t.replace(x, " "); };
  let until = null;
  if ((m = / (?:until|through|till|ending(?: on)?) ((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2}(?:st|nd|rd|th)?(?: \d{4})?) /.exec(t))) {
    const [mn, dd, yy] = m[1].split(" "); const mi = MONTHS.findIndex((x) => x.toLowerCase().startsWith(mn.slice(0, 3)));
    let y = yy ? Number(yy) : Number(today.slice(0, 4)); const cand = `${y}-${String(mi + 1).padStart(2, "0")}-${String(parseInt(dd, 10)).padStart(2, "0")}`;
    until = cand < today && !yy ? `${y + 1}${cand.slice(4)}` : cand; cut(m[0]);
  }
  const n = (w) => NUMS[w] ?? Number(w);
  if ((m = / every (other|\d+|two|three|four|five|six|seven|eight|nine|ten) days? /.exec(t))) { rep = { freq: "daily", interval: n(m[1]) }; cut(m[0]); }
  else if ((m = / (every ?day|daily|each day|every single day) /.exec(t))) { rep = { freq: "daily", interval: 1 }; cut(m[0]); }
  else if ((m = / (?:on )?(?:every |each )?(weekdays|week days|weekday|every weekday) /.exec(t))) { rep = { freq: "weekly", interval: 1, days: ["mon", "tue", "wed", "thu", "fri"] }; cut(m[0]); }
  else if ((m = / (?:on )?(?:every |each )?(weekends?) /.exec(t))) { rep = { freq: "weekly", interval: 1, days: ["sun", "sat"] }; cut(m[0]); }
  else if ((m = new RegExp(` (?:on )?the (first|second|third|fourth|last|1st|2nd|3rd|4th) ${DAY_RX} (?:of )?(?:every|each|the) month `).exec(t))) {
    const k = { first: 1, second: 2, third: 3, fourth: 4, last: -1, "1st": 1, "2nd": 2, "3rd": 3, "4th": 4 }[m[1]];
    rep = { freq: "monthly", interval: 1, nth: { n: k, day: dayKey(m[2]) } }; cut(m[0]);
  } else if ((m = / (?:every|each) (other|\d+|two|three|four|five|six) months?(?: on the (\d{1,2})(?:st|nd|rd|th)?)? /.exec(t))) {
    rep = { freq: "monthly", interval: n(m[1]), ...(m[2] ? { monthDay: Number(m[2]) } : {}) }; cut(m[0]);
  } else if ((m = / (?:on )?the (\d{1,2})(?:st|nd|rd|th)? (?:of )?(?:every|each|the) month /.exec(t)) || (m = / (?:every month|monthly|each month)(?: on the (\d{1,2})(?:st|nd|rd|th)?)? /.exec(t))) {
    rep = { freq: "monthly", interval: 1, ...(m[1] ? { monthDay: Number(m[1]) } : {}) }; cut(m[0]);
  } else if ((m = / (every year|yearly|annually|each year) /.exec(t))) { rep = { freq: "yearly", interval: 1 }; cut(m[0]); }
  else if ((m = / (?:every|each) (other|\d+|two|three|four) weeks?(?: on)? /.exec(t)) || (m = / (every week|weekly|each week)(?: on)? /.exec(t))) {
    const interval = /^(every week|weekly|each week)/.test(m[1]) ? 1 : n(m[1]);
    cut(m[0]);
    const days = [...t.matchAll(new RegExp(`\\b${DAY_RX}\\b`, "g"))].map((x) => dayKey(x[1]));
    rep = { freq: "weekly", interval, days: days.length ? [...new Set(days)] : null }; if (days.length) cut(new RegExp(`(?:on )?(?:\\b${DAY_RX}\\b(?:,| and| &| or)? ?)+`, "g"));
  } else {
    // "every monday", "mondays and wednesdays", "every tuesday and thursday", "on mon, wed and fri each week"
    const every = new RegExp(`(?: on)? (?:every|each) ((?:${DAY_RX}(?:,| and| &| or)? ?)+)`).exec(t) ?? new RegExp(` on ((?:(?:sun|mon|tues?|wednes|thurs?|fri|satur)days(?:,| and| &)? ?)+)`).exec(t) ?? new RegExp(` ((?:(?:sun|mon|tues?|wednes|thurs?|fri|satur)days(?:,| and| &)? ?)+)`).exec(t);
    if (every) {
      const days = [...every[1].matchAll(new RegExp(DAY_RX, "g"))].map((x) => dayKey(x[1])).filter(Boolean);
      if (days.length) { rep = { freq: "weekly", interval: 1, days: [...new Set(days)] }; cut(every[0]); }
    }
  }
  if (!rep) return null;
  if (until) rep.until = until;
  if ((m = / (?:except|but not|not|excluding|skipping|skip) (?:on )?(?:the )?(?:public |federal |national |bank )?holidays /.exec(t))) { rep.exceptHolidays = true; cut(m[0]); }
  return { repeat: rep, rest: t.replace(/\s+/g, " ").trim() };
}
