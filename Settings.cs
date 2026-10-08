using System;
using System.IO;
using System.Text.Json;

namespace Animo;

internal sealed class Settings
{
    public string Monitor { get; set; } = "";
    public double RelativeX { get; set; } = .65;
    public double RelativeY { get; set; } = 1;
    public double Size { get; set; } = 1;
    public bool Roaming { get; set; } = true;
    public bool FloorOnly { get; set; } = true;
    public bool ClickThrough { get; set; }
    public static string DirectoryPath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Animo");

    public void Validate()
    {
        Monitor ??= "";
        RelativeX = double.IsFinite(RelativeX) ? Math.Clamp(RelativeX, 0, 1) : .65;
        RelativeY = double.IsFinite(RelativeY) ? Math.Clamp(RelativeY, 0, 1) : 1;
        Size = double.IsFinite(Size) ? Math.Clamp(Size, .65, 1.5) : 1;
    }

    public static Settings Load(string? path = null)
    {
        try
        {
            var settings = JsonSerializer.Deserialize<Settings>(File.ReadAllText(path ?? Path.Combine(DirectoryPath, "settings.json"))) ?? new Settings();
            settings.Validate();
            return settings;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException) { return new Settings(); }
    }

    public bool Save(string? path = null)
    {
        try
        {
            path ??= Path.Combine(DirectoryPath, "settings.json");
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
            Validate();
            string temp = path + ".tmp";
            File.WriteAllText(temp, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
            File.Move(temp, path, true);
            return true;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return false; }
    }
}
