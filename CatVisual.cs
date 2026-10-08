using System;
using System.Globalization;
using System.Windows;
using System.Windows.Media;

namespace Animo;

internal sealed class CatVisual : FrameworkElement
{
    private static readonly Brush Fur = Brush("#FFD99B");
    private static readonly Brush Cream = Brush("#FFF0D0");
    private static readonly Brush Stripe = Brush("#DE9959");
    private static readonly Brush Pink = Brush("#F3A2A3");
    private static readonly Brush Ink = Brush("#594136");
    private static readonly Brush Blush = Brush("#EFB3A0");
    private static readonly Brush Shadow = Brush("#18000000");
    private static readonly Brush FarFur = Brush("#E8BD80");
    private static readonly Pen FarOutline = Pen(Brush("#88634B"), 2.3);
    private static readonly Pen Outline = Pen(Ink, 2.8);
    private static readonly Pen Fine = Pen(Ink, 1.7);
    private static readonly Geometry Head = Geometry.Parse("M 76,48 L 75,24 Q 75,19 80,22 L 96,35 Q 107,32 116,36 L 129,22 Q 133,19 133,25 L 131,49 Q 140,61 134,78 Q 129,91 107,93 Q 83,92 76,78 Q 69,63 76,48 Z");
    public PetPose Pose { get; set; } = PetPose.Sitting;
    public bool FacingRight { get; set; } = true;
    public double Time { get; set; }

    private static SolidColorBrush Brush(string color)
    {
        var b = new SolidColorBrush((Color)ColorConverter.ConvertFromString(color)); b.Freeze(); return b;
    }
    private static Pen Pen(Brush brush, double width)
    {
        var p = new Pen(brush, width) { StartLineCap = PenLineCap.Round, EndLineCap = PenLineCap.Round, LineJoin = PenLineJoin.Round };
        p.Freeze(); return p;
    }
    private static void Path(DrawingContext dc, string data, Brush? fill, Pen? stroke) => dc.DrawGeometry(fill, stroke, Geometry.Parse(data));

    protected override void OnRender(DrawingContext dc)
    {
        base.OnRender(dc);
        dc.PushTransform(new ScaleTransform(ActualWidth / 160, ActualHeight / 144));
        if (!FacingRight) dc.PushTransform(new MatrixTransform(new Matrix(-1, 0, 0, 1, 160, 0)));
        double bob = Pose == PetPose.Walking ? Math.Cos(Time / .68 * Math.PI * 4) * .55 : Math.Sin(Time * 2) * .55;
        if (Pose != PetPose.Held)
            dc.DrawEllipse(Shadow, null, new Point(83, 132), Pose == PetPose.Sleeping ? 48 : 43, 3);
        dc.PushTransform(new TranslateTransform(0, bob));
        if (Pose == PetPose.Sleeping) DrawSleeping(dc);
        else DrawAwake(dc, bob);
        dc.Pop();
        if (!FacingRight) dc.Pop();
        dc.Pop();
    }

    private void DrawAwake(DrawingContext dc, double bob)
    {
        double sway = Math.Sin(Time * 2.5) * 6;
        string tail = FormattableString.Invariant($"M 43,100 C 13,99 15,{62 + sway} 28,{60 + sway}");
        Path(dc, tail, null, Pen(Ink, 15));
        Path(dc, tail, null, Pen(Fur, 10));
        if (Pose == PetPose.Sitting) DrawSeatedBody(dc, bob);
        else DrawStandingBody(dc, bob);
        dc.DrawGeometry(Fur, Outline, Head);
        Path(dc, "M 80,29 L 82,44 L 91,38 Z M 128,29 L 118,39 L 128,44 Z", Pink, null);
        dc.DrawEllipse(Cream, null, new Point(105, 79), 21, 11);
        Path(dc, "M 99,37 L 102,47 M 107,36 L 107,46 M 115,38 L 112,47", null, Pen(Stripe, 3.5));
        bool blink = Time % 5.3 < .16;
        if (blink)
        {
            Path(dc, "M 88,65 Q 93,70 98,65 M 114,65 Q 119,70 124,65", null, Fine);
        }
        else
        {
            dc.DrawEllipse(Ink, null, new Point(93, 65), 4.5, 6);
            dc.DrawEllipse(Ink, null, new Point(119, 65), 4.5, 6);
            dc.DrawEllipse(Brushes.White, null, new Point(94, 63), 1.5, 2);
            dc.DrawEllipse(Brushes.White, null, new Point(120, 63), 1.5, 2);
        }
        dc.DrawEllipse(Blush, null, new Point(85, 76), 5, 2.6);
        dc.DrawEllipse(Blush, null, new Point(128, 76), 5, 2.6);
        Path(dc, "M 102,74 Q 106,71 110,74 L 106,78 Z", Pink, null);
        Path(dc, "M 106,78 L 106,81 Q 102,86 99,81 M 106,81 Q 110,86 113,81", null, Fine);
        Path(dc, "M 87,78 L 70,75 M 87,82 L 71,85 M 124,78 L 141,75 M 124,82 L 141,85", null, Pen(Ink, 1.2));
    }

