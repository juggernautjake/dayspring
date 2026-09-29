// Dayspring's own windows, handed to the window manager (public/winman.js): big, normal, small, minimised to the dock,
// closed; by voice ("minimize the map", "put the viewer in the corner"), the – ❐ ▢ buttons and the keys. Each panel keeps
// its own code; this only registers it (its own – and ▢ now minimise into the dock and make it big, like every window). A panel created
// later (Mail, the picture grid) is registered when it appears. The video player registers itself (tv.js).
// Another add-on registers its own window the same way: winman.register("gallery", el, { title: "Photos", icon: "🖼",
// aliases: ["gallery", "photos"], bar: ".my-header", onClose: () => close(), isOpen: () => isItOpen() }).
(() => {
  const W = window.winman; if (!W) return;
  const $ = (s) => document.querySelector(s);
  const frameOpen = (sel) => () => { const f = $(sel); const src = f?.getAttribute("src") ?? ""; return Boolean(f && src && src !== "about:blank"); };
  // /cameras.html, /printers.html, /smarthome.html, /setup: what the page window is showing now
  const PAGE = [[/cameras/, "Cameras", "📷", ["cameras", "camera", "camera page"]], [/printers/, "Printers", "🖨", ["printers", "printer", "3d printer"]], [/smarthome|devices/, "Devices", "💡", ["devices", "smart home", "home devices", "device page"]],
    [/setup|settings/, "Settings", "⚙", ["settings", "settings page"]], [/.*/, "Page", "▣", ["page"]]];
  const pageInfo = () => { const src = $("#pageframe")?.getAttribute("src") ?? ""; return PAGE.find(([re]) => re.test(src)); };
  const SPEC = {
    // #id or selector → [winman id, options]
    "#dsMB": ["mediabrowser", { title: "Music & Video", icon: "🎵", aliases: ["music browser", "music and video", "media browser", "library", "browser"], bar: ".mb-bar", before: ".mb-win", route: { ".mb-min": "min", ".mb-dock": "max" }, grip: ".mb-grip", stripClass: "float",
      isOpen: () => Boolean(window.dsMB?._state?.().open), onClose: () => window.dsMB?.close() }],
    "#dsViewer": ["viewer", { title: () => $("#dsViewer .vw-title b")?.textContent || "Viewer", icon: "🗎", aliases: ["viewer", "file viewer", "file", "document"], bar: ".vw-bar", before: ".vw-x", grip: ".vw-grip",
      onClose: () => window.dsViewer?.close() }],
    "#dsMaps": ["maps", { title: "Maps", icon: "🗺", aliases: ["map", "maps"], bar: ".mp-bar", before: ".mp-win", route: { ".mp-min": "min", ".mp-dock": "max" }, grip: ".mp-grip", stripClass: "float",
      isOpen: (r) => Boolean(window.dsMaps?._state?.().open || window.dsMaps?._state?.().minimized || r.minHidden), onClose: () => window.dsMaps?.close() }],
    "#dsGifs": ["gifs", { title: "GIFs", icon: "🎞", aliases: ["gifs", "gif"], bar: ".g-bar", before: ".g-win", route: { ".g-min": "min", ".g-max": "max" }, grip: ".g-resize", stripClass: "float",
      onClose: () => $("#dsGifs .g-x")?.click() }],
    ".mailwin": ["mail", { title: "Mail", icon: "✉", aliases: ["email", "mail", "inbox"], bar: ".mw-bar", before: '[data-a="close"]', onClose: () => window.dsMail?.close() }],
    "#dsImages": ["images", { title: "Pictures", icon: "🖼", aliases: ["images", "pictures", "image grid"], bar: "header", onClose: () => $("#dsImages header .ib")?.click() }],
    "#calwrap": ["schedule", { title: "Schedule", icon: "📅", aliases: ["schedule", "calendar"], isOpen: frameOpen("#calframe"), onClose: () => window.postMessage({ type: "dayspring-calendar-close" }, "*"), overStyle: "left:.6em;right:auto;top:.6em" }],
    "#pagewrap": ["page", { title: () => pageInfo()?.[1] ?? "Page", icon: "▣", aliases: () => pageInfo()?.[3] ?? ["page"], isOpen: frameOpen("#pageframe"), onClose: () => $("#pageClose")?.click(), overStyle: "left:.6em;right:auto;top:.6em" }],
  };
  function scan() {
    for (const [sel, [id, o]] of Object.entries(SPEC)) {
      const el = $(sel);
      if (!el || el.dataset.wmId === id) continue;
      const h = W.register(id, el, o);
      const over = el.querySelector(":scope > .wm-btns.wm-over"); if (over && o.overStyle) over.style.cssText = o.overStyle;
      if (id === "page") { const upd = () => h?.update({ icon: pageInfo()?.[2] ?? "▣" }); upd(); new MutationObserver(upd).observe($("#pageframe"), { attributes: true, attributeFilter: ["src"] }); }
    }
  }
  scan();
  new MutationObserver(() => scan()).observe(document.body, { childList: true });
  // the picture grid draws itself anew each time: its buttons go back in
  setInterval(() => { const im = $("#dsImages"); if (im && im.dataset.wmId && !im.querySelector(".wm-btns")) W.register("images", im, SPEC["#dsImages"][1]); }, 1500);
})();
