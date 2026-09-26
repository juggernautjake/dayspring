// Dayspring's desktop notifications: small cards at the top-right of the screen, in front of every window (full-screen
// apps too), that never take the focus and have no taskbar button. Compiled by lib/overlay.mjs with the C# compiler that
// ships with Windows (.NET Framework 4), started hidden by the Dayspring server, and fed one JSON object per line on stdin:
//   {"type":"show","id":"…","title":"…","text":"…","kind":"reminders","snooze":true,"seconds":8}
//   {"type":"dismiss","id":"…"}   {"type":"config","screen":"primary"|"2","seconds":8}
// It answers on stdout, one JSON object per line: {"type":"ready"} {"type":"shown","id"} {"type":"skipped","id","why"}
//   {"type":"click","id"} {"type":"dismissed","id"} {"type":"snooze","id"} {"type":"hotkey","name":"toggle-off"}
// It exits when stdin closes (the server stopped). Ctrl+Alt+Shift+D is a global hotkey: Dayspring off / back on.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

static class Native {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr h, int id, uint mods, uint vk);
  [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr h, int id);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);   // Windows 10 1703+
  // sharp text on every monitor: per-monitor v2 where Windows has it, else system DPI (older Windows 10)
  public static void Dpi() { try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; } catch (EntryPointNotFoundException) { } try { SetProcessDPIAware(); } catch { } }
  public static readonly IntPtr TOPMOST = new IntPtr(-1);
  public const uint NOSIZE = 1, NOMOVE = 2, NOACTIVATE = 0x10, SHOWWINDOW = 0x40;
}

class Card : Form {
  const int WS_EX_TOPMOST = 0x8, WS_EX_TOOLWINDOW = 0x80, WS_EX_NOACTIVATE = 0x08000000;
  public string Id; public DateTime Until;
  readonly string title, text; readonly bool snooze; readonly Color accent;
  Rectangle closeBox, snoozeBox;
  public event Action<Card, string> Act;
  public Card(string id, string title, string text, bool snooze, int seconds, Color accent) {
    Id = id; this.title = title ?? "Dayspring"; this.text = text ?? ""; this.snooze = snooze; this.accent = accent;
    Until = DateTime.Now.AddSeconds(Math.Max(3, seconds));
    FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; TopMost = true; StartPosition = FormStartPosition.Manual;
    BackColor = Color.FromArgb(18, 22, 44); DoubleBuffered = true; Cursor = Cursors.Hand; Opacity = 0.97;
    Width = 360;
    using (var g = CreateGraphics()) {
      var tSize = g.MeasureString(this.text, BodyFont, Width - 40);
      Height = Math.Min(220, 58 + (int)Math.Ceiling(tSize.Height) + (snooze ? 28 : 6));
    }
    MouseUp += (s, e) => {
      if (closeBox.Contains(e.Location)) { if (Act != null) Act(this, "dismissed"); }
      else if (snooze && snoozeBox.Contains(e.Location)) { if (Act != null) Act(this, "snooze"); }
      else { if (Act != null) Act(this, "click"); }
    };
  }
  static readonly Font TitleFont = new Font("Segoe UI Semibold", 10.5f), BodyFont = new Font("Segoe UI", 9.75f), SmallFont = new Font("Segoe UI", 9f);
  protected override bool ShowWithoutActivation { get { return true; } }
  protected override CreateParams CreateParams { get { var p = base.CreateParams; p.ExStyle |= WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE; return p; } }
  protected override void OnPaint(PaintEventArgs e) {
    var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias; g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
    using (var br = new LinearGradientBrush(ClientRectangle, Color.FromArgb(24, 29, 58), Color.FromArgb(14, 17, 36), 90f)) g.FillRectangle(br, ClientRectangle);
    using (var a = new SolidBrush(accent)) g.FillRectangle(a, 0, 0, 4, Height);
    using (var pen = new Pen(Color.FromArgb(70, 124, 140, 255))) g.DrawRectangle(pen, 0, 0, Width - 1, Height - 1);
    using (var dot = new SolidBrush(accent)) g.FillEllipse(dot, 16, 16, 10, 10);
    g.DrawString(title, TitleFont, Brushes.White, new RectangleF(32, 11, Width - 72, 22));
    using (var b = new SolidBrush(Color.FromArgb(214, 220, 245))) g.DrawString(text, BodyFont, b, new RectangleF(16, 36, Width - 32, Height - 40 - (snooze ? 26 : 0)));
    closeBox = new Rectangle(Width - 32, 8, 22, 22);
    using (var c = new SolidBrush(Color.FromArgb(160, 170, 200))) g.DrawString("✕", SmallFont, c, closeBox.X + 5, closeBox.Y + 3);
    if (snooze) {
      snoozeBox = new Rectangle(16, Height - 28, 110, 22);
      using (var sb = new SolidBrush(Color.FromArgb(40, 124, 140, 255))) g.FillRectangle(sb, snoozeBox);
      using (var st = new SolidBrush(Color.FromArgb(200, 208, 255))) g.DrawString("💤 Snooze 10 min", SmallFont, st, snoozeBox.X + 6, snoozeBox.Y + 3);
    }
  }
}

