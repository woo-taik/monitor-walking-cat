import type { Bounds, Pose } from './types.js';
export function clampPosition(x: number, y: number, bounds: Bounds, width: number, height: number) {
  return {
    x: Math.max(bounds.x, Math.min(Number.isFinite(x) ? x : bounds.x, bounds.x + Math.max(0, bounds.width - width))),
    y: Math.max(bounds.y, Math.min(Number.isFinite(y) ? y : bounds.y, bounds.y + Math.max(0, bounds.height - height)))
  };
}
export class PetBrain {
  x = 0; y = 0; width = 160; height = 144;
  roaming = true; floorOnly = true; facingRight = true; pose: Pose = 'sitting';
  private remaining = 2;
  private target = { x: 0, y: 0 };
  constructor(public bounds: Bounds, private random: () => number = Math.random) {
    this.setPosition(bounds.x + bounds.width * .65, bounds.y + bounds.height - this.height);
  }
  setPosition(x: number, y: number) { const p = clampPosition(x, y, this.bounds, this.width, this.height); this.x = p.x; this.y = p.y; }
  setBounds(bounds: Bounds) { this.bounds = bounds; this.setPosition(this.x, this.y); if (this.pose === 'walking') this.rest(); }
  pin(x = this.x, y = this.y) { this.roaming = false; this.setPosition(x, y); this.rest(); }
  hold() { this.roaming = false; this.pose = 'held'; }
  setRoaming(roaming: boolean) { this.roaming = roaming; this.rest(); this.remaining = roaming ? .4 : 3; }
  private rest() { this.pose = 'sitting'; this.remaining = 3 + this.random() * 5; }
  tick(seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0 || this.pose === 'held') return;
    seconds = Math.min(seconds, .1);
    this.remaining -= seconds;
    if (this.pose === 'walking') {
      const dx = this.target.x - this.x, dy = this.target.y - this.y;
      const distance = Math.hypot(dx, dy), step = 52 * (this.width / 160) * seconds;
      if (distance <= step || this.remaining <= 0) { this.setPosition(this.target.x, this.target.y); this.rest(); }
      else this.setPosition(this.x + dx / distance * step, this.y + dy / distance * step);
    } else if (this.remaining <= 0) {
      if (this.pose === 'sleeping') this.rest();
      else if (this.roaming && this.random() > .25) {
        this.target = {
          x: this.bounds.x + this.random() * Math.max(0, this.bounds.width - this.width),
          y: this.floorOnly ? this.bounds.y + Math.max(0, this.bounds.height - this.height)
            : this.bounds.y + this.random() * Math.max(0, this.bounds.height - this.height)
        };
        this.facingRight = this.target.x >= this.x; this.pose = 'walking';
        this.remaining = Math.hypot(this.target.x - this.x, this.target.y - this.y) / (52 * this.width / 160) + 1;
      } else { this.pose = 'sleeping'; this.remaining = 8 + this.random() * 10; }
    }
  }
}
