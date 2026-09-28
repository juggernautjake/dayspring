// Recordings a camera (or its NVR) keeps on its own SD card or disk, listed with the brand's own HTTP API and played
// back over RTSP (ffmpeg turns the part asked for into an MP4 on the Dayspring screen):
//   dahua     Dahua, Amcrest, Lorex:  /cgi-bin/mediaFileFind.cgi, playback rtsp://…/cam/playback?channel=&starttime=&endtime=
//   hikvision Hikvision, Annke:       POST /ISAPI/ContentMgmt/search, playback by the playbackURI it returns
// ONVIF cameras use Profile G instead (onvif.mjs); GoPro has its own media list (gopro.mjs).
//   adapter(kind, { host, username, password, port }) → { recordings({ days }), fetchRecording(ref) }
import { camFetch } from "../http-auth.mjs";
import { tags, text } from "../onvif.mjs";

export const KINDS = ["dahua", "hikvision"];
const pad = (n) => String(n).padStart(2, "0");
const dahuaTime = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const us = (s) => String(s).replace(/[-: ]/g, "_");

export function parseDahuaItems(body) {
  const items = new Map();
  for (const line of String(body).split(/\r?\n/)) {
    const m = /^items\[(\d+)\]\.(\w+)=(.*)$/.exec(line.trim()); if (!m) continue;
    const it = items.get(m[1]) ?? {}; it[m[2]] = m[3]; items.set(m[1], it);
  }
  return [...items.values()];
}
export function parseHikMatches(xml) {
  return tags(xml, "searchMatchItem").map((m) => ({ uri: text(m.body, "playbackURI"), start: text(m.body, "startTime"), end: text(m.body, "endTime"), track: text(m.body, "trackID") })).filter((x) => x.uri);
}

export function adapter(kind, { host, username = "", password = "", port = 80, rtspPort = 554, channel = 1 } = {}) {
  const http = (path, opts = {}) => camFetch(`http://${host}:${port}${path}`, { username, password, timeoutMs: 15_000, maxBytes: 4e6, ...opts });
  const rtspAuth = username ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@` : "";
  if (kind === "dahua") return {
    async recordings({ days = 3 } = {}) {
      const obj = /result=(\d+)/.exec((await http("/cgi-bin/mediaFileFind.cgi?action=factory.create")).buf.toString())?.[1];
      if (!obj) throw new Error("The camera didn't start a recordings search.");
      const end = new Date(), start = new Date(Date.now() - days * 864e5);
      try {
        await http(`/cgi-bin/mediaFileFind.cgi?action=findFile&object=${obj}&condition.Channel=${channel}&condition.StartTime=${encodeURIComponent(dahuaTime(start))}&condition.EndTime=${encodeURIComponent(dahuaTime(end))}`);
        const body = (await http(`/cgi-bin/mediaFileFind.cgi?action=findNextFile&object=${obj}&count=100`)).buf.toString();
        return parseDahuaItems(body).map((it) => ({ ref: `dahua:${it.StartTime}|${it.EndTime}`, name: `${it.StartTime}${it.Events ? " · " + it.Events : ""}`, at: it.StartTime?.replace(" ", "T"), end: it.EndTime?.replace(" ", "T"), size: Number(it.Length) || null, type: "video/mp4", kind: "stream" }));
      } finally { http(`/cgi-bin/mediaFileFind.cgi?action=close&object=${obj}`).catch(() => {}); http(`/cgi-bin/mediaFileFind.cgi?action=destroy&object=${obj}`).catch(() => {}); }
    },
    async fetchRecording(ref) {
      const [s, e] = String(ref).replace(/^dahua:/, "").split("|");
      const secs = Math.max(1, Math.min(3600, (Date.parse(e.replace(" ", "T")) - Date.parse(s.replace(" ", "T"))) / 1000 || 60));
      return { input: ["-rtsp_transport", "tcp", "-i", `rtsp://${rtspAuth}${host}:${rtspPort}/cam/playback?channel=${channel}&starttime=${us(s)}&endtime=${us(e)}`], seconds: secs };
    } };
  if (kind === "hikvision") return {
    async recordings({ days = 3 } = {}) {
      const iso = (d) => d.toISOString().replace(/\.\d+Z$/, "Z");
      const body = `<?xml version="1.0" encoding="UTF-8"?><CMSearchDescription><searchID>dayspring-${Date.now()}</searchID><trackList><trackID>${channel}01</trackID></trackList><timeSpanList><timeSpan><startTime>${iso(new Date(Date.now() - days * 864e5))}</startTime><endTime>${iso(new Date())}</endTime></timeSpan></timeSpanList><maxResults>100</maxResults><searchResultPostion>0</searchResultPostion><metadataList><metadataDescriptor>//recordType.meta.std-cgi.com</metadataDescriptor></metadataList></CMSearchDescription>`;
      const xml = (await http("/ISAPI/ContentMgmt/search", { method: "POST", body, headers: { "content-type": "application/xml" } })).buf.toString();
      return parseHikMatches(xml).map((m) => ({ ref: `hik:${m.uri}`, name: m.start, at: m.start, end: m.end, type: "video/mp4", kind: "stream" }));
    },
    async fetchRecording(ref) {
      const uri = String(ref).replace(/^hik:/, "");
      if (!/^rtsp:\/\//i.test(uri)) throw new Error("That recording address isn't one the camera gave.");
      const u = new URL(uri);
      if (u.hostname !== host) throw new Error("That recording isn't on this camera.");
      if (username) { u.username = username; u.password = password; }
      return { input: ["-rtsp_transport", "tcp", "-i", u.href], seconds: 600 };
    } };
  throw new Error("Unknown recordings type.");
}
