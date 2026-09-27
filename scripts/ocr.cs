// Dayspring's picture helper: reads a picture on this computer with Windows' own tools. Nothing leaves the computer.
// Compiled by lib/vision/helper.mjs with the C# compiler that ships with Windows (.NET Framework 4, C# 5), started
// hidden, and fed one JSON object per line on stdin; it answers one JSON object per line on stdout (same "id").
//
//   {"id":1,"cmd":"ping"}                                   → {ok, ocr, faces, lang}
//   {"id":2,"cmd":"analyze","path":"…","want":["facts","colors","ocr","faces","pixels"],"max":1024}
//        facts:  width, height (as shown, after the EXIF turn), format, taken, make, model, lat, lon, orientation
//        colors: the main colours [{hex, share}]
//        ocr:    Windows.Media.Ocr (built into Windows 10/11): lines [{text, x, y, w, h}] in 0..1 of the picture
//        faces:  Windows.Media.FaceAnalysis.FaceDetector (built in): boxes [{x, y, w, h}] in 0..1 (no identity)
//        pixels: the picture as RGB bytes (base64), at most "max" pixels on the long side, for the face models
//   {"id":3,"cmd":"thumb","path":"…","box":[x,y,w,h],"size":96}   → {jpeg: base64}  (a square crop, 0..1 box)
//   {"id":4,"cmd":"protect","b64":"…"} / {"cmd":"unprotect","b64":"…"}   → {b64}  Windows DPAPI, this Windows user only
//   {"id":5,"cmd":"render","text":"…","out":"x.png","w":900,"h":300}       → a picture of text (for the tests)
//   {"id":7,"cmd":"encode","path":"…","max":1568}                         → {jpeg: base64, w, h}  (for the AI)
//   {"id":6,"cmd":"resize","path":"…","out":"y.jpg","max":480}              → a smaller copy (for the tests)
// Errors come back as {"id":…, "error":"…"}. It exits when stdin closes.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using Windows.Graphics.Imaging;
using Windows.Media.FaceAnalysis;
using Windows.Media.Ocr;

