// How a printer's state is said out loud ("Printer 1 is printing benchy: 37% done, layer 44 of 120, about 1 hour left.").
// Shared by the voice commands, the AI's tools and other Dayspring computers asking (lib/remote).
export const mins = (m) => (m == null ? null : m >= 60 ? `${Math.floor(m / 60)} hour${Math.floor(m / 60) === 1 ? "" : "s"}${m % 60 ? ` ${m % 60} minutes` : ""}` : `${m} minute${m === 1 ? "" : "s"}`);
function sayStatus(s) {
  if (!s) return "I don't know that printer.";
  if (!s.online) return `${s.name} isn't connected right now${s.error ? ` (${s.error})` : ""}.`;
  const t = (x) => (x?.temp != null ? `${Math.round(x.temp)}°` : "?");
  const temps = `nozzle ${s.nozzle?.length > 1 ? s.nozzle.map(t).join(" and ") : t(s.nozzle?.[0])}, bed ${t(s.bed)}`;
  if (s.state === "printing" || s.state === "preparing") return `${s.name} is ${s.state === "preparing" ? "getting ready to print" : "printing"}${s.job?.name ? ` ${s.job.name}` : ""}: ${s.progress != null ? `${Math.round(s.progress)}% done` : "under way"}${s.layer ? `, layer ${s.layer}${s.totalLayers ? ` of ${s.totalLayers}` : ""}` : ""}${s.remainingMin != null ? `, about ${mins(s.remainingMin)} left` : ""}. ${temps[0].toUpperCase() + temps.slice(1)}.${s.errors?.length ? ` It reports: ${s.errors.map((e) => e.text).join("; ")}.` : ""}`;
  if (s.state === "paused") return `${s.name} is paused${s.job?.name ? ` on ${s.job.name}` : ""} at ${Math.round(s.progress ?? 0)}%.${s.errors?.length ? ` It reports: ${s.errors.map((e) => e.text).join("; ")}.` : ""}`;
  if (s.state === "finished") return `${s.name} finished${s.job?.name ? ` ${s.job.name}` : " its print"}. ${s.hot ? "It's still cooling down." : "It's idle now."}`;
  if (s.state === "failed") return `${s.name}'s last print failed.${s.errors?.length ? ` ${s.errors.map((e) => e.text).join("; ")}.` : ""}`;
  return `${s.name} is idle (${temps}).`;
}
export { sayStatus };
