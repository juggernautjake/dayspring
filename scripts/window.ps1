# Minimize / maximize / restore / hide / show / close Dayspring's own display window, or report its state.
# It only ever touches a browser window (Chromium-family or Firefox) titled "Dayspring" (or "Nova · Dayspring" once the
# assistant is renamed, "Welcome to Dayspring", or "Dayspring - Mozilla Firefox") AND whose browser was started with a Dayspring display profile (...\DayspringDisplay,
# ...\DayspringTV, a per-browser one like ...\DayspringDisplay-brave, or DS_PROFILE); never the owner's own browser
# windows, the media window or the study window. Prints JSON: { found, action, windows: [...] }.
# topmost / notopmost: keep it in front of other windows ("Dayspring mini" → Keep on top), never taking the focus.
# move: restore the window and put it at -X -Y with size -W x -H (compact mode), in front of other windows, never behind.
# A renamed assistant's screen is titled "<name> · Dayspring" ("Nova · Dayspring"): the product name stays at the end as a
# stable marker, so the window is still found (· and — are written as escapes: this file is read as ANSI).
param([ValidateSet("state", "minimize", "maximize", "restore", "hide", "show", "close", "topmost", "notopmost", "move")][string]$Action = "state", [string]$Title = '^(Welcome to )?([^·]{1,40} · )?Dayspring( [-—] .*)?$', [Alias("X")][int]$Left = 0, [Alias("Y")][int]$Top = 0, [Alias("W")][int]$Width = 380, [Alias("H")][int]$Height = 560)   # not $W/$H: PowerShell names ignore case, and $w/$h are used below
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class DsWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hgt, bool repaint);
  public static List<long[]> Find(string title) {
    var r = new List<long[]>();
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      var sb = new StringBuilder(512); GetWindowText(h, sb, 512);
      if (System.Text.RegularExpressions.Regex.IsMatch(sb.ToString(), title)) {
        var c = new StringBuilder(256); GetClassName(h, c, 256);
        if (c.ToString() == "Chrome_WidgetWin_1" || c.ToString() == "MozillaWindowClass") { uint pid; GetWindowThreadProcessId(h, out pid); r.Add(new long[] { h.ToInt64(), pid }); }
      }
      return true;
    }, IntPtr.Zero);
    return r;
  }
}
"@
$profileRx = '(user-data-dir=|-profile\s+)"?[^"]*\\' + $(if ($env:DS_PROFILE) { [regex]::Escape($env:DS_PROFILE) } else { 'Dayspring(Display|TV)' }) + '(-[a-z]+)?"?(\s|$)'
$mine = @()
foreach ($w in [DsWin]::Find($Title)) {
  $cl = (Get-CimInstance Win32_Process -Filter "ProcessId=$($w[1])" -ErrorAction SilentlyContinue).CommandLine
  if ($cl -and $cl -match $profileRx) { $mine += ,$w }
}
$code = @{ minimize = 6; maximize = 3; restore = 9; hide = 0; show = 5 }
foreach ($w in $mine) {
  $h = [IntPtr]::new($w[0])
  switch ($Action) {
    "close" { [void][DsWin]::PostMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) }
    "show" { [void][DsWin]::ShowWindow($h, 5); if ([DsWin]::IsIconic($h)) { [void][DsWin]::ShowWindow($h, 9) }; [void][DsWin]::SetForegroundWindow($h) }
    "state" { }
    "move" { [void][DsWin]::ShowWindow($h, 9); Start-Sleep -Milliseconds 120; [void][DsWin]::MoveWindow($h, $Left, $Top, $Width, $Height, $true); [void][DsWin]::SetForegroundWindow($h) }
    "topmost" { [void][DsWin]::SetWindowPos($h, [IntPtr]::new(-1), 0, 0, 0, 0, 0x13) }
    "notopmost" { [void][DsWin]::SetWindowPos($h, [IntPtr]::new(-2), 0, 0, 0, 0, 0x13) }
    default { [void][DsWin]::ShowWindow($h, $code[$Action]); if ($Action -in @("maximize", "restore")) { [void][DsWin]::SetForegroundWindow($h) } }
  }
}
Start-Sleep -Milliseconds 150
$out = @{ found = $mine.Count; action = $Action; windows = @($mine | ForEach-Object { $h = [IntPtr]::new($_[0]); @{ visible = [DsWin]::IsWindowVisible($h); minimized = [DsWin]::IsIconic($h); maximized = [DsWin]::IsZoomed($h) } }) }
$out | ConvertTo-Json -Compress -Depth 4