class HotkeyWindow : NativeWindow, IDisposable {
  public event Action Pressed;
  public HotkeyWindow() { CreateHandle(new CreateParams()); Native.RegisterHotKey(Handle, 1, 0x1 | 0x2 | 0x4 | 0x4000, (uint)Keys.D); }   // Alt+Ctrl+Shift+D, no repeat
  protected override void WndProc(ref Message m) { if (m.Msg == 0x0312) { if (Pressed != null) Pressed(); } base.WndProc(ref m); }
  public void Dispose() { Native.UnregisterHotKey(Handle, 1); DestroyHandle(); }
}

static class Program {
  static readonly List<Card> cards = new List<Card>();
  static readonly JavaScriptSerializer json = new JavaScriptSerializer();
  static readonly object outLock = new object();
  static string screenPick = "primary"; static int seconds = 8;
  static Form host;
  static readonly Regex DAYSPRING_TITLE = new Regex(@"^(Welcome to )?Dayspring( [-—] .*)?$");
  static readonly Dictionary<string, Color> ACCENT = new Dictionary<string, Color> {
    { "reminders", Color.FromArgb(255, 210, 122) }, { "schedule", Color.FromArgb(124, 140, 255) }, { "texts", Color.FromArgb(126, 227, 176) },
    { "lantern", Color.FromArgb(255, 181, 71) }, { "discover", Color.FromArgb(213, 139, 255) }, { "system", Color.FromArgb(103, 232, 249) },
  };

