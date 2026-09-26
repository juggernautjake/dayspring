// "Dayspring Keep Awake.exe": keeps this PC awake (no sleep, screen on, so no idle lock screen) while it's plugged in and
// Dayspring is running. The same request video players make (SetThreadExecutionState); no power settings change, and it
// ends the moment this program (or Dayspring) exits. Replaces scripts\keep-awake.ps1 so no anonymous powershell.exe lingers.
//   "Dayspring Keep Awake.exe" --parent <pid> [--battery]      prints awake=true|false when that changes
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

static class KeepAwake {
  [DllImport("kernel32.dll")] static extern uint SetThreadExecutionState(uint flags);
  const uint CONTINUOUS = 0x80000000, SYSTEM = 0x1, DISPLAY = 0x2;
  static int Main(string[] args) {
    int parent = 0; bool battery = false;
    for (int i = 0; i < args.Length; i++) { if (args[i] == "--parent" && i + 1 < args.Length) int.TryParse(args[++i], out parent); else if (args[i] == "--battery") battery = true; }
    var stdout = new System.IO.StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true };
    bool? held = null;
    while (true) {
      if (parent > 0) { try { if (Process.GetProcessById(parent).HasExited) break; } catch { break; } }
      bool plugged = SystemInformation.PowerStatus.PowerLineStatus == PowerLineStatus.Online;
      bool want = plugged || battery;
      if (held != want) {
        SetThreadExecutionState(want ? (CONTINUOUS | SYSTEM | DISPLAY) : CONTINUOUS);
        held = want;
        try { stdout.WriteLine("awake=" + (want ? "True" : "False")); } catch { }
      }
      Thread.Sleep(30000);
    }
    SetThreadExecutionState(CONTINUOUS);
    return 0;
  }
}
