// The Money review page (money.html): import a statement, read it from the website (read-only), the report with a
// sortable table of every transaction, privacy settings, saved reports and "delete all". Talks to /api/money (lib/money-routes.mjs).
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => `$${Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const api = async (path, body) => {
    const r = await fetch("/api/money" + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
    return j;
  };
  const say = (t, bad = false) => { const m = $("#msg"); m.textContent = t || ""; m.classList.toggle("bad", bad); };
  let S = null, R = null, sortKey = "date", sortDir = -1;

  function renderState() {
    $("#folder").textContent = S.importFolder;
    $("#permText").textContent = S.permissionText;
    $("#permOff").hidden = S.permission; $("#permOnBox").hidden = !S.permission;
    $("#bankUrl").value = S.settings.bankUrl || "";
    $("#months").value = S.settings.months || 3;
    $("#browserState").textContent = S.browser.open ? `The money window is open${S.browser.host ? ` on ${S.browser.host}` : ""}. It closes by itself after ${S.browser.idleMinutes} idle minutes.` : "The money window is closed.";
    $("#consentLabel").textContent = `Let my AI analyse the report. ${S.consentText.replace(/ OK\?$/, "")}`;
    $("#aiConsent").checked = Boolean(S.settings.aiConsent);
    $("#noAi").hidden = S.aiReady;
    $("#visionLabel").textContent = `Screenshots as a last resort. ${S.visionConsentText.replace(/ OK\?$/, "")}`;
    $("#visionConsent").checked = Boolean(S.settings.visionConsent);
    $("#retention").value = S.settings.retentionDays; $("#idle").value = S.settings.idleMinutes;
    $("#reports").innerHTML = S.reports.length ? S.reports.map((r) => `<li><a href="#" data-open="${esc(r.id)}">${esc(r.id.slice(0, 10))} ${esc(r.id.slice(11, 16).replace("-", ":"))}</a> · <a href="/api/money/file?id=${encodeURIComponent(r.id)}&kind=md">Markdown</a> · <a href="/api/money/file?id=${encodeURIComponent(r.id)}&kind=csv">CSV</a> · <button data-del="${esc(r.id)}">Delete</button></li>`).join("") : "<li class='muted'>None yet.</li>";
    $("#log").textContent = (S.activity ?? []).join("\n") || "Nothing yet.";
  }
  async function load() { S = await api("/state"); renderState(); }

  // ---- the report ------------------------------------------------------------------------------------------------
  const table = (el, head, rows) => { el.innerHTML = `<tr>${head.map((h) => `<th class="${h.num ? "num" : ""}">${esc(h.t)}</th>`).join("")}</tr>` + rows.map((r) => `<tr>${r.map((c, i) => `<td class="${head[i].num ? "num" : ""}">${c}</td>`).join("")}</tr>`).join(""); };
  const list = (el, items, empty = "None found.") => { el.innerHTML = items.length ? items.map((x) => `<li>${x}</li>`).join("") : `<li class="muted">${empty}</li>`; };
  const monthName = (ym) => new Date(`${ym}-15T12:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  function renderReport() {
    $("#report").hidden = !R;
    if (!R) return;
    $("#rTitle").textContent = `Your money, ${R.from} to ${R.to}`;
    $("#rSub").textContent = `${R.count} transactions from ${R.sources.join(", ")}. Made ${new Date(R.createdAt).toLocaleString()}.`;
    const subsYear = R.recurring.reduce((s, x) => s + x.yearly, 0);
    $("#tiles").innerHTML = [["Money in", money(R.totals.in), "in"], ["Money out", money(R.totals.out), "out"], ["Net", money(R.totals.net), R.totals.net >= 0 ? "in" : "out"],
      ["Repeating charges", `${R.recurring.length} · ${money(subsYear)}/yr`, ""], ["Fees and interest", money(R.feesTotal), R.feesTotal ? "out" : ""], ["Worth a look", String(R.cancel.length), ""]]
      .map(([t, v, c]) => `<div class="tile"><span class="muted small">${t}</span><b class="${c}">${esc(v)}</b></div>`).join("");
    list($("#cancel"), R.cancel.map((c) => `<b>${esc(c.merchant)}</b> ${money(c.amount)} ${esc(c.every)} (${money(c.yearly)} a year)<div class="reason">Why: ${esc(c.reasons.join("; "))}.</div><div class="reason">How to cancel: ${esc(c.how)}</div>`), "Nothing stood out.");
    table($("#recurring"), [{ t: "Merchant" }, { t: "Amount", num: 1 }, { t: "How often" }, { t: "Last" }, { t: "Next expected" }, { t: "Per year", num: 1 }],
      R.recurring.map((x) => [`${esc(x.merchant)}${x.priceUp ? ' <span class="tag">price went up</span>' : ""}`, money(x.amount), esc(x.every), esc(x.last), esc(x.next), money(x.yearly)]));
    table($("#months"), [{ t: "Month" }, { t: "In", num: 1 }, { t: "Out", num: 1 }, { t: "Net", num: 1 }], R.months.map((m) => [esc(monthName(m.month)), money(m.in), money(m.out), `<span class="${m.net >= 0 ? "in" : "out"}">${money(m.net)}</span>`]));
    table($("#cats"), [{ t: "Category" }, { t: "Total", num: 1 }, { t: "Share", num: 1 }, { t: "Count", num: 1 }], R.categories.map((c) => [esc(c.category), money(c.total), `${c.share}%`, c.count]));
    table($("#merchants"), [{ t: "Merchant" }, { t: "Total", num: 1 }, { t: "Count", num: 1 }], R.merchants.map((m) => [esc(m.merchant), money(m.total), m.count]));
    list($("#prices"), R.priceIncreases.map((p) => `${esc(p.merchant)}: ${money(p.from)} to ${money(p.to)} on ${esc(p.date)} (about ${money(p.yearlyExtra)} more a year)`));
    list($("#dups"), R.duplicates.map((d) => `${esc(d.merchant)}: ${money(d.amount)} on ${esc(d.dates.join(" and "))}`));
    list($("#unusual"), R.unusual.map((u) => `${esc(u.date)} ${esc(u.merchant)}: ${money(u.amount)} (${esc(u.why)})`));
    list($("#fees"), R.fees.map((f) => `${esc(f.date)} ${esc(f.description || f.merchant)}: ${money(f.amount)}`));
    $("#insightsBox").hidden = !R.insights; $("#insights").textContent = R.insights ?? "";
    $("#rNotes").textContent = (R.notes ?? []).join(" ");
    renderTx();
  }
  const COLS = [["date", "Date"], ["description", "Description"], ["merchant", "Merchant"], ["amount", "Amount", 1], ["direction", "In/Out"], ["category", "Category"], ["status", "Status"], ["account", "Account / source"]];
  function renderTx() {
    const f = $("#filter").value.trim().toLowerCase();
    let rows = R.transactions.filter((t) => !f || `${t.description} ${t.merchant} ${t.category} ${t.note ?? ""} ${t.source}`.toLowerCase().includes(f));
    rows = [...rows].sort((a, b) => { const x = a[sortKey] ?? "", y = b[sortKey] ?? ""; return (typeof x === "number" ? x - y : String(x).localeCompare(String(y))) * sortDir; });
    $("#shownCount").textContent = `${rows.length} of ${R.transactions.length}`;
    $("#tx").innerHTML = `<tr>${COLS.map(([k, t, n]) => `<th class="sort ${n ? "num" : ""}" data-k="${k}" tabindex="0" aria-sort="${sortKey === k ? (sortDir > 0 ? "ascending" : "descending") : "none"}">${t}${sortKey === k ? ` <span class="arr">${sortDir > 0 ? "▲" : "▼"}</span>` : ""}</th>`).join("")}</tr>` +
      rows.map((t) => `<tr><td>${esc(t.date)}</td><td>${esc(t.description)}${t.note ? `<div class="reason">${esc(t.note)}</div>` : ""}</td><td>${esc(t.merchant)}</td><td class="num ${t.direction}">${t.direction === "out" ? "−" : "+"}${money(t.amount)}</td><td>${t.direction}</td><td>${esc(t.category)}</td><td>${t.status}</td><td>${esc(t.account ?? t.source)}</td></tr>`).join("");
  }
  $("#tx").addEventListener("click", (e) => { const th = e.target.closest("th[data-k]"); if (!th) return; const k = th.dataset.k; sortDir = sortKey === k ? -sortDir : (k === "date" || k === "amount" ? -1 : 1); sortKey = k; renderTx(); });
  $("#tx").addEventListener("keydown", (e) => { if (e.key === "Enter") e.target.closest("th[data-k]")?.click(); });
  $("#filter").addEventListener("input", () => R && renderTx());
  async function openReport(id) { try { R = await api("/report" + (id ? `?id=${encodeURIComponent(id)}` : "")); renderReport(); $("#report").scrollIntoView({ behavior: "smooth" }); } catch (e) { R = null; renderReport(); } }

  // ---- actions ---------------------------------------------------------------------------------------------------
  const run = (fn) => async (...a) => { try { await fn(...a); } catch (e) { say(e.message, true); } };
  async function importFiles(files) {
    for (const f of files) {
      if (!/\.(csv|ofx|qfx|qbo)$/i.test(f.name)) { say(`${f.name} isn't a CSV or OFX file.`, true); continue; }
      say(`Importing ${f.name}…`);
      const r = await api("/import", { name: f.name, text: await f.text() });
      say(`Imported ${r.imported.count} transactions. ${r.say ?? ""}`);
      await load(); if (r.id) await openReport(r.id);
    }
  }
  $("#file").addEventListener("change", run(async (e) => { await importFiles([...e.target.files]); e.target.value = ""; }));
  const drop = $("#drop");
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", run(async (e) => { e.preventDefault(); drop.classList.remove("over"); await importFiles([...e.dataTransfer.files]); }));
  $("#importFolder").onclick = run(async () => { const r = await api("/import-folder", {}); say(r.done.length ? `Imported ${r.done.reduce((s, x) => s + x.count, 0)} transactions. ${r.say ?? ""}` : `No CSV or OFX files in the folder yet.${r.failed.length ? ` Couldn't read: ${r.failed.map((f) => `${f.file} (${f.error})`).join(", ")}` : ""}`, !r.done.length && r.failed.length > 0); await load(); if (r.id) await openReport(r.id); });
  $("#permOn").onclick = run(async () => { if (!$("#understood").checked) { say("Please read the explanation and tick \"I understand\" first.", true); return; } S = await api("/permission", { on: true, understood: true }); renderState(); say("Money review (read-only) is on."); });
  $("#permOffBtn").onclick = run(async () => { S = await api("/permission", { on: false }); renderState(); say("Money review is off. Imports still work."); });
  const open = (target) => run(async () => { say("Opening…"); const r = await api("/open", { target }); say(`Opened ${r.host}. ${r.say}`); await load(); });
  $("#openVenmo").onclick = open("venmo"); $("#openCash").onclick = open("cashapp");
  $("#openBank").onclick = run(async () => { const u = $("#bankUrl").value.trim(); if (!u) { say("Type your bank's web address first.", true); return; } await api("/settings", { bankUrl: u }); await open("bank")(); });
  $("#closeBrowser").onclick = run(async () => { await api("/close", {}); say("Closed the money window."); await load(); });
  $("#review").onclick = run(async () => { say("Reading your transactions… this can take a minute."); await api("/settings", { months: Number($("#months").value) || 3 }); const r = await api("/review", { months: Number($("#months").value) || 3 }); say(r.say, !r.ok); await load(); if (r.id) await openReport(r.id); });
  $("#aiConsent").onchange = run(async (e) => { if (e.target.checked && !confirm(S.consentText)) { e.target.checked = false; return; } S = await api("/consent", { ai: e.target.checked }); renderState(); });
  $("#visionConsent").onchange = run(async (e) => { if (e.target.checked && !S.settings.aiConsent) { e.target.checked = false; say("Allow AI analysis first.", true); return; } if (e.target.checked && !confirm(S.visionConsentText)) { e.target.checked = false; return; } S = await api("/consent", { vision: e.target.checked }); renderState(); });
  $("#saveSettings").onclick = run(async () => { S = await api("/settings", { retentionDays: Number($("#retention").value), idleMinutes: Number($("#idle").value) }); renderState(); say("Saved."); });
  $("#reports").addEventListener("click", run(async (e) => {
    const o = e.target.closest("[data-open]"); if (o) { e.preventDefault(); await openReport(o.dataset.open); return; }
    const d = e.target.closest("[data-del]"); if (d && confirm("Delete this report (Markdown, CSV and all)?")) { S = await api("/report/delete", { id: d.dataset.del }); renderState(); if (R?.id === d.dataset.del) { R = null; renderReport(); } }
  }));
  $("#deleteAll").onclick = run(async () => {
    const t = prompt("This deletes every transaction and report Dayspring has kept, and can't be undone. Type DELETE to go ahead.");
    if (t !== "DELETE") return;
    const r = await api("/delete-all", { confirm: "DELETE" }); S = r; renderState(); R = null; renderReport(); say(`Deleted ${r.deleted.raw} saved read(s) and ${r.deleted.reports} report(s).`);
  });

  (async () => {
    try { await load(); } catch (e) { say(e.message, true); return; }
    const want = new URLSearchParams(location.search);
    if (want.get("s") === "import") $("#importPanel").scrollIntoView();
    if (want.get("s") === "bank") { $("#sitePanel").scrollIntoView(); $("#bankUrl")?.focus(); }
    if (want.get("report") || S.reports.length) await openReport(want.get("report") || null);
  })();
})();
