// loopcap: hears whatever a playback device is playing (WASAPI loopback, shared mode: it never takes the device over,
// so Discord and everything else keep working) and writes it to stdout as 16 kHz mono 16-bit PCM for Dayspring's
// "Tune in". Built on first use by lib/loopback.mjs with the C# compiler that ships with Windows (.NET Framework 4).
//   loopcap.exe -list                  → JSON list of playback devices
//   loopcap.exe [-device <id|name part>] → PCM on stdout until stdin closes or the device goes away (exit code 2)
// Written for the C# 5 compiler (no string interpolation).
using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Diagnostics;
using System.Runtime.InteropServices;

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
  int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
  int RegisterEndpointNotificationCallback(IntPtr client);
  int UnregisterEndpointNotificationCallback(IntPtr client);
}
[ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceCollection {
  int GetCount(out int count);
  int Item(int index, out IMMDevice device);
}
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object obj);
  int OpenPropertyStore(int access, out IPropertyStore store);
  int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
  int GetState(out int state);
}
[ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPropertyStore {
  int GetCount(out int count);
  int GetAt(int index, out PropertyKey key);
  int GetValue(ref PropertyKey key, out PropVariant value);
  int SetValue(ref PropertyKey key, ref PropVariant value);
  int Commit();
}
[StructLayout(LayoutKind.Sequential)] struct PropertyKey { public Guid fmtid; public int pid; }
[StructLayout(LayoutKind.Explicit, Size = 24)] struct PropVariant { [FieldOffset(0)] public short vt; [FieldOffset(8)] public IntPtr ptr; }
[ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioClient {
  int Initialize(int shareMode, int streamFlags, long bufferDuration, long periodicity, IntPtr format, ref Guid sessionGuid);
  int GetBufferSize(out uint frames);
  int GetStreamLatency(out long latency);
  int GetCurrentPadding(out uint padding);
  int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
  int GetMixFormat(out IntPtr format);
  int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
  int Start();
  int Stop();
  int Reset();
  int SetEventHandle(IntPtr handle);
  int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object obj);
}
[ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioCaptureClient {
  int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devicePosition, out ulong qpcPosition);
  int ReleaseBuffer(uint frames);
  int GetNextPacketSize(out uint frames);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom { }

static class Program {
  const int eRender = 0, eConsole = 0, ACTIVE = 1, CLSCTX_ALL = 23, SHARED = 0, LOOPBACK = 0x00020000, SILENT = 0x2;
  static PropertyKey FriendlyName = new PropertyKey { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };
  static Guid FLOAT = new Guid("00000003-0000-0010-8000-00aa00389b71");

  static string Name(IMMDevice d) {
    IPropertyStore ps; if (d.OpenPropertyStore(0, out ps) != 0) return "";
    PropVariant v; var k = FriendlyName;
    if (ps.GetValue(ref k, out v) != 0 || v.ptr == IntPtr.Zero) return "";
    return Marshal.PtrToStringUni(v.ptr);
  }
  static string Id(IMMDevice d) { string id; d.GetId(out id); return id; }
  static string Json(string s) { return "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\""; }

  static int Main(string[] args) {
    try {
      var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
      IMMDevice def; en.GetDefaultAudioEndpoint(eRender, eConsole, out def);
      string defId = def != null ? Id(def) : "";
      IMMDeviceCollection all; en.EnumAudioEndpoints(eRender, ACTIVE, out all);
      int n; all.GetCount(out n);
      if (args.Length > 0 && args[0] == "-list") {
        var sb = new StringBuilder("[");
        for (int i = 0; i < n; i++) {
          IMMDevice d; all.Item(i, out d); string id = Id(d);
          if (i > 0) sb.Append(",");
          sb.Append("{\"id\":" + Json(id) + ",\"name\":" + Json(Name(d)) + ",\"default\":" + (id == defId ? "true" : "false") + "}");
        }
        Console.Out.Write(sb.Append("]").ToString());
        return 0;
      }
      IMMDevice dev = def;
      int di = Array.IndexOf(args, "-device");
      if (di >= 0 && di + 1 < args.Length) {
        string want = args[di + 1].ToLowerInvariant(); dev = null;
        for (int i = 0; i < n && dev == null; i++) { IMMDevice d; all.Item(i, out d); if (Id(d).ToLowerInvariant() == want || Name(d).ToLowerInvariant().Contains(want)) dev = d; }
        if (dev == null) { Console.Error.WriteLine("no playback device matches " + args[di + 1]); return 3; }
      }
      if (dev == null) { Console.Error.WriteLine("no playback device"); return 3; }
      Console.Error.WriteLine("device: " + Name(dev));

      Guid iidClient = typeof(IAudioClient).GUID; object o;
      Marshal.ThrowExceptionForHR(dev.Activate(ref iidClient, CLSCTX_ALL, IntPtr.Zero, out o));
      var client = (IAudioClient)o;
      IntPtr fmt; Marshal.ThrowExceptionForHR(client.GetMixFormat(out fmt));
      int tag = Marshal.ReadInt16(fmt, 0), ch = Marshal.ReadInt16(fmt, 2), rate = Marshal.ReadInt32(fmt, 4), bits = Marshal.ReadInt16(fmt, 14), align = Marshal.ReadInt16(fmt, 12);
      bool isFloat = tag == 3 || (tag == unchecked((short)0xFFFE) && (Guid)Marshal.PtrToStructure(new IntPtr(fmt.ToInt64() + 24), typeof(Guid)) == FLOAT);
      Console.Error.WriteLine("format: " + rate + " Hz, " + ch + " ch, " + bits + " bit" + (isFloat ? " float" : ""));
      Guid session = Guid.Empty;
      Marshal.ThrowExceptionForHR(client.Initialize(SHARED, LOOPBACK, 2000000, 0, fmt, ref session));
      Guid iidCap = typeof(IAudioCaptureClient).GUID;
      Marshal.ThrowExceptionForHR(client.GetService(ref iidCap, out o));
      var cap = (IAudioCaptureClient)o;
      Marshal.ThrowExceptionForHR(client.Start());

      var stdout = Console.OpenStandardOutput();
      // stop when Dayspring closes our stdin
      new Thread(() => { try { Console.OpenStandardInput().ReadByte(); } catch { } Environment.Exit(0); }) { IsBackground = true }.Start();

      double step = rate / 16000.0, pos = 0;   // resampler: average the source frames that fall in each 16 kHz sample
      double acc = 0; int accN = 0;
      long written = 0; var clock = Stopwatch.StartNew();
      var outBuf = new MemoryStream();
      byte[] raw = new byte[0];
      while (true) {
        Thread.Sleep(20);
        uint packet;
        if (cap.GetNextPacketSize(out packet) != 0) { Console.Error.WriteLine("device went away"); return 2; }
        while (packet > 0) {
          IntPtr data; uint frames, flags; ulong p1, p2;
          if (cap.GetBuffer(out data, out frames, out flags, out p1, out p2) != 0) return 2;
          int bytes = (int)frames * align;
          if (raw.Length < bytes) raw = new byte[bytes];
          bool silent = (flags & SILENT) != 0;
          if (!silent) Marshal.Copy(data, raw, 0, bytes);
          for (int f = 0; f < frames; f++) {
            double s = 0;
            if (!silent) for (int c = 0; c < ch; c++) {
              int off = f * align + c * (bits / 8);
              s += isFloat ? BitConverter.ToSingle(raw, off) : bits == 16 ? BitConverter.ToInt16(raw, off) / 32768.0 : BitConverter.ToInt32(raw, off) / 2147483648.0;
            }
            acc += s / ch; accN++; pos += 1;
            if (pos >= step) {
              pos -= step;
              double v = acc / accN; acc = 0; accN = 0;
              short sv = (short)Math.Max(-32768, Math.Min(32767, v * 32767));
              outBuf.WriteByte((byte)(sv & 0xFF)); outBuf.WriteByte((byte)((sv >> 8) & 0xFF)); written++;
            }
          }
          cap.ReleaseBuffer(frames);
          if (cap.GetNextPacketSize(out packet) != 0) return 2;
        }
        // nothing playing: loopback sends no packets, so keep time with silence (the listener needs real gaps)
        long due = (long)(clock.Elapsed.TotalSeconds * 16000) - 1600;
        while (written < due) { outBuf.WriteByte(0); outBuf.WriteByte(0); written++; }
        if (outBuf.Length > 0) { outBuf.WriteTo(stdout); stdout.Flush(); outBuf.SetLength(0); }
      }
    } catch (Exception e) { Console.Error.WriteLine("error: " + e.Message); return 1; }
  }
}
