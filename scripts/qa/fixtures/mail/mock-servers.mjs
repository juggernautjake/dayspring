// Stand-in mail servers for the email tests: never a real account, never the internet, everything on 127.0.0.1.
//   startImap({ user, pass, folders })  a small IMAP4rev1 server (what imapflow uses: LOGIN, LIST with special-use, SELECT/
//                                       EXAMINE, UID SEARCH, UID FETCH incl. ENVELOPE and partial BODY[], UID STORE, UID MOVE,
//                                       APPEND with APPENDUID, UID EXPUNGE, STATUS) over plain TCP
//   startSmtp({ user, pass })           smtp-server (the nodemailer project's own) that keeps every message it gets
//   startGmail() / startGraph()         Gmail API and Microsoft Graph stand-ins (with OAuth token endpoints)
// Each returns { port, close(), … state }. MOCK_IMAP_DEBUG=1 prints the IMAP conversation.
import net from "node:net";
import http from "node:http";
import { randomBytes } from "node:crypto";
import addressparser from "nodemailer/lib/addressparser";
import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";

// ---------------------------------------------------------------------------------------------------------- IMAP
const q = (s) => (s == null ? "NIL" : `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ")}"`);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const idate = (d) => { const p = (n) => String(n).padStart(2, "0"); return `${p(d.getUTCDate())}-${MON[d.getUTCMonth()]}-${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`; };
function headers(raw) {
  const s = raw.toString("latin1"), end = s.search(/\r?\n\r?\n/), block = (end < 0 ? s : s.slice(0, end)).replace(/\r?\n[ \t]+/g, " ");
  const h = {}; for (const line of block.split(/\r?\n/)) { const m = /^([\w-]+):\s*(.*)$/.exec(line); if (m && !(m[1].toLowerCase() in h)) h[m[1].toLowerCase()] = m[2]; }
  return h;
}
const addrs = (v) => { if (!v) return "NIL"; const l = addressparser(v, { flatten: true }).filter((a) => a.address); if (!l.length) return "NIL"; return "(" + l.map((a) => { const [m, host] = a.address.split("@"); return `(${a.name ? q(a.name) : "NIL"} NIL ${q(m)} ${q(host ?? "")})`; }).join("") + ")"; };
function envelope(raw) {
  const h = headers(raw);
  return `(${q(h.date ?? null)} ${q(h.subject ?? null)} ${addrs(h.from)} ${addrs(h.sender ?? h.from)} ${addrs(h["reply-to"] ?? h.from)} ${addrs(h.to)} ${addrs(h.cc)} ${addrs(h.bcc)} ${q(h["in-reply-to"] ?? null)} ${q(h["message-id"] ?? null)})`;
}
// tokens: atoms (BODY.PEEK[]<0.8192> stays one), "quoted", (lists)
function tokenize(s) {
  let i = 0;
  const read = () => {
    while (s[i] === " ") i++;
    if (i >= s.length) return undefined;
    if (s[i] === "(") { i++; const out = []; while (i < s.length && s[i] !== ")") { const t = read(); if (t === undefined) break; out.push(t); while (s[i] === " ") i++; } i++; return out; }
    if (s[i] === '"') { i++; let v = ""; while (i < s.length && s[i] !== '"') { if (s[i] === "\\") i++; v += s[i++]; } i++; return { str: v }; }
    let v = "", depth = 0;
    while (i < s.length && (depth > 0 || (s[i] !== " " && s[i] !== ")"))) { if (s[i] === "[") depth++; if (s[i] === "]") depth--; v += s[i++]; }
    return v;
  };
  const out = []; let t; while ((t = read()) !== undefined) out.push(t);
  return out;
}
const val = (t) => (t && typeof t === "object" && "str" in t ? t.str : t);
function inSet(set, n, max) { return String(set).split(",").some((r) => { const [a, b] = r.split(":"); const lo = a === "*" ? max : Number(a), hi = b === undefined ? lo : b === "*" ? max : Number(b); return n >= Math.min(lo, hi) && n <= Math.max(lo, hi); }); }

