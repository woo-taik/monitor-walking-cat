using System;
using System.Diagnostics;
using System.Linq;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using Forms = System.Windows.Forms;
using Drawing = System.Drawing;

namespace Animo;

internal sealed class PetWindow : Window
{
    internal readonly CatVisual Cat = new();
    internal readonly PetBrain Brain;
    private readonly Settings settings;
    private readonly bool smoke;
    private readonly string output;
    private readonly DispatcherTimer timer = new(DispatcherPriority.Background);
    private readonly Stopwatch clock = new();
    private readonly Forms.ContextMenuStrip menu = new();
    private Forms.NotifyIcon? tray;
    private Drawing.Icon? trayIcon;
    private HwndSource? source;
    internal nint Handle { get; private set; }
    private double lastTime, saveElapsed;
    private bool held, paused, hidden, ready, saveWarning;
    private double grabX, grabY;
    private bool hideHotkey, recallHotkey;
    private MonitorInfo monitor;

    internal bool ClickThrough => settings.ClickThrough;
    internal Forms.ContextMenuStrip PetMenu => menu;
    internal void ShowPetMenu(int x, int y)
    {
        BuildMenu();
        // WinForms chooses a screen from the whole popup rectangle. Near a screen
        // edge that rectangle can belong to a neighbour instead of the clicked screen.
        Area workArea = Nearest(x, y).WorkArea;
        Drawing.Size preferred = menu.GetPreferredSize(Drawing.Size.Empty);
        var initial = workArea.Clamp(x, y, preferred.Width, preferred.Height);
        menu.Show((int)Math.Round(initial.X), (int)Math.Round(initial.Y));
        // The reused popup can change size when moving between different DPIs.
        // Clamp its final physical rectangle after WinForms has finished scaling it.
        if (menu.Visible && Native.GetWindowRect(menu.Handle, out var rect))
        {
            var position = workArea.Clamp(x, y, rect.Right - rect.Left, rect.Bottom - rect.Top);
            Native.Move(menu.Handle, position.X, position.Y);
        }
    }

    public PetWindow(Settings settings, bool smoke, string output)
    {
        this.settings = settings;
        this.smoke = smoke;
        this.output = output;
        settings.Validate();
        monitor = Native.Monitors().FirstOrDefault(m => m.Device == settings.Monitor) ?? Native.Monitors().First(m => m.Primary);
        Brain = new PetBrain(monitor.WorkArea) { FloorOnly = settings.FloorOnly };
        Brain.SetRoaming(settings.Roaming);
        Title = "Animo · 작은 고양이";
        Width = 160 * settings.Size;
        Height = 144 * settings.Size;
        WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.NoResize;
        AllowsTransparency = true;
        Background = Brushes.Transparent;
        Topmost = true;
        ShowInTaskbar = false;
        ShowActivated = false;
        Content = Cat;
        Cat.Cursor = Cursors.Hand;
        Cat.ToolTip = "끌어서 배치 · 우클릭으로 메뉴\nCtrl+Alt+C 숨기기 · Ctrl+Alt+R 고양이 찾기";
        SourceInitialized += OnSourceInitialized;
        Loaded += OnLoaded;
        Closed += OnClosed;
        Cat.MouseLeftButtonDown += StartDrag;
        Cat.MouseMove += Drag;
        Cat.MouseLeftButtonUp += (_, e) => { EndDrag(); e.Handled = true; };
        Cat.LostMouseCapture += (_, _) => EndDrag();
        Cat.MouseRightButtonUp += (_, e) =>
        {
            if (!held && Native.GetCursorPos(out var point)) ShowPetMenu(point.X, point.Y);
            e.Handled = true;
        };
        menu.Opening += (_, e) => { BuildMenu(); e.Cancel = false; };
        timer.Tick += Tick;
        timer.Interval = TimeSpan.FromMilliseconds(33);
    }

