using System;
using System.IO;
using System.Threading;
using System.Windows;

namespace Animo;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        bool smoke = Array.IndexOf(args, "--smoke-test") >= 0;
        string output = Path.Combine(AppContext.BaseDirectory, "verification");
        int index = Array.IndexOf(args, "--output");
        if (index >= 0 && index + 1 < args.Length) output = Path.GetFullPath(args[index + 1]);
        if (Array.IndexOf(args, "--self-test") >= 0) return Verification.RunCore(output);

        using var mutex = new Mutex(true, "Local\\Animo.DesktopCat", out bool first);
        if (!first && !smoke) return 0;
        var app = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
        app.DispatcherUnhandledException += (_, e) =>
        {
            try
            {
                Directory.CreateDirectory(Settings.DirectoryPath);
                File.AppendAllText(Path.Combine(Settings.DirectoryPath, "error.log"), $"{DateTimeOffset.Now:O}\n{e.Exception}\n");
            }
            catch { }
            if (!smoke) MessageBox.Show("실행 중 오류가 발생했습니다. Animo를 다시 실행해 주세요.\n" + e.Exception.Message, "Animo");
            e.Handled = true;
            app.Shutdown(1);
        };
        var window = new PetWindow(smoke ? new Settings() : Settings.Load(), smoke, output);
        return app.Run(window);
    }
}
