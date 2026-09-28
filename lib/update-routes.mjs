// Settings → Updates and the update notice on the Dayspring screen (paths are after /api).
//   GET  /update/status            where things stand: version, the latest release, what's downloaded, the plan, history
//   GET  /update/check             ask GitHub now ("Check now")
//   POST /update/choose { choice } now | launch (next time Dayspring starts) | idle (when I'm not using it) | later
//   POST /update/when { when }     the standing choice: ask | launch | idle
//   POST /update/apply             install now (older name, kept for "Update Dayspring.cmd" from 1.0.0)
//   POST /update/channel { channel }  stable (production) | dev (development) → { channel, offer } (offer: the production
//                                  version to go back to, when leaving development)
//   GET  /update/stable-offer · POST /update/to-stable   go back to the newest production version (backed up first)
// ctx = { m, p, q, send, readJSON, restart? } — restart is the server's own restart, used after an update.
import * as updater from "./updater.mjs";

const view = () => ({ ...updater.status(), history: updater.history(), backups: updater.backups().slice(0, 10) });

export async function handle(req, res, ctx) {
  const { m, p, send, readJSON } = ctx;
  if (!p.startsWith("/update/")) return false;
  if (m === "GET" && p === "/update/status") { send(res, 200, view()); return true; }
  if (m === "GET" && p === "/update/check") {
    try { send(res, 200, { ...(await updater.check()), status: view() }); }
    catch (e) { send(res, 502, { error: e.message, status: view() }); }
    return true;
  }
  if (m === "POST" && p === "/update/choose") {
    const b = await readJSON(req).catch(() => ({}));
    try { send(res, 200, { ...(await updater.choose(String(b.choice ?? ""), { restart: ctx.restart })), status: view() }); }
    catch (e) { send(res, 500, { error: e.message, status: view() }); }
    return true;
  }
  if (m === "POST" && p === "/update/when") {
    const b = await readJSON(req).catch(() => ({}));
    try { updater.setWhen(String(b.when ?? "")); send(res, 200, view()); } catch (e) { send(res, 400, { error: e.message }); }
    return true;
  }
  // the update channel: production (stable) or development (dev: the -dev pre-releases too)
  if (m === "POST" && p === "/update/channel") {
    const b = await readJSON(req).catch(() => ({}));
    try {
      const c = updater.setChannel(String(b.channel ?? ""));
      // development → production: is there a production version to go back to? (the page asks before installing it)
      const o = c === "stable" ? await updater.stableOffer().catch(() => ({ offer: null })) : { offer: null };
      send(res, 200, { channel: c, offer: o.offer ?? null, status: view() });
    } catch (e) { send(res, 400, { error: e.message }); }
    return true;
  }
  if (m === "GET" && p === "/update/stable-offer") {
    try { send(res, 200, await updater.stableOffer()); } catch (e) { send(res, 502, { error: e.message }); }
    return true;
  }
  if (m === "POST" && p === "/update/to-stable") {
    try { send(res, 200, await updater.toStable({ restart: ctx.restart })); }
    catch (e) { send(res, 500, { error: e.message, status: view() }); }
    return true;
  }
  if (m === "POST" && p === "/update/apply") {
    try { send(res, 200, await updater.install({ restart: ctx.restart, how: "now" })); }
    catch (e) { send(res, 500, { error: e.message, status: view() }); }
    return true;
  }
  return false;
}

// Said or typed to Dayspring: "check for updates", "update Dayspring", "install the update", "what's new in Dayspring"
export async function command(text, { restart } = {}) {
  const t = String(text ?? "").toLowerCase().replace(/[.!?,]/g, "").replace(/^(hey |ok |okay )?dayspring /, "").trim();
  const friendly = (e) => (/ECONN|ENOTFOUND|fetch failed|timeout/i.test(e.message) ? "I couldn't reach the internet to check for updates. Try again in a bit." : e.message);
  if (/^(please )?(update (dayspring|yourself)|install (the |that )?(new )?(update|version)|update now)( please)?$/.test(t)) {
    try {
      const info = await updater.check();
      if (info.off) return info.message;
      if (!info.available) return `No updates right now: you have the newest Dayspring (${info.current}).`;
      updater.install({ restart, how: "now" }).catch(() => {});
      return `Updating to Dayspring ${info.latest}. Your data is backed up first. I'll be back in about a minute.`;
    } catch (e) { return friendly(e); }
  }
  if (/^(check for (an )?updates?|any updates?|is there (an update|a new version)|are there any updates)( for dayspring)?$/.test(t)) {
    try {
      const info = await updater.check();
      if (info.off) return info.message;
      return info.available ? `Yes: Dayspring ${info.latest} is available (you have ${info.current}). Say "update Dayspring" to install it now, or see what's new in Settings, under Updates.` : `No updates right now: you have the newest Dayspring (${info.current}).`;
    } catch (e) { return friendly(e); }
  }
  if (/^what(?:'s| is) new( in dayspring)?$|^what changed in (the )?(last )?update$/.test(t)) {
    const last = updater.history().find((h) => h.ok);
    return last ? `In Dayspring ${last.to}: ${String(last.notes ?? "").replace(/[#*`>_]/g, "").replace(/\s+/g, " ").slice(0, 400) || "small fixes and improvements."} The full list is in Settings, under Updates.` : "Nothing new yet. The update history is in Settings, under Updates.";
  }
  return null;
}