    private void OnSourceInitialized(object? sender, EventArgs e)
    {
        Handle = new WindowInteropHelper(this).Handle;
        source = HwndSource.FromHwnd(Handle);
        source?.AddHook(WindowMessage);
        long style = Native.GetWindowLongPtr(Handle, Native.GwlExStyle).ToInt64();
        Native.SetWindowLongPtr(Handle, Native.GwlExStyle, (nint)(style | Native.NoActivate | Native.ToolWindow));
        ApplyClickThrough(settings.ClickThrough);
        if (!smoke)
        {
            // MOD_NOREPEAT | MOD_CONTROL | MOD_ALT.
            hideHotkey = Native.RegisterHotKey(Handle, 1, 0x4003, 0x43);
            recallHotkey = Native.RegisterHotKey(Handle, 2, 0x4003, 0x52);
        }
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        // Move in physical coordinates; WPF handles the monitor's DPI change.
        Native.Move(Handle, monitor.WorkArea.Left + monitor.WorkArea.Width * .5, monitor.WorkArea.Top + monitor.WorkArea.Height * .5);
        UpdateLayout();
        SyncDimensions();
        RestorePosition();
        CreateTray();
        ready = true;
        clock.Start();
        timer.Start();
        if (smoke)
        {
            var verifyTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(700) };
            verifyTimer.Tick += (_, _) =>
            {
                verifyTimer.Stop();
                timer.Stop();
                int result = Verification.RunWindow(this, output);
                Application.Current.Shutdown(result);
            };
            verifyTimer.Start();
        }
    }

    private nint WindowMessage(nint hwnd, int msg, nint wParam, nint lParam, ref bool handled)
    {
        if (msg == 0x0021) { handled = true; return 3; } // MA_NOACTIVATE, still allow mouse input.
        if (msg == 0x0312)
        {
            if (wParam == 1) ToggleHidden();
            else if (wParam == 2) Recall();
            handled = true;
        }
        if (ready && (msg == 0x007E || msg == 0x001A || msg == 0x02E0))
            Dispatcher.BeginInvoke(DispatcherPriority.Background, new Action(RefreshMonitor));
        return 0;
    }

    internal void SyncDimensions()
    {
        if (!Native.GetWindowRect(Handle, out var rect)) return;
        Brain.Width = Math.Max(1, rect.Right - rect.Left);
        Brain.Height = Math.Max(1, rect.Bottom - rect.Top);
        Brain.Scale = Math.Max(1, Native.GetDpiForWindow(Handle)) / 96.0 * settings.Size;
        Brain.SetPosition(Brain.X, Brain.Y);
    }

    private void RestorePosition()
    {
        Area area = monitor.WorkArea;
        Brain.SetBounds(area);
        Brain.SetPosition(area.Left + Math.Max(0, area.Width - Brain.Width) * settings.RelativeX,
            area.Top + Math.Max(0, area.Height - Brain.Height) * settings.RelativeY);
        Native.Move(Handle, Brain.X, Brain.Y);
    }

    private MonitorInfo Nearest(double x, double y)
    {
        return Native.Monitors().OrderBy(m =>
        {
            Area a = m.WorkArea;
            double dx = x - Math.Clamp(x, a.Left, a.Right), dy = y - Math.Clamp(y, a.Top, a.Bottom);
            return dx * dx + dy * dy;
        }).First();
    }

    private void RefreshMonitor()
    {
        if (held) return;
        SyncDimensions();
        monitor = Nearest(Brain.X + Brain.Width / 2, Brain.Y + Brain.Height / 2);
        Brain.SetBounds(monitor.WorkArea);
        Native.Move(Handle, Brain.X, Brain.Y);
        Save();
    }

    private void Tick(object? sender, EventArgs e)
    {
        double now = clock.Elapsed.TotalSeconds;
        double delta = Math.Min(.1, now - lastTime);
        lastTime = now;
        if (held || hidden || paused || menu.Visible) return;
        SyncDimensions();
        Brain.Tick(delta);
        Native.Move(Handle, Brain.X, Brain.Y);
        Cat.Pose = Brain.Pose;
        Cat.FacingRight = Brain.FacingRight;
        Cat.Time += delta;
        Cat.InvalidateVisual();
        timer.Interval = TimeSpan.FromMilliseconds(Brain.Pose == PetPose.Walking ? 33 : 100);
        saveElapsed += delta;
        if (saveElapsed >= 15) { Save(); saveElapsed = 0; }
    }

    private void StartDrag(object sender, MouseButtonEventArgs e)
    {
        if (settings.ClickThrough || !Native.GetCursorPos(out var point)) return;
        BeginPlacement(point.X, point.Y);
        if (held) Cat.CaptureMouse();
        e.Handled = true;
    }

    internal void BeginPlacement(double cursorX, double cursorY)
    {
        if (settings.ClickThrough || !Native.GetWindowRect(Handle, out var rect)) return;
        held = true;
        grabX = cursorX - rect.Left;
        grabY = cursorY - rect.Top;
        Brain.BeginHold();
        Cat.Pose = PetPose.Held;
        Cat.InvalidateVisual();
    }

    private void Drag(object sender, System.Windows.Input.MouseEventArgs e)
    {
        if (!held || !Native.GetCursorPos(out var point)) return;
        MovePlacement(point.X, point.Y);
        e.Handled = true;
    }

    internal void MovePlacement(double cursorX, double cursorY)
    {
        if (held) Native.Move(Handle, cursorX - grabX, cursorY - grabY);
    }

    internal void EndDrag()
    {
        if (!held) return;
        held = false;
        Cat.ReleaseMouseCapture();
        if (Native.GetWindowRect(Handle, out var rect))
        {
            monitor = Nearest((rect.Left + rect.Right) / 2.0, (rect.Top + rect.Bottom) / 2.0);
            SyncDimensions();
            Brain.SetBounds(monitor.WorkArea);
            Brain.Pin(rect.Left, rect.Top);
            Native.Move(Handle, Brain.X, Brain.Y);
        }
        Cat.Pose = PetPose.Sitting;
        Cat.InvalidateVisual();
        Save();
    }

    internal void ApplyClickThrough(bool enabled)
    {
        settings.ClickThrough = enabled;
        long style = Native.GetWindowLongPtr(Handle, Native.GwlExStyle).ToInt64();
        style = enabled ? style | Native.Transparent : style & ~Native.Transparent;
        Native.SetWindowLongPtr(Handle, Native.GwlExStyle, (nint)style);
    }

    private void ToggleHidden()
    {
        hidden = !hidden;
        if (hidden) Hide(); else Show();
    }

    private void Recall()
    {
        if (held) EndDrag();
        ApplyClickThrough(false);
        paused = false;
        hidden = false;
        Show();
        monitor = Native.Monitors().First(m => m.Primary);
        Native.Move(Handle, monitor.WorkArea.Left + monitor.WorkArea.Width * .5, monitor.WorkArea.Top + monitor.WorkArea.Height * .5);
        SyncDimensions();
        Brain.SetBounds(monitor.WorkArea);
        Brain.Pin(monitor.WorkArea.Left + (monitor.WorkArea.Width - Brain.Width) * .5, monitor.WorkArea.Bottom - Brain.Height);
        Native.Move(Handle, Brain.X, Brain.Y);
        Cat.Pose = PetPose.Sitting;
        Cat.InvalidateVisual();
        Save();
    }

    internal void ChangeSize(double size)
    {
        double feetX = Brain.X + Brain.Width / 2, feetY = Brain.Y + Brain.Height;
        settings.Size = size;
        Width = 160 * size; Height = 144 * size;
        UpdateLayout();
        SyncDimensions();
        Brain.SetPosition(feetX - Brain.Width / 2, feetY - Brain.Height);
        Native.Move(Handle, Brain.X, Brain.Y);
        Save();
    }

    internal void MoveToMonitor(MonitorInfo screen)
    {
        monitor = screen;
        Native.Move(Handle, screen.WorkArea.Left + screen.WorkArea.Width * .5, screen.WorkArea.Top + screen.WorkArea.Height * .5);
        UpdateLayout();
        SyncDimensions();
        Brain.SetBounds(screen.WorkArea);
        Brain.SetPosition(screen.WorkArea.Left + (screen.WorkArea.Width - Brain.Width) * .5, screen.WorkArea.Bottom - Brain.Height);
        Native.Move(Handle, Brain.X, Brain.Y);
        Save();
    }

    private void BuildMenu()
    {
        while (menu.Items.Count > 0) { var item = menu.Items[0]; menu.Items.RemoveAt(0); item.Dispose(); }
        menu.Items.Add(new Forms.ToolStripMenuItem("Animo · 작은 고양이") { Enabled = false });
        menu.Items.Add(new Forms.ToolStripSeparator());
        Add("산책 모드", () => { Brain.SetRoaming(true); Save(); }, Brain.Roaming);
        Add("이 자리에 머물기", () => { Brain.Pin(Brain.X, Brain.Y); Save(); }, !Brain.Roaming);
        Add("화면 아래쪽에서만 산책", () => { Brain.FloorOnly = !Brain.FloorOnly; Brain.SetRoaming(Brain.Roaming); Save(); }, Brain.FloorOnly);
        Add("잠시 멈추기", () => paused = !paused, paused);
        menu.Items.Add(new Forms.ToolStripSeparator());
        var sizes = new Forms.ToolStripMenuItem("고양이 크기");
        foreach (var option in new[] { ("작게", .75), ("보통", 1.0), ("크게", 1.35) })
        {
            var sizeItem = new Forms.ToolStripMenuItem(option.Item1) { Checked = Math.Abs(settings.Size - option.Item2) < .01 };
            double value = option.Item2;
            sizeItem.Click += (_, _) => ChangeSize(value);
            sizes.DropDownItems.Add(sizeItem);
        }
        menu.Items.Add(sizes);
        var monitors = new Forms.ToolStripMenuItem("모니터로 이동");
        int count = 0;
        foreach (MonitorInfo screen in Native.Monitors())
        {
            var item = new Forms.ToolStripMenuItem($"모니터 {++count}" + (screen.Primary ? " (주 화면)" : "")) { Checked = screen.Device == monitor.Device };
            item.Click += (_, _) => MoveToMonitor(screen);
            monitors.DropDownItems.Add(item);
        }
        menu.Items.Add(monitors);
        Add("고양이도 클릭 통과", () => { ApplyClickThrough(!settings.ClickThrough); Save(); }, settings.ClickThrough);
        Add(hidden ? "고양이 보이기" : "고양이 숨기기", ToggleHidden);
        Add("고양이 찾기 · 위치 초기화", Recall);
        menu.Items.Add(new Forms.ToolStripSeparator());
        Add("사용 방법", () => MessageBox.Show(
            "고양이를 끌어 원하는 자리에 놓으면 그 위치에 머뭅니다.\n" +
            "고양이 우클릭 또는 트레이 아이콘 우클릭으로 산책을 다시 시작할 수 있습니다.\n\n" +
            "배경의 투명한 부분은 뒤쪽 프로그램을 클릭할 수 있습니다.\n" +
            "‘고양이도 클릭 통과’를 켜면 고양이를 직접 잡을 수 없습니다.\n" +
            "트레이 메뉴에서 해제하거나 ‘고양이 찾기’를 선택하세요.\n\n" +
            "Ctrl+Alt+C: 숨기기 / 보이기" + (hideHotkey ? "" : " (다른 앱에서 사용 중)") + "\n" +
            "Ctrl+Alt+R: 클릭 통과 해제 및 주 화면으로 복귀" + (recallHotkey ? "" : " (다른 앱에서 사용 중)") + "\n\n" +
            "종료: 트레이 메뉴의 ‘종료’", "Animo 사용 방법"));
        Add("종료", Close);
    }

    private void Add(string label, Action action, bool selected = false)
    {
        var item = new Forms.ToolStripMenuItem(label) { Checked = selected };
        item.Click += (_, _) => action();
        menu.Items.Add(item);
    }

    private void CreateTray()
    {
        trayIcon = MakeIcon();
        tray = new Forms.NotifyIcon { Icon = trayIcon, Text = "Animo · 끌어서 배치, 우클릭으로 메뉴", ContextMenuStrip = menu, Visible = true };
        tray.DoubleClick += (_, _) => Recall();
        if (!smoke)
        {
            tray.BalloonTipTitle = "고양이가 도착했어요";
            tray.BalloonTipText = "끌어서 자리를 정해 주세요. 우클릭하면 산책을 시작할 수 있어요.";
            tray.ShowBalloonTip(4500);
        }
    }

    private static Drawing.Icon MakeIcon()
    {
        using var bitmap = new Drawing.Bitmap(32, 32);
        using (var graphics = Drawing.Graphics.FromImage(bitmap))
        {
            graphics.SmoothingMode = Drawing.Drawing2D.SmoothingMode.AntiAlias;
            using var fur = new Drawing.SolidBrush(Drawing.Color.FromArgb(255, 217, 155));
            using var ink = new Drawing.Pen(Drawing.Color.FromArgb(89, 65, 54), 1.4f);
            using var pink = new Drawing.SolidBrush(Drawing.Color.FromArgb(243, 162, 163));
            graphics.FillPolygon(fur, new[] { new Drawing.Point(4, 14), new Drawing.Point(4, 3), new Drawing.Point(13, 10) });
            graphics.FillPolygon(fur, new[] { new Drawing.Point(19, 10), new Drawing.Point(28, 3), new Drawing.Point(28, 14) });
            graphics.FillEllipse(fur, 3, 8, 26, 22);
            graphics.DrawEllipse(ink, 3, 8, 26, 22);
            graphics.FillEllipse(Drawing.Brushes.SaddleBrown, 9, 16, 3, 4);
            graphics.FillEllipse(Drawing.Brushes.SaddleBrown, 21, 16, 3, 4);
            graphics.FillEllipse(pink, 14, 22, 5, 3);
        }
        nint handle = bitmap.GetHicon();
        try { using var icon = Drawing.Icon.FromHandle(handle); return (Drawing.Icon)icon.Clone(); }
        finally { Native.DestroyIcon(handle); }
    }

    private void Save()
    {
        if (smoke || !ready) return;
        settings.Monitor = monitor.Device;
        settings.RelativeX = Math.Clamp((Brain.X - monitor.WorkArea.Left) / Math.Max(1, monitor.WorkArea.Width - Brain.Width), 0, 1);
        settings.RelativeY = Math.Clamp((Brain.Y - monitor.WorkArea.Top) / Math.Max(1, monitor.WorkArea.Height - Brain.Height), 0, 1);
        settings.Roaming = Brain.Roaming;
        settings.FloorOnly = Brain.FloorOnly;
        if (!settings.Save() && !saveWarning && tray != null)
        {
            saveWarning = true;
            tray.ShowBalloonTip(4000, "위치를 저장하지 못했습니다", "현재 실행은 계속됩니다. 다음 실행에서는 기본 위치로 돌아올 수 있습니다.", Forms.ToolTipIcon.Warning);
        }
    }

    private void OnClosed(object? sender, EventArgs e)
    {
        timer.Stop();
        Save();
        if (hideHotkey) Native.UnregisterHotKey(Handle, 1);
        if (recallHotkey) Native.UnregisterHotKey(Handle, 2);
        source?.RemoveHook(WindowMessage);
        if (tray != null) { tray.Visible = false; tray.Dispose(); }
        menu.Dispose();
        trayIcon?.Dispose();
    }
}
