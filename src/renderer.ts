import { catSVG } from './cat.js';
import type { PetAPI, PetState, Point } from './shared/types.js';
declare global { interface Window { animo?: PetAPI; animoPreview?: { render: (state: Partial<PetState>) => void; hit: (x: number, y: number) => boolean; getState: () => PetState }; } }
const root = document.getElementById('pet')!;
let state: PetState = { pose: 'sitting', facingRight: true, time: 1, size: 1, clickThrough: false, frozen: false };
let drag = false, hovered = false;
function render(next: PetState) {
  state = next;
  root.innerHTML = catSVG(state);
  document.body.classList.toggle('held', state.pose === 'held');
  document.body.classList.toggle('click-through', state.clickThrough);
}
function hit(x: number, y: number) { return !!document.elementFromPoint(x, y)?.closest('[data-cat]'); }
function hover(p: Point) {
  const next = hit(p.x, p.y);
  if (next !== hovered) { hovered = next; window.animo?.hover(next); }
}
document.addEventListener('mousemove', e => hover({ x: e.clientX, y: e.clientY }));
document.addEventListener('mouseleave', () => { hovered = false; window.animo?.hover(false); });
document.addEventListener('pointerdown', e => {
  if (state.clickThrough || !hit(e.clientX, e.clientY)) return;
  if (e.button === 0) { drag = true; root.setPointerCapture(e.pointerId); window.animo?.beginDrag(); e.preventDefault(); }
});
document.addEventListener('pointerup', e => { if (e.button === 0 && drag) { drag = false; if (root.hasPointerCapture(e.pointerId)) root.releasePointerCapture(e.pointerId); window.animo?.endDrag(); } });
document.addEventListener('pointercancel', () => { if (drag) { drag = false; window.animo?.endDrag(); } });
window.addEventListener('blur', () => { if (drag) { drag = false; window.animo?.endDrag(); } });
document.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (!state.clickThrough && hit(e.clientX, e.clientY)) window.animo?.openMenu({ x: e.clientX, y: e.clientY });
});
// Only enabled by the main process in smoke-test/preview mode. It exposes no OS actions.
if (new URLSearchParams(location.search).has('preview')) {
  window.animoPreview = { render: patch => render({ ...state, ...patch }), hit, getState: () => state };
}
render(state);
window.animo?.onState(render);
window.animo?.onCursor(hover);
window.animo?.ready();
// Cursor polling events come over the narrow preload bridge rather than exposing IPC.
