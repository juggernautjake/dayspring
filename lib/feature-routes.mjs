// Feature maturity, compatibility and testing (paths are after /api).
//   GET  /features                       the channel, every feature (stage, on, switchable, New), hidden sections, jobs
//   GET  /features/gate.js               for the screen and Settings, loaded first: window.dsFeatures, and the buttons,
//                                        panels and stylesheets of features that are off, hidden before anything draws
//   POST /features/switch { id, on }     the owner's off switch (beta; dev only in development or for the developer)
//   GET  /compat                         the compatibility lists (compat/*.json, with the owner's verifications)
//   POST /compat/verify { id, test }     mark a device verified (Testing page)       POST /compat/unverify { id }
//   GET  /testing                        the checklist, results and progress (404 unless development or the developer)
//   POST /testing/result { id, status, note }       POST /testing/promote { feature }       POST /testing/unpromote { feature }
//   GET  /testing/export?format=md|csv   the results, to bake promotions into the next release (scripts/promote-features.mjs)
import * as features from "./features.mjs";
import * as compat from "./compat.mjs";
import * as testing from "./testing.mjs";

const who = () => "owner";

// What the screen and Settings need before they draw: which features are on, and what to hide while they're off.
export function gateScript() {
  const st = features.status();
  const on = Object.fromEntries(st.features.map((f) => [f.id, f.on]));
  const data = { channel: st.channel, channelName: st.channelName, developer: st.developer, testing: st.testing, on, hiddenSections: st.hiddenSections, hide: st.ui.selectors, styles: st.ui.styles };
  return `/* Dayspring feature gate (lib/features.mjs), generated */
(function () {
  var d = ${JSON.stringify(data)};
  window.dsFeatures = { channel: d.channel, channelName: d.channelName, developer: d.developer, testing: d.testing, hiddenSections: d.hiddenSections,
    on: function (id) { return d.on[id] === undefined ? d.channel === "dev" : d.on[id] === true; } };
  try {
    if (d.hide.length) { var s = document.createElement("style"); s.id = "dsFeatureGate"; s.textContent = d.hide.join(",") + "{display:none!important}"; (document.head || document.documentElement).appendChild(s); }
    var off = function () { d.styles.forEach(function (href) { var l = document.querySelector('link[rel="stylesheet"][href="' + href + '"]'); if (l) l.disabled = true; }); };
    if (d.styles.length) { off(); document.addEventListener("DOMContentLoaded", off); }
  } catch (e) { /* the page still works */ }
})();
`;
}

export async function handle(req, res, { m, p, q, send, readJSON }) {
  if (!/^\/(features|compat|testing)(\/|$)/.test(p)) return false;
  const body = m === "POST" ? await readJSON(req).catch(() => ({})) : {};
  try {
    // ---- features
    if (m === "GET" && p === "/features") return send(res, 200, features.status()), true;
    if (m === "GET" && p === "/features/gate.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
      res.end(gateScript()); return true;
    }
    if (m === "POST" && p === "/features/switch") {
      const on = features.setSwitch(String(body.id ?? ""), body.on !== false);
      return send(res, 200, { id: body.id, on, restartHint: "Some changes show fully after the screen reloads.", ...features.status() }), true;
    }
    // ---- compatibility
    if (m === "GET" && p === "/compat") return send(res, 200, { ...compat.load(), counts: compat.counts(), canVerify: features.testingVisible() }), true;
    if (m === "POST" && (p === "/compat/verify" || p === "/compat/unverify")) {
      if (!features.testingVisible()) return send(res, 404, { error: `no route ${m} ${p}` }), true;
      const e = p === "/compat/verify" ? compat.verify(String(body.id ?? ""), { by: who(), test: body.test ?? null }) : compat.unverify(String(body.id ?? ""));
      return send(res, 200, { entry: e }), true;
    }
    // ---- testing (the development version, or the developer on any build)
    if (p.startsWith("/testing")) {
      if (!features.testingVisible()) return send(res, 404, { error: `no route ${m} ${p}` }), true;
      if (m === "GET" && p === "/testing") return send(res, 200, { ...testing.checklist(), results: testing.results(), progress: testing.progress(), channel: features.channel(), features: features.status().features }), true;
      if (m === "POST" && p === "/testing/result") return send(res, 200, testing.setResult(String(body.id ?? ""), { status: body.status ?? null, note: body.note ?? "", by: who() })), true;
      if (m === "POST" && p === "/testing/promote") return send(res, 200, { promoted: testing.promote(String(body.feature ?? ""), { by: who() }), progress: testing.progress() }), true;
      if (m === "POST" && p === "/testing/unpromote") return send(res, 200, { feature: features.unpromote(String(body.feature ?? "")), progress: testing.progress() }), true;
      if (m === "GET" && p === "/testing/export") {
        const csv = q?.get("format") === "csv";
        const text = csv ? testing.exportCSV() : testing.exportMarkdown();
        const name = `dayspring-test-results-${new Date().toLocaleDateString("en-CA")}.${csv ? "csv" : "md"}`;
        res.writeHead(200, { "content-type": csv ? "text/csv; charset=utf-8" : "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" });
        res.end(text); return true;
      }
    }
  } catch (e) { return send(res, 400, { error: e.message }), true; }
  return false;
}
