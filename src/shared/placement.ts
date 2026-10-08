import type { Bounds, Point } from './types.js';
// Electron's menu popup coordinates are relative to the owning window's origin.
// Clamp in screen DIPs first, then convert once into local coordinates.
export function menuPoint(point: Point, window: Bounds, workArea: Bounds): Point {
  return {
    x: Math.round(Math.max(workArea.x, Math.min(workArea.x + workArea.width - 1, point.x)) - window.x),
    y: Math.round(Math.max(workArea.y, Math.min(workArea.y + workArea.height - 1, point.y)) - window.y)
  };
}
