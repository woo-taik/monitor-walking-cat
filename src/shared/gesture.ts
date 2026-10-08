import type { Point } from './types.js';

// Distances are CSS/DIP pixels, so the same gestures work at different DPI scales.
export class PetGesture {
  private origin?: Point;
  private previous?: Point;
  private distance = 0;
  private dragging = false;
  private lastStroke = -Infinity;
  begin(point: Point) { this.origin = point; this.dragging = false; this.resetStroke(); }
  move(point: Point, overCat: boolean, now: number): 'drag' | 'stroke' | undefined {
    if (this.origin) {
      if (!this.dragging && Math.hypot(point.x - this.origin.x, point.y - this.origin.y) >= 5) {
        this.dragging = true; return 'drag';
      }
      return;
    }
    if (!overCat) { this.resetStroke(); return; }
    if (this.previous) this.distance += Math.min(15, Math.hypot(point.x - this.previous.x, point.y - this.previous.y));
    this.previous = point;
    if (this.distance >= 40 && now - this.lastStroke >= 1000) {
      this.distance = 0; this.lastStroke = now; return 'stroke';
    }
  }
  release(overCat: boolean): 'pet' | 'drop' | undefined {
    const action = this.origin ? this.dragging ? 'drop' : overCat ? 'pet' : undefined : undefined;
    this.cancel(); return action;
  }
  cancel() { this.origin = undefined; this.dragging = false; this.resetStroke(); }
  private resetStroke() { this.previous = undefined; this.distance = 0; }
}
