// The Learning tab on the Progress page: each Lantern course with its progress (from Lantern), the XP it has earned in
// Dayspring, the week's learning, recent completions, and how learning moves the Study & Learning badges.
//   window.dsLearning = { panel(root) }
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = (p, body) => fetch("/api" + p, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}).then((r) => r.json());
  const short = (t) => String(t ?? "").replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+\d{3}$/, "").trim();
  const hours = (m) => (m == null ? "" : m < 60 ? `about ${m} min left` : `about ${Math.round(m / 60)} h left`);

  async function panel(root) {
    root.innerHTML = `<p class="xp-muted">Loading your learning…</p>`;
    let v, badges, x;
    try { [v, badges, x] = await Promise.all([api("/xp/learning"), api("/xp/badges").catch(() => null), api("/xp").catch(() => null)]); }
    catch { root.innerHTML = `<p class="xp-err">Learning couldn't load. Is Dayspring running?</p>`; return; }
    const study = badges?.categories?.find((c) => c.cat === "study");
    const w = v.week;
    const weekCard = `<section class="ln-week"><h2>This week</h2><div class="ln-stats">
      <div><b>${w.lessons}</b><span>lessons</span></div><div><b>${w.practiceMinutes}</b><span>practice minutes</span></div>
      <div><b>${w.xp}</b><span>learning XP</span></div><div><b>${x?.streak?.days ?? 0}</b><span>day streak</span></div></div></section>`;
    const courses = v.courses.length ? v.courses.map((c) => `<section class="ln-course" data-course="${esc(c.id)}">
        <header><h3>${esc(short(c.title))}</h3><span class="ln-xp">${c.xp} XP earned</span></header>
        <div class="bbar ln-bar" role="progressbar" aria-label="${esc(short(c.title))} progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(c.percent)}"><i style="width:${Math.max(0, Math.min(100, Math.round(c.percent)))}%"></i></div>
        <p class="ln-meta">${Math.round(c.percent)}%${c.measure ? ` · ${esc(c.measure)}` : ""}${c.units.total ? ` · ${c.units.done} of ${c.units.total} units` : ""}${c.minutesLeft != null ? ` · ${hours(c.minutesLeft)}` : ""}</p>
        ${c.next?.title ? `<p>Next: <b>${esc(c.next.title)}</b></p>` : ""}
        <p class="xp-muted">${c.items} thing${c.items === 1 ? "" : "s"} finished${c.authoredXp ? ` · ${c.authoredXp} of Lantern's course points` : ""} · counts toward your Study &amp; Learning badges</p></section>`).join("")
      : `<p class="bempty">${v.connected ? "No Lantern courses installed yet." : "Lantern isn't running right now. Your finished lessons still count: they're added the next time Lantern is open."}</p>`;
    const badgeLine = study ? `<section><h2>Study &amp; Learning badges</h2><p>${study.earned} of 18 earned${study.next?.done ? "" : ` · next${study.next?.name ? `: ${esc(study.next.name)}` : ""} in ${study.next?.toGo ?? "?"} XP`}</p>
      <div class="bbar"><i style="width:${Math.round((study.next?.pct ?? 0) * 100)}%;background:linear-gradient(90deg,#1F5F6B,#2A9D8F)"></i></div><p class="xp-muted">Lessons, exercises and practice in Lantern count here, like study check-ins.</p></section>` : "";
    const recent = v.recent.length ? `<ul class="xp-recent ln-recent">${v.recent.map((e) => `<li><b>${esc(e.line.replace(/ \+\d+ XP, .*$/, ""))}</b> <span class="xp-muted">${esc(short(e.courseTitle ?? e.course))}</span>${e.catchup ? ` <span class="xp-muted">(catch-up)</span>` : ""}<time>+${e.amount} XP · ${esc(e.line.replace(/^.* XP, /, ""))}</time></li>`).join("")}</ul>` : `<p class="xp-muted">Nothing yet. Finish a lesson in Lantern and it shows up here.</p>`;
    const r = v.rates;
    root.innerHTML = `${weekCard}${courses}${badgeLine}
      <section><h2>Recently finished</h2>${recent}<button type="button" class="xp-link" id="lnSync">Check Lantern now</button> <span class="xp-muted" id="lnSyncMsg"></span></section>
      <section><h2>What learning is worth</h2><ul class="xp-rules">
        <li><b>Lesson</b> ${r.lesson}</li><li><b>Exercise passed</b> ${r.exercise} <span class="xp-muted">the first pass</span></li>
        <li><b>Practice</b> ${r.practice} <span class="xp-muted">per ${v.caps.practiceMinutes}+ minutes, up to ${v.caps.practicePerDay} a day per course</span></li>
        <li><b>Unit check</b> up to ${r.check} <span class="xp-muted">from ${Math.round(v.caps.checkPass * 100)}%, by your score</span></li>
        <li><b>Project milestone</b> ${r.milestone}</li><li><b>Unit finished</b> ${r.unit}</li><li><b>Course finished</b> ${r.course}</li></ul>
        <p class="xp-muted">Only work Lantern has verified counts, and each thing counts once. Learning has its own limit of ${v.caps.learning} XP a day. At most ${v.caps.spending} XP a day can be added to what you spend (check-ins and learning together); the rest still counts toward your level and badges.</p></section>`;
    $("#lnSync", root).onclick = async () => { $("#lnSyncMsg", root).textContent = "Checking…"; const s = await api("/xp/learning/sync", {}).catch(() => null); $("#lnSyncMsg", root).textContent = !s?.ok ? "Lantern isn't running." : s.awarded ? `Added ${s.awarded} (+${s.xp} XP).` : "All caught up."; if (s?.awarded) setTimeout(() => panel(root), 900); };
  }
  window.dsLearning = { panel };
})();
