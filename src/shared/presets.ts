import { clampPosition } from './brain.js';
import type { Anchor, Bounds, Point, PositionPreset } from './types.js';
export interface MonitorArea { id: string; workArea: Bounds }
export function relativePosition(point: Point, area: Bounds, width: number, height: number) {
  const p = clampPosition(point.x, point.y, area, width, height);
  return { relativeX: (p.x - area.x) / Math.max(1, area.width - width), relativeY: (p.y - area.y) / Math.max(1, area.height - height) };
}
export function anchorPosition(anchor: Anchor, area: Bounds, width: number, height: number) {
  const ratio = anchor === 'bottom-left' ? 0 : anchor === 'bottom-center' ? .5 : 1;
  return clampPosition(area.x + Math.max(0, area.width - width) * ratio, area.y + Math.max(0, area.height - height), area, width, height);
}
export function resolvePreset(preset: PositionPreset, displays: MonitorArea[], primaryId: string, width: number, height: number) {
  const original = displays.find(d => d.id === preset.displayId);
  const display = original ?? displays.find(d => d.id === primaryId) ?? displays[0];
  if (!display) throw new Error('사용 가능한 모니터가 없습니다.');
  const a = display.workArea;
  const point = clampPosition(a.x + Math.max(0, a.width - width) * preset.relativeX, a.y + Math.max(0, a.height - height) * preset.relativeY, a, width, height);
  return { displayId: display.id, point, fallback: !original };
}
