# Per-app speaker and microphone, the same setting as Windows Settings > Sound > Volume mixer > (an app) > Output/Input.
# It only affects that one app; Windows remembers it for the app from then on.
#   app-audio.ps1 -Get  -Pid 1234                  -> JSON { output, input } (device ids, or empty for "Default")
#   app-audio.ps1 -Set  -Pid 1234 -Output <id> -Input <id>   (either may be omitted; "default" clears it)
param([switch]$Get, [switch]$Set, [int]$ProcessId, [string]$Output, [string]$InputDev)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace DsAppAudio {
  // Windows.Media.Internal.AudioPolicyConfig (what the Volume mixer uses). Method order matters; unused ones are placeholders.
  [ComImport, Guid("ab3d4648-e242-459f-b02f-541c70306324"), InterfaceType(ComInterfaceType.InterfaceIsIInspectable)]
  interface IAudioPolicyConfigFactory {
    [PreserveSig] int __1(); [PreserveSig] int __2(); [PreserveSig] int __3(); [PreserveSig] int __4(); [PreserveSig] int __5(); [PreserveSig] int __6(); [PreserveSig] int __7();
    [PreserveSig] int __8(); [PreserveSig] int __9(); [PreserveSig] int __10(); [PreserveSig] int __11(); [PreserveSig] int __12(); [PreserveSig] int __13(); [PreserveSig] int __14();
    [PreserveSig] int __15(); [PreserveSig] int __16(); [PreserveSig] int __17(); [PreserveSig] int __18(); [PreserveSig] int __19();
    [PreserveSig] int SetPersistedDefaultAudioEndpoint(uint processId, int flow, int role, IntPtr deviceId);
    [PreserveSig] int GetPersistedDefaultAudioEndpoint(uint processId, int flow, int role, out IntPtr deviceId);
    [PreserveSig] int ClearAllPersistedApplicationDefaultEndpoints();
  }
  public static class Api {
    [DllImport("combase.dll")] static extern int WindowsCreateString([MarshalAs(UnmanagedType.LPWStr)] string s, int len, out IntPtr h);
    [DllImport("combase.dll")] static extern int WindowsDeleteString(IntPtr h);
    [DllImport("combase.dll")] static extern IntPtr WindowsGetStringRawBuffer(IntPtr h, out uint len);
    [DllImport("combase.dll")] static extern int RoGetActivationFactory(IntPtr cls, ref Guid iid, [MarshalAs(UnmanagedType.IInspectable)] out object factory);
    const string RENDER = "{e6327cad-dcec-4949-ae8a-991e976a79d2}", CAPTURE = "{2eef81be-33fa-4800-9670-1cd474972c3f}";
    static IAudioPolicyConfigFactory Factory() {
      IntPtr h; WindowsCreateString("Windows.Media.Internal.AudioPolicyConfig", 40, out h);
      Guid iid = typeof(IAudioPolicyConfigFactory).GUID; object f;
      Marshal.ThrowExceptionForHR(RoGetActivationFactory(h, ref iid, out f));
      WindowsDeleteString(h);
      return (IAudioPolicyConfigFactory)f;
    }
    // the endpoint id ({0.0.0.00000000}.{…}) wrapped the way this API wants it
    static string Wrap(string id, int flow) { return @"\\?\SWD#MMDEVAPI#" + id + "#" + (flow == 0 ? RENDER : CAPTURE); }
    public static void SetFor(uint pid, int flow, string id) {
      var f = Factory(); IntPtr h = IntPtr.Zero;
      if (!string.IsNullOrEmpty(id) && id != "default") { string w = Wrap(id, flow); WindowsCreateString(w, w.Length, out h); }
      Marshal.ThrowExceptionForHR(f.SetPersistedDefaultAudioEndpoint(pid, flow, 0, h));   // console
      Marshal.ThrowExceptionForHR(f.SetPersistedDefaultAudioEndpoint(pid, flow, 1, h));   // multimedia
      if (h != IntPtr.Zero) WindowsDeleteString(h);
    }
    public static string GetFor(uint pid, int flow) {
      var f = Factory(); IntPtr h;
      if (f.GetPersistedDefaultAudioEndpoint(pid, flow, 0, out h) != 0 || h == IntPtr.Zero) return "";
      uint len; string s = Marshal.PtrToStringUni(WindowsGetStringRawBuffer(h, out len), (int)len); WindowsDeleteString(h);
      int a = s.IndexOf("{0."), b = s.LastIndexOf("#");
      return a >= 0 && b > a ? s.Substring(a, b - a) : s;
    }
  }
}
"@

if ($Set) {
  if ($Output) { [DsAppAudio.Api]::SetFor([uint32]$ProcessId, 0, $Output) }
  if ($InputDev) { [DsAppAudio.Api]::SetFor([uint32]$ProcessId, 1, $InputDev) }
  "ok"; exit 0
}
ConvertTo-Json -Compress -InputObject ([pscustomobject]@{ output = [DsAppAudio.Api]::GetFor([uint32]$ProcessId, 0); input = [DsAppAudio.Api]::GetFor([uint32]$ProcessId, 1) })
