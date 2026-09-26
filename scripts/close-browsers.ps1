# Closes Dayspring's own browsers (the Dayspring screen and the media browser) the polite way, like clicking the X, so the
# browser saves cookies (sign-ins to YouTube and Spotify stay). Never touches the owner's regular Chrome or Edge.
# Profiles: DayspringDisplay (the screen), DayspringTV (its older name), DayspringMedia (music and video, with -MediaToo).
param([switch]$MediaToo)
$profiles = @("DayspringDisplay", "DayspringTV"); if ($MediaToo) { $profiles += "DayspringMedia" }
$filter = "Name='chrome.exe' OR Name='msedge.exe'"
foreach ($p in $profiles) {
  $procs = Get-CimInstance Win32_Process -Filter $filter | Where-Object { $_.CommandLine -match [regex]::Escape($p) }
  $ids = @($procs | ForEach-Object { $_.ProcessId })
  # the main browser process is the one whose parent isn't another of its own processes
  $roots = $procs | Where-Object { $ids -notcontains $_.ParentProcessId }
  foreach ($r in $roots) { & taskkill /pid $r.ProcessId | Out-Null }
}
Start-Sleep -Seconds 4
# anything still hanging on after a polite close
foreach ($p in $profiles) { Get-CimInstance Win32_Process -Filter $filter | Where-Object { $_.CommandLine -match [regex]::Escape($p) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }
