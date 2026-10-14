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
 * Stand beside the cursor facing toward the screen's center. At an edge, use
 * the reachable side so the cat stays on screen and can still touch the cursor.
 * The errand ignores `floorOnly`: a cat kept to the bottom strip could never reach a cursor further
 * up, and it walks back to its own spot as soon as the shove is done.
 */
export function approachTarget(cursor: Point, bounds: Bounds, width: number, height: number, screenBounds = bounds) {
  const facingRight = pushesRight(cursor, screenBounds);
  const target = (right: boolean) => ({ point: clampPosition(cursor.x - width * (right ? PAW_X : 1 - PAW_X), cursor.y - height * PAW_Y, bounds, width, height), facingRight: right });
  const preferred = target(facingRight);
  if (inPushRange(pawPoint(preferred.point, width, height, facingRight), cursor, width / 160)) return preferred;
  const alternate = target(!facingRight);
  return inPushRange(pawPoint(alternate.point, width, height, !facingRight), cursor, width / 160) ? alternate : preferred;
}

function pushesRight(cursor: Point, bounds: Bounds) { return cursor.x < bounds.x + bounds.width / 2; }

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

/** Only shove after the travelling cat's paw is actually within reach. */
export function inPushRange(paw: Point, cursor: Point, scale: number) {
  return Math.hypot(cursor.x - paw.x, cursor.y - paw.y) <= 46 * scale;
}

/** Push toward the screen's center, with a small lift and an eased landing. */
export function pushPath(cursor: Point, bounds: Bounds): Point[] {
  const direction = pushesRight(cursor, bounds) ? 1 : -1;
  const path: Point[] = [];
  for (let i = 1; i <= PUSH_STEPS; i++) {
    const t = i / PUSH_STEPS, ease = 1 - (1 - t) * (1 - t);
    path.push({
      x: clamp(cursor.x + direction * PUSH_DISTANCE * ease, bounds.x + 2, bounds.x + bounds.width - 2),
      y: clamp(cursor.y - Math.sin(Math.PI * t) * PUSH_LIFT, bounds.y + 2, bounds.y + bounds.height - 2)
    });
  }
  return path;
}
