// Copying a GIF to the Windows clipboard, so it can be pasted anywhere: the GIF file itself (Outlook, Discord, Teams,
// Slack, a folder), the same GIF as a picture for rich editors (Gmail, Word: HTML pointing at the GIF's web address)
// and its link as plain text, all in one copy. Done by a short PowerShell step (System.Windows.Forms, single-threaded
// apartment as the clipboard requires). The data goes through a temporary JSON file, never the command line.
//   copyToClipboard({ file, html, text }) → { copied: true } | { dryRun: true, would }  (DAYSPRING_GIFS_CLIPBOARD=dry)
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PS = `$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$j = Get-Content -Raw -Encoding UTF8 -LiteralPath $args[0] | ConvertFrom-Json
$d = New-Object System.Windows.Forms.DataObject
if ($j.file) { $c = New-Object System.Collections.Specialized.StringCollection; [void]$c.Add([string]$j.file); $d.SetFileDropList($c) }
if ($j.html) { $d.SetData([System.Windows.Forms.DataFormats]::Html, [string]$j.html) }
if ($j.text) { $d.SetText([string]$j.text, [System.Windows.Forms.TextDataFormat]::UnicodeText) }
[System.Windows.Forms.Clipboard]::SetDataObject($d, $true, 5, 100)
'ok'
`;
// the clipboard's HTML format (CF_HTML): a header with byte offsets, then the fragment
export function cfHtml(fragment) {
  const pre = "<html><body><!--StartFragment-->", post = "<!--EndFragment--></body></html>";
  const head = (a, b, c, d) => `Version:0.9\r\nStartHTML:${String(a).padStart(10, "0")}\r\nEndHTML:${String(b).padStart(10, "0")}\r\nStartFragment:${String(c).padStart(10, "0")}\r\nEndFragment:${String(d).padStart(10, "0")}\r\n`;
  const hl = head(0, 0, 0, 0).length;
  const len = (s) => Buffer.byteLength(s, "utf8");
  const sh = hl, sf = sh + len(pre), ef = sf + len(fragment), eh = ef + len(post);
  return head(sh, eh, sf, ef) + pre + fragment + post;
}
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])).replace(/[^\x20-\x7e]/g, (c) => `&#${c.codePointAt(0)};`);
export const imgHtml = (url, alt) => `<img src="${esc(url)}" alt="${esc(alt)}">`;

export function copyToClipboard({ file = null, html = null, text = null } = {}) {
  const would = { file, html: html ? cfHtml(html) : null, text };
  if (process.env.DAYSPRING_GIFS_CLIPBOARD === "dry" || process.platform !== "win32") return Promise.resolve({ dryRun: true, would });
  return new Promise((resolve, reject) => {
    const dir = mkdtempSync(join(tmpdir(), "ds-gifclip-"));
    const cleanup = () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* fine */ } };
    try {
      writeFileSync(join(dir, "c.ps1"), PS, "utf8");
      writeFileSync(join(dir, "c.json"), JSON.stringify(would), "utf8");
    } catch (e) { cleanup(); return reject(e); }
    const ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-File", join(dir, "c.ps1"), join(dir, "c.json")], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", errText = "";
    ps.stdout.on("data", (x) => (out += x)); ps.stderr.on("data", (x) => (errText += x));
    const timer = setTimeout(() => { try { ps.kill(); } catch { /* gone */ } }, 15_000);
    ps.on("close", (code) => { clearTimeout(timer); cleanup(); if (code === 0 && /ok/.test(out)) resolve({ copied: true }); else reject(new Error(`The clipboard didn't take it${errText ? ` (${errText.trim().split(/\r?\n/)[0].slice(0, 120)})` : ""}.`)); });
    ps.on("error", (e) => { clearTimeout(timer); cleanup(); reject(e); });
  });
}
