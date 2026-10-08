using System;

namespace Animo;

internal readonly record struct Area(double Left, double Top, double Right, double Bottom)
{
    public double Width => Math.Max(0, Right - Left);
    public double Height => Math.Max(0, Bottom - Top);
    public (double X, double Y) Clamp(double x, double y, double width, double height) =>
        (Math.Clamp(x, Left, Math.Max(Left, Right - width)), Math.Clamp(y, Top, Math.Max(Top, Bottom - height)));
}

internal enum PetPose { Sitting, Walking, Sleeping, Held }

internal sealed class PetBrain
{
    private readonly Random random;
    private double remaining = 2;
    private double targetX;
    private double targetY;
    public double X { get; private set; }
    public double Y { get; private set; }
    public bool Roaming { get; private set; } = true;
    public bool FloorOnly { get; set; } = true;
    public bool FacingRight { get; private set; } = true;
    public PetPose Pose { get; private set; } = PetPose.Sitting;
    public double Width { get; set; } = 160;
    public double Height { get; set; } = 144;
    public double Scale { get; set; } = 1;
    public Area Bounds { get; private set; }

    public PetBrain(Area bounds, int? seed = null)
    {
        Bounds = bounds;
        random = seed is int value ? new Random(value) : new Random();
        SetPosition(bounds.Left + bounds.Width * .65, bounds.Bottom - Height);
    }

    public void SetBounds(Area bounds)
    {
        Bounds = bounds;
        SetPosition(X, Y);
        if (Pose == PetPose.Walking) Rest();
    }

    public void SetPosition(double x, double y)
    {
        if (!double.IsFinite(x)) x = Bounds.Left;
        if (!double.IsFinite(y)) y = Bounds.Top;
        (X, Y) = Bounds.Clamp(x, y, Width, Height);
    }

    public void Pin(double x, double y)
    {
        Roaming = false;
        SetPosition(x, y);
        Rest();
    }

    public void BeginHold()
    {
        Roaming = false;
        Pose = PetPose.Held;
    }

    public void SetRoaming(bool roaming)
    {
        Roaming = roaming;
        Rest();
        remaining = roaming ? .4 : 3;
    }

    private void Rest()
    {
        Pose = PetPose.Sitting;
        remaining = 3 + random.NextDouble() * 5;
    }

    public void Tick(double seconds)
    {
        if (!double.IsFinite(seconds) || seconds <= 0 || Pose == PetPose.Held) return;
        seconds = Math.Min(seconds, .1);
        remaining -= seconds;
        if (Pose == PetPose.Walking)
        {
            double dx = targetX - X, dy = targetY - Y;
            double distance = Math.Sqrt(dx * dx + dy * dy);
            double step = 52 * Scale * seconds;
            if (distance <= step || remaining <= 0) { SetPosition(targetX, targetY); Rest(); }
            else SetPosition(X + dx / distance * step, Y + dy / distance * step);
        }
        else if (remaining <= 0)
        {
            if (Pose == PetPose.Sleeping) Rest();
            else if (Roaming && random.NextDouble() > .25)
            {
                targetX = Bounds.Left + random.NextDouble() * Math.Max(0, Bounds.Width - Width);
                targetY = FloorOnly ? Math.Max(Bounds.Top, Bounds.Bottom - Height)
                    : Bounds.Top + random.NextDouble() * Math.Max(0, Bounds.Height - Height);
                FacingRight = targetX >= X;
                Pose = PetPose.Walking;
                double dx = targetX - X, dy = targetY - Y;
                remaining = Math.Sqrt(dx * dx + dy * dy) / (52 * Scale) + 1;
            }
            else { Pose = PetPose.Sleeping; remaining = 8 + random.NextDouble() * 10; }
        }
    }
}
