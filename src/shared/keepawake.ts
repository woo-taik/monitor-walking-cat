import { clampPosition } from './brain.js';
import type { Bounds, Point } from './types.js';

// Moving the cursor does not reset the system idle timer on either OS, so the
// power blocker is what actually holds the screen saver off. The cat walking
// over and shoving the pointer is the visible half of the same setting.
export const NUDGE_IDLE_SECONDS = 45;
export const NUDGE_INTERVAL_SECONDS = 60;
const WALK_SPEED = 52;
const PUSH_DISTANCE = 28;
const PUSH_STEPS = 18;
const PUSH_LIFT = 6;
const PAW_X = .86, PAW_Y = .72;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(value, high));

/** Only leave for the cursor once the desk has really been left alone. */
export function wantsNudge(o: { enabled: boolean; busy: boolean; idleSeconds: number; sinceNudge: number }) {
  return o.enabled && !o.busy && o.idleSeconds >= NUDGE_IDLE_SECONDS && o.sinceNudge >= NUDGE_INTERVAL_SECONDS;
}

/**
 * Stand beside the cursor with the paws at its height, approaching from whichever side has room.
 * The errand ignores `floorOnly`: a cat kept to the bottom strip could never reach a cursor further
 * up, and it walks back to its own spot as soon as the shove is done.
 */
export function approachTarget(cursor: Point, bounds: Bounds, width: number, height: number) {
  const facingRight = cursor.x - width >= bounds.x;
  const x = cursor.x - width * (facingRight ? PAW_X : 1 - PAW_X);
  return { point: clampPosition(x, cursor.y - height * PAW_Y, bounds, width, height), facingRight };
}

/**
 * How long one leg of the errand may take before the cat gives up: twice the ideal
 * walk plus the acceleration ramp, so the allowance grows with the screen instead of
 * cutting a long crossing short.
 */
export function legTimeout(from: Point, to: Point, scale: number) {
  return 5 + 2 * Math.hypot(to.x - from.x, to.y - from.y) / (WALK_SPEED * Math.max(.1, scale));
}

/** The front paw that reaches the cursor. */
export function pawPoint(cat: Point, width: number, height: number, facingRight: boolean): Point {
  return { x: cat.x + width * (facingRight ? PAW_X : 1 - PAW_X), y: cat.y + height * PAW_Y };
}

/** A cursor on another monitor stays out of reach; skip the shove instead of lunging at it. */
export function inPushRange(paw: Point, cursor: Point, scale: number) {
  return Math.hypot(cursor.x - paw.x, cursor.y - paw.y) <= 46 * scale;
}

/** Cursor positions for one shove: away from the paw, lifted slightly, easing out. */
export function pushPath(paw: Point, cursor: Point, bounds: Bounds): Point[] {
  const dx = cursor.x - paw.x, dy = cursor.y - paw.y, length = Math.hypot(dx, dy);
  const ux = length > 1 ? dx / length : 1, uy = length > 1 ? dy / length : 0;
  const path: Point[] = [];
  for (let i = 1; i <= PUSH_STEPS; i++) {
    const t = i / PUSH_STEPS, ease = 1 - (1 - t) * (1 - t);
    path.push({
      x: clamp(cursor.x + ux * PUSH_DISTANCE * ease, bounds.x + 2, bounds.x + bounds.width - 2),
      y: clamp(cursor.y + uy * PUSH_DISTANCE * ease - Math.sin(Math.PI * t) * PUSH_LIFT, bounds.y + 2, bounds.y + bounds.height - 2)
    });
  }
  return path;
}