class VisionHelper {
  static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 64 * 1024 * 1024 };
  static readonly byte[] Entropy = Encoding.UTF8.GetBytes("dayspring-people-v1");
  static OcrEngine ocr;
  static FaceDetector faceDetector;

  static void Main() {
    Console.InputEncoding = new UTF8Encoding(false);
    var stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
    stdout.AutoFlush = true;
    string line;
    while ((line = Console.In.ReadLine()) != null) {
      if (line.Trim().Length == 0) continue;
      Dictionary<string, object> req = null, res = new Dictionary<string, object>();
      try {
        req = Json.Deserialize<Dictionary<string, object>>(line);
        res = Handle(req);
      } catch (Exception e) {
        var inner = e is AggregateException && e.InnerException != null ? e.InnerException : e;
        res = new Dictionary<string, object>();
        res["error"] = inner.Message;
      }
      if (req != null && req.ContainsKey("id")) res["id"] = req["id"];
      stdout.WriteLine(Json.Serialize(res));
    }
  }

  static string Str(Dictionary<string, object> r, string k) { object v; return r.TryGetValue(k, out v) && v != null ? Convert.ToString(v) : null; }
  static int Int(Dictionary<string, object> r, string k, int d) { object v; return r.TryGetValue(k, out v) && v != null ? Convert.ToInt32(v) : d; }

  static Dictionary<string, object> Handle(Dictionary<string, object> r) {
    var cmd = Str(r, "cmd");
    var o = new Dictionary<string, object>();
    if (cmd == "ping") {
      o["ok"] = true;
      o["ocr"] = Ocr() != null;
      o["lang"] = Ocr() != null ? Ocr().RecognizerLanguage.LanguageTag : null;
      bool fd = false; try { fd = FaceDetector.IsSupported; } catch { }
      o["faces"] = fd;
      return o;
    }
    if (cmd == "protect" || cmd == "unprotect") {
      var data = Convert.FromBase64String(Str(r, "b64") ?? "");
      var outb = cmd == "protect" ? ProtectedData.Protect(data, Entropy, DataProtectionScope.CurrentUser) : ProtectedData.Unprotect(data, Entropy, DataProtectionScope.CurrentUser);
      o["b64"] = Convert.ToBase64String(outb);
      return o;
    }
    if (cmd == "render") return Render(r);
    if (cmd == "resize") return Resize(r);
    if (cmd == "encode") return Encode(r);
    if (cmd == "analyze") return Analyze(r);
    if (cmd == "thumb") return Thumb(r);
    throw new Exception("unknown command " + cmd);
  }

  // Windows answers later (async); these wait for the answer without the .NET bridge (which needs the Windows SDK to build)
  static T Await<T>(Windows.Foundation.IAsyncOperation<T> op) {
    var done = new System.Threading.ManualResetEvent(false);
    op.Completed = delegate { done.Set(); };
    if (!done.WaitOne(60000)) throw new TimeoutException("Windows took too long.");
    if (op.Status == Windows.Foundation.AsyncStatus.Error) throw new Exception(op.ErrorCode != null ? op.ErrorCode.Message : "Windows couldn't do that.");
    if (op.Status != Windows.Foundation.AsyncStatus.Completed) throw new Exception("Windows stopped early.");
    return op.GetResults();
  }
  static T AwaitP<T, P>(Windows.Foundation.IAsyncOperationWithProgress<T, P> op) {
    var done = new System.Threading.ManualResetEvent(false);
    op.Completed = delegate { done.Set(); };
    if (!done.WaitOne(60000)) throw new TimeoutException("Windows took too long.");
    if (op.Status == Windows.Foundation.AsyncStatus.Error) throw new Exception(op.ErrorCode != null ? op.ErrorCode.Message : "Windows couldn't do that.");
    return op.GetResults();
  }

  static OcrEngine Ocr() {
    if (ocr == null) { try { ocr = OcrEngine.TryCreateFromUserProfileLanguages(); } catch { ocr = null; } }
    return ocr;
  }

  // ---- decoding: Windows' own decoders (JPEG, PNG, GIF, BMP, TIFF, HEIC/WebP when Windows has them), turned upright ----
  class Decoded { public byte[] Bgra; public int W, H, FullW, FullH; public BitmapDecoder Dec; public string Format; }
  static Decoded Decode(string path, int max) {
    var bytes = File.ReadAllBytes(path);
    var ras = new Windows.Storage.Streams.InMemoryRandomAccessStream();
    AwaitP(ras.WriteAsync(ToBuffer(bytes)));
    ras.Seek(0);
    var dec = Await(BitmapDecoder.CreateAsync(ras));
    int pw = (int)dec.PixelWidth, ph = (int)dec.PixelHeight;
    double scale = max > 0 ? Math.Min(1.0, (double)max / Math.Max(pw, ph)) : 1.0;
    var t = new BitmapTransform();
    int sw = Math.Max(1, (int)Math.Round(pw * scale)), sh = Math.Max(1, (int)Math.Round(ph * scale));
    t.ScaledWidth = (uint)sw; t.ScaledHeight = (uint)sh; t.InterpolationMode = BitmapInterpolationMode.Fant;
    var px = Await(dec.GetPixelDataAsync(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied, t, ExifOrientationMode.RespectExifOrientation, ColorManagementMode.DoNotColorManage));
    var data = px.DetachPixelData();
    bool turned = dec.OrientedPixelWidth != dec.PixelWidth;
    var d = new Decoded { Bgra = data, W = turned ? sh : sw, H = turned ? sw : sh, FullW = (int)dec.OrientedPixelWidth, FullH = (int)dec.OrientedPixelHeight, Dec = dec };
    if (d.W * d.H * 4 != data.Length) { d.W = sw; d.H = sh; }
    try { d.Format = dec.DecoderInformation.FriendlyName; } catch { d.Format = null; }
    return d;
  }
  static Windows.Storage.Streams.IBuffer ToBuffer(byte[] bytes) {
    var w = new Windows.Storage.Streams.DataWriter();
    w.WriteBytes(bytes);
    return w.DetachBuffer();
  }
  static SoftwareBitmap ToSoftware(Decoded d) {
    return SoftwareBitmap.CreateCopyFromBuffer(ToBuffer(d.Bgra), BitmapPixelFormat.Bgra8, d.W, d.H, BitmapAlphaMode.Premultiplied);
  }

  static Dictionary<string, object> Analyze(Dictionary<string, object> r) {
    var path = Str(r, "path");
    var want = new HashSet<string>();
    object wv; if (r.TryGetValue("want", out wv) && wv is System.Collections.ArrayList) foreach (var x in (System.Collections.ArrayList)wv) want.Add(Convert.ToString(x));
    int max = Int(r, "max", 1024);
    // text wants detail: read it from a larger copy (Windows OCR's own limit applies)
    int ocrMax = want.Contains("ocr") ? Math.Max(max, Math.Min(2600, (int)OcrEngine.MaxImageDimension)) : max;
    var d = Decode(path, ocrMax);
    var o = new Dictionary<string, object>();
    o["width"] = d.FullW; o["height"] = d.FullH;
    if (want.Contains("facts")) o["facts"] = Facts(d);
    if (want.Contains("ocr")) o["ocr"] = ReadText(d);
    // faces and pixels from the smaller copy
    Decoded small = d;
    if (Math.Max(d.W, d.H) > max) small = Shrink(d, max);
    if (want.Contains("colors")) o["colors"] = Colors(small);
    if (want.Contains("faces")) o["faces"] = Faces(small);
    if (want.Contains("pixels")) {
      var rgb = new byte[small.W * small.H * 3];
      for (int i = 0, j = 0; i < small.Bgra.Length; i += 4, j += 3) { rgb[j] = small.Bgra[i + 2]; rgb[j + 1] = small.Bgra[i + 1]; rgb[j + 2] = small.Bgra[i]; }
      o["pixels"] = new Dictionary<string, object> { { "w", small.W }, { "h", small.H }, { "rgb", Convert.ToBase64String(rgb) } };
    }
    return o;
  }

  static Decoded Shrink(Decoded d, int max) {
    double s = (double)max / Math.Max(d.W, d.H);
    int w = Math.Max(1, (int)Math.Round(d.W * s)), h = Math.Max(1, (int)Math.Round(d.H * s));
    using (var src = ToBitmap(d)) using (var dst = new Bitmap(w, h, System.Drawing.Imaging.PixelFormat.Format32bppPArgb)) {
      using (var g = Graphics.FromImage(dst)) { g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBilinear; g.DrawImage(src, 0, 0, w, h); }
      return new Decoded { Bgra = FromBitmap(dst), W = w, H = h, FullW = d.FullW, FullH = d.FullH, Dec = d.Dec, Format = d.Format };
    }
  }
  static Bitmap ToBitmap(Decoded d) {
    var b = new Bitmap(d.W, d.H, System.Drawing.Imaging.PixelFormat.Format32bppPArgb);
    var bd = b.LockBits(new Rectangle(0, 0, d.W, d.H), ImageLockMode.WriteOnly, b.PixelFormat);
    for (int y = 0; y < d.H; y++) Marshal.Copy(d.Bgra, y * d.W * 4, bd.Scan0 + y * bd.Stride, d.W * 4);
    b.UnlockBits(bd);
    return b;
  }
  static byte[] FromBitmap(Bitmap b) {
    var outb = new byte[b.Width * b.Height * 4];
    var bd = b.LockBits(new Rectangle(0, 0, b.Width, b.Height), ImageLockMode.ReadOnly, System.Drawing.Imaging.PixelFormat.Format32bppPArgb);
    for (int y = 0; y < b.Height; y++) Marshal.Copy(bd.Scan0 + y * bd.Stride, outb, y * b.Width * 4, b.Width * 4);
    b.UnlockBits(bd);
    return outb;
  }

  // ---- facts: when, which camera, where (coordinates only; turning them into a place happens elsewhere, offline) ----
  static Dictionary<string, object> Facts(Decoded d) {
    var f = new Dictionary<string, object>();
    f["format"] = d.Format;
    try {
      var keys = new List<string> { "System.Photo.DateTaken", "System.Photo.CameraManufacturer", "System.Photo.CameraModel", "System.GPS.Latitude", "System.GPS.LatitudeRef", "System.GPS.Longitude", "System.GPS.LongitudeRef", "System.Photo.Orientation" };
      var props = Await(d.Dec.BitmapProperties.GetPropertiesAsync(keys));
      foreach (var kv in props) {
        var v = kv.Value.Value;
        if (v == null) continue;
        switch (kv.Key) {
          case "System.Photo.DateTaken": if (v is DateTimeOffset) f["taken"] = ((DateTimeOffset)v).ToString("yyyy-MM-ddTHH:mm:ss"); break;
          case "System.Photo.CameraManufacturer": f["make"] = Convert.ToString(v).Trim(); break;
          case "System.Photo.CameraModel": f["model"] = Convert.ToString(v).Trim(); break;
          case "System.Photo.Orientation": f["orientation"] = Convert.ToInt32(v); break;
          case "System.GPS.Latitude": f["latDms"] = Dms(v); break;
          case "System.GPS.Longitude": f["lonDms"] = Dms(v); break;
          case "System.GPS.LatitudeRef": f["latRef"] = Convert.ToString(v); break;
          case "System.GPS.LongitudeRef": f["lonRef"] = Convert.ToString(v); break;
        }
      }
    } catch { /* no metadata this decoder can read (PNG, GIF…) */ }
    if (f.ContainsKey("latDms") && f.ContainsKey("lonDms")) {
      double lat = (double)f["latDms"], lon = (double)f["lonDms"];
      if (Convert.ToString(f.ContainsKey("latRef") ? f["latRef"] : "N").StartsWith("S")) lat = -lat;
      if (Convert.ToString(f.ContainsKey("lonRef") ? f["lonRef"] : "E").StartsWith("W")) lon = -lon;
      if (!(lat == 0 && lon == 0)) { f["lat"] = Math.Round(lat, 5); f["lon"] = Math.Round(lon, 5); }
    }
    f.Remove("latDms"); f.Remove("lonDms"); f.Remove("latRef"); f.Remove("lonRef");
    return f;
  }
  static double Dms(object v) {
    var a = v as double[];
    if (a != null && a.Length >= 3) return a[0] + a[1] / 60.0 + a[2] / 3600.0;
    return Convert.ToDouble(v);
  }

  // ---- the main colours: a coarse histogram of a small copy ----
  static List<object> Colors(Decoded d) {
    var counts = new Dictionary<int, long[]>();
    int step = Math.Max(1, (int)Math.Sqrt((double)d.W * d.H / 6000.0)), n = 0;
    for (int y = 0; y < d.H; y += step) for (int x = 0; x < d.W; x += step) {
      int i = (y * d.W + x) * 4;
      int b = d.Bgra[i], g = d.Bgra[i + 1], rr = d.Bgra[i + 2];
      int key = ((rr >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
      long[] c; if (!counts.TryGetValue(key, out c)) { c = new long[4]; counts[key] = c; }
      c[0]++; c[1] += rr; c[2] += g; c[3] += b; n++;
    }
    var list = new List<KeyValuePair<int, long[]>>(counts);
    list.Sort((a, b) => b.Value[0].CompareTo(a.Value[0]));
    var outl = new List<object>();
    for (int k = 0; k < list.Count && outl.Count < 5; k++) {
      var c = list[k].Value;
      double share = (double)c[0] / Math.Max(1, n);
      if (share < 0.04 && outl.Count > 0) break;
      outl.Add(new Dictionary<string, object> { { "hex", string.Format("#{0:x2}{1:x2}{2:x2}", c[1] / c[0], c[2] / c[0], c[3] / c[0]) }, { "share", Math.Round(share, 3) } });
    }
    return outl;
  }

  // ---- text ----
  static Dictionary<string, object> ReadText(Decoded d) {
    var o = new Dictionary<string, object>();
    var eng = Ocr();
    if (eng == null) { o["error"] = "no-ocr-language"; return o; }
    var sb = ToSoftware(d);
    var res = Await(eng.RecognizeAsync(sb));
    var lines = new List<object>();
    foreach (var l in res.Lines) {
      double x1 = double.MaxValue, y1 = double.MaxValue, x2 = 0, y2 = 0;
      foreach (var w in l.Words) { var b = w.BoundingRect; x1 = Math.Min(x1, b.X); y1 = Math.Min(y1, b.Y); x2 = Math.Max(x2, b.X + b.Width); y2 = Math.Max(y2, b.Y + b.Height); }
      lines.Add(new Dictionary<string, object> { { "text", l.Text }, { "x", Math.Round(x1 / d.W, 4) }, { "y", Math.Round(y1 / d.H, 4) }, { "w", Math.Round((x2 - x1) / d.W, 4) }, { "h", Math.Round((y2 - y1) / d.H, 4) } });
    }
    o["lang"] = eng.RecognizerLanguage.LanguageTag;
    o["lines"] = lines;
    return o;
  }

  // ---- faces (where they are, never who) ----
  static List<object> Faces(Decoded d) {
    var outl = new List<object>();
    bool ok = false; try { ok = FaceDetector.IsSupported; } catch { }
    if (!ok) return null;
    if (faceDetector == null) faceDetector = Await(FaceDetector.CreateAsync());
    var sb = SoftwareBitmap.Convert(ToSoftware(d), BitmapPixelFormat.Gray8);
    var faces = Await(faceDetector.DetectFacesAsync(sb));
    foreach (var f in faces) {
      var b = f.FaceBox;
      outl.Add(new Dictionary<string, object> { { "x", Math.Round((double)b.X / d.W, 4) }, { "y", Math.Round((double)b.Y / d.H, 4) }, { "w", Math.Round((double)b.Width / d.W, 4) }, { "h", Math.Round((double)b.Height / d.H, 4) } });
    }
    return outl;
  }

  // ---- a square face thumbnail (JPEG) ----
  static Dictionary<string, object> Thumb(Dictionary<string, object> r) {
    var d = Decode(Str(r, "path"), Int(r, "max", 1600));
    var box = (System.Collections.ArrayList)r["box"];
    double bx = Convert.ToDouble(box[0]) * d.W, by = Convert.ToDouble(box[1]) * d.H, bw = Convert.ToDouble(box[2]) * d.W, bh = Convert.ToDouble(box[3]) * d.H;
    double side = Math.Max(bw, bh) * 1.35, cx = bx + bw / 2, cy = by + bh / 2;
    int size = Int(r, "size", 96);
    using (var src = ToBitmap(d)) using (var dst = new Bitmap(size, size, System.Drawing.Imaging.PixelFormat.Format24bppRgb)) {
      using (var g = Graphics.FromImage(dst)) {
        g.Clear(Color.Black);
        g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
        g.DrawImage(src, new Rectangle(0, 0, size, size), new RectangleF((float)(cx - side / 2), (float)(cy - side / 2), (float)side, (float)side), GraphicsUnit.Pixel);
      }
      var o = new Dictionary<string, object>();
      o["jpeg"] = Convert.ToBase64String(Jpeg(dst, 82));
      return o;
    }
  }
  static byte[] Jpeg(Bitmap b, long quality) {
    ImageCodecInfo codec = null;
    foreach (var c in ImageCodecInfo.GetImageEncoders()) if (c.MimeType == "image/jpeg") codec = c;
    var ps = new EncoderParameters(1); ps.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, quality);
    using (var ms = new MemoryStream()) { b.Save(ms, codec, ps); return ms.ToArray(); }
  }

  // ---- for the tests: a picture of some text, and a smaller copy of a picture ----
  static Dictionary<string, object> Render(Dictionary<string, object> r) {
    int w = Int(r, "w", 900), h = Int(r, "h", 300);
    using (var b = new Bitmap(w, h)) {
      using (var g = Graphics.FromImage(b)) {
        g.Clear(Color.White);
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
        using (var font = new Font("Segoe UI", Int(r, "size", 40), FontStyle.Regular, GraphicsUnit.Pixel)) g.DrawString(Str(r, "text") ?? "", font, Brushes.Black, new RectangleF(20, 20, w - 40, h - 40));
      }
      b.Save(Str(r, "out"), System.Drawing.Imaging.ImageFormat.Png);
    }
    return new Dictionary<string, object> { { "ok", true } };
  }
  // a JPEG copy for the AI (at most "max" pixels on the long side)
  static Dictionary<string, object> Encode(Dictionary<string, object> r) {
    var d = Decode(Str(r, "path"), Int(r, "max", 1568));
    using (var b = ToBitmap(d)) using (var flat = new Bitmap(d.W, d.H, System.Drawing.Imaging.PixelFormat.Format24bppRgb)) {
      using (var g = Graphics.FromImage(flat)) { g.Clear(Color.White); g.DrawImage(b, 0, 0, d.W, d.H); }
      return new Dictionary<string, object> { { "jpeg", Convert.ToBase64String(Jpeg(flat, Int(r, "quality", 85))) }, { "w", d.W }, { "h", d.H } };
    }
  }
  static Dictionary<string, object> Resize(Dictionary<string, object> r) {
    var d = Decode(Str(r, "path"), Int(r, "max", 480));
    using (var b = ToBitmap(d)) using (var flat = new Bitmap(d.W, d.H, System.Drawing.Imaging.PixelFormat.Format24bppRgb)) {
      using (var g = Graphics.FromImage(flat)) g.DrawImage(b, 0, 0, d.W, d.H);
      File.WriteAllBytes(Str(r, "out"), Jpeg(flat, Int(r, "quality", 85)));
    }
    return new Dictionary<string, object> { { "ok", true }, { "w", d.W }, { "h", d.H } };
  }
}
