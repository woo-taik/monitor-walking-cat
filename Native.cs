using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace Animo;

internal sealed record MonitorInfo(string Device, Area WorkArea, bool Primary);

internal static class Native
{
    public const int GwlExStyle = -20;
    public const long NoActivate = 0x08000000, ToolWindow = 0x80, Transparent = 0x20;
    private const uint NoSize = 1, NoZOrder = 4, NoActivation = 0x10;
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct MonitorData
    {
        public int Size;
        public Rect Monitor, Work;
        public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string Device;
    }
    private delegate bool MonitorCallback(nint monitor, nint dc, ref Rect rect, nint data);
    [DllImport("user32.dll")] private static extern bool EnumDisplayMonitors(nint dc, nint clip, MonitorCallback callback, nint data);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool GetMonitorInfo(nint monitor, ref MonitorData info);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(nint hwnd, out Rect rect);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(nint hwnd);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern nint GetWindowLongPtr(nint hwnd, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] public static extern nint SetWindowLongPtr(nint hwnd, int index, nint value);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(nint hwnd, nint insertAfter, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] public static extern bool RegisterHotKey(nint hwnd, int id, uint modifiers, uint key);
    [DllImport("user32.dll")] public static extern bool UnregisterHotKey(nint hwnd, int id);
    [DllImport("user32.dll")] public static extern bool DestroyIcon(nint icon);
    [DllImport("user32.dll")] public static extern nint GetForegroundWindow();
    public static void Move(nint hwnd, double x, double y) => SetWindowPos(hwnd, 0, (int)Math.Round(x), (int)Math.Round(y), 0, 0, NoSize | NoZOrder | NoActivation);
    public static IReadOnlyList<MonitorInfo> Monitors()
    {
        var list = new List<MonitorInfo>();
        EnumDisplayMonitors(0, 0, (nint monitor, nint dc, ref Rect rect, nint data) =>
        {
            var info = new MonitorData { Size = Marshal.SizeOf<MonitorData>(), Device = "" };
            if (GetMonitorInfo(monitor, ref info)) list.Add(new MonitorInfo(info.Device,
                new Area(info.Work.Left, info.Work.Top, info.Work.Right, info.Work.Bottom), (info.Flags & 1) != 0));
            return true;
        }, 0);
        if (list.Count == 0) list.Add(new MonitorInfo("default", new Area(0, 0, 1920, 1080), true));
        return list;
    }
}
