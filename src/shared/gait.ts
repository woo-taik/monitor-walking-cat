import type { Pose } from './types.js';
export function legStep(time: number, phase: number, pose: Pose) {
  if (pose === 'held') return { offset: Math.sin(time * 2 + phase * Math.PI * 2) * 1.5, lift: -6 };
  const stride = ((time / .68 + phase) % 1 + 1) % 1;
  if (stride < .64) return { offset: 11 - 22 * stride / .64, lift: 0 };
  const swing = (stride - .64) / .36;
  return { offset: -11 + 11 * (1 - Math.cos(swing * Math.PI)), lift: 7 * Math.sin(swing * Math.PI) };
}
