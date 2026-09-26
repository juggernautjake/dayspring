# Lists playback devices, or makes one the Windows default output. No extra software needed.
#   audio-default.ps1 -List           -> JSON: [{ id, name, default }]
#   audio-default.ps1 -Set <deviceId> -> makes it the default for apps and media
#   add -Capture to work with microphones instead of speakers
param([switch]$List, [string]$Set, [switch]$Capture, [switch]$KeepComms)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;

namespace DsAudio {
  [StructLayout(LayoutKind.Sequential)] public struct PropKey { public Guid fmtid; public int pid; }
  [StructLayout(LayoutKind.Explicit)] public struct PropVariant { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr p; [FieldOffset(16)] public IntPtr p2; }

  [Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore { int GetCount(out int c); int GetAt(int i, out PropKey k); int GetValue(ref PropKey k, out PropVariant v); }

  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
    int OpenPropertyStore(int access, out IPropertyStore store);
    int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    int GetState(out int state);
  }
  [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceCollection { int GetCount(out int c); int Item(int i, out IMMDevice d); }

  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int flow, int mask, out IMMDeviceCollection c);
    int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice d);
  }
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator {}

  [Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPolicyConfig {
    int GetMixFormat(); int GetDeviceFormat(); int ResetDeviceFormat(); int SetDeviceFormat();
    int GetProcessingPeriod(); int SetProcessingPeriod(); int GetShareMode(); int SetShareMode();
    int GetPropertyValue(); int SetPropertyValue();
    int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
  }
  [ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")] class PolicyConfigClient {}

  public class Dev { public string id; public string name; public bool isDefault; public int formFactor; public string device; }

  public static class Api {
    public static List<Dev> List(int flow) {
      var en = (IMMDeviceEnumerator)new MMDeviceEnumerator();
      string defId = null;
      IMMDevice def;
      if (en.GetDefaultAudioEndpoint(flow, 1, out def) == 0) def.GetId(out defId);
      IMMDeviceCollection col;
      en.EnumAudioEndpoints(flow, 1, out col);   // active devices: 0 = speakers, 1 = microphones
      int n; col.GetCount(out n);
      var list = new List<Dev>();
      var key = new PropKey { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };
      for (int i = 0; i < n; i++) {
        IMMDevice d; col.Item(i, out d);
        string id; d.GetId(out id);
        IPropertyStore ps; d.OpenPropertyStore(0, out ps);
        PropVariant v; ps.GetValue(ref key, out v);
        // form factor: 1 speakers, 3 headphones, 4 microphone, 5 headset, 9 HDMI/DisplayPort display (a TV or monitor), 10 unknown
        var ffKey = new PropKey { fmtid = new Guid("1da5d803-d492-4edd-8c23-e0c0ffee7f0e"), pid = 0 };
        PropVariant ff; int formFactor = 10;
        if (ps.GetValue(ref ffKey, out ff) == 0 && ff.vt == 19) formFactor = (int)(ff.p.ToInt64() & 0xFFFFFFFF);
        // the physical device ("Gaming Headset", "Intel Smart Sound…"): links a headset's speaker and mic
        var ifKey = new PropKey { fmtid = new Guid("026e516e-b814-414b-83cd-856d6fef4822"), pid = 2 };
        PropVariant iv; string device = "";
        if (ps.GetValue(ref ifKey, out iv) == 0 && iv.vt == 31 && iv.p != IntPtr.Zero) device = Marshal.PtrToStringUni(iv.p);
        list.Add(new Dev { id = id, name = v.p == IntPtr.Zero ? "" : Marshal.PtrToStringUni(v.p), isDefault = id == defId, formFactor = formFactor, device = device });
      }
      return list;
    }
    public static void SetDefault(string id, bool comms) {
      var pc = (IPolicyConfig)new PolicyConfigClient();
      Marshal.ThrowExceptionForHR(pc.SetDefaultEndpoint(id, 0));   // console
      Marshal.ThrowExceptionForHR(pc.SetDefaultEndpoint(id, 1));   // multimedia
      if (comms) Marshal.ThrowExceptionForHR(pc.SetDefaultEndpoint(id, 2));   // communications (Discord, Teams…)
    }
  }
}
"@

if ($Set) { [DsAudio.Api]::SetDefault($Set, -not $KeepComms); "ok"; exit 0 }
$devs = [DsAudio.Api]::List($(if ($Capture) { 1 } else { 0 })) | ForEach-Object { [pscustomobject]@{ id = $_.id; name = $_.name; default = $_.isDefault; formFactor = $_.formFactor; device = $_.device } }
ConvertTo-Json -InputObject @($devs) -Compress
