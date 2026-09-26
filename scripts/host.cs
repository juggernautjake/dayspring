// bin\Dayspring.exe: what Task Manager shows as "Dayspring". It starts Dayspring's server ("Dayspring Server.exe", a copy of
// this computer's node.exe) with the same arguments, working folder and output, keeps it in a Windows job so the server
// never outlives it, and ends with the server's exit code. Windows' resource API can't re-label node.exe itself, so
// Dayspring's name, version and icon live on this small program instead (built on this computer by lib/native.mjs;
// __VERSION__ is filled in from package.json).
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;

[assembly: AssemblyTitle("Dayspring")]
[assembly: AssemblyDescription("Dayspring")]
[assembly: AssemblyProduct("Dayspring")]
[assembly: AssemblyCompany("Dayspring")]
[assembly: AssemblyCopyright("Dayspring (its server runs on Node.js)")]
[assembly: AssemblyVersion("__VERSION__.0")]
[assembly: AssemblyFileVersion("__VERSION__.0")]

static class Host {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr a, string name);
  [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job, int cls, IntPtr info, uint len);
  [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr proc);
  [StructLayout(LayoutKind.Sequential)] struct BASIC { public long a, b; public uint LimitFlags; public UIntPtr c, d; public uint e; public UIntPtr f; public uint g, h; }
  [StructLayout(LayoutKind.Sequential)] struct IO { public ulong a, b, c, d, e, f; }
  [StructLayout(LayoutKind.Sequential)] struct EXT { public BASIC Basic; public IO Io; public UIntPtr p, j, pp, jp; }

  static string Quote(string a) {
    if (a.Length > 0 && a.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return a;
    var sb = new StringBuilder("\"");
    int bs = 0;
    foreach (var ch in a) {
      if (ch == '\\') { bs++; continue; }
      if (ch == '"') { sb.Append('\\', bs * 2 + 1); sb.Append('"'); bs = 0; continue; }
      sb.Append('\\', bs); bs = 0; sb.Append(ch);
    }
    sb.Append('\\', bs * 2); sb.Append('"');
    return sb.ToString();
  }

  static int Main(string[] args) {
    var here = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
    var server = Path.Combine(here, "Dayspring Server.exe");
    if (!File.Exists(server)) { Console.Error.WriteLine("Dayspring Server.exe is missing next to Dayspring.exe."); return 3; }
    var parts = new string[args.Length]; for (int i = 0; i < args.Length; i++) parts[i] = Quote(args[i]);
    var psi = new ProcessStartInfo(server, string.Join(" ", parts)) { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = Environment.CurrentDirectory, RedirectStandardOutput = true, RedirectStandardError = true };
    var p = Process.Start(psi);
    // the server's output goes wherever this program's goes (Dayspring's log file)
    var t1 = Pump(p.StandardOutput.BaseStream, Console.OpenStandardOutput());
    var t2 = Pump(p.StandardError.BaseStream, Console.OpenStandardError());
    // the server ends with this program (a kill of Dayspring.exe ends both)
    try {
      var job = CreateJobObject(IntPtr.Zero, null);
      var info = new EXT(); info.Basic.LimitFlags = 0x2000 | 0x1000;   // KILL_ON_JOB_CLOSE; SILENT_BREAKAWAY_OK so what the server starts isn't tied to it
      int len = Marshal.SizeOf(typeof(EXT)); var ptr = Marshal.AllocHGlobal(len);
      Marshal.StructureToPtr(info, ptr, false);
      SetInformationJobObject(job, 9, ptr, (uint)len);
      AssignProcessToJobObject(job, p.Handle);
    } catch { }
    p.WaitForExit();
    t1.Join(2000); t2.Join(2000);
    return p.ExitCode;
  }

  static System.Threading.Thread Pump(Stream from, Stream to) {
    var t = new System.Threading.Thread(() => {
      var buf = new byte[8192]; int n;
      try { while ((n = from.Read(buf, 0, buf.Length)) > 0) { try { to.Write(buf, 0, n); to.Flush(); } catch { } } } catch { }
    });
    t.IsBackground = true; t.Start(); return t;
  }
}
