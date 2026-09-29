// This computer's memory and graphics, for recommending a local model (nothing is installed or changed: Windows' own
// CIM and registry, read once and kept). Intel and AMD integrated graphics share the main memory, and Ollama's support
// for Intel graphics is limited/experimental, so those count as "runs on the processor".
//   detect() → { ramGB, vramGB, gpu: "nvidia"|"amd"|"intel"|"apple"|null, gpuName, integrated, cpu, cores }
import { execFile } from "node:child_process";
import { totalmem, cpus } from "node:os";

let cached = null;
const PS = `$ErrorActionPreference='SilentlyContinue'
$cs = Get-CimInstance Win32_ComputerSystem
$gpus = @(Get-CimInstance Win32_VideoController | ForEach-Object { @{ name = $_.Name; ram = [double]$_.AdapterRAM } })
$reg = @(Get-ItemProperty 'HKLM:\\SYSTEM\\ControlSet001\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' | ForEach-Object { @{ name = $_.DriverDesc; mem = [double]$_.'HardwareInformation.qwMemorySize' } })
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
@{ ram = [double]$cs.TotalPhysicalMemory; gpus = $gpus; reg = $reg; cpu = $cpu.Name; cores = $cpu.NumberOfCores } | ConvertTo-Json -Depth 4 -Compress`;

export function classify(raw = {}) {
  const ramGB = Math.round((Number(raw.ram) || totalmem()) / 1024 ** 3 * 10) / 10;
  const list = (raw.gpus ?? []).filter((g) => g?.name && !/basic display|remote|virtual|parsec|mirage/i.test(g.name));
  const kind = (n) => (/nvidia|geforce|rtx|quadro|tesla/i.test(n) ? "nvidia" : /radeon|amd/i.test(n) ? "amd" : /intel|arc|iris|uhd/i.test(n) ? "intel" : null);
  // a card of its own beats integrated graphics
  const best = list.map((g) => {
    const reg = (raw.reg ?? []).find((r) => r?.name === g.name && r.mem > 0);
    const vram = (reg?.mem || g.ram || 0) / 1024 ** 3;
    const integrated = kind(g.name) === "intel" && !/arc\(tm\) a\d{3}|arc a\d{3}/i.test(g.name) || /radeon\(tm\) graphics$|radeon graphics$|vega \d+ graphics|780m|680m|890m/i.test(g.name);
    return { name: g.name, gpu: kind(g.name), vram, integrated };
  }).sort((a, b) => (a.integrated - b.integrated) || (b.vram - a.vram))[0];
  return { ramGB, vramGB: best && !best.integrated ? Math.round(best.vram * 10) / 10 : 0, gpu: best?.gpu ?? null, gpuName: best?.name ?? null, integrated: best ? best.integrated : true, cpu: raw.cpu ?? cpus()[0]?.model ?? null, cores: raw.cores ?? cpus().length };
}
export async function detect({ force = false } = {}) {
  if (cached && !force) return cached;
  if (process.env.DAYSPRING_FAKE_HARDWARE) { try { return (cached = classify(JSON.parse(process.env.DAYSPRING_FAKE_HARDWARE))); } catch { /* the real one */ } }
  if (process.platform !== "win32") return (cached = classify({}));
  const out = await new Promise((res) => execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", PS], { windowsHide: true, timeout: 15_000, encoding: "utf8" }, (e, o) => res(e ? "" : o)));
  let raw = {};
  try { raw = JSON.parse(out.trim() || "{}"); if (raw.gpus && !Array.isArray(raw.gpus)) raw.gpus = [raw.gpus]; if (raw.reg && !Array.isArray(raw.reg)) raw.reg = [raw.reg]; } catch { raw = {}; }
  return (cached = classify(raw));
}
