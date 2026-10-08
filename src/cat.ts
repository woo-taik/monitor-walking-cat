import { legStep } from './shared/gait.js';
import type { PetState, Point } from './shared/types.js';
const fur = '#FFD99B', cream = '#FFF0D0', stripe = '#DE9959', pink = '#F3A2A3', ink = '#594136';
const path = (d: string, fill = 'none', stroke = ink, width = 2.8) => `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
const ellipse = (x: number, y: number, rx: number, ry: number, fill: string) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}"/>`;
function leg(hip: Point, knee: Point, ankle: Point, foot: Point) {
  return `M ${hip.x - 6},${hip.y} Q ${knee.x - 6},${knee.y} ${ankle.x - 4},${ankle.y} Q ${foot.x - 8},${foot.y} ${foot.x - 7},${foot.y + 3} Q ${foot.x - 6},${foot.y + 5} ${foot.x + 4},${foot.y + 5} Q ${foot.x + 11},${foot.y + 5} ${foot.x + 10},${foot.y + 1} Q ${foot.x + 9},${foot.y - 2} ${ankle.x + 4},${ankle.y - 1} Q ${knee.x + 5},${knee.y - 1} ${hip.x + 6},${hip.y} Z`;
}
const toes = (p: Point) => path(`M ${p.x + 2},${p.y + 2} v 2 M ${p.x + 6},${p.y + 2} v 2`, 'none', ink, 1.1);
function movingLeg(state: PetState, hipX: number, rear: boolean, phase: number, bob: number) {
  const { offset, lift } = legStep(state.time, phase, state.pose);
  const foot = { x: hipX + offset + (rear ? -2 : 2), y: 124 - bob - lift };
  return { foot, d: leg({ x: hipX, y: 96 }, { x: hipX + offset * .3 + (rear ? 5 : -2), y: 111 - lift * .25 }, { x: foot.x + (rear ? -3 : -1), y: foot.y - 4 }, foot) };
}
function body(state: PetState, bob: number) {
  let far: string, shape: string, detail: string, belly: string, feet: string;
  if (state.pose === 'sitting') {
    const backFoot = { x: 58, y: 124 - bob }, frontFoot = { x: 107, y: 124 - bob };
    far = leg({ x: 94, y: 91 }, { x: 94, y: 108 }, { x: 92, y: 120 - bob }, { x: 92, y: 123 - bob });
    const torso = 'M39,120 C30,104 39,84 55,75 C72,66 87,71 96,86 Q108,94 108,111 L105,125 Q76,131 52,128 Z';
    const rear = `M44,114 Q56,111 62,${backFoot.y - 5} Q70,${backFoot.y - 4} 70,${backFoot.y + 2} Q69,${backFoot.y + 5} 58,${backFoot.y + 5} L46,${backFoot.y + 5} Q39,${backFoot.y + 1} 44,114 Z`;
    const front = leg({ x: 105, y: 90 }, { x: 103, y: 107 }, { x: 104, y: 120 - bob }, frontFoot);
    shape = `<path d="${torso}"/><path d="${rear}"/><path d="${front}"/>`;
    detail = path('M44,100 C58,96 69,104 64,115 Q62,119 57,120', 'none', ink, 1.9) + path('M47,80 Q48,87 55,90 M60,73 Q61,82 67,85', 'none', stripe, 4);
    belly = ellipse(94, 101, 16, 22, cream); feet = toes(backFoot) + toes(frontFoot);
  } else {
    const farRear = movingLeg(state, 60, true, .75, bob), farFront = movingLeg(state, 94, false, .5, bob);
    const nearRear = movingLeg(state, 48, true, .25, bob), nearFront = movingLeg(state, 107, false, 0, bob);
    far = farRear.d + ' ' + farFront.d;
    shape = `<path d="M35,92 C35,75 54,65 78,69 C96,70 111,81 112,96 Q111,112 88,113 L57,113 Q36,111 35,92 Z"/><path d="${nearRear.d}"/><path d="${nearFront.d}"/>`;
    detail = path('M45,91 Q60,89 62,103', 'none', ink, 1.7) + path('M46,76 Q49,85 56,87 M59,70 Q61,80 68,82', 'none', stripe, 4);
    belly = ellipse(88, 99, 21, 18, cream); feet = toes(nearRear.foot) + toes(nearFront.foot);
  }
  return `<defs><g id="body-shapes">${shape}</g><clipPath id="body-clip"><use href="#body-shapes"/></clipPath></defs>${path(far, '#E8BD80', '#88634B', 2.3)}<use href="#body-shapes" fill="${fur}" filter="url(#outline)"/><g clip-path="url(#body-clip)">${belly}</g>${detail}${feet}`;
}
function face(time: number) {
  let eyes = path('M88,65 Q93,70 98,65 M114,65 Q119,70 124,65', 'none', ink, 1.7);
  if (time % 5.3 >= .16) eyes = ellipse(93, 65, 4.5, 6, ink) + ellipse(119, 65, 4.5, 6, ink) + ellipse(94, 63, 1.5, 2, '#fff') + ellipse(120, 63, 1.5, 2, '#fff');
  return path('M76,48 L75,24 Q75,19 80,22 L96,35 Q107,32 116,36 L129,22 Q133,19 133,25 L131,49 Q140,61 134,78 Q129,91 107,93 Q83,92 76,78 Q69,63 76,48 Z', fur)
    + path('M80,29 L82,44 L91,38 Z M128,29 L118,39 L128,44 Z', pink, 'none')
    + ellipse(105, 79, 21, 11, cream) + path('M99,37 L102,47 M107,36 L107,46 M115,38 L112,47', 'none', stripe, 3.5) + eyes
    + ellipse(85, 76, 5, 2.6, '#EFB3A0') + ellipse(128, 76, 5, 2.6, '#EFB3A0')
    + path('M102,74 Q106,71 110,74 L106,78 Z', pink, 'none')
    + path('M106,78 L106,81 Q102,86 99,81 M106,81 Q110,86 113,81', 'none', ink, 1.7)
    + path('M87,78 L70,75 M87,82 L71,85 M124,78 L141,75 M124,82 L141,85', 'none', ink, 1.2);
}
function sleeping(time: number) {
  return `<ellipse cx="76" cy="105" rx="45" ry="24" fill="${fur}" stroke="${ink}" stroke-width="2.8"/>`
    + path('M49,86 Q50,96 57,99 M61,82 Q62,93 68,95', 'none', stripe, 5)
    + path('M88,96 L90,77 L103,87 L119,82 L119,97 Q129,106 123,115 Q113,125 94,118 Q80,111 88,96 Z', fur)
    + path('M93,83 L94,92 L100,89 Z', pink, 'none')
    + path('M92,104 Q97,109 102,104 M111,104 Q116,109 121,103', 'none', ink, 1.7)
    + path('M104,111 L108,114 L112,110', pink, 'none')
    + path('M38,109 C44,134 92,129 88,117 C86,111 72,112 64,116', 'none', ink, 15)
    + path('M38,109 C44,134 92,129 88,117 C86,111 72,112 64,116', 'none', fur, 10)
    + `<g fill="${stripe}" font-family="system-ui" font-size="14" pointer-events="none"><text x="129" y="${84 - Math.sin(time) * 3}">z</text><text x="139" y="${71 - Math.sin(time + 1) * 3}">z</text></g>`;
}
export function catSVG(state: PetState) {
  const t = state.time, bob = state.pose === 'walking' ? Math.cos(t / .68 * Math.PI * 4) * .55 : Math.sin(t * 2) * .55;
  const tail = `M43,100 C13,99 15,${62 + Math.sin(t * 2.5) * 6} 28,${60 + Math.sin(t * 2.5) * 6}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 144" aria-label="작은 고양이" style="pointer-events:none"><defs><filter id="outline" x="-20%" y="-20%" width="140%" height="140%"><feMorphology in="SourceAlpha" operator="dilate" radius="1.4" result="outer"/><feFlood flood-color="${ink}"/><feComposite in2="outer" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><g transform="${state.facingRight ? '' : 'translate(160 0) scale(-1 1)'}">${state.pose === 'held' ? '' : ellipse(83, 132, state.pose === 'sleeping' ? 48 : 43, 3, '#00000018')}<g transform="translate(0 ${bob})" data-cat="true" pointer-events="visiblePainted">${state.pose === 'sleeping' ? sleeping(t) : path(tail, 'none', ink, 15) + path(tail, 'none', fur, 10) + body(state, bob) + face(t)}</g></g></svg>`;
}
