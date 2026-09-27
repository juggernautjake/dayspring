// A one-time question on the Dayspring screen for installs from before file access had to be chosen: their setting was
// kept exactly as it was (nothing widened, deleting off), and this asks the owner to confirm it once, or review it in
// Settings → Permissions. A small card in the corner: it never covers the day or takes the keyboard.
(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const later = () => { try { return sessionStorage.getItem("ds-fa-later") === "1"; } catch { return false; } };
  async function check() {
    if (later() || document.getElementById("faCheck")) return;
    let p; try { const r = await fetch("/api/setup/permissions"); if (!r.ok) return; p = await r.json(); } catch { return; }
    if (!p?.confirmPending) return;
    const card = document.createElement("div");
    card.id = "faCheck"; card.setAttribute("role", "region"); card.setAttribute("aria-label", "Please confirm file access");
    card.style.cssText = "position:fixed;left:1.2em;bottom:1.2em;z-index:60;max-width:26em;background:rgba(16,19,44,.96);color:#eef0ff;border:1px solid rgba(255,210,122,.55);border-radius:1em;padding:.9em 1em;font:inherit;font-size:max(14px,.9em);box-shadow:0 10px 40px rgba(0,0,0,.5)";
    card.innerHTML = `<b style="font-weight:600">Please confirm what Dayspring may do with your files</b>
      <p style="margin:.4em 0 .6em;color:#c9cdea">Dayspring now asks everyone to choose this. Yours was kept exactly as it was: ${esc(p.summary)}</p>
      <div style="display:flex;gap:.5em;flex-wrap:wrap"><button type="button" data-k="keep" style="background:linear-gradient(135deg,#7c8cff,#a78bfa);border:0;color:#fff;border-radius:.7em;padding:.45em 1em;cursor:pointer;font:inherit">Keep it</button>
      <a href="/setup?s=permissions" target="_blank" rel="noopener" data-k="review" style="border:1px solid rgba(170,180,255,.4);color:#eef0ff;border-radius:.7em;padding:.45em 1em;text-decoration:none">Review in Settings</a>
      <button type="button" data-k="later" style="background:none;border:0;color:#a4abcc;cursor:pointer;font:inherit">Later</button></div>`;
    card.addEventListener("click", async (e) => {
      const k = e.target.closest("[data-k]")?.dataset.k; if (!k) return;
      if (k === "keep") { try { await fetch("/api/setup/permissions/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); } catch { /* asked again next time */ } }
      if (k !== "keep") { try { sessionStorage.setItem("ds-fa-later", "1"); } catch { /* private mode */ } }
      card.remove();
    });
    document.body.appendChild(card);
  }
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", () => setTimeout(check, 4000)); else setTimeout(check, 4000);
})();
