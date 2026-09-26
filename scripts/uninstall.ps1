# Removes Dayspring from this computer. Settings → About → Uninstall copies this script to %TEMP% and starts it hidden;
# it waits for Dayspring to stop (a program can't remove itself while it runs), then:
#   stops every Dayspring process (its helpers and the browser windows with a Dayspring profile; nothing else),
#   removes Dayspring's shortcuts (Start menu, desktop, Start with Windows) when they point at this install,
#   removes Dayspring's browser profile folders and its entry in the shared Ecosystem folder (never Lantern's files),
#   removes the program files, and the data folder only when -RemoveData is given (sent to the Recycle Bin, not deleted),
#   then shows "Dayspring has been uninstalled".
# The owner's source copy is never removed (the server refuses before it gets here, and this checks again).
param(
  [Parameter(Mandatory = $true)][string]$InstallDir,
  [int]$WaitPid = 0,
  [switch]$RemoveData,
  [string]$StartMenu = "",          # tests: stand-in folders
  [string]$Desktop = "",
  [string]$Startup = "",
  [string]$LocalAppData = "",
  [string]$RecycleTo = "",          # tests: move to this folder instead of the Recycle Bin
  [switch]$NoFinalPage
)
$ErrorActionPreference = "SilentlyContinue"
if (-not $StartMenu) { $StartMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Dayspring' }
if (-not $Desktop) { $Desktop = [Environment]::GetFolderPath('Desktop') }
if (-not $Startup) { $Startup = [Environment]::GetFolderPath('Startup') }
if (-not $LocalAppData) { $LocalAppData = $env:LOCALAPPDATA }
$InstallDir = (Resolve-Path -LiteralPath $InstallDir).Path.TrimEnd('\')
Set-Location -LiteralPath $env:TEMP     # a folder can't be removed while this script's working folder is inside it
$log = Join-Path $env:TEMP 'dayspring-uninstall.log'
function Note($t) { Add-Content -LiteralPath $log -Value ((Get-Date -Format s) + '  ' + $t) }
Note "uninstalling $InstallDir (remove data: $RemoveData)"

# safety: a real Dayspring install, and never the source copy releases are made from
$ok = (Test-Path -LiteralPath (Join-Path $InstallDir 'server.mjs')) -and (Test-Path -LiteralPath (Join-Path $InstallDir 'package.json'))
if ($ok) { try { $ok = ((Get-Content -Raw -LiteralPath (Join-Path $InstallDir 'package.json') | ConvertFrom-Json).name -match 'dayspring') } catch { $ok = $false } }
if (Test-Path -LiteralPath (Join-Path $InstallDir 'dist\Install Dayspring.cmd')) { $ok = $false; Note 'refused: this is the source copy' }
if (-not $ok) { Note 'refused: not a Dayspring install'; exit 2 }

function Recycle($path) {
  if (-not (Test-Path -LiteralPath $path)) { return }
  if ($RecycleTo) { New-Item -ItemType Directory -Force $RecycleTo | Out-Null; Move-Item -LiteralPath $path -Destination (Join-Path $RecycleTo ([IO.Path]::GetFileName($path))) -Force; return }
  Add-Type -AssemblyName Microsoft.VisualBasic
  if (Test-Path -LiteralPath $path -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($path, 'OnlyErrorDialogs', 'SendToRecycleBin') }
  else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($path, 'OnlyErrorDialogs', 'SendToRecycleBin') }
}

# 1. wait for Dayspring to stop, then end anything of Dayspring's that's left
if ($WaitPid) { for ($i = 0; $i -lt 60; $i++) { if (-not (Get-Process -Id $WaitPid -ErrorAction SilentlyContinue)) { break }; Start-Sleep -Milliseconds 500 } }
# only profiles in this Windows user's own LocalAppData (the stand-in folder in tests)
$profileRx = 'user-data-dir="?' + [regex]::Escape($LocalAppData) + '\\Dayspring(Display|TV|Media|Search)(-[a-z]+)?'
Get-CimInstance Win32_Process | Where-Object { ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($InstallDir, [StringComparison]::OrdinalIgnoreCase)) -or ($_.CommandLine -and $_.CommandLine -match $profileRx) } | ForEach-Object { Note ("stop " + $_.Name + " " + $_.ProcessId); Stop-Process -Id $_.ProcessId -Force }
Start-Sleep -Milliseconds 800

# 2. shortcuts that point at this install
$sh = New-Object -ComObject WScript.Shell
function PointsHere($lnk) { try { $s = $sh.CreateShortcut($lnk); return (($s.TargetPath + ' ' + $s.Arguments + ' ' + $s.WorkingDirectory) -like ('*' + $InstallDir + '*')) } catch { return $false } }
if (Test-Path -LiteralPath $StartMenu) { Remove-Item -LiteralPath $StartMenu -Recurse -Force; Note "removed $StartMenu" }
foreach ($f in @((Join-Path $Desktop 'Dayspring.lnk'), (Join-Path $Startup 'Dayspring.lnk'))) { if ((Test-Path -LiteralPath $f) -and (PointsHere $f)) { Remove-Item -LiteralPath $f -Force; Note "removed $f" } }

# 3. browser profiles and the shared Ecosystem entry (Lantern's files are never touched)
foreach ($p in @(Get-ChildItem -LiteralPath $LocalAppData -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^Dayspring(Display|TV|Media|Search)(-[a-z]+)?$' })) { Recycle $p.FullName; Note ("removed profile " + $p.Name) }
$eco = Join-Path $LocalAppData 'Ecosystem\apps\dayspring.json'
if (Test-Path -LiteralPath $eco) { Remove-Item -LiteralPath $eco -Force; Note 'removed the Ecosystem presence file' }

# 4. the program (and the data folder only when asked; it goes to the Recycle Bin)
$data = Join-Path $InstallDir 'data'
# a linked folder (junction) is unlinked, never emptied: its contents belong somewhere else
Get-ChildItem -LiteralPath $InstallDir -Force | Where-Object { $_.Name -ne 'data' } | ForEach-Object {
  if ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) { if ($_.PSIsContainer) { [IO.Directory]::Delete($_.FullName) } else { [IO.File]::Delete($_.FullName) } }
  else { Remove-Item -LiteralPath $_.FullName -Recurse -Force }
}
if ($RemoveData) { Recycle $InstallDir; Note 'data sent to the Recycle Bin' }
else { Note "kept the data in $data" }

# 5. done
Note 'uninstalled'
if (-not $NoFinalPage) {
  $page = Join-Path $env:TEMP 'dayspring-uninstalled.html'
  $kept = if ($RemoveData) { 'Your data went to the Recycle Bin (you can restore it from there).' } else { 'Your data (settings, schedule, notes, backups) is still in ' + $data + '.' }
  Set-Content -LiteralPath $page -Encoding UTF8 -Value ('<!doctype html><meta charset="utf-8"><title>Dayspring</title><body style="font:18px Segoe UI,sans-serif;background:#0b1020;color:#eef0ff;display:grid;place-items:center;height:100vh;margin:0"><div style="max-width:32em;text-align:center"><h1 style="font-weight:300">Dayspring has been uninstalled</h1><p>' + $kept + '</p><p>Thanks for using Dayspring. You can close this page.</p></div>')
  Start-Process $page
}
exit 0