    private static Geometry Leg(Point shoulder, Point knee, Point ankle, Point foot)
    {
        // A continuous tapered leg and small rounded foot, rather than a detached oval paw.
        return Geometry.Parse(FormattableString.Invariant($"M {shoulder.X - 6},{shoulder.Y} Q {knee.X - 6},{knee.Y} {ankle.X - 4},{ankle.Y} Q {foot.X - 8},{foot.Y} {foot.X - 7},{foot.Y + 3} Q {foot.X - 6},{foot.Y + 5} {foot.X + 4},{foot.Y + 5} Q {foot.X + 11},{foot.Y + 5} {foot.X + 10},{foot.Y + 1} Q {foot.X + 9},{foot.Y - 2} {ankle.X + 4},{ankle.Y - 1} Q {knee.X + 5},{knee.Y - 1} {shoulder.X + 6},{shoulder.Y} Z"));
    }

    private static void Toes(DrawingContext dc, Point foot)
    {
        dc.DrawLine(Pen(Ink, 1.1), new Point(foot.X + 2, foot.Y + 2), new Point(foot.X + 2, foot.Y + 4));
        dc.DrawLine(Pen(Ink, 1.1), new Point(foot.X + 6, foot.Y + 2), new Point(foot.X + 6, foot.Y + 4));
    }

    private void DrawSeatedBody(DrawingContext dc, double bob)
    {
        Point backFoot = new(58, 124 - bob), frontFoot = new(107, 124 - bob);
        Geometry farLeg = Leg(new Point(94, 91), new Point(94, 108), new Point(92, 120 - bob), new Point(92, 123 - bob));
        dc.DrawGeometry(FarFur, FarOutline, farLeg);
        Geometry body = Geometry.Parse("M 39,120 C 30,104 39,84 55,75 C 72,66 87,71 96,86 Q 108,94 108,111 L 105,125 Q 76,131 52,128 Z");
        Geometry rearPaw = Geometry.Parse(FormattableString.Invariant($"M 44,114 Q 56,111 62,{backFoot.Y - 5} Q 70,{backFoot.Y - 4} 70,{backFoot.Y + 2} Q 69,{backFoot.Y + 5} 58,{backFoot.Y + 5} L 46,{backFoot.Y + 5} Q 39,{backFoot.Y + 1} 44,114 Z"));
        Geometry frontLeg = Leg(new Point(105, 90), new Point(103, 107), new Point(104, 120 - bob), frontFoot);
        Geometry silhouette = Geometry.Combine(Geometry.Combine(body, rearPaw, GeometryCombineMode.Union, null), frontLeg, GeometryCombineMode.Union, null);
        dc.DrawGeometry(Fur, Outline, silhouette);
        dc.PushClip(silhouette);
        dc.DrawEllipse(Cream, null, new Point(94, 101), 16, 22);
        dc.Pop();
        Path(dc, "M 44,100 C 58,96 69,104 64,115 Q 62,119 57,120", null, Pen(Ink, 1.9));
        Path(dc, "M 47,80 Q 48,87 55,90 M 60,73 Q 61,82 67,85", null, Pen(Stripe, 4));
        Toes(dc, backFoot);
        Toes(dc, frontFoot);
    }

