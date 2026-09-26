# Installed programs, for Dayspring's "open a program" ability.
#   -List          JSON: [{ name, appId, lnk, exe }]  (Start menu shortcuts + Get-StartApps, which includes Store apps)
#   -Open <appId>  opens it through the Start menu's app folder (works for desktop and Store apps)
#   -OpenLnk <path>  opens a Start menu shortcut
param([switch]$List, [string]$Open, [string]$OpenLnk)
$ErrorActionPreference = "SilentlyContinue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if ($List) {
  $shell = New-Object -ComObject WScript.Shell
  $dirs = @("$env:ProgramData\Microsoft\Windows\Start Menu\Programs", "$env:APPDATA\Microsoft\Windows\Start Menu\Programs")
  $lnks = @{}
  foreach ($d in $dirs) {
    Get-ChildItem -Path $d -Recurse -Filter *.lnk | ForEach-Object {
      $t = $shell.CreateShortcut($_.FullName).TargetPath
      if (-not $lnks.ContainsKey($_.BaseName)) { $lnks[$_.BaseName] = @{ lnk = $_.FullName; exe = $t } }
    }
  }
  $out = @()
  $seen = @{}
  foreach ($a in (Get-StartApps)) {
    $l = $lnks[$a.Name]
    $out += [pscustomobject]@{ name = $a.Name; appId = $a.AppID; lnk = $(if ($l) { $l.lnk } else { "" }); exe = $(if ($l) { $l.exe } else { "" }) }
    $seen[$a.Name] = $true
  }
  foreach ($k in $lnks.Keys) {
    if (-not $seen.ContainsKey($k)) { $out += [pscustomobject]@{ name = $k; appId = ""; lnk = $lnks[$k].lnk; exe = $lnks[$k].exe } }
  }
  $out | Sort-Object name | ConvertTo-Json -Compress
  exit 0
}
if ($Open) { Start-Process "explorer.exe" -ArgumentList "shell:AppsFolder\$Open"; "ok"; exit 0 }
if ($OpenLnk) { Start-Process -FilePath $OpenLnk; "ok"; exit 0 }
