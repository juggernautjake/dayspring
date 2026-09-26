// "Add your own" chips: type an interest, press Enter (or a comma) and it becomes a chip; ✕ removes it. Used by the
// welcome Interests step and Settings → You. window.dsChipInput(el, { values, max, placeholder, label }) → { values() }
(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const css = document.createElement("style");
  css.textContent = `
  .ci{display:flex;flex-wrap:wrap;gap:.4em;align-items:center;padding:.4em;border:1px solid var(--edge2,rgba(170,180,255,.28));border-radius:.8em;background:rgba(255,255,255,.05);cursor:text}
  .ci:focus-within{border-color:var(--indigo,#7c8cff)}
  .ci .c{display:inline-flex;align-items:center;gap:.3em;padding:.2em .3em .2em .75em;border-radius:2em;background:rgba(124,140,255,.25);border:1px solid rgba(124,140,255,.45);font-size:.92em;max-width:100%}
  .ci .c span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ci .c button{border:0;background:rgba(255,255,255,.12);color:inherit;border-radius:50%;width:1.5em;height:1.5em;line-height:1;cursor:pointer;font-size:.8em;flex:none}
  .ci .c button:hover{background:rgba(255,255,255,.3)}
  .ci input[type=text]{flex:1 1 10em;min-width:8em;border:0!important;background:transparent!important;min-height:2em!important;padding:.2em .4em!important;outline:none;width:auto!important}
  .ci-hint{color:var(--dim,#a4abcc);font-size:.85em;margin-top:.3em}`;
  document.head.appendChild(css);

  window.dsChipInput = (el, { values = [], max = 40, placeholder = "Type one and press Enter", label = "Add your own interest" } = {}) => {
    let vals = [];
    const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    const has = (s) => vals.some((v) => v.toLowerCase() === s.toLowerCase());
    el.innerHTML = `<div class="ci" role="group" aria-label="${esc(label)}"><input type="text" autocomplete="off" spellcheck="true" placeholder="${esc(placeholder)}" aria-label="${esc(label)}"></div><div class="ci-hint" aria-live="polite"></div>`;
    const box = el.querySelector(".ci"), inp = box.querySelector("input"), hint = el.querySelector(".ci-hint");
    const paint = () => {
      box.querySelectorAll(".c").forEach((c) => c.remove());
      inp.insertAdjacentHTML("beforebegin", vals.map((v, i) => `<span class="c" data-i="${i}"><span title="${esc(v)}">${esc(v)}</span><button type="button" aria-label="Remove ${esc(v)}">✕</button></span>`).join(""));
      inp.disabled = vals.length >= max;
      inp.placeholder = vals.length >= max ? `That's the most (${max})` : placeholder;
      hint.textContent = vals.length ? `${vals.length} of ${max}. Press Enter after each one.` : "Anything you like: woodworking, marine wildlife, pickleball… Press Enter after each one.";
    };
    // typed text splits on commas; saved interests arrive whole ("strategy games (4X, voxel worlds)" stays one chip)
    const add = (text, whole = false) => {
      for (const s of (whole ? text : String(text).split(",")).map(clean).filter(Boolean)) { if (vals.length >= max) break; if (!has(s)) vals.push(s); }
      paint();
    };
    inp.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === ",") && inp.value.trim()) { e.preventDefault(); e.stopPropagation(); add(inp.value); inp.value = ""; }
      else if (e.key === "Enter") { e.stopPropagation(); e.preventDefault(); }
      else if (e.key === "Backspace" && !inp.value && vals.length) { vals.pop(); paint(); }
    });
    inp.addEventListener("blur", () => { if (inp.value.trim()) { add(inp.value); inp.value = ""; } });
    box.addEventListener("click", (e) => {
      const x = e.target.closest(".c button");
      if (x) { vals.splice(Number(x.closest(".c").dataset.i), 1); paint(); inp.focus(); return; }
      if (e.target === box) inp.focus();
    });
    add(Array.isArray(values) ? values.map(String) : [], true);
    // anything still being typed counts too
    return { values: () => { if (inp.value.trim()) { add(inp.value); inp.value = ""; } return [...vals]; }, input: inp };
  };
})();
