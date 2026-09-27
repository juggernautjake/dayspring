// The People page: one page per person (photos and faces, relationship and connections, prayer requests, goals, past and
// upcoming events, the message thread, calls, notes), the face groups nobody has named yet, and the open questions.
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (path, body, method) => {
    const r = await fetch("/api" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "That didn't work.");
    return j;
  };
  const day = (iso) => (iso ? new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");
  const av = (p) => `<span class="av">${p.thumb ? `<img alt="" src="data:image/jpeg;base64,${p.thumb}">` : esc((p.name ?? "?").charAt(0))}</span>`;
  let current = null, openPrivate = false;

  async function loadList() {
    const r = await api("/people");
    $("#list").innerHTML = r.people.length ? r.people.map((p) => `<button type="button" data-id="${p.id}" aria-current="${p.id === current}">${av(p)}<span><b>${esc(p.name)}</b><br><span class="muted small">${esc(p.relation ?? "")}${p.photos ? ` · ${p.photos} photo${p.photos > 1 ? "s" : ""}` : ""}</span></span></button>`).join("") : '<p class="muted">Nobody yet. Tell Dayspring about someone ("Sarah is my cousin"), or name the people in your photos.</p>';
    $("#list").onclick = (e) => { const b = e.target.closest("[data-id]"); if (b) show(b.dataset.id); };
    if (r.faces) loadGroups(); else $("#groups").hidden = true;
    loadQuestions();
  }
  async function loadGroups() {
    const g = (await api("/people/faces/groups")).groups;
    $("#groups").hidden = !g.length;
    $("#groups").innerHTML = `<h2 style="margin-top:0">Not named yet</h2>` + g.slice(0, 30).map((c) => `<div class="grp">${av({ name: "?", thumb: c.thumb })}<span style="flex:1"><b>${esc(c.label)}</b><br><span class="muted small">${c.photos.length} photo${c.photos.length > 1 ? "s" : ""}</span></span>
      <button class="g" data-name="${c.id}">Name</button><button class="g" data-ignore="${c.id}" title="Never ask about this person">Ignore</button></div>`).join("");
    $("#groups").onclick = async (e) => {
      const n = e.target.closest("[data-name]"), i = e.target.closest("[data-ignore]");
      try {
        if (n) { const name = prompt("Who is this?"); if (!name) return; const r = await api("/people/faces/name", { cluster: n.dataset.name, name }); await loadList(); show(r.person.id); if (r.suggestions?.length) suggest(r.suggestions[0], r.person); }
        if (i) { await api("/people/faces/action", { action: "ignore", cluster: i.dataset.ignore }); loadGroups(); }
      } catch (err) { alert(err.message); }
    };
  }
  async function suggest(s, person) {
    if (!confirm(`${s.label} (in ${s.photos.length} photo${s.photos.length > 1 ? "s" : ""}) looks like ${person.name}, ${Math.round(s.conf * 100)}% sure. Is it also ${person.name}?`)) { await api("/people/faces/action", { action: "suggestion", cluster: s.cluster, personId: person.id, yes: false }); return; }
    await api("/people/faces/action", { action: "suggestion", cluster: s.cluster, personId: person.id, yes: true });
    loadList(); show(person.id);
  }
  async function loadQuestions() {
    const q = await api("/people/questions").catch(() => ({ matches: [], suggestions: [] }));
    const items = [...q.matches.map((m) => `<div class="grp"><span style="flex:1">Is <b>“${esc(m.raw)}”</b> in your texts ${m.candidates.map((c) => `<button class="g" data-match="${m.id}" data-person="${c.id}">${esc(c.name)}</button>`).join(" ")}<button class="g" data-match="${m.id}" data-person="">someone else</button></span></div>`),
      ...q.suggestions.map((s) => `<div class="grp"><span style="flex:1">${esc(s.text)}. Add <b>${esc(s.name)}</b>?</span><button class="g" data-sug="${s.id}" data-st="yes">Add</button><button class="g" data-sug="${s.id}" data-st="no">No</button></div>`)];
    $("#questions").hidden = !items.length;
    $("#questions").innerHTML = `<h2 style="margin-top:0">Questions</h2>${items.join("")}`;
    $("#questions").onclick = async (e) => {
      const m = e.target.closest("[data-match]"), s = e.target.closest("[data-sug]");
      if (m) { await api("/people/questions/match", { id: m.dataset.match, personId: m.dataset.person || null }); loadQuestions(); }
      if (s) { await api("/people/questions/suggestion", { id: s.dataset.sug, status: s.dataset.st }); loadList(); }
    };
  }

  async function show(id) {
    current = id;
    document.querySelectorAll("#list [data-id]").forEach((b) => b.setAttribute("aria-current", String(b.dataset.id === id)));
    let p; try { p = await api(`/people/${id}${openPrivate ? "?private=1" : ""}`); } catch (e) { $("#profile").innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
    const sec = (title, body) => (body ? `<h2>${title}</h2>${body}` : "");
    const list = (a, f) => (a.length ? `<ul>${a.map(f).join("")}</ul>` : "");
    $("#profile").innerHTML = `<div class="row big">${av({ name: p.name, thumb: p.faces.thumb })}<div><h1 style="margin:0">${esc(p.name)}</h1><div class="muted">${esc(p.relation ?? "")}${p.nickname && p.nickname !== p.name ? ` · “${esc(p.nickname)}”` : ""}${p.birthday ? ` · birthday ${esc(p.birthday)}` : ""}</div></div></div>
      ${sec("Photos", p.faces.photos ? `<p class="muted small">In ${p.faces.photos} photo${p.faces.photos > 1 ? "s" : ""}${p.faces.firstSeen ? `, from ${day(p.faces.firstSeen)} to ${day(p.faces.lastSeen)}` : ""}.</p><div class="thumbs">${p.faces.photoIds.slice(0, 18).map((x) => `<img loading="lazy" alt="" src="/api/photos/img/${x}">`).join("")}</div>` : "")}
      ${sec("Connections", list(p.connections, (c) => `<li><a href="#" data-go="${c.personId}">${esc(c.name)}</a> <span class="muted">${esc(c.relation ?? "")}</span></li>`))}
      ${sec("Prayer", list(p.prayer, (x) => `<li>${x.answered ? "✓ " : ""}${esc(x.title)}${x.detail ? ` <span class="muted">— ${esc(x.detail)}</span>` : x.private ? ' <span class="muted">(private)</span>' : ""}${x.answered && x.answeredOn ? ` <span class="muted small">answered ${esc(x.answeredOn)}</span>` : ""}</li>`) + (p.prayer.some((x) => x.private) && !openPrivate ? '<button class="g" id="openPriv">Show private details</button>' : ""))}
      ${sec("Goals", list(p.goals, (g) => `<li>${g.done ? "✓ " : ""}${esc(g.text)}${g.due ? ` <span class="muted small">by ${esc(g.due)}</span>` : ""}</li>`))}
      ${sec("Coming up", list(p.events.upcoming, (e) => `<li>${esc(day(e.date))}: ${esc(e.title)}</li>`))}
      ${sec("Together before", list(p.events.past.slice(0, 8), (e) => `<li>${esc(day(e.date))}: ${esc(e.title)}</li>`))}
      ${sec("Messages", p.messages.length ? `<div class="msgs">${p.messages.slice(-60).map((m) => `<div class="msg ${m.dir === "out" ? "out" : ""}"><div class="small muted">${esc(day(m.at))}</div>${esc(m.text)}</div>`).join("")}</div>` : "")}
      ${sec("Calls", list(p.calls.slice(-15).reverse(), (c) => `<li>${esc(day(c.start))} · ${esc(c.app)}${c.missed ? " (missed)" : ""}${c.durationSec ? ` · ${Math.round(c.durationSec / 60)} min` : ""}</li>`))}
      ${sec("Notes", list(p.notes.slice(-20).reverse(), (n) => `<li>${esc(n.text)} <span class="muted small">${esc(day(n.at))}</span></li>`))}
      <h2>Edit</h2>
      <div class="row"><input id="e-rel" placeholder="Relationship (e.g. your cousin)" value="${esc(p.relation ?? "")}"><input id="e-nick" placeholder="Nickname" value="${esc(p.nickname ?? "")}"><button class="b" id="e-save">Save</button></div>
      <div class="row" style="margin-top:8px"><input id="e-note" placeholder="Add a note or fact" style="flex:1"><button class="g" id="e-add">Add</button></div>
      <div class="row" style="margin-top:8px"><input id="e-merge" placeholder="Merge with (name)"><button class="g" id="e-mergeb">Merge</button><button class="d" id="e-del">Delete ${esc(p.name)}</button></div>`;
    $("#profile").onclick = (e) => { const g = e.target.closest("[data-go]"); if (g) { e.preventDefault(); show(g.dataset.go); } };
    const po = $("#openPriv"); if (po) po.onclick = () => { openPrivate = true; show(id); };
    $("#e-save").onclick = async () => { await api(`/people/${id}`, { relation: $("#e-rel").value, nickname: $("#e-nick").value }); loadList(); show(id); };
    $("#e-add").onclick = async () => { const v = $("#e-note").value.trim(); if (!v) return; await api(`/people/${id}`, { note: v }); show(id); };
    $("#e-mergeb").onclick = async () => { const name = $("#e-merge").value.trim(); const list = (await api("/people")).people; const o = list.find((x) => x.name.toLowerCase() === name.toLowerCase()); if (!o) return alert(`I don't know ${name}.`); if (!confirm(`Merge ${o.name} into ${p.name}? Their notes, faces and messages move here.`)) return; await api("/people/merge", { keep: id, merge: o.id }); loadList(); show(id); };
    $("#e-del").onclick = async () => { if (!confirm(`Delete ${p.name}? Their profile, faces (fingerprints and thumbnails), saved messages and calls are removed. This can't be undone.`)) return; await api(`/people/${id}`, undefined, "DELETE"); current = null; $("#profile").innerHTML = '<p class="muted">Deleted.</p>'; loadList(); };
  }
  loadList().catch((e) => { $("#list").textContent = e.message; });
  const want = new URLSearchParams(location.search).get("id"); if (want) show(want);
})();
