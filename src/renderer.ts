import { catFrame, type CatFrame } from './cat.js';
import { PetGesture } from './shared/gesture.js';
import type { PetAPI, PetState, Point } from './shared/types.js';
type Stats = { builds: number; updates: number; attributeWrites: number; skipped: number };
declare global { interface Window { animo?: PetAPI; animoPreview?: { render: (state: Partial<PetState>, immediate?: boolean) => void; hit: (x: number, y: number) => boolean; getState: () => PetState; stats: () => Stats }; } }
const root = document.getElementById('pet')!;
let state: PetState = { pose: 'sitting', facingRight: true, time: 1, size: 1, clickThrough: false, frozen: false, poseTime: 0, gaitTime: 0, speed: 0 };
const stats: Stats = { builds: 0, updates: 0, attributeWrites: 0, skipped: 0 };
const gesture = new PetGesture();
let hovered = false, pressed = false, cursor = { x: -1, y: -1 }, signature = '', facing = 1, transitionStart = 0;
type Layer = { element: HTMLDivElement; prefix: string; nodes: Map<string, Element>; attributes: CatFrame['attributes'] };
let active: Layer | undefined, outgoing: Layer | undefined;
function createLayer(next: PetState): Layer {
  const prefix = `cat${++stats.builds}`, frame = catFrame(next, true, prefix, facing);
  const element = document.createElement('div'); element.className = 'cat-layer'; element.innerHTML = frame.markup;
  root.appendChild(element);
  return { element, prefix, attributes: frame.attributes, nodes: new Map(Array.from(element.querySelectorAll('[data-part]'), node => [node.getAttribute('data-part')!, node])) };
}
function updateLayer(layer: Layer, next: PetState) {
  const frame = catFrame(next, false, layer.prefix, facing);
  for (const [key, attrs] of frame.attributes) {
    const node = layer.nodes.get(key)!, previous = layer.attributes.get(key)!;
    for (const [name, value] of Object.entries(attrs)) if (previous[name] !== value) { node.setAttribute(name, value); stats.attributeWrites++; }
  }
  layer.attributes = frame.attributes; stats.updates++;
}
function render(next: PetState, immediate = false) {
  const nextSignature = JSON.stringify(next);
  if (!immediate && nextSignature === signature) { stats.skipped++; return; }
  const delta = Math.max(0, Math.min(.25, next.time - state.time)), desiredFacing = next.facingRight ? 1 : -1;
  facing = immediate ? desiredFacing : facing + (desiredFacing - facing) * Math.min(1, delta * 12);
  if (Math.abs(facing - desiredFacing) < .002) facing = desiredFacing;
  if (immediate) { outgoing?.element.remove(); outgoing = undefined; }
  if (!active || state.pose !== next.pose) {
    outgoing?.element.remove(); outgoing = undefined;
    if (active && !immediate) { outgoing = active; outgoing.element.setAttribute('data-outgoing', 'true'); }
    else active?.element.remove();
    active = createLayer(next); transitionStart = next.time;
  } else updateLayer(active, next);
  if (outgoing) {
    const progress = Math.max(0, Math.min(1, (next.time - transitionStart) / .28)), ease = progress * progress * (3 - 2 * progress);
    active.element.style.opacity = String(ease); outgoing.element.style.opacity = String(1 - ease);
    if (progress >= 1) { outgoing.element.remove(); outgoing = undefined; }
  } else active.element.style.opacity = '1';
  state = next; signature = nextSignature;
  document.body.classList.toggle('held', state.pose === 'held');
  document.body.classList.toggle('click-through', state.clickThrough);
  hover(cursor);
}
function hit(x: number, y: number) { const node = document.elementFromPoint(x, y); return !!node?.closest('[data-cat]') && !node.closest('[data-outgoing]'); }
function hover(point: Point) {
  cursor = point;
  const next = hit(point.x, point.y);
  if (next !== hovered) { hovered = next; window.animo?.hover(next); }
}
document.addEventListener('mousemove', e => hover({ x: e.clientX, y: e.clientY }));
document.addEventListener('mouseleave', () => { hover({ x: -1, y: -1 }); if (!pressed) gesture.cancel(); });
document.addEventListener('pointerdown', e => {
  if (e.button !== 0 || state.clickThrough || !hit(e.clientX, e.clientY)) return;
  // The window stops moving during the press, making local coordinates stable.
  pressed = true; gesture.begin({ x: e.clientX, y: e.clientY });
  root.setPointerCapture(e.pointerId); window.animo?.press(); e.preventDefault();
});
document.addEventListener('pointermove', e => {
  if (state.clickThrough || (e.buttons !== 0 && !pressed)) return;
  const point = pressed ? { x: e.clientX, y: e.clientY } : { x: e.screenX, y: e.screenY };
  const action = gesture.move(point, hit(e.clientX, e.clientY), performance.now());
  if (action === 'drag') window.animo?.beginDrag();
  if (action === 'stroke') window.animo?.pet();
});
document.addEventListener('pointerup', e => {
  if (e.button !== 0 || !pressed) return;
  const action = gesture.release(hit(e.clientX, e.clientY)); pressed = false;
  if (root.hasPointerCapture(e.pointerId)) root.releasePointerCapture(e.pointerId);
  window.animo?.endDrag(); if (action === 'pet') window.animo?.pet();
});
function cancel() { gesture.cancel(); if (pressed) { pressed = false; window.animo?.endDrag(); } }
document.addEventListener('pointercancel', cancel);
document.addEventListener('lostpointercapture', cancel);
window.addEventListener('blur', cancel);
document.addEventListener('contextmenu', e => {
  e.preventDefault(); cancel();
  if (!state.clickThrough && hit(e.clientX, e.clientY)) window.animo?.openMenu({ x: e.clientX, y: e.clientY });
});
// Preview tools stay unavailable in normal launches and expose no OS actions.
if (new URLSearchParams(location.search).has('preview')) {
  window.animoPreview = { render: (patch, immediate = true) => render({ ...state, ...patch }, immediate), hit, getState: () => state, stats: () => ({ ...stats }) };
}
render(state);
window.animo?.onState(render);
window.animo?.onCursor(hover);
window.animo?.ready();
