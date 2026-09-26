// The in-app guide: a table of contents, search across every page, and a small Markdown renderer (headings, lists,
// code, tables, links, callouts). Pages come from /api/help (docs/*.md). Deep links: /help#voices, /help#voices/free-voices.
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // the same anchors GitHub makes, so links like voices.md#free-voices work in both places
  const anchor = (t) => String(t).toLowerCase().replace(/<[^>]+>/g, "").replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s/g, "-");
  const plain = (md) => md.replace(/```[\s\S]*?```/g, " ").replace(/`([^`]*)`/g, "$1").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/:?-{3,}:?/g, " ").replace(/[*_>#|]/g, " ").replace(/\s+/g, " ");

  let docs = [], cache = {}, current = null;

  // ---------- Markdown ----------
  function inline(s) {
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
    s = esc(s);
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => `<img alt="${alt}" src="${safeUrl(imgUrl(src))}" loading="lazy" style="max-width:100%;border-radius:.6em">`);
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => link(text, href));
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^\w*])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<em>$2</em>").replace(/(^|\W)_([^_\s][^_]*?)_(?!\w)/g, "$1<em>$2</em>");
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, pre, u) => `${pre}<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[i])}</code>`);
  }
  // screenshots live in docs/images/ (images/x.png on GitHub) and come from /api/help/image/ here
  const imgUrl = (u) => { const m = /^(?:\.\.\/)*(?:docs\/)?images\/([a-z0-9-]+\.(?:png|jpe?g|gif|webp|svg))$/i.exec(u); return m ? "/api/help/image/" + m[1].toLowerCase() : u; };
  function safeUrl(u) { u = u.replace(/&amp;/g, "&"); return /^(https?:|\/|#|[a-z0-9-]+\.md)/i.test(u) ? esc(u) : "#"; }
  function link(text, href) {
    href = href.replace(/&amp;/g, "&");
    // another page of the guide: install.md, docs/install.md#step-2, ../docs/voices.md. The developer pages in docs/dev/
    // are "dev-<name>": dev/architecture.md, or a bare name from another developer page (../faq.md leaves dev/)
    const md = /^(?:(.*)\/)?([a-z0-9-]+)\.md(?:#([\w-]+))?$/i.exec(href);
    if (md && !/^https?:/i.test(href)) {
      const dir = md[1] ?? "", dev = /(^|\/)dev$/i.test(dir) || (!dir && String(current ?? "").startsWith("dev-"));
      return `<a href="#${dev ? "dev-" : ""}${md[2].toLowerCase()}${md[3] ? "/" + md[3] : ""}">${text}</a>`;
    }
    if (href.startsWith("#")) return `<a href="#${current ?? ""}/${esc(href.slice(1))}">${text}</a>`;
    if (/^https?:/i.test(href)) return `<a href="${esc(href)}" target="_blank" rel="noopener">${text}</a>`;
    if (href.startsWith("/")) return `<a href="${esc(href)}">${text}</a>`;
    return text;                                              // relative links outside the guide (e.g. ../../releases)
  }
  const CALLOUT = [[/^(tip)\b/i, "tip"], [/^(note)\b/i, "note"], [/^(warning|important|careful)\b/i, "warn"], [/^(if it doesn'?t work|troubleshooting)\b/i, "fix"]];

  function render(md) {
    const lines = md.replace(/\r/g, "").split("\n");
    const out = []; const headings = [];
    let i = 0;
    const isBlockStart = (l) => /^(#{1,6}\s|```|>|\s*([-*+]|\d+[.)])\s|\|.*\||---+\s*$|\*\*\*+\s*$)/.test(l);
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) { i++; continue; }
      let m;
      if ((m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l))) {
        const n = m[1].length, id = anchor(m[2]);
        if (n === 2 || n === 3) headings.push({ n, id, text: m[2].replace(/[*`]/g, "") });
        out.push(`<h${n} id="${id}">${inline(m[2])}${n > 1 && n < 4 ? `<a class="anchor" href="#${current}/${id}" aria-label="Link to this section">#</a>` : ""}</h${n}>`);
        i++; continue;
      }
      if ((m = /^(\s*)```\s*([\w-]*)/.exec(l))) {
        const ind = m[1].length, body = []; i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) { body.push(lines[i].slice(Math.min(ind, lines[i].search(/\S|$/)))); i++; }
        i++;
        out.push(`<pre><button class="copy" type="button">Copy</button><code>${esc(body.join("\n"))}</code></pre>`);
        continue;
      }
      if (/^\s*(---+|\*\*\*+)\s*$/.test(l)) { out.push("<hr>"); i++; continue; }
      if (/^>/.test(l)) {
        const body = [];
        while (i < lines.length && /^>/.test(lines[i])) { body.push(lines[i].replace(/^>\s?/, "")); i++; }
        let cls = "", html = render(body.join("\n")).html;
        const lead = /^<p><strong>([^<]+?):?<\/strong>:?\s*/.exec(html);
        if (lead) {
          const hit = CALLOUT.find(([re]) => re.test(lead[1].replace(/&#39;/g, "'")));
          if (hit) { cls = hit[1]; html = html.replace(lead[0], `<p><span class="label">${lead[1].replace(/:$/, "")}:</span> `); }
        }
        out.push(`<blockquote${cls ? ` class="${cls}"` : ""}>${html}</blockquote>`);
        continue;
      }
      if (/^\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[i + 1])) {
        const cells = (r) => r.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
        const head = cells(l); i += 2;
        const rows = [];
        while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
        out.push(`<div class="table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
        continue;
      }
      if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) {
        const r = list(lines, i); out.push(r.html); i = r.next; continue;
      }
      const para = [];
      while (i < lines.length && lines[i].trim() && !(para.length && isBlockStart(lines[i]))) { para.push(lines[i].trim()); i++; }
      out.push(`<p>${inline(para.join(" "))}</p>`);
    }
    return { html: out.join("\n"), headings };
  }
  // A list, with nesting by indentation and code blocks / paragraphs inside items.
  function list(lines, i) {
    const ind0 = lines[i].search(/\S/), ordered = /^\s*\d+[.)]\s/.test(lines[i]);
    const start = ordered ? Number(/^\s*(\d+)/.exec(lines[i])[1]) : 1;
    const items = [];
    while (i < lines.length) {
      const l = lines[i];
      const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(l);
      if (m && m[1].length === ind0) { items.push([m[3]]); i++; continue; }
      if (!l.trim()) {
        // a blank line ends the list unless the next line is indented under it or is another item
        const nx = lines.slice(i + 1).find((x) => x.trim());
        if (nx === undefined) break;
        const nInd = nx.search(/\S/), nItem = /^\s*([-*+]|\d+[.)])\s/.test(nx);
        if (nInd > ind0 || (nItem && nInd === ind0)) { items.at(-1)?.push(""); i++; continue; }
        break;
      }
      const lInd = l.search(/\S/);
      if (lInd > ind0 && items.length) { items.at(-1).push(l.slice(Math.min(lInd, ind0 + (ordered ? 3 : 2)))); i++; continue; }
      break;
    }
    const lis = items.map((it) => {
      let first = it[0], cls = "";
      const task = /^\[([ xX])\]\s+(.*)$/.exec(first);
      if (task) { cls = ` class="task${task[1].trim() ? " done" : ""}"`; first = task[2]; }
      const rest = it.slice(1);
      const inner = rest.some((x) => x.trim()) ? render(rest.join("\n")).html : "";
      return `<li${cls}>${inline(first)}${inner}</li>`;
    });
    const tag = ordered ? "ol" : "ul";
    return { html: `<${tag}${ordered && start !== 1 ? ` start="${start}"` : ""}>${lis.join("")}</${tag}>`, next: i };
  }

  // ---------- data ----------
  async function getJSON(u) { const r = await fetch(u); if (!r.ok) throw new Error(`${r.status}`); return r.json(); }
  async function load(slug) {
    if (!cache[slug]) cache[slug] = await getJSON(`/api/help/doc/${encodeURIComponent(slug)}`);
    return cache[slug];
  }

  // ---------- contents ----------
  const GROUPS = [
    ["Start here", ["getting-started", "install", "setup-wizard", "tutorials", "talking-to-dayspring", "schedule", "learning", "lantern"]],
    ["Make it yours", ["ai-providers", "voices", "audio-devices", "display-setup", "settings-reference"]],
    ["Connect", ["connections", "permissions", "files-and-browser", "documents", "music", "discover", "phone", "discord-calls", "discord-bot", "photos", "claude-code"]],
    ["More", ["faith-features", "privacy", "updating", "troubleshooting", "faq"]],
    ["For developers", ["dev-architecture", "dev-code-map", "dev-api-reference", "dev-extending", "dev-testing", "dev-releasing", "integrations-ideas", "publishing-releases"]],
  ];
  function drawToc(headings = []) {
    const known = new Set(GROUPS.flatMap((g) => g[1]));
    const extra = docs.filter((d) => !known.has(d.slug)).map((d) => d.slug);
    const groups = GROUPS.map(([t, s]) => [t, s.filter((x) => docs.some((d) => d.slug === x))]).concat(extra.length ? [["Other", extra]] : []).filter((g) => g[1].length);
    const title = (s) => docs.find((d) => d.slug === s)?.title ?? s;
    $("#toc").innerHTML = groups.map(([t, slugs]) => `<h2>${esc(t)}</h2>` + slugs.map((s) => {
      const on = s === current;
      const sub = on && headings.filter((h) => h.n === 2).length > 1
        ? `<div class="sub">${headings.filter((h) => h.n === 2).map((h) => `<a href="#${s}/${h.id}">${esc(h.text)}</a>`).join("")}</div>` : "";
      return `<a href="#${s}"${on ? ' class="on" aria-current="page"' : ""}>${esc(title(s))}</a>${sub}`;
    }).join("")).join("");
  }

  // ---------- pages ----------
  async function show(slug, section) {
    document.body.classList.remove("menu");
    // a link to a page that doesn't exist (an old bookmark, a typo): say so, and suggest the closest pages
    if (slug && docs.length && !docs.some((d) => d.slug === slug)) {
      const words = slug.toLowerCase().split(/[-_\s]+/).filter((w) => w.length > 2);
      const near = docs.map((d) => ({ d, s: words.filter((w) => d.slug.includes(w) || d.title.toLowerCase().includes(w)).length })).filter((x) => x.s).sort((a, b) => b.s - a.s).slice(0, 5).map((x) => x.d);
      current = null; drawToc();
      $("#doc").className = "results";
      $("#doc").innerHTML = `<h1>Page not found</h1><p class="empty">There's no guide page called “${esc(slug)}”. It may have moved.</p>`
        + (near.length ? `<h2>Maybe one of these?</h2>${near.map((d) => `<a class="hit" href="#${d.slug}"><b>${esc(d.title)}</b></a>`).join("")}` : "")
        + `<p><a class="hit" href="#${docs[0].slug}"><b>Start at the beginning: ${esc(docs[0].title)}</b></a></p>`;
      $("#main").scrollTop = 0;
      return;
    }
    if (!docs.some((d) => d.slug === slug)) slug = docs[0]?.slug;
    if (!slug) { $("#doc").innerHTML = `<p class="empty">The guide isn't installed. Look for the <code>docs</code> folder.</p>`; return; }
    let d;
    try { d = await load(slug); } catch { $("#doc").innerHTML = `<p class="empty">Couldn't load that page. Is Dayspring running?</p>`; return; }
    const prevSlug = current; current = slug;
    const r = render(d.markdown);
    const idx = docs.findIndex((x) => x.slug === slug), prev = docs[idx - 1], next = docs[idx + 1];
    const art = $("#doc");
    art.className = ""; void art.offsetWidth;
    art.innerHTML = r.html + `<nav class="pager">${prev ? `<a class="prev" href="#${prev.slug}"><small>← Previous</small>${esc(prev.title)}</a>` : "<span></span>"}${next ? `<a class="next" href="#${next.slug}"><small>Next →</small>${esc(next.title)}</a>` : ""}</nav>`;
    document.title = `${d.title} · Dayspring Guide`;
    drawToc(r.headings);
    wireCopy();
    const target = section && document.getElementById(section);
    if (target) { if (prevSlug !== slug) $("#main").style.scrollBehavior = "auto"; target.scrollIntoView({ block: "start" }); $("#main").style.scrollBehavior = ""; target.classList.add("flash"); }
    else $("#main").scrollTop = 0;
  }
  function wireCopy() {
    document.querySelectorAll("pre .copy").forEach((b) => b.onclick = async () => {
      const t = b.nextElementSibling.textContent;
      try { await navigator.clipboard.writeText(t); b.textContent = "Copied"; } catch { b.textContent = "Select and copy"; }
      setTimeout(() => (b.textContent = "Copy"), 1600);
    });
  }

  // ---------- search ----------
  let all = null;
  async function searchIndex() {
    if (all) return all;
    all = await Promise.all(docs.map(async (d) => {
      const x = await load(d.slug).catch(() => null);
      if (!x) return [];
      // one entry per section, so a hit can jump straight to it
      const parts = []; let sec = { id: "", title: d.title, text: "" };
      for (const line of x.markdown.split("\n")) {
        const h = /^(#{2,3})\s+(.*)$/.exec(line);
        if (h) { parts.push(sec); sec = { id: anchor(h[2]), title: h[2].replace(/[*`]/g, ""), text: "" }; }
        else sec.text += line + "\n";
      }
      parts.push(sec);
      return parts.map((p) => ({ slug: d.slug, page: d.title, id: p.id, title: p.title, text: plain(p.text) }));
    })).then((a) => a.flat());
    return all;
  }
  async function search(q) {
    const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
    if (!words.length) return;
    const idx = await searchIndex();
    const scored = idx.map((e) => {
      const t = e.title.toLowerCase(), b = e.text.toLowerCase(), p = e.page.toLowerCase();
      let s = 0;
      for (const w of words) {
        const inT = t.includes(w), inP = p.includes(w), n = b.split(w).length - 1;
        if (!inT && !inP && !n) return { e, s: 0 };
        s += (inT ? 8 : 0) + (inP ? 4 : 0) + Math.min(n, 6);
      }
      if (t.includes(q.toLowerCase()) || b.includes(q.toLowerCase())) s += 10;
      return { e, s };
    }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 25);
    const mark = (s) => { let h = esc(s); for (const w of words) h = h.replace(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"), "<mark>$1</mark>"); return h; };
    const snip = (text) => {
      const lo = text.toLowerCase(), at = Math.max(0, Math.min(...words.map((w) => { const k = lo.indexOf(w); return k < 0 ? 1e9 : k; })));
      const from = Math.max(0, (at === 1e9 ? 0 : at) - 60);
      return (from ? "…" : "") + text.slice(from, from + 180).trim() + "…";
    };
    current = null;
    drawToc();
    $("#doc").className = "results";
    $("#doc").innerHTML = `<h1>Search: “${esc(q)}”</h1>` + (scored.length
      ? scored.map(({ e }) => `<a class="hit" href="#${e.slug}${e.id ? "/" + e.id : ""}"><b>${mark(e.title)}</b><small>${esc(e.page)}</small><span class="snip">${mark(snip(e.text))}</span></a>`).join("")
      : `<p class="empty">Nothing found. Try fewer or different words, or browse the contents.</p>`);
    $("#main").scrollTop = 0;
  }

  // ---------- routing ----------
  function route() {
    const h = decodeURIComponent(location.hash.slice(1));
    if (h.startsWith("search=")) { const q = h.slice(7); $("#q").value = q; search(q); return; }
    const [slug, section] = h.split("/");
    show(slug || docs[0]?.slug, section);
  }
  let typing;
  $("#q").addEventListener("input", (e) => {
    clearTimeout(typing);
    const q = e.target.value.trim();
    typing = setTimeout(() => {
      if (q.length > 1) { history.replaceState(null, "", `#search=${encodeURIComponent(q)}`); search(q); }
      else if (!q) route();
      else if ($("#doc").className === "results") $("#doc").innerHTML = `<h1>Search</h1><p class="empty">Keep typing: at least two letters.</p>`;   // one letter: the old results don't stay up
    }, 220);
  });
  $("#q").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.target.value = ""; location.hash = current ?? ""; route(); } if (e.key === "Enter") document.querySelector(".hit")?.click(); });
  document.addEventListener("keydown", (e) => { if (e.key === "/" && document.activeElement !== $("#q")) { e.preventDefault(); $("#q").focus(); } });
  $("#menuBtn").onclick = () => document.body.classList.toggle("menu");
  document.addEventListener("click", (e) => { if (document.body.classList.contains("menu") && !e.target.closest("#toc,#menuBtn")) document.body.classList.remove("menu"); });
  window.addEventListener("hashchange", route);
  // opened from inside the Dayspring screen: "back" returns there
  if (document.referrer && /\/(tv|display)\b/.test(document.referrer)) $("#backLink").href = new URL(document.referrer).pathname;

  (async () => {
    try { docs = (await getJSON("/api/help/list")).docs; }
    catch { $("#doc").innerHTML = `<p class="empty">Couldn't reach Dayspring. Make sure it's running, then reload this page.</p>`; return; }
    drawToc();
    // /help?q=snooze (from "how do I snooze?"): straight to the best section, or else the search results
    const ask = new URLSearchParams(location.search).get("q");
    if (ask && !location.hash) {
      const hit = await getJSON("/api/help/find?q=" + encodeURIComponent(ask)).catch(() => null);
      history.replaceState(null, "", location.search + "#" + (hit?.found ? `${hit.slug}${hit.anchor ? "/" + hit.anchor : ""}` : "search=" + encodeURIComponent(ask)));
    }
    route();
  })();
})();
