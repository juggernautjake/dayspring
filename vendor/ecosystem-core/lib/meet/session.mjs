// One managed Google Meet window, driven by Playwright (injected, so this module has no dependencies).
//
//   const s = createMeetSession({ chromium, profileDir, channel: "chrome", onEvent });
//   await s.open("https://meet.google.com/abc-defg-hij")  → { ok, stage: "in-call" | "prejoin" | "sign-in" | "loading" }
//   s.status() · await s.selfCheck() · await s.enableCaptions() · await s.openChat() · await s.sendChat(text)
//   await s.toggleMic() · await s.toggleCamera() · await s.toggleCaptions() · await s.leave() · await s.close()
//   await s.participants() · await s.tile(bounds) · await s.large(bounds) · await s.badge({ as, text } | null)
//
// It never types a password or signs in: when Google wants a sign-in, stage is "sign-in" and the owner does it in the
// window. Joining clicks "Join now" / "Ask to join" only after the owner asked Dayspring to join that meeting.
import { agentSource, REGISTRY } from "./selectors.mjs";

// A click that doesn't depend on what's on top (the small tile has a see-through cover over the page)
const press = (loc) => loc.evaluate((el) => el.click()).then(() => true, () => false);

const MEET_URL = /^https:\/\/meet\.google\.com\/[a-z]{3,4}-[a-z]{3,5}-[a-z]{3,4}(?:[/?#].*)?$/i;
export const meetLink = (text) => {
  const m = /https?:\/\/meet\.google\.com\/([a-z]{3,4}-[a-z]{3,5}-[a-z]{3,4})\b/i.exec(String(text ?? "")) ?? /\bmeet\.google\.com\/([a-z]{3,4}-[a-z]{3,5}-[a-z]{3,4})\b/i.exec(String(text ?? ""));
  return m ? `https://meet.google.com/${m[1].toLowerCase()}` : null;
};
export const isMeetUrl = (u) => MEET_URL.test(String(u ?? ""));

export function createMeetSession({ chromium, profileDir, channel = undefined, headless = false, args = [], registry = REGISTRY, onEvent = () => {}, allowUrl = null, log = () => {}, launch = null } = {}) {
  let ctx = null, page = null, url = null, stage = "closed", lastState = {}, opening = null;
  const emit = (e) => { try { onEvent(e); } catch (err) { log(`meet event handler: ${err.message}`); } };
  const okUrl = (u) => isMeetUrl(u) || (typeof allowUrl === "function" && allowUrl(u));

  async function ensure() {
    if (ctx && page && !page.isClosed()) return page;
    const make = launch ?? (() => chromium.launchPersistentContext(profileDir, {
      channel, headless, viewport: null,
      args: ["--no-first-run", "--disable-session-crashed-bubble", "--disable-blink-features=AutomationControlled", "--window-size=1280,800", "--window-position=80,60", ...args],
      ignoreDefaultArgs: ["--enable-automation", "--mute-audio"],
      permissions: ["microphone", "camera", "notifications"],
    }));
    ctx = await make();
    ctx.on("close", () => { ctx = null; page = null; if (stage !== "closed") { stage = "closed"; emit({ type: "closed" }); } });
    await ctx.exposeBinding("__ecoMeetEmit", (_src, ev) => { if (ev && typeof ev === "object") { if (ev.type === "state") lastState = ev; emit(ev); } }).catch(() => {});
    await ctx.addInitScript({ content: agentSource(registry) });
    page = ctx.pages()[0] ?? await ctx.newPage();
    for (const extra of ctx.pages()) if (extra !== page) await extra.close().catch(() => {});
    return page;
  }

  async function stageNow() {
    if (!page || page.isClosed()) return "closed";
    const u = page.url();
    if (/accounts\.google\.com|\/signin|ServiceLogin/i.test(u)) return "sign-in";
    const s = await page.evaluate(() => window.__ecoMeet?.selfCheck()).catch(() => null);
    if (s?.inCall) return "in-call";
    const join = await joinButton();
    if (join) return "prejoin";
    return "loading";
  }
  async function joinButton() {
    if (!page) return null;
    for (const sel of registry.joinButton ?? []) { const b = page.locator(sel).first(); if (await b.isVisible().catch(() => false)) return b; }
    const b = page.getByRole("button", { name: /^(join now|ask to join|join here too|switch here)$/i }).first();
    return (await b.isVisible().catch(() => false)) ? b : null;
  }

  async function toggle(part, keys) {
    if (!page) return false;
    const b = page.locator((registry[part] ?? []).join(", ")).first();
    if (await b.isVisible().catch(() => false) && await press(b)) return true;
    await page.bringToFront().catch(() => {});
    await page.locator("body").press(keys).catch(() => {});
    return true;
  }
  const api = {
    get page() { return page; },
    status: () => ({ open: Boolean(page && !page.isClosed()), url, stage, ...lastState }),
    async open(link, { join = true, waitMs = 45_000 } = {}) {
      if (!okUrl(link)) return { ok: false, error: "That isn't a Google Meet link." };
      if (opening) return opening;
      opening = (async () => {
        const p = await ensure();
        url = link; stage = "loading";
        if (p.url() !== link) await p.goto(link, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch((e) => log(`meet: ${e.message}`));
        const until = Date.now() + waitMs;
        while (Date.now() < until) {
          stage = await stageNow();
          if (stage === "in-call" || stage === "sign-in") break;
          if (stage === "prejoin" && join) { const b = await joinButton(); if (b) { await b.click().catch(() => {}); await p.waitForTimeout(1500); continue; } }
          await p.waitForTimeout(700);
        }
        emit({ type: "stage", stage });
        if (stage === "in-call") { await api.enableCaptions().catch(() => {}); await api.openChat().catch(() => {}); }
        return { ok: stage === "in-call", stage };
      })();
      try { return await opening; } finally { opening = null; }
    },
    async refreshStage() { stage = await stageNow(); return stage; },
    async selfCheck() {
      if (!page || page.isClosed()) return { open: false };
      const s = await page.evaluate(() => window.__ecoMeet?.selfCheck()).catch(() => null);
      return { open: true, stage: await stageNow(), ...(s ?? { agent: false }) };
    },
    async participants() { return page ? await page.evaluate(() => window.__ecoMeet?.participants() ?? []).catch(() => []) : []; },
    async selfName() { return page ? await page.evaluate(() => window.__ecoMeet?.selfName() ?? "").catch(() => "") : ""; },
    async enableCaptions() {
      if (!page) return false;
      for (let i = 0; i < 3; i++) {
        if (await page.evaluate(() => window.__ecoMeet?.captionsOn()).catch(() => false)) return true;
        const b = page.locator((registry.captionsButton ?? []).join(", ")).first();
        const label = (await b.getAttribute("aria-label").catch(() => "")) ?? "";
        if (/turn off captions/i.test(label)) return true;
        if (await b.isVisible().catch(() => false)) await press(b); else await page.keyboard.press("c").catch(() => {});
        await page.waitForTimeout(1200);
      }
      return Boolean(await page.evaluate(() => window.__ecoMeet?.captionsOn()).catch(() => false));
    },
    async toggleCaptions() { if (page) { await page.keyboard.press("c").catch(() => {}); return true; } return false; },
    // Meet's own buttons (its Ctrl+D / Ctrl+E shortcuts when a button can't be found)
    async toggleMic() { return toggle("micButton", "Control+d"); },
    async toggleCamera() { return toggle("camButton", "Control+e"); },
    async micState() {
      if (!page) return null;
      const l = await page.locator((registry.micButton ?? []).join(", ")).first().getAttribute("aria-label").catch(() => null);
      return l ? (/turn on/i.test(l) ? "muted" : /turn off/i.test(l) ? "on" : null) : null;
    },
    // The chat box is only usable while the chat panel is open (it may be in the page but hidden when it isn't)
    async openChat() {
      if (!page) return false;
      const box = page.locator((registry.chatInput ?? []).join(", ")).first();
      if (await box.isVisible().catch(() => false)) return true;
      const b = page.locator((registry.chatButton ?? []).join(", ")).first();
      if (await b.isVisible().catch(() => false)) { await press(b); await box.waitFor({ state: "visible", timeout: 3000 }).catch(() => {}); }
      return await box.isVisible().catch(() => false);
    },
    async sendChat(text) {
      if (!page || !String(text ?? "").trim()) return false;
      if (!(await api.openChat())) return false;
      const box = page.locator((registry.chatInput ?? []).join(", ")).first();
      try {
        await box.fill(String(text), { timeout: 5000 });
        await box.press("Enter", { timeout: 3000 });
        return true;
      } catch (e) { log(`meet chat: ${e.message}`); return false; }
    },
    async leave() {
      if (!page) return false;
      const b = page.locator((registry.leaveButton ?? []).join(", ")).first();
      if (await b.isVisible().catch(() => false)) { await press(b); await page.waitForTimeout(800); }
      stage = "left"; emit({ type: "stage", stage });
      return true;
    },
    async close() { stage = "closed"; const c = ctx; ctx = null; page = null; if (c) await c.close().catch(() => {}); },
    // Window size and place (screen pixels) through the DevTools protocol, and a scaled-down page for the small tile,
    // so captions and chat keep their full layout (and keep being read) while the window is small.
    async bounds(b, { scale = null } = {}) {
      if (!page) return false;
      let cdp = null;
      try {
        cdp = await page.context().newCDPSession(page);
        const { windowId } = await cdp.send("Browser.getWindowForTarget");
        await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
        if (b.windowState && b.windowState !== "normal") await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: b.windowState } });
        else await cdp.send("Browser.setWindowBounds", { windowId, bounds: { left: b.left, top: b.top, width: b.width, height: b.height } });
        if (scale) await cdp.send("Emulation.setDeviceMetricsOverride", { width: scale.width, height: scale.height, deviceScaleFactor: 0, mobile: false, scale: scale.factor }).catch(() => {});
        else await cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => {});
        return true;
      } catch (e) { log(`meet window: ${e.message}`); return false; }
      finally { await cdp?.detach().catch(() => {}); }
    },
    async setTile(on, label) { if (page) await page.evaluate(([o, l]) => window.__ecoMeet?.setTile(o, l), [on, label]).catch(() => {}); },
    async badge(b) { if (page) await page.evaluate((x) => window.__ecoMeet?.badge(x), b ?? null).catch(() => {}); },
  };
  return api;
}
