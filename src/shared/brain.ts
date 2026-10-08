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
  poseTime = 0; gaitTime = 0; speed = 0;
  private remaining = 2;
  private petCooldown = 0;
  private target = { x: 0, y: 0 };
  constructor(public bounds: Bounds, private random: () => number = Math.random) {
    this.setPosition(bounds.x + bounds.width * .65, bounds.y + bounds.height - this.height);
  }
  setPosition(x: number, y: number) { const p = clampPosition(x, y, this.bounds, this.width, this.height); this.x = p.x; this.y = p.y; }
  setBounds(bounds: Bounds) { this.bounds = bounds; this.setPosition(this.x, this.y); if (this.pose === 'walking') this.rest(); }
  pin(x = this.x, y = this.y) { this.roaming = false; this.setPosition(x, y); this.rest(); }
  hold() { this.roaming = false; this.changePose('held', 0); }
  setRoaming(roaming: boolean) { this.roaming = roaming; this.rest(); this.remaining = roaming ? .4 : 3; }
  private changePose(pose: Pose, duration: number) { this.pose = pose; this.poseTime = 0; this.remaining = duration; this.speed = 0; }
  private rest() { this.changePose('sitting', 3 + this.random() * 5); }
  pet() {
    if (this.pose === 'held' || this.petCooldown > 0) return false;
    this.petCooldown = 6; this.changePose('petted', 2.4); return true;
  }
  tick(seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0 || this.pose === 'held') return;
    seconds = Math.min(seconds, .25);
    this.poseTime += seconds;
    this.petCooldown = Math.max(0, this.petCooldown - seconds);
    this.remaining -= seconds;
    if (this.pose === 'walking') {
      const dx = this.target.x - this.x, dy = this.target.y - this.y;
      const scale = this.width / 160, distance = Math.hypot(dx, dy), acceleration = 150 * scale;
      const desired = Math.min(52 * scale, Math.sqrt(2 * acceleration * distance));
      this.speed += Math.max(-acceleration * seconds, Math.min(acceleration * seconds, desired - this.speed));
      const step = Math.min(distance, this.speed * seconds);
      this.gaitTime += step / (52 * scale);
      if (distance <= Math.max(.2 * scale, step)) { this.setPosition(this.target.x, this.target.y); this.rest(); }
      else this.setPosition(this.x + dx / distance * step, this.y + dy / distance * step);
    } else if (this.remaining <= 0) {
      if (['sleeping', 'grooming', 'stretching', 'petted'].includes(this.pose)) this.rest();
      else if (this.roaming && this.random() > .25) {
        this.target = {
          x: this.bounds.x + this.random() * Math.max(0, this.bounds.width - this.width),
          y: this.floorOnly ? this.bounds.y + Math.max(0, this.bounds.height - this.height)
            : this.bounds.y + this.random() * Math.max(0, this.bounds.height - this.height)
        };
        this.facingRight = this.target.x >= this.x; this.changePose('walking', 0); this.gaitTime = 0;
      } else {
        const choice = this.random();
        if (choice < .3) this.changePose('stretching', 3);
        else if (choice < .65) this.changePose('grooming', 4.5);
        else this.changePose('sleeping', 8 + this.random() * 10);
      }
    }
  }
}
