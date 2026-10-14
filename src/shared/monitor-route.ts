import { clampPosition } from './brain.js';
import type { Bounds, Point } from './types.js';

export interface TravelDisplay { id: number; bounds: Bounds; workArea: Bounds }
export interface TravelWaypoint { displayId: number; point: Point }
const center = (area: Bounds) => ({ x: area.x + area.width / 2, y: area.y + area.height / 2 });
const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

export function desktopBounds(displays: TravelDisplay[]): Bounds {
  if (!displays.length) throw new Error('No displays available for travel.');
  const x = Math.min(...displays.map(d => d.workArea.x)), y = Math.min(...displays.map(d => d.workArea.y));
  return { x, y, width: Math.max(...displays.map(d => d.workArea.x + d.workArea.width)) - x,
    height: Math.max(...displays.map(d => d.workArea.y + d.workArea.height)) - y };
}

function gap(a: Bounds, b: Bounds) {
  return Math.hypot(Math.max(0, a.x - b.x - b.width, b.x - a.x - a.width),
    Math.max(0, a.y - b.y - b.height, b.y - a.y - a.height));
}

// Prefer touching displays over crossing empty desktop space. Among routes with
// the same gap, choose the shorter one. This also handles vertical/L layouts.
function displayPath(displays: TravelDisplay[], from: number, to: number) {
  const costs = new Map<number, { gap: number; length: number }>([[from, { gap: 0, length: 0 }]]);
  const previous = new Map<number, number>(), remaining = new Set(displays.map(d => d.id));
  const better = (a: { gap: number; length: number }, b?: { gap: number; length: number }) => !b || a.gap < b.gap || (a.gap === b.gap && a.length < b.length);
  while (remaining.size) {
    let id: number | undefined;
    for (const candidate of remaining) if (costs.has(candidate) && (id === undefined || better(costs.get(candidate)!, costs.get(id)))) id = candidate;
    if (id === undefined || id === to) break;
    remaining.delete(id);
    const source = displays.find(d => d.id === id)!, cost = costs.get(id)!;
    for (const target of displays.filter(d => remaining.has(d.id))) {
      const next = { gap: cost.gap + gap(source.bounds, target.bounds), length: cost.length + distance(center(source.bounds), center(target.bounds)) };
      if (better(next, costs.get(target.id))) { costs.set(target.id, next); previous.set(target.id, id); }
    }
  }
  const ids = [to];
  while (ids[0] !== from) {
    const prior = previous.get(ids[0]);
    if (prior === undefined) throw new Error('Travel display is unavailable.');
    ids.unshift(prior);
  }
  return ids.map(id => displays.find(d => d.id === id)!);
}

function centerArea(area: Bounds, width: number, height: number): Bounds {
  return { x: area.x + width / 2, y: area.y + height / 2, width: Math.max(0, area.width - width), height: Math.max(0, area.height - height) };
}
function crossing(a: Bounds, b: Bounds, current: Point) {
  const axis = (lowA: number, highA: number, lowB: number, highB: number, preferred: number) => {
    if (highA < lowB) return [highA, lowB];
    if (highB < lowA) return [lowA, highB];
    const shared = Math.max(Math.max(lowA, lowB), Math.min(Math.min(highA, highB), preferred));
    return [shared, shared];
  };
  const [ax, bx] = axis(a.x, a.x + a.width, b.x, b.x + b.width, current.x);
  const [ay, by] = axis(a.y, a.y + a.height, b.y, b.y + b.height, current.y);
  return [{ x: ax, y: ay }, { x: bx, y: by }];
}

/** Window positions for walking across display boundaries, without teleporting. */
export function monitorRoute(displays: TravelDisplay[], from: number, to: number, start: Point, destination: Point, width: number, height: number): TravelWaypoint[] {
  if (!displays.some(d => d.id === from) || !displays.some(d => d.id === to)) throw new Error('Travel display is unavailable.');
  const screens = displayPath(displays, from, to), waypoints: TravelWaypoint[] = [];
  let current = { x: start.x + width / 2, y: start.y + height / 2 };
  for (let i = 1; i < screens.length; i++) {
    const points = crossing(centerArea(screens[i - 1].workArea, width, height), centerArea(screens[i].workArea, width, height), current);
    for (let j = 0; j < points.length; j++) waypoints.push({ displayId: screens[i - 1 + j].id, point: { x: points[j].x - width / 2, y: points[j].y - height / 2 } });
    current = points[1];
  }
  waypoints.push({ displayId: to, point: clampPosition(destination.x, destination.y, screens.at(-1)!.workArea, width, height) });
  return waypoints;
}
