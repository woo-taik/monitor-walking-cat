import type { Pose } from './types.js';

export const PAW_DURATION = 1.3;
export const PAW_STRIKE_TIME = .58;
// Front-paw keyframes in the cat's own 160x144 view box: sit, cock the paw back and
// high, drive it through the cursor, follow through, then set it down again.
const PAW_KEYS = [
  { t: 0, x: 107, y: 124 },
  { t: .40, x: 97, y: 99 },
  { t: PAW_STRIKE_TIME, x: 146, y: 101 },
  { t: .80, x: 130, y: 114 },
  { t: PAW_DURATION, x: 107, y: 124 }
];
export function pawReach(poseTime: number) {
  const time = Math.max(0, Math.min(PAW_DURATION, poseTime));
  let i = 0;
  while (i < PAW_KEYS.length - 2 && time > PAW_KEYS[i + 1].t) i++;
  const from = PAW_KEYS[i], to = PAW_KEYS[i + 1], span = to.t - from.t;
  // Equal-time keyframes with cosine easing: the short strike segment reads as a snap.
  const ease = (1 - Math.cos((span > 0 ? Math.min(1, (time - from.t) / span) : 1) * Math.PI)) / 2;
  return { x: from.x + (to.x - from.x) * ease, y: from.y + (to.y - from.y) * ease };
}
/** Visibility of the swipe streaks; stays a single expression so the node tree never changes mid-pose. */
export function pawSwishFade(poseTime: number) {
  const k = (poseTime - .40) / .36;
  return k <= 0 || k >= 1 ? 0 : Math.sin(k * Math.PI);
}
export function legStep(time: number, phase: number, pose: Pose) {
  if (pose === 'held') return { offset: Math.sin(time * 2 + phase * Math.PI * 2) * 1.5, lift: -6 };
  const stride = ((time / .68 + phase) % 1 + 1) % 1;
  if (stride < .64) return { offset: 11 - 22 * stride / .64, lift: 0 };
  const swing = (stride - .64) / .36;
  return { offset: -11 + 11 * (1 - Math.cos(swing * Math.PI)), lift: 7 * Math.sin(swing * Math.PI) };
}