export async function startImap({ user = "me@example.test", pass = "app-pass", folders = null } = {}) {
  const boxes = new Map();
  const mk = (path, use = null) => boxes.set(path, { path, use, uidValidity: 1000 + boxes.size, uidNext: 1, msgs: [] });
  for (const [p, u] of folders ?? [["INBOX", null], ["Sent", "\\Sent"], ["Drafts", "\\Drafts"], ["Trash", "\\Trash"], ["Archive", "\\Archive"], ["Bulk Mail", "\\Junk"], ["Receipts", null]]) mk(p, u);
  const state = { boxes, logins: 0, failedLogins: 0, commands: [], appended: [] };
  const add = (path, raw, flags = [], date = new Date()) => { const b = boxes.get(path); const m = { uid: b.uidNext++, flags: new Set(flags), raw: Buffer.from(raw), date }; b.msgs.push(m); return m; };
  state.add = add;
  const server = net.createServer((sock) => {
    let buf = Buffer.alloc(0), authed = false, sel = null, readOnly = false, pendingLiteral = null;
    const w = (line) => { if (process.env.MOCK_IMAP_DEBUG) console.log("S:", String(line).slice(0, 200)); sock.write(line + "\r\n"); };
    w("* OK [CAPABILITY IMAP4rev1 LITERAL+ SPECIAL-USE MOVE UIDPLUS ID] Mock IMAP ready");
    const box = () => boxes.get(sel);
    const seqOf = (m) => box().msgs.indexOf(m) + 1;
    function search(tokens, msgs) {
      let i = 0;
      const one = () => {
        let t = tokens[i++]; if (t === undefined) return () => true;
        if (Array.isArray(t)) { const sub = t; const fn = (m) => { const saved = [tokens, i]; tokens = sub; i = 0; let ok = true; while (i < tokens.length) { const f = one(); ok = ok && f(m); } [tokens, i] = saved; return ok; }; return fn; }
        const k = String(val(t)).toUpperCase();
        const text = (m, part) => { const h = headers(m.raw); const hay = part === "BODY" ? m.raw.toString("utf8").split(/\r?\n\r?\n/).slice(1).join("\n") : part === "TEXT" ? m.raw.toString("utf8") : String(h[part.toLowerCase()] ?? ""); return hay.toLowerCase(); };
        switch (k) {
          case "ALL": return () => true;
          case "SEEN": return (m) => m.flags.has("\\Seen");
          case "UNSEEN": return (m) => !m.flags.has("\\Seen");
          case "FLAGGED": return (m) => m.flags.has("\\Flagged");
          case "UNFLAGGED": return (m) => !m.flags.has("\\Flagged");
          case "DELETED": return (m) => m.flags.has("\\Deleted");
          case "UNDELETED": return (m) => !m.flags.has("\\Deleted");
          case "DRAFT": return (m) => m.flags.has("\\Draft");
          case "NOT": { const f = one(); return (m) => !f(m); }
          case "OR": { const a = one(), b = one(); return (m) => a(m) || b(m); }
          case "FROM": case "TO": case "CC": case "BCC": case "SUBJECT": case "BODY": case "TEXT": { const v = String(val(tokens[i++])).toLowerCase(); return (m) => text(m, k).includes(v); }
          case "HEADER": { const name = String(val(tokens[i++])).toLowerCase(), v = String(val(tokens[i++])).toLowerCase(); return (m) => String(headers(m.raw)[name] ?? "").toLowerCase().includes(v); }
          case "UID": { const set = val(tokens[i++]); return (m) => inSet(set, m.uid, Math.max(0, ...msgs.map((x) => x.uid))); }
          case "CHARSET": i++; return () => true;
          case "SINCE": case "BEFORE": case "ON": case "SENTSINCE": case "SENTBEFORE": i++; return () => true;
          default: if (/^[\d:*,]+$/.test(k)) return (m) => inSet(k, msgs.indexOf(m) + 1, msgs.length); return () => true;
        }
      };
      const fns = []; while (i < tokens.length) fns.push(one());
      return msgs.filter((m) => fns.every((f) => f(m)));
    }
    function fetchLine(m, items, byUid) {
      const parts = [], lits = [];
      const want = items.map((x) => String(val(x)).toUpperCase());
      if (byUid || want.includes("UID")) parts.push(`UID ${m.uid}`);
      for (const it of want) {
        if (it === "FLAGS") parts.push(`FLAGS (${[...m.flags].join(" ")})`);
        else if (it === "ENVELOPE") parts.push(`ENVELOPE ${envelope(m.raw)}`);
        else if (it === "INTERNALDATE") parts.push(`INTERNALDATE "${idate(m.date)}"`);
        else if (it === "RFC822.SIZE") parts.push(`RFC822.SIZE ${m.raw.length}`);
        else if (/^BODY(\.PEEK)?\[\]/.test(it)) {
          const pm = /<(\d+)(?:\.(\d+))?>$/.exec(it); const start = pm ? Number(pm[1]) : 0, len = pm?.[2] ? Number(pm[2]) : m.raw.length;
          const data = m.raw.subarray(start, start + len);
          parts.push(`BODY[]${pm ? `<${start}>` : ""} {${data.length}}`); lits.push(data);
          if (!it.includes("PEEK")) m.flags.add("\\Seen");
        }
      }
      // one literal at a time: split the line where each {n} appears
      let out = Buffer.from(`* ${seqOf(m)} FETCH (`, "latin1");
      let li = 0;
      for (const [n, p] of parts.entries()) {
        out = Buffer.concat([out, Buffer.from((n ? " " : "") + p, "latin1")]);
        if (/\{\d+\}$/.test(p)) { out = Buffer.concat([out, Buffer.from("\r\n"), lits[li++]]); }
      }
      out = Buffer.concat([out, Buffer.from(")\r\n")]);
      if (process.env.MOCK_IMAP_DEBUG) console.log("S:", out.toString("latin1").slice(0, 200));
      sock.write(out);
    }
    function run(tag, cmd, args, lit) {
      state.commands.push(`${cmd} ${args}`.slice(0, 200));
      const t = tokenize(args);
      const byUid = cmd === "UID"; if (byUid) { cmd = String(t.shift()).toUpperCase(); }
      const need = () => { if (!authed) { w(`${tag} NO Not logged in`); return false; } return true; };
      const needSel = () => { if (!need()) return false; if (!sel) { w(`${tag} BAD No mailbox selected`); return false; } return true; };
      switch (cmd) {
        case "CAPABILITY": w("* CAPABILITY IMAP4rev1 LITERAL+ SPECIAL-USE MOVE UIDPLUS ID"); return w(`${tag} OK CAPABILITY completed`);
        case "ID": w('* ID ("name" "MockIMAP")'); return w(`${tag} OK ID completed`);
        case "NOOP": case "CHECK": return w(`${tag} OK done`);
        case "LOGIN": {
          if (val(t[0]) === user && val(t[1]) === pass) { authed = true; state.logins++; return w(`${tag} OK [CAPABILITY IMAP4rev1 LITERAL+ SPECIAL-USE MOVE UIDPLUS ID] Logged in`); }
          state.failedLogins++; return w(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)`);
        }
        case "LOGOUT": w("* BYE Bye"); w(`${tag} OK Logout completed`); return sock.end();
        case "NAMESPACE": if (!need()) return; w('* NAMESPACE (("" "/")) NIL NIL'); return w(`${tag} OK done`);
        case "ENABLE": if (!need()) return; w("* ENABLED"); return w(`${tag} OK done`);
        case "LIST": case "LSUB": case "XLIST": {
          if (!need()) return;
          const ref = String(val(t[0]) ?? ""), pat = String(val(t[1]) ?? "*");
          if (pat === "") { w(`* ${cmd} (\\Noselect) "/" ""`); return w(`${tag} OK ${cmd} completed`); }   // the hierarchy delimiter
          const re = new RegExp("^" + (ref + pat).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/%/g, "[^/]*") + "$", "i");
          for (const b of boxes.values()) if (re.test(b.path)) w(`* ${cmd} (${["\\HasNoChildren", ...(b.use ? [b.use] : [])].join(" ")}) "/" ${q(b.path)}`);
          return w(`${tag} OK ${cmd} completed`);
        }
        case "SELECT": case "EXAMINE": {
          if (!need()) return;
          const b = boxes.get(val(t[0]) === "inbox" ? "INBOX" : val(t[0])); if (!b) return w(`${tag} NO No such mailbox`);
          sel = b.path; readOnly = cmd === "EXAMINE";
          w("* FLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft)"); w("* OK [PERMANENTFLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft \\*)] ok");
          w(`* ${b.msgs.length} EXISTS`); w("* 0 RECENT"); w(`* OK [UIDVALIDITY ${b.uidValidity}] ok`); w(`* OK [UIDNEXT ${b.uidNext}] ok`);
          return w(`${tag} OK [${readOnly ? "READ-ONLY" : "READ-WRITE"}] ${cmd} completed`);
        }
        case "CLOSE": case "UNSELECT": sel = null; return w(`${tag} OK done`);
        case "STATUS": {
          if (!need()) return;
          const b = boxes.get(val(t[0])); if (!b) return w(`${tag} NO No such mailbox`);
          w(`* STATUS ${q(b.path)} (MESSAGES ${b.msgs.length} UNSEEN ${b.msgs.filter((m) => !m.flags.has("\\Seen")).length} UIDNEXT ${b.uidNext} UIDVALIDITY ${b.uidValidity})`);
          return w(`${tag} OK STATUS completed`);
        }
        case "SEARCH": {
          if (!needSel()) return;
          const hits = search(t, box().msgs);
          w(`* SEARCH${hits.map((m) => " " + (byUid ? m.uid : seqOf(m))).join("")}`);
          return w(`${tag} OK SEARCH completed`);
        }
        case "FETCH": {
          if (!needSel()) return;
          const set = val(t[0]), items = Array.isArray(t[1]) ? t[1] : [t[1]], all = box().msgs, maxU = Math.max(0, ...all.map((m) => m.uid));
          for (const m of all.filter((m, i) => (byUid ? inSet(set, m.uid, maxU) : inSet(set, i + 1, all.length)))) fetchLine(m, items, byUid);
          return w(`${tag} OK FETCH completed`);
        }
        case "STORE": {
          if (!needSel()) return;
          const set = val(t[0]), op = String(val(t[1])).toUpperCase(), flags = (Array.isArray(t[2]) ? t[2] : [t[2]]).map(val);
          const all = box().msgs, maxU = Math.max(0, ...all.map((m) => m.uid));
          for (const m of all.filter((m, i) => (byUid ? inSet(set, m.uid, maxU) : inSet(set, i + 1, all.length)))) {
            if (op.startsWith("+")) flags.forEach((f) => m.flags.add(f)); else if (op.startsWith("-")) flags.forEach((f) => m.flags.delete(f)); else m.flags = new Set(flags);
            if (!op.includes(".SILENT")) w(`* ${seqOf(m)} FETCH (UID ${m.uid} FLAGS (${[...m.flags].join(" ")}))`);
          }
          return w(`${tag} OK STORE completed`);
        }
        case "MOVE": case "COPY": {
          if (!needSel()) return;
          const set = val(t[0]), dest = boxes.get(val(t[1])); if (!dest) return w(`${tag} NO [TRYCREATE] No such mailbox`);
          const src = box(), maxU = Math.max(0, ...src.msgs.map((m) => m.uid));
          const moving = src.msgs.filter((m, i) => (byUid ? inSet(set, m.uid, maxU) : inSet(set, i + 1, src.msgs.length)));
          const newUids = moving.map((m) => { const n = add(dest.path, m.raw, [...m.flags], m.date); return n.uid; });
          w(`* OK [COPYUID ${dest.uidValidity} ${moving.map((m) => m.uid).join(",")} ${newUids.join(",")}] copied`);
          if (cmd === "MOVE") for (const m of moving) { const s = seqOf(m); src.msgs.splice(s - 1, 1); w(`* ${s} EXPUNGE`); }
          return w(`${tag} OK ${cmd} completed`);
        }
        case "EXPUNGE": {
          if (!needSel()) return;
          const b = box(), set = byUid ? val(t[0]) : null, maxU = Math.max(0, ...b.msgs.map((m) => m.uid));
          for (const m of [...b.msgs]) if (m.flags.has("\\Deleted") && (!set || inSet(set, m.uid, maxU))) { const s = seqOf(m); b.msgs.splice(s - 1, 1); w(`* ${s} EXPUNGE`); }
          return w(`${tag} OK EXPUNGE completed`);
        }
        case "APPEND": {
          if (!need()) return;
          const b = boxes.get(val(t[0])); if (!b) return w(`${tag} NO [TRYCREATE] No such mailbox`);
          const flags = Array.isArray(t[1]) ? t[1].map(val) : [];
          const m = add(b.path, lit, flags);
          state.appended.push({ path: b.path, uid: m.uid, flags, raw: m.raw });
          return w(`${tag} OK [APPENDUID ${b.uidValidity} ${m.uid}] APPEND completed`);
        }
        default: return w(`${tag} BAD Unknown command ${cmd}`);
      }
    }
    sock.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (pendingLiteral) {
          if (buf.length < pendingLiteral.n) return;
          const lit = buf.subarray(0, pendingLiteral.n); buf = buf.subarray(pendingLiteral.n);
          const eol = buf.indexOf("\r\n"); if (eol < 0) { pendingLiteral.lit = lit; pendingLiteral.n = 0; pendingLiteral.waitEol = true; return; }
          buf = buf.subarray(eol + 2);
          const p = pendingLiteral; pendingLiteral = null; run(p.tag, p.cmd, p.args, lit);
          continue;
        }
        const eol = buf.indexOf("\r\n"); if (eol < 0) return;
        const line = buf.subarray(0, eol).toString("latin1"); buf = buf.subarray(eol + 2);
        if (process.env.MOCK_IMAP_DEBUG) console.log("C:", line.slice(0, 200));
        const m = /^(\S+) (\S+)\s?(.*)$/.exec(line); if (!m) continue;
        const [, tag, c, rest] = m;
        const lm = /\{(\d+)(\+)?\}$/.exec(rest);
        if (lm) { const n = Number(lm[1]); pendingLiteral = { tag, cmd: c.toUpperCase(), args: rest.slice(0, lm.index).trim(), n }; if (!lm[2]) w("+ Ready for literal data"); continue; }
        try { run(tag, c.toUpperCase(), rest); } catch (e) { w(`${tag} BAD ${e.message}`); }
      }
    });
    sock.on("error", () => {});
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { ...state, state, port: server.address().port, add, close: () => new Promise((r) => { server.close(() => r()); for (const s of sockets) s.destroy(); }) };
}
const sockets = new Set();

// ---------------------------------------------------------------------------------------------------------- SMTP
export async function startSmtp({ user = "me@example.test", pass = "app-pass" } = {}) {
  const got = [];
  const srv = new SMTPServer({ secure: false, disabledCommands: ["STARTTLS"], allowInsecureAuth: true, authMethods: ["PLAIN", "LOGIN"], logger: false, banner: "Mock SMTP",
    onAuth(auth, session, cb) { if (auth.username === user && auth.password === pass) return cb(null, { user }); return cb(Object.assign(new Error("Invalid login"), { responseCode: 535 })); },
    onData(stream, session, cb) { const chunks = []; stream.on("data", (c) => chunks.push(c)); stream.on("end", async () => { const raw = Buffer.concat(chunks); got.push({ from: session.envelope.mailFrom?.address, to: session.envelope.rcptTo.map((r) => r.address), raw, parsed: await simpleParser(raw, { keepCidLinks: true }).catch(() => null) }); cb(); }); } });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { port: srv.server.address().port, got, close: () => new Promise((r) => srv.close(() => r())) };
}

// ---------------------------------------------------------------------------------------------------------- Gmail + Graph
const body = (req) => new Promise((ok) => { const b = []; req.on("data", (c) => b.push(c)); req.on("end", () => ok(Buffer.concat(b))); });
const json = (res, code, x) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(x)); };
// A Gmail stand-in with OAuth: messages are stored as raw MIME; format=full is built from them the way Gmail does
export async function startGmail({ email = "me@gmail.test" } = {}) {
  const st = { email, codes: new Map(), tokens: new Map(), msgs: [], drafts: new Map(), sent: [], modified: [], trashed: [], calls: [], scopes: "" };
  let n = 0;
  const addMsg = async (raw, labels = ["INBOX", "UNREAD"]) => { const id = "gm" + (++n).toString(36) + randomBytes(3).toString("hex"); const m = { id, threadId: "th-" + id, raw: Buffer.from(raw), labels: new Set(labels), parsed: await simpleParser(Buffer.from(raw)) }; st.msgs.push(m); return m; };
  st.addMsg = addMsg;
  const part = (p, idPrefix, atts) => p;
  const full = (m) => {
    const hdrs = [...m.parsed.headerLines].map((l) => { const i = l.line.indexOf(":"); return { name: l.line.slice(0, i), value: l.line.slice(i + 1).trim().replace(/\r?\n\s+/g, " ") }; });
    const parts = [];
    if (m.parsed.text) parts.push({ partId: "0", mimeType: "text/plain", filename: "", headers: [{ name: "Content-Type", value: "text/plain; charset=utf-8" }], body: { size: m.parsed.text.length, data: Buffer.from(m.parsed.text).toString("base64url") } });
    if (m.parsed.html) parts.push({ partId: "1", mimeType: "text/html", filename: "", headers: [{ name: "Content-Type", value: "text/html; charset=utf-8" }], body: { size: m.parsed.html.length, data: Buffer.from(m.parsed.html).toString("base64url") } });
    const alt = { partId: "", mimeType: "multipart/alternative", filename: "", headers: [], body: { size: 0 }, parts };
    const atts = m.parsed.attachments.map((a, i) => ({ partId: String(2 + i), mimeType: a.contentType, filename: a.filename ?? "", headers: [{ name: "Content-Disposition", value: `${a.contentDisposition ?? "attachment"}; filename="${a.filename ?? ""}"` }, ...(a.cid ? [{ name: "Content-ID", value: `<${a.cid}>` }] : [])], body: { size: a.size, attachmentId: `att-${m.id}-${i}` } }));
    const payload = atts.length ? { mimeType: "multipart/mixed", headers: hdrs, body: { size: 0 }, parts: [alt, ...atts] } : { ...alt, headers: hdrs };
    return { id: m.id, threadId: m.threadId, labelIds: [...m.labels], snippet: (m.parsed.text ?? "").replace(/\s+/g, " ").slice(0, 120), internalDate: String(+(m.parsed.date ?? new Date())), sizeEstimate: m.raw.length, payload };
  };
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://x"), p = u.pathname;
    if (p === "/token") {
      const f = new URLSearchParams((await body(req)).toString());
      if (f.get("grant_type") === "authorization_code") { const c = st.codes.get(f.get("code")); if (!c) return json(res, 400, { error: "invalid_grant" }); const at = "at-" + (++n); st.tokens.set(at, c.email); st.scopes = c.scope; return json(res, 200, { access_token: at, refresh_token: "rt-" + c.email, expires_in: 3600, id_token: `h.${Buffer.from(JSON.stringify({ email: c.email })).toString("base64url")}.s`, scope: c.scope }); }
      if (f.get("grant_type") === "refresh_token") { const at = "at-" + (++n); st.tokens.set(at, st.email); return json(res, 200, { access_token: at, expires_in: 3600 }); }
      return json(res, 400, { error: "unsupported" });
    }
    if (p === "/revoke") return json(res, 200, {});
    if (!st.tokens.has(String(req.headers.authorization ?? "").replace(/^Bearer /, ""))) return json(res, 401, { error: { message: "Invalid Credentials" } });
    const b = req.method === "GET" ? null : (await body(req)).toString();
    st.calls.push({ m: req.method, p, q: Object.fromEntries(u.searchParams), body: b });
    let mm;
    const G = "/gmail/v1/users/me";
    if (p === G + "/labels") return json(res, 200, { labels: [{ id: "INBOX", name: "INBOX", type: "system" }, { id: "Label_1", name: "Receipts", type: "user" }] });
    if (p === G + "/labels/INBOX") return json(res, 200, { id: "INBOX", messagesUnread: st.msgs.filter((m) => m.labels.has("INBOX") && m.labels.has("UNREAD")).length });
    if (p === G + "/messages" && req.method === "GET") {
      const labels = u.searchParams.getAll("labelIds"), qq = (u.searchParams.get("q") ?? "").toLowerCase();
      let l = st.msgs.filter((m) => labels.every((x) => m.labels.has(x)) && (u.searchParams.get("includeSpamTrash") === "true" || !m.labels.has("TRASH")));
      if (/is:unread/.test(qq)) l = l.filter((m) => m.labels.has("UNREAD"));
      const fm = /from:\(([^)]+)\)/.exec(qq); if (fm) l = l.filter((m) => (m.parsed.from?.text ?? "").toLowerCase().includes(fm[1]));
      const words = qq.replace(/from:\([^)]+\)|is:\w+|-?in:\w+/g, " ").trim(); if (words) l = l.filter((m) => `${m.parsed.subject} ${m.parsed.text} ${m.parsed.from?.text}`.toLowerCase().includes(words));
      if (/-in:inbox/.test(qq)) l = st.msgs.filter((m) => !m.labels.has("INBOX") && !m.labels.has("TRASH") && !m.labels.has("SENT") && !m.labels.has("DRAFT"));
      return json(res, 200, { messages: l.slice().reverse().map((m) => ({ id: m.id, threadId: m.threadId })) });
    }
    if ((mm = new RegExp(`^${G}/messages/([\\w-]+)$`).exec(p)) && req.method === "GET") {
      const m = st.msgs.find((x) => x.id === mm[1]); if (!m) return json(res, 404, { error: { message: "Not Found" } });
      const fmt = u.searchParams.get("format");
      if (fmt === "raw") return json(res, 200, { id: m.id, raw: m.raw.toString("base64url") });
      const f = full(m);
      if (fmt === "metadata") { const want = u.searchParams.getAll("metadataHeaders").map((x) => x.toLowerCase()); return json(res, 200, { ...f, payload: { mimeType: f.payload.mimeType, headers: f.payload.headers.filter((h) => want.includes(h.name.toLowerCase())) } }); }
      return json(res, 200, f);
    }
    if ((mm = new RegExp(`^${G}/messages/([\\w-]+)/attachments/att-([\\w-]+)-(\\d+)$`).exec(p))) { const m = st.msgs.find((x) => x.id === mm[2]); const a = m?.parsed.attachments[Number(mm[3])]; return a ? json(res, 200, { size: a.size, data: a.content.toString("base64url") }) : json(res, 404, {}); }
    if ((mm = new RegExp(`^${G}/messages/([\\w-]+)/modify$`).exec(p))) {
      if (!st.scopes.includes("gmail.modify")) return json(res, 403, { error: { message: "Request had insufficient authentication scopes." } });
      const m = st.msgs.find((x) => x.id === mm[1]); const j = JSON.parse(b); for (const l of j.addLabelIds ?? []) m.labels.add(l); for (const l of j.removeLabelIds ?? []) m.labels.delete(l); st.modified.push({ id: m.id, ...j }); return json(res, 200, { id: m.id, labelIds: [...m.labels] });
    }
    if ((mm = new RegExp(`^${G}/messages/([\\w-]+)/trash$`).exec(p))) { if (!st.scopes.includes("gmail.modify")) return json(res, 403, { error: { message: "insufficient scopes" } }); const m = st.msgs.find((x) => x.id === mm[1]); m.labels.add("TRASH"); m.labels.delete("INBOX"); st.trashed.push(m.id); return json(res, 200, { id: m.id }); }
    if (new RegExp(`^${G}/messages/[\\w-]+$`).test(p) && req.method === "DELETE") return json(res, 500, { error: { message: "permanent delete must never be used" } });
    if ((mm = new RegExp(`^${G}/threads/([\\w-]+)$`).exec(p))) return json(res, 200, { id: mm[1], messages: st.msgs.filter((m) => m.threadId === mm[1]).map((m) => ({ id: m.id })) });
    if (p === G + "/drafts" && req.method === "POST") { const j = JSON.parse(b); const id = "dr" + (++n); const m = await addMsg(Buffer.from(j.message.raw, "base64url"), ["DRAFT"]); st.drafts.set(id, { id, messageId: m.id, raw: Buffer.from(j.message.raw, "base64url") }); return json(res, 200, { id, message: { id: m.id } }); }
    if (p === G + "/drafts" && req.method === "GET") return json(res, 200, { drafts: [...st.drafts.values()].map((d) => ({ id: d.id, message: { id: d.messageId } })) });
    if ((mm = new RegExp(`^${G}/drafts/([\\w-]+)$`).exec(p)) && req.method === "PUT") { const j = JSON.parse(b); const d = st.drafts.get(mm[1]); if (!d) return json(res, 404, {}); d.raw = Buffer.from(j.message.raw, "base64url"); st.msgs = st.msgs.filter((m) => m.id !== d.messageId); const m = await addMsg(d.raw, ["DRAFT"]); d.messageId = m.id; return json(res, 200, { id: d.id, message: { id: m.id } }); }
    if ((mm = new RegExp(`^${G}/drafts/([\\w-]+)$`).exec(p)) && req.method === "DELETE") { const d = st.drafts.get(mm[1]); st.drafts.delete(mm[1]); if (d) st.msgs = st.msgs.filter((m) => m.id !== d.messageId); res.writeHead(204); return res.end(); }
    if (p === G + "/messages/send") {
      if (!st.scopes.includes("gmail.send")) return json(res, 403, { error: { message: "Request had insufficient authentication scopes." } });
      const j = JSON.parse(b), raw = Buffer.from(j.raw, "base64url"); st.sent.push({ raw, threadId: j.threadId ?? null, parsed: await simpleParser(raw) }); const m = await addMsg(raw, ["SENT"]); return json(res, 200, { id: m.id, threadId: j.threadId ?? m.threadId });
    }
    // Calendar (for invitations)
    if (/^\/calendar\/v3\/calendars\/[^/]+\/events$/.test(p) && req.method === "POST") { const j = JSON.parse(b); st.events = st.events ?? []; st.events.push({ body: j, query: Object.fromEntries(u.searchParams) }); return json(res, 200, { id: "ev" + (++n), summary: j.summary, htmlLink: "https://calendar.test/e", ...(j.conferenceData ? { hangoutLink: "https://meet.google.com/abc-defg-hij" } : {}) }); }
    if (/^\/calendar\/v3\/users\/me\/calendarList$/.test(p)) return json(res, 200, { items: [] });
    json(res, 404, { error: { message: `mock gmail: no ${req.method} ${p}` } });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  st.port = srv.address().port; st.base = `http://127.0.0.1:${st.port}`;
  st.close = () => new Promise((r) => srv.close(() => r()));
  return st;
}
// A Microsoft Graph stand-in with OAuth (the MIME the mail adapter sends and reads)
export async function startGraph({ email = "me@outlook.test" } = {}) {
  const st = { email, msgs: [], sent: [], calls: [], scopes: "", events: [] };
  let n = 0;
  const folderOf = (m) => m.folder;
  const addMsg = async (raw, folder = "inbox", { isRead = false, isDraft = false } = {}) => { const parsed = await simpleParser(Buffer.from(raw)); const m = { id: "om" + (++n) + randomBytes(3).toString("hex"), raw: Buffer.from(raw), parsed, folder, isRead, flag: "notFlagged", isDraft, conversationId: "cv-" + n }; st.msgs.push(m); return m; };
  st.addMsg = addMsg;
  const shape = (m) => ({ id: m.id, subject: m.parsed.subject, from: { emailAddress: { name: m.parsed.from?.value?.[0]?.name ?? "", address: m.parsed.from?.value?.[0]?.address ?? "" } }, toRecipients: (m.parsed.to?.value ?? []).map((a) => ({ emailAddress: a })), ccRecipients: [], receivedDateTime: (m.parsed.date ?? new Date()).toISOString(), bodyPreview: (m.parsed.text ?? "").slice(0, 100), isRead: m.isRead, flag: { flagStatus: m.flag }, hasAttachments: m.parsed.attachments.length > 0, conversationId: m.conversationId, isDraft: m.isDraft, internetMessageId: m.parsed.messageId });
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://x"), p = u.pathname;
    if (p.endsWith("/token")) { const f = new URLSearchParams((await body(req)).toString()); st.scopes = f.get("scope") ?? st.scopes; return json(res, 200, { access_token: "ms-at", refresh_token: "ms-rt", expires_in: 3600, scope: st.scopes }); }
    if (req.headers.authorization !== "Bearer ms-at") return json(res, 401, { error: { message: "InvalidAuthenticationToken" } });
    const b = req.method === "GET" ? null : (await body(req)).toString();
    st.calls.push({ m: req.method, p, q: Object.fromEntries(u.searchParams), body: b, ct: req.headers["content-type"] });
    let mm;
    if (p === "/me") return json(res, 200, { mail: st.email });
    if (p === "/me/mailFolders" && req.method === "GET") return json(res, 200, { value: [{ id: "f-inbox", displayName: "Inbox" }, { id: "f-proj", displayName: "Projects" }] });
    if (p === "/me/mailFolders/inbox") return json(res, 200, { unreadItemCount: st.msgs.filter((m) => m.folder === "inbox" && !m.isRead).length });
    if ((mm = /^\/me\/mailFolders\/([\w-]+)\/messages$/.exec(p))) {
      let l = st.msgs.filter((m) => folderOf(m) === mm[1]);
      if (u.searchParams.get("$filter") === "isRead eq false") l = l.filter((m) => !m.isRead);
      const s = (u.searchParams.get("$search") ?? "").replace(/"/g, "").toLowerCase(); if (s) l = l.filter((m) => { const f = /from:(\S+)/.exec(s); const w = s.replace(/from:\S+/, "").trim(); return (!f || (m.parsed.from?.text ?? "").toLowerCase().includes(f[1])) && (!w || `${m.parsed.subject} ${m.parsed.text}`.toLowerCase().includes(w)); });
      return json(res, 200, { value: l.slice().reverse().map(shape) });
    }
    if (p === "/me/messages" && req.method === "GET") { const f = u.searchParams.get("$filter") ?? ""; let l = st.msgs; if (/flagged/.test(f)) l = l.filter((m) => m.flag === "flagged"); const cv = /conversationId eq '([^']+)'/.exec(f); if (cv) l = l.filter((m) => m.conversationId === cv[1]); return json(res, 200, { value: l.map(shape) }); }
    if ((mm = /^\/me\/messages\/([\w-]+)\/\$value$/.exec(p))) { const m = st.msgs.find((x) => x.id === mm[1]); if (!m) return json(res, 404, {}); res.writeHead(200, { "content-type": "text/plain" }); return res.end(m.raw); }
    if ((mm = /^\/me\/messages\/([\w-]+)$/.exec(p)) && req.method === "GET") { const m = st.msgs.find((x) => x.id === mm[1]); return m ? json(res, 200, shape(m)) : json(res, 404, {}); }
    if ((mm = /^\/me\/messages\/([\w-]+)$/.exec(p)) && req.method === "PATCH") { const m = st.msgs.find((x) => x.id === mm[1]); const j = JSON.parse(b); if ("isRead" in j) m.isRead = j.isRead; if (j.flag) m.flag = j.flag.flagStatus; return json(res, 200, shape(m)); }
    if ((mm = /^\/me\/messages\/([\w-]+)\/move$/.exec(p))) { const m = st.msgs.find((x) => x.id === mm[1]); const j = JSON.parse(b); m.folder = j.destinationId; m.id = "om" + (++n) + "m"; return json(res, 200, shape(m)); }
    if ((mm = /^\/me\/messages\/([\w-]+)$/.exec(p)) && req.method === "DELETE") { const m = st.msgs.find((x) => x.id === mm[1]); if (m && !m.isDraft) return json(res, 500, { error: { message: "only drafts may be deleted" } }); st.msgs = st.msgs.filter((x) => x.id !== mm[1]); res.writeHead(204); return res.end(); }
    if (p === "/me/messages" && req.method === "POST") { if (!/text\/plain/.test(req.headers["content-type"] ?? "")) return json(res, 400, { error: { message: "mock wants MIME" } }); const m = await addMsg(Buffer.from(b, "base64"), "drafts", { isRead: true, isDraft: true }); return json(res, 201, shape(m)); }
    if (p === "/me/sendMail") { if (!/Mail\.Send/.test(st.scopes)) return json(res, 403, { error: { message: "Access is denied. Check credentials and try again." } }); const raw = Buffer.from(b, "base64"); st.sent.push({ raw, parsed: await simpleParser(raw) }); res.writeHead(202); return res.end(); }
    if (p === "/me/events" && req.method === "POST") { const j = JSON.parse(b); st.events.push(j); return json(res, 201, { id: "oe" + (++n), subject: j.subject, webLink: "https://outlook.test/e", onlineMeeting: j.isOnlineMeeting ? { joinUrl: "https://teams.test/meet/1" } : null }); }
    json(res, 404, { error: { message: `mock graph: no ${req.method} ${p}` } });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  st.port = srv.address().port; st.base = `http://127.0.0.1:${st.port}`;
  st.close = () => new Promise((r) => srv.close(() => r()));
  return st;
}