  // a winexe has no console: write UTF-8 lines straight to the stdout pipe
  static System.IO.StreamWriter stdout;
  static void Send(Dictionary<string, object> o) { lock (outLock) { try { if (stdout == null) { stdout = new System.IO.StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)); stdout.AutoFlush = true; } stdout.WriteLine(json.Serialize(o)); } catch { } } }
  static Dictionary<string, object> Msg(string type, string id = null, string extra = null, string extraValue = null) {
    var d = new Dictionary<string, object> { { "type", type } }; if (id != null) d["id"] = id; if (extra != null) d[extra] = extraValue; return d;
  }
  static Screen Target() {
    int n; var all = Screen.AllScreens;
    if (int.TryParse(screenPick, out n)) { var sorted = new List<Screen>(all); sorted.Sort((a, b) => a.Bounds.X != b.Bounds.X ? a.Bounds.X.CompareTo(b.Bounds.X) : a.Bounds.Y.CompareTo(b.Bounds.Y)); if (n >= 1 && n <= sorted.Count) return sorted[n - 1]; }
    return Screen.PrimaryScreen;
  }
  static void Layout() {
    var wa = Target().WorkingArea; int y = wa.Top + 12;
    foreach (var c in cards) {
      c.Location = new Point(wa.Right - c.Width - 12, y);
      Native.SetWindowPos(c.Handle, Native.TOPMOST, c.Left, c.Top, 0, 0, Native.NOSIZE | Native.NOACTIVATE | Native.SHOWWINDOW);
      y += c.Height + 8;
    }
  }
  static void Close(Card c, string why) {
    if (!cards.Remove(c)) return;
    c.Hide(); c.Dispose(); Layout();
    Send(Msg(why, c.Id));
  }
  static bool DayspringInFront() {
    var sb = new StringBuilder(256); Native.GetWindowText(Native.GetForegroundWindow(), sb, 256);
    return DAYSPRING_TITLE.IsMatch(sb.ToString());
  }
  static void Show(Dictionary<string, object> m) {
    string id = m.ContainsKey("id") ? Convert.ToString(m["id"]) : Guid.NewGuid().ToString("N");
    if (DayspringInFront() && !(m.ContainsKey("force") && Convert.ToBoolean(m["force"]))) { Send(Msg("skipped", id, "why", "dayspring-in-front")); return; }
    string kind = m.ContainsKey("kind") ? Convert.ToString(m["kind"]) : "schedule";
    Color accent; if (!ACCENT.TryGetValue(kind, out accent)) accent = ACCENT["schedule"];
    int secs = m.ContainsKey("seconds") ? Convert.ToInt32(m["seconds"]) : seconds;
    var c = new Card(id, m.ContainsKey("title") ? Convert.ToString(m["title"]) : "Dayspring", m.ContainsKey("text") ? Convert.ToString(m["text"]) : "", m.ContainsKey("snooze") && Convert.ToBoolean(m["snooze"]), secs, accent);
    c.Act += (card, what) => Close(card, what);
    cards.Insert(0, c);
    while (cards.Count > 4) Close(cards[cards.Count - 1], "dismissed");
    c.Show(); Layout();
    Send(Msg("shown", id));
  }
  static void Handle(string line) {
    Dictionary<string, object> m;
    try { m = json.Deserialize<Dictionary<string, object>>(line); } catch { return; }
    if (m == null || !m.ContainsKey("type")) return;
    string type = Convert.ToString(m["type"]);
    if (type == "show") Show(m);
    else if (type == "dismiss") { var id = Convert.ToString(m["id"]); var c = cards.Find(x => x.Id == id); if (c != null) Close(c, "dismissed"); }
    else if (type == "config") { if (m.ContainsKey("screen")) screenPick = Convert.ToString(m["screen"]); if (m.ContainsKey("seconds")) seconds = Math.Max(3, Convert.ToInt32(m["seconds"])); Layout(); }
    else if (type == "ping") Send(Msg("pong"));
  }

  [STAThread]
  static void Main() {
    Native.Dpi();
    Application.EnableVisualStyles();
    // an invisible form that owns the message loop (never shown: only its handle is created, for BeginInvoke)
    host = new Form { ShowInTaskbar = false, FormBorderStyle = FormBorderStyle.None, Size = new Size(1, 1) };
    var unused = host.Handle;
    var hot = new HotkeyWindow(); hot.Pressed += () => Send(Msg("hotkey", null, "name", "toggle-off"));
    var timer = new System.Windows.Forms.Timer { Interval = 500 };
    timer.Tick += (s, e) => { foreach (var c in cards.ToArray()) if (DateTime.Now > c.Until && !c.Bounds.Contains(Cursor.Position)) Close(c, "dismissed"); };
    timer.Start();
    var reader = new Thread(() => {
      var stdin = new System.IO.StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
      string line;
      while ((line = stdin.ReadLine()) != null) { var l = line; try { host.BeginInvoke((Action)(() => Handle(l))); } catch { } }
      try { host.BeginInvoke((Action)(() => { hot.Dispose(); Application.Exit(); })); } catch { Environment.Exit(0); }
    }) { IsBackground = true };
    reader.Start(); Send(Msg("ready"));
    Application.Run();
  }
}
