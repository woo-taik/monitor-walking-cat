import type { Pose } from './types.js';

export function frameInterval(pose: Pose, frozen: boolean, inactive: boolean, battery: boolean) {
  if (inactive) return 1000;
  if (frozen) return 100;
  if (pose === 'sleeping') return battery ? 250 : 200;
  if (pose === 'sitting') return battery ? 150 : 100;
  return battery ? 66 : 33;
}
