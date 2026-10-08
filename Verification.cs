using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace Animo;

internal static class Verification
{
    private static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }

    public static int RunCore(string output)
    {
        Directory.CreateDirectory(output);
        var lines = new List<string>();
        try
        {
            var brain = new PetBrain(new Area(-1920, -120, 0, 960), 42);
            var poses = new HashSet<PetPose>();
            for (int i = 0; i < 100000; i++)
            {
                brain.Tick(i % 71 == 0 ? 20 : .033);
                Require(brain.X >= -1920 && brain.X + brain.Width <= 0 && brain.Y >= -120 && brain.Y + brain.Height <= 960, "Roaming escaped work area.");
                poses.Add(brain.Pose);
            }
            Require(poses.Contains(PetPose.Walking) && poses.Contains(PetPose.Sleeping) && poses.Contains(PetPose.Sitting), "Missing automatic poses.");
            lines.Add("PASS: 100,000 roaming frames, negative monitor coordinates, long frame gaps, all automatic poses.");
            brain.Pin(-620, 150);
            for (int i = 0; i < 10000; i++) brain.Tick(.1);
            Require(brain.X == -620 && brain.Y == 150 && !brain.Roaming, "Pinned cat moved.");
            lines.Add("PASS: fixed position stays unchanged through 10,000 animation frames.");
            brain.BeginHold();
            brain.Tick(10);
            Require(brain.Pose == PetPose.Held && !brain.Roaming, "Hold must stop autonomous movement.");
            brain.Pin(-900, 240);
            Require(brain.Pose == PetPose.Sitting && brain.X == -900 && brain.Y == 240, "Drop should pin and sit.");
            brain.SetRoaming(true);
            for (int i = 0; i < 300; i++) brain.Tick(.1);
            Require(brain.Roaming && brain.X != -900, "Resume failed.");
            lines.Add("PASS: hold, drop into fixed mode, resume walking.");
            brain.Width = 216; brain.Height = 194; brain.Scale = 1.35;
            brain.SetBounds(new Area(0, 0, 3840, 2080));
            brain.FloorOnly = false;
            for (int i = 0; i < 10000; i++)
            {
                brain.Tick(.1);
                Require(brain.X >= 0 && brain.X <= 3624 && brain.Y >= 0 && brain.Y <= 1886, "Resized cat escaped bounds.");
            }
            brain.SetBounds(new Area(0, 0, 80, 60));
            brain.SetPosition(double.NaN, double.PositiveInfinity);
            Require(brain.X == 0 && brain.Y == 0, "Invalid coordinates or undersized work area not handled.");
            brain.Tick(double.NaN);
            Require(double.IsFinite(brain.X) && double.IsFinite(brain.Y), "Invalid elapsed time contaminated position.");
            lines.Add("PASS: resizing, whole-screen roaming, monitor removal, small work areas, invalid inputs.");
            string path = Path.Combine(output, "test-settings.json");
            var settings = new Settings { Monitor = "TEST", RelativeX = .2, RelativeY = .6, Size = 1.35, Roaming = false, ClickThrough = true, FloorOnly = false };
            Require(settings.Save(path), "Settings write failed.");
            var loaded = Settings.Load(path);
            Require(loaded.Monitor == "TEST" && loaded.RelativeX == .2 && loaded.RelativeY == .6 && loaded.Size == 1.35 && !loaded.Roaming && loaded.ClickThrough && !loaded.FloorOnly, "Settings round trip failed.");
            File.WriteAllText(path, "broken json");
            Require(Settings.Load(path).Size == 1, "Corrupt file did not fall back to defaults.");
            File.WriteAllText(path, "{\"Size\":100,\"RelativeX\":-5,\"RelativeY\":100}");
            loaded = Settings.Load(path);
            Require(loaded.Size == 1.5 && loaded.RelativeX == 0 && loaded.RelativeY == 1, "Settings validation failed.");
            Require(Settings.Load(Path.Combine(output, "missing.json")).Roaming, "Missing settings file must use defaults.");
            File.Delete(path);
            lines.Add("PASS: settings persistence, missing/corrupt file recovery, validation.");
            lines.Add("5 groups passed.");
            File.WriteAllLines(Path.Combine(output, "core-tests.txt"), lines);
            return 0;
        }
        catch (Exception e)
        {
            lines.Add("FAIL: " + e);
            File.WriteAllLines(Path.Combine(output, "core-tests.txt"), lines);
            return 1;
        }
    }

    public static int RunWindow(PetWindow window, string output)
    {
        Directory.CreateDirectory(output);
        var lines = new List<string>();
        try
        {
            Require(window.IsLoaded && window.IsVisible && window.Handle != 0, "Window failed to show.");
            Require(window.AllowsTransparency && window.Topmost && !window.ShowInTaskbar && !window.ShowActivated, "Overlay flags incorrect.");
            long style = Native.GetWindowLongPtr(window.Handle, Native.GwlExStyle).ToInt64();
            Require((style & Native.NoActivate) != 0 && (style & Native.ToolWindow) != 0 && (style & 0x80000) != 0, "Native no-activate, tool-window or layered style missing.");
            lines.Add("PASS: real transparent topmost HWND, no activation, no taskbar button.");
            window.ApplyClickThrough(true);
            Require((Native.GetWindowLongPtr(window.Handle, Native.GwlExStyle).ToInt64() & Native.Transparent) != 0, "Click-through style not enabled.");
            window.ApplyClickThrough(false);
            Require((Native.GetWindowLongPtr(window.Handle, Native.GwlExStyle).ToInt64() & Native.Transparent) == 0, "Click-through style not disabled.");
            lines.Add("PASS: native click-through on/off.");
            window.Brain.Pin(window.Brain.Bounds.Left + 200, window.Brain.Bounds.Top + 200);
            Native.Move(window.Handle, window.Brain.X, window.Brain.Y);
            Native.GetWindowRect(window.Handle, out var before);
            window.BeginPlacement(before.Left + 80, before.Top + 72);
            window.MovePlacement(before.Left + 120, before.Top + 102);
            window.EndDrag();
            Native.GetWindowRect(window.Handle, out var after);
            Require(after.Left == before.Left + 40 && after.Top == before.Top + 30, "Physical window drag did not preserve grab offset.");
            Require(!window.Brain.Roaming && window.Brain.Pose == PetPose.Sitting && Math.Abs(window.Brain.X - after.Left) < 1, "Window drop failed to pin.");
            lines.Add("PASS: real HWND placement moves 40x30 physical pixels, drop pins position.");
            lines.Add($"INFO: {Native.Monitors().Count} monitors; window DPI {Native.GetDpiForWindow(window.Handle)}; physical size {after.Right - after.Left}x{after.Bottom - after.Top}.");
            nint foreground = Native.GetForegroundWindow();
            foreach (MonitorInfo screen in Native.Monitors())
            {
                window.MoveToMonitor(screen);
                foreach (double size in new[] { .75, 1.0, 1.35 })
                {
                    window.ChangeSize(size);
                    Native.GetWindowRect(window.Handle, out var rect);
                    double scale = Native.GetDpiForWindow(window.Handle) / 96.0;
                    Require(Math.Abs(rect.Right - rect.Left - 160 * size * scale) <= 2 && Math.Abs(rect.Bottom - rect.Top - 144 * size * scale) <= 2, "Physical pet dimensions did not follow monitor DPI.");
                    Require(rect.Left >= screen.WorkArea.Left && rect.Right <= screen.WorkArea.Right && rect.Top >= screen.WorkArea.Top && rect.Bottom <= screen.WorkArea.Bottom, "Monitor/size change escaped work area.");
                }
                lines.Add($"PASS: {screen.Device} at {Native.GetDpiForWindow(window.Handle)} DPI, all 3 sizes remain inside work area.");
                foreach (var point in new[] {
                    (screen.WorkArea.Left + 24, screen.WorkArea.Top + 24),
                    (screen.WorkArea.Right - 24, screen.WorkArea.Top + 24),
                    (screen.WorkArea.Left + 24, screen.WorkArea.Bottom - 24),
                    (screen.WorkArea.Right - 24, screen.WorkArea.Bottom - 24) })
                {
                    window.ShowPetMenu((int)point.Item1, (int)point.Item2);
                    Require(Native.GetWindowRect(window.PetMenu.Handle, out var menuBounds), "Menu HWND missing.");
                    Require(window.PetMenu.Visible && menuBounds.Left >= screen.WorkArea.Left && menuBounds.Right <= screen.WorkArea.Right && menuBounds.Top >= screen.WorkArea.Top && menuBounds.Bottom <= screen.WorkArea.Bottom, "Context menu is outside the clicked monitor.");
                    window.PetMenu.Close();
                }
                window.ShowPetMenu((int)screen.WorkArea.Right - 24, (int)screen.WorkArea.Bottom - 24);
                window.PetMenu.Items.Cast<System.Windows.Forms.ToolStripItem>().First(i => i.Text == "산책 모드").PerformClick();
                Require(window.Brain.Roaming, "Context menu walk action failed.");
                window.PetMenu.Close();
                window.ShowPetMenu((int)screen.WorkArea.Right - 24, (int)screen.WorkArea.Bottom - 24);
                window.PetMenu.Items.Cast<System.Windows.Forms.ToolStripItem>().First(i => i.Text == "이 자리에 머물기").PerformClick();
                Require(!window.Brain.Roaming, "Context menu stay action failed.");
                window.PetMenu.Close();
                lines.Add($"PASS: {screen.Device} first/repeated popup opens inside all four corners; walk/stay actions work.");
            }
            Require(Native.GetForegroundWindow() == foreground, "Programmatic movement stole keyboard focus.");
            window.ChangeSize(1);
            lines.Add("PASS: monitor and size changes preserve foreground window.");
            var bitmapList = new List<BitmapSource>();
            foreach (PetPose pose in new[] { PetPose.Sitting, PetPose.Walking, PetPose.Sleeping, PetPose.Held })
            {
                var cat = new CatVisual { Width = 320, Height = 288, Pose = pose, FacingRight = true, Time = 1.15 };
                cat.Measure(new Size(320, 288)); cat.Arrange(new Rect(0, 0, 320, 288)); cat.UpdateLayout();
                var bitmap = new RenderTargetBitmap(320, 288, 96, 96, PixelFormats.Pbgra32);
                bitmap.Render(cat);
                var pixels = new byte[320 * 288 * 4]; bitmap.CopyPixels(pixels, 320 * 4, 0);
                Require(pixels[3] == 0 && pixels[(288 * 320 - 1) * 4 + 3] == 0, "Preview corners must be transparent.");
                Require(Enumerable.Range(0, pixels.Length / 4).Count(p => pixels[p * 4 + 3] > 0) > 3000, "Cat drawing empty.");
                SavePng(bitmap, Path.Combine(output, pose.ToString().ToLowerInvariant() + ".png"));
                bitmapList.Add(bitmap);
            }
            var visual = new DrawingVisual();
            using (DrawingContext dc = visual.RenderOpen())
            {
                dc.DrawRoundedRectangle(new SolidColorBrush(Color.FromRgb(247, 241, 230)), null, new Rect(0, 0, 1280, 336), 16, 16);
                string[] labels = { "SIT", "WALK", "SLEEP", "DRAG & PLACE" };
                for (int i = 0; i < bitmapList.Count; i++)
                {
                    dc.DrawImage(bitmapList[i], new Rect(i * 320, 0, 320, 288));
                    var text = new FormattedText(labels[i], System.Globalization.CultureInfo.InvariantCulture, FlowDirection.LeftToRight,
                        new Typeface("Segoe UI"), 15, new SolidColorBrush(Color.FromRgb(89, 65, 54)), 1);
                    dc.DrawText(text, new Point(i * 320 + (320 - text.Width) / 2, 298));
                }
            }
            var sheet = new RenderTargetBitmap(1280, 336, 96, 96, PixelFormats.Pbgra32); sheet.Render(visual);
            SavePng(sheet, Path.Combine(output, "cat-preview.png"));
            var gaitSheet = new DrawingVisual();
            using (DrawingContext dc = gaitSheet.RenderOpen())
            {
                dc.DrawRectangle(new SolidColorBrush(Color.FromRgb(247, 241, 230)), null, new Rect(0, 0, 1280, 576));
                for (int i = 0; i < 20; i++)
                {
                    var cat = new CatVisual { Width = 320, Height = 288, Pose = PetPose.Walking, Time = .68 * i / 20 };
                    cat.Measure(new Size(320, 288)); cat.Arrange(new Rect(0, 0, 320, 288)); cat.UpdateLayout();
                    var frame = new DrawingVisual();
                    using (DrawingContext frameDc = frame.RenderOpen())
                    {
                        frameDc.DrawRectangle(new SolidColorBrush(Color.FromRgb(247, 241, 230)), null, new Rect(0, 0, 320, 288));
                        var catBitmap = new RenderTargetBitmap(320, 288, 96, 96, PixelFormats.Pbgra32); catBitmap.Render(cat);
                        frameDc.DrawImage(catBitmap, new Rect(0, 0, 320, 288));
                    }
                    var frameBitmap = new RenderTargetBitmap(320, 288, 96, 96, PixelFormats.Pbgra32); frameBitmap.Render(frame);
                    SavePng(frameBitmap, Path.Combine(output, $"walk-{i:00}.png"));
                    if (i % 3 == 0 || i == 19)
                    {
                        int slot = i == 19 ? 7 : i / 3;
                        dc.DrawImage(frameBitmap, new Rect(slot % 4 * 320, slot / 4 * 288, 320, 288));
                    }
                }
            }
            var gait = new RenderTargetBitmap(1280, 576, 96, 96, PixelFormats.Pbgra32); gait.Render(gaitSheet);
            SavePng(gait, Path.Combine(output, "walk-cycle.png"));
            lines.Add("PASS: all four poses rendered, transparent corners checked; PNG previews saved.");
            lines.Add("6 groups passed. Real pointer hit testing and dragging across mixed-DPI monitor boundaries require manual verification.");
            File.WriteAllLines(Path.Combine(output, "window-tests.txt"), lines);
            return 0;
        }
        catch (Exception e)
        {
            lines.Add("FAIL: " + e);
            File.WriteAllLines(Path.Combine(output, "window-tests.txt"), lines);
            return 1;
        }
    }

    private static void SavePng(BitmapSource bitmap, string path)
    {
        var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(bitmap));
        using var file = File.Create(path); encoder.Save(file);
    }
}
