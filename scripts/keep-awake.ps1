# Keeps this PC awake (no sleep, screen stays on, so no idle lock screen) while it's plugged in and Dayspring is running.
# It uses Windows' own "an app needs the system awake" request (SetThreadExecutionState), the way video players do:
# no power settings are changed, and the request ends by itself the moment this script (or Dayspring) exits.
#   -ParentPid  Dayspring's process: when it's gone, this script ends too.
param([int]$ParentPid = 0, [switch]$AlsoOnBattery)
Add-Type -Namespace DS -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);'
Add-Type -AssemblyName System.Windows.Forms
$CONTINUOUS = [uint32]"0x80000000"; $SYSTEM = [uint32]"0x00000001"; $DISPLAY = [uint32]"0x00000002"
$held = $null
while ($true) {
  if ($ParentPid -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { break }
  $plugged = [System.Windows.Forms.SystemInformation]::PowerStatus.PowerLineStatus -eq "Online"
  $want = $plugged -or $AlsoOnBattery
  if ($want -ne $held) {
    if ($want) { [void][DS.Power]::SetThreadExecutionState($CONTINUOUS -bor $SYSTEM -bor $DISPLAY) }
    else { [void][DS.Power]::SetThreadExecutionState($CONTINUOUS) }
    $held = $want
    Write-Output ("awake=" + $want)
  }
  Start-Sleep -Seconds 30
}
[void][DS.Power]::SetThreadExecutionState($CONTINUOUS)
