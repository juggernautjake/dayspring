# Which screen the Dayspring display opens on. Prints "X Y W H P" (P = 1 for the main screen) or nothing.
#   -Want auto | primary | secondary | <number>   (default: $env:DS_SCREEN, then data/owner.json "display", else auto)
#   auto      = the biggest second screen if there is one, else the main screen
#   secondary = only a second screen (prints nothing when there isn't one)
#   <number>  = screens counted left to right, starting at 1
param([string]$Want = "")
Add-Type -AssemblyName System.Windows.Forms
if (-not $Want) { $Want = [string]$env:DS_SCREEN }
if (-not $Want) {
  $owner = Join-Path $PSScriptRoot "..\data\owner.json"
  if (Test-Path $owner) { try { $Want = [string]((Get-Content $owner -Raw | ConvertFrom-Json).display) } catch { } }
}
if (-not $Want) { $Want = "auto" }
$all = [System.Windows.Forms.Screen]::AllScreens | Sort-Object { $_.Bounds.X }, { $_.Bounds.Y }
$others = $all | Where-Object { -not $_.Primary } | Sort-Object { $_.Bounds.Width * $_.Bounds.Height } -Descending
$main = $all | Where-Object { $_.Primary } | Select-Object -First 1
$s = $null
switch -Regex ($Want.Trim().ToLower()) {
  '^\d+$'      { $i = [int]$Want - 1; if ($i -ge 0 -and $i -lt @($all).Count) { $s = @($all)[$i] } }
  '^primary$'  { $s = $main }
  '^secondary$' { $s = $others | Select-Object -First 1 }
  default      { $s = $others | Select-Object -First 1; if (-not $s) { $s = $main } }
}
if ($s) { '{0} {1} {2} {3} {4}' -f $s.Bounds.X, $s.Bounds.Y, $s.Bounds.Width, $s.Bounds.Height, [int]$s.Primary }