    private (Geometry Shape, Point Foot) WalkingLeg(double hipX, bool rear, double phase, double bob)
    {
        double stride = (Time / .68 + phase) % 1;
        double offset, lift;
        if (Pose == PetPose.Held)
        {
            offset = Math.Sin(Time * 2 + phase * Math.PI * 2) * 1.5;
            lift = -6;
        }
        else if (stride < .64)
        {
            // During contact the foot moves back relative to the advancing body.
            offset = 11 - 22 * stride / .64;
            lift = 0;
        }
        else
        {
            double swing = (stride - .64) / .36;
            offset = -11 + 22 * (1 - Math.Cos(swing * Math.PI)) / 2;
            lift = 7 * Math.Sin(swing * Math.PI);
        }
        double footX = hipX + offset + (rear ? -2 : 2);
        // Cancel torso bounce for planted paws so the feet stay on the floor.
        Point foot = new(footX, 124 - bob - lift);
        Point knee = new(hipX + offset * .3 + (rear ? 5 : -2), 111 - lift * .25);
        Point ankle = new(footX + (rear ? -3 : -1), foot.Y - 4);
        return (Leg(new Point(hipX, 96), knee, ankle, foot), foot);
    }

    private void DrawStandingBody(DrawingContext dc, double bob)
    {
        // Four legs take separate steps, with the far pair shaded behind the torso.
        var farRear = WalkingLeg(60, true, .75, bob);
        var farFront = WalkingLeg(94, false, .5, bob);
        dc.DrawGeometry(FarFur, FarOutline, farRear.Shape);
        dc.DrawGeometry(FarFur, FarOutline, farFront.Shape);
        var nearRear = WalkingLeg(48, true, .25, bob);
        var nearFront = WalkingLeg(107, false, 0, bob);
        Geometry body = Geometry.Parse("M 35,92 C 35,75 54,65 78,69 C 96,70 111,81 112,96 Q 111,112 88,113 L 57,113 Q 36,111 35,92 Z");
        Geometry silhouette = Geometry.Combine(Geometry.Combine(body, nearRear.Shape, GeometryCombineMode.Union, null), nearFront.Shape, GeometryCombineMode.Union, null);
        dc.DrawGeometry(Fur, Outline, silhouette);
        dc.PushClip(silhouette);
        dc.DrawEllipse(Cream, null, new Point(88, 99), 21, 18);
        dc.Pop();
        Path(dc, "M 45,91 Q 60,89 62,103", null, Pen(Ink, 1.7));
        Path(dc, "M 46,76 Q 49,85 56,87 M 59,70 Q 61,80 68,82", null, Pen(Stripe, 4));
        Toes(dc, nearRear.Foot);
        Toes(dc, nearFront.Foot);
    }

    private void DrawSleeping(DrawingContext dc)
    {
        dc.DrawEllipse(Fur, Outline, new Point(76, 105), 45, 24);
        Path(dc, "M 49,86 Q 50,96 57,99 M 61,82 Q 62,93 68,95", null, Pen(Stripe, 5));
        Path(dc, "M 88,96 L 90,77 L 103,87 L 119,82 L 119,97 Q 129,106 123,115 Q 113,125 94,118 Q 80,111 88,96 Z", Fur, Outline);
        Path(dc, "M 93,83 L 94,92 L 100,89 Z", Pink, null);
        Path(dc, "M 92,104 Q 97,109 102,104 M 111,104 Q 116,109 121,103", null, Fine);
        Path(dc, "M 104,111 L 108,114 L 112,110", Pink, null);
        Path(dc, "M 38,109 C 44,134 92,129 88,117 C 86,111 72,112 64,116", null, Pen(Ink, 15));
        Path(dc, "M 38,109 C 44,134 92,129 88,117 C 86,111 72,112 64,116", null, Pen(Fur, 10));
        var text = new FormattedText("z", CultureInfo.InvariantCulture, FlowDirection.LeftToRight,
            new Typeface("Segoe UI"), 14, Stripe, VisualTreeHelper.GetDpi(this).PixelsPerDip);
        dc.DrawText(text, new Point(129, 72 - Math.Sin(Time) * 3));
        dc.DrawText(text, new Point(139, 59 - Math.Sin(Time + 1) * 3));
    }
}
