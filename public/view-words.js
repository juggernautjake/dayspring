// How a video is shown, in words: big, in the corner (picture in picture), audio only, full screen; where the corner
// window goes; bigger or smaller. One list for the Dayspring screen (tv.js, said right there) and the server
// (lib/video/controls.mjs, said anywhere), so the two never disagree.
//   dsViewWords(text) → { action, value, say } | null
//     action "view"   value big | corner | audio | full | exitFull
//     action "place"  value tl | tr | bl | br | t | b | l | r | c      (the corner window; it becomes one if it isn't)
//     action "resize" value bigger | smaller                          (the corner window; big and audio step between modes)
// "Turn off the video" and "close the video" stay "stop". "Minimize" means audio only (the owner's word for it).
(function (root) {
  const VID = "(?:the |this |that |my )?(?:youtube video|video|picture|player|youtube|movie|clip|show|it|this|that)";
  const PLACE = { "top left": "tl", "upper left": "tl", "top right": "tr", "upper right": "tr", "bottom left": "bl", "lower left": "bl", "bottom right": "br", "lower right": "br",
    top: "t", up: "t", bottom: "b", down: "b", left: "l", right: "r", center: "c", centre: "c", middle: "c" };
  const PLACE_RE = "(top left|upper left|top right|upper right|bottom left|lower left|bottom right|lower right|top|bottom|left|right|center|centre|middle)";
  const norm = (s) => String(s == null ? "" : s).toLowerCase().replace(/[’`]/g, "'").replace(/[!?,;:"“”]/g, " ").replace(/\.(?!\d)/g, " ").replace(/\s+/g, " ").trim()
    .replace(/^(?:(?:please|can you|could you|would you|hey|ok|okay|dayspring|go ahead and|just go ahead and) )+/, "").replace(/ (?:please|for me|now|thanks)$/, "").trim();
  function viewWords(text) {
    const t = norm(text);
    if (!t || t.length > 80) return null;
    let m;
    // audio only (the picture goes away; the sound keeps playing)
    if (new RegExp(`^(?:minimi[sz]e|hide|lose)(?: ${VID})?$`).test(t)
      || /^(?:audio|sound|music|listen) only$|^only (?:the )?(?:audio|sound|music)$|^(?:just|only) (?:play |keep |give me |keep playing )?(?:the )?(?:audio|sound|music)(?: only)?$/.test(t)
      || /^(?:play|keep) (?:just|only) (?:the )?(?:audio|sound|music)$|^(?:play|keep playing) (?:the )?(?:audio|sound) only$|^(?:play|keep playing) (?:it |the video )?in the background$/.test(t)
      || /^(?:turn off|hide|lose|get rid of|no more) the (?:picture|screen part|visuals?)$|^(?:audio|listening|background) mode$|^i (?:just )?want to (?:listen|hear it)(?: to it)?$/.test(t)
      || /^(?:hide|minimi[sz]e) the video but keep (?:playing|the (?:audio|sound|music))$|^(?:make it|go) audio only$|^switch to audio(?: only)?$/.test(t))
      return { action: "view", value: "audio", say: "Just the sound now." };
    // the corner: picture in picture
    if (/^(?:picture in picture|pip|mini ?player|mini ?view)(?: mode)?$|^(?:small|little|corner|floating) (?:window|screen|player|mode|view)$/.test(t)
      || new RegExp(`^(?:put|move|send|stick|tuck) ${VID} (?:in|into|to|in to) (?:the |a )?corner$|^(?:make|turn) ${VID} (?:small|little|a small window|into a small window)$|^(?:shrink|tuck away)(?: ${VID})?$`).test(t)
      || new RegExp(`^(?:show|put|play) ${VID} in (?:a |the )?(?:small|little|corner|floating) (?:window|player|box)$|^(?:switch to|go to) (?:picture in picture|the corner|corner mode|mini player)$`).test(t))
      return { action: "view", value: "corner", say: "" };
    // where the corner window goes
    if ((m = new RegExp(`^(?:move|put|send|drag|take|slide|stick) ${VID} (?:to|in|into|over to|up to|down to|to the|in the|over to the|up to the|down to the)? ?(?:the )?${PLACE_RE}(?: corner| side| edge| of the screen| of the tv)?$`).exec(t)))
      return { action: "place", value: PLACE[m[1]], say: "" };
    if ((m = new RegExp(`^(?:move|put|slide) ${VID} (up|down|left|right)(?: a (?:bit|little))?$`).exec(t))) return { action: "place", value: PLACE[m[1]], say: "" };
    // bigger / smaller (the corner window's size; from big, smaller goes to the corner)
    if ((m = new RegExp(`^(?:make|turn) ${VID} (?:a (?:little|bit) )?(bigger|larger|smaller|tinier)$|^(bigger|larger|smaller)$|^(?:grow|enlarge) ${VID}$`).exec(t)))
      return { action: "resize", value: /small|tin/.test(m[1] ?? m[2] ?? "") ? "smaller" : "bigger", say: "" };
    // full screen, and out of it
    if (/^(?:exit|leave|get out of|close|turn off|stop|no(?: more)?) full ?screen$|^(?:un)?full ?screen off$|^go back to (?:the )?(?:normal|regular) (?:size|view)$|^(?:normal|regular) (?:size|view)$/.test(t)) return { action: "view", value: "exitFull", say: "" };
    if (/^(?:go |put it |make it |turn on |switch to |open )?full ?screen(?: (?:the )?video| mode)?$|^full ?screen (?:the )?video$|^maximi[sz]e(?: the)?(?: video| player)?$|^(?:make (?:it|the video) )?(?:fill|take up) the (?:whole )?screen$/.test(t)) return { action: "view", value: "full", say: "" };
    // big (theatre): the video back where it can be watched
    if (new RegExp(`^(?:make|turn) ${VID} big(?: again)?$|^(?:go|make it) big(?: again)?$|^show(?: me)? (?:the )?(?:video|picture)(?: again)?$|^(?:bring|put) ${VID} back(?: up)?$|^(?:restore|bring back|bring up|expand|unminimi[sz]e)(?: ${VID})?(?: back)?$`).test(t)
      || /^(?:theat(?:er|re)|big|large) (?:mode|view|size|screen)$|^back to (?:the )?(?:big|large) (?:size|view|screen|player)$|^(?:i want to )?(?:watch|see) (?:it|the video)(?: again)?$|^switch to video$/.test(t))
      return { action: "view", value: "big", say: "" };
    return null;
  }
  root.dsViewWords = viewWords;

  // ---- every window on the screen (public/winman.js), by name: "minimize the map", "shrink the email", "put the viewer in
  // the corner", "maximize the browser", "restore the map", "move the map to the right side", "close the viewer", "hide
  // everything" / "minimize all", "show everything again".
  //   dsWindowWords(text, windows) → { op, id?, value? } | null
  //     windows: [{ id, aliases }] (what's registered on the screens; NAMES below adds the usual words for each)
  //     op "mode" value max | normal | small | min · "restore" · "close" · "place" value tl…c · "resize" value bigger | smaller
  //     · "minAll" · "restoreAll"
  const NAMES = {
    video: ["video", "videos", "player", "youtube", "movie", "clip"],
    mediabrowser: ["music browser", "media browser", "music and video", "music & video", "music and video browser", "music library", "library", "browser"],
    viewer: ["viewer", "file viewer", "file", "document", "pdf", "picture viewer", "photo viewer", "image viewer"],
    maps: ["map", "maps", "directions"],
    mail: ["email", "e-mail", "emails", "mail", "inbox", "email window"],
    gifs: ["gif", "gifs", "gif picker"],
    images: ["images", "image grid", "image results", "pictures", "picture grid", "image search"],
    schedule: ["schedule", "calendar"],
    page: ["settings", "settings page", "page"],
  };
  const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function windowWords(text, windows) {
    const t = norm(text);
    if (!t || t.length > 90) return null;
    if (/^(?:minimi[sz]e|hide|tuck away|put away|clear away) (?:all|everything|all (?:the |my |of the )?windows|every window|all of (?:them|it))$|^clear (?:the |my )?screen$/.test(t)) return { op: "minAll" };
    if (/^(?:show|restore|bring back|unhide|open|bring up) (?:all|everything|all (?:the |my |of the )?windows|all of (?:them|it)|every window)(?: again| back)?$|^bring (?:it all|everything|all of it|them all) back$/.test(t)) return { op: "restoreAll" };
    const byName = new Map();
    for (const w of windows ?? []) for (const n of [...(NAMES[w.id] ?? []), ...(w.aliases ?? [])]) { const k = String(n).toLowerCase().trim(); if (k && !byName.has(k)) byName.set(k, w.id); }
    if (!byName.size) return null;
    const names = [...byName.keys()].sort((a, b) => b.length - a.length).map(reEsc).join("|");
    const T = `(?:the |my |this |that )?(${names})(?: window| panel| page| app)?`;
    const R = (s) => new RegExp(`^${s}$`);
    let m;
    const id = (i = 1) => byName.get(m[i]);
    if ((m = R(`(?:minimi[sz]e|hide|dock|collapse|tuck away) ${T}`).exec(t)) || (m = R(`(?:put|tuck) ${T} away`).exec(t))) return { op: "mode", id: id(), value: "min" };
    if ((m = R(`(?:maximi[sz]e|expand|enlarge) ${T}`).exec(t)) || (m = R(`(?:make|put) ${T} (?:big|large|huge|full ?screen)`).exec(t)) || (m = R(`full ?screen ${T}`).exec(t)) || (m = R(`(?:make )?${T} (?:fill|take up) the (?:whole )?screen`).exec(t))) return { op: "mode", id: id(), value: "max" };
    if ((m = R(`(?:put|move|send|stick|tuck) ${T} (?:in|into|to) (?:the |a )?corner`).exec(t))) return { op: "place", id: id(), value: "br" };
    if ((m = R(`(?:move|put|send|drag|slide|stick) ${T} (?:to|in|into|over to|up to|down to|on)? ?(?:the )?${PLACE_RE}(?: corner| side| edge| half| of the screen)?`).exec(t))) return { op: "place", id: id(), value: PLACE[m[2]] };
    if ((m = R(`(?:make|turn) ${T} (?:a (?:little|bit) )?(bigger|larger|smaller|tinier)`).exec(t))) return { op: "resize", id: id(), value: /small|tin/.test(m[2]) ? "smaller" : "bigger" };
    if ((m = R(`(?:shrink|float|pop out) ${T}`).exec(t)) || (m = R(`(?:make|turn) ${T} (?:small|little|a small window|into a small window|a window)`).exec(t)) || (m = R(`(?:put|show|open) ${T} in a (?:small|little|floating) window`).exec(t))) return { op: "mode", id: id(), value: "small" };
    if ((m = R(`(?:make|turn|put) ${T} (?:back to )?normal(?: size)?`).exec(t)) || (m = R(`${T} (?:back to )?normal size`).exec(t))) return { op: "mode", id: id(), value: "normal" };
    if ((m = R(`(?:restore|unminimi[sz]e|bring back|bring up|unhide|show|open) ${T}(?: again| back)?`).exec(t)) || (m = R(`(?:bring|put) ${T} back(?: up)?`).exec(t))) return { op: "restore", id: id() };
    if ((m = R(`(?:close|exit|dismiss|shut) ${T}`).exec(t))) return { op: "close", id: id() };
    return null;
  }
  root.dsWindowWords = windowWords;
  root.dsWindowNames = NAMES;
})(typeof window !== "undefined" ? window : globalThis);
