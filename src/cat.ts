import { legStep, pawReach, pawSwishFade } from './shared/gait.js';
import type { PetState, Point } from './shared/types.js';
const fur = '#FFD99B', cream = '#FFF0D0', stripe = '#DE9959', pink = '#F3A2A3', ink = '#594136';
type Attributes = Record<string, string>;
export interface CatFrame { markup: string; attributes: Map<string, Attributes> }

// Build an SVG once per pose; later frames update attributes in the existing tree.
export function catFrame(state: PetState, markup = false, prefix = 'cat', facing = state.facingRight ? 1 : -1): CatFrame {
  const attributes = new Map<string, Attributes>();
  let index = 0;
  const node = (tag: string, values: Record<string, string | number>, children = '') => {
    const key = `p${index++}`, attrs = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)]));
    attributes.set(key, attrs);
    return markup ? `<${tag} data-part="${key}" ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}>${children}</${tag}>` : '';
  };
  const group = (attrs: Record<string, string | number>, children: string) => node('g', attrs, children);
  const path = (d: string, fill = 'none', stroke = ink, width = 2.8) => node('path', { d, fill, stroke, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  const ellipse = (cx: number, cy: number, rx: number, ry: number, fill: string) => node('ellipse', { cx, cy, rx, ry, fill });
  const toes = (p: Point) => path(`M ${p.x + 2},${p.y + 2} v 2 M ${p.x + 6},${p.y + 2} v 2`, 'none', ink, 1.1);
  const leg = (hip: Point, knee: Point, ankle: Point, foot: Point) => `M ${hip.x - 6},${hip.y} Q ${knee.x - 6},${knee.y} ${ankle.x - 4},${ankle.y} Q ${foot.x - 8},${foot.y} ${foot.x - 7},${foot.y + 3} Q ${foot.x - 6},${foot.y + 5} ${foot.x + 4},${foot.y + 5} Q ${foot.x + 11},${foot.y + 5} ${foot.x + 10},${foot.y + 1} Q ${foot.x + 9},${foot.y - 2} ${ankle.x + 4},${ankle.y - 1} Q ${knee.x + 5},${knee.y - 1} ${hip.x + 6},${hip.y} Z`;
  const t = state.time, poseTime = state.poseTime;
  const stretch = state.pose === 'stretching' ? Math.sin(Math.min(1, poseTime / 3) * Math.PI) : 0;
  const contentment = state.pose === 'petted' ? Math.sin(Math.min(1, poseTime / 2.4) * Math.PI) : 0;
  const bob = state.pose === 'walking' ? Math.cos(state.gaitTime / .68 * Math.PI * 4) * .55 * Math.min(1, state.speed / 52) : Math.sin(t * 2) * .4;
  const movingLeg = (hipX: number, rear: boolean, phase: number) => {
    const step = legStep(state.pose === 'held' ? t : state.gaitTime, phase, state.pose);
    const strength = state.pose === 'walking' ? Math.min(1, state.speed / 52) : state.pose === 'held' ? 1 : 0;
    const offset = step.offset * strength, lift = step.lift * strength;
    const foot = { x: hipX + offset + (rear ? -2 : 2) + (rear ? -3 : 13) * stretch, y: 124 - bob - lift };
    return { foot, d: leg({ x: hipX, y: 96 + (rear ? -12 : 8) * stretch }, { x: hipX + offset * .3 + (rear ? 5 : -2), y: 111 - lift * .25 }, { x: foot.x + (rear ? -3 : -1), y: foot.y - 4 }, foot) };
  };
  const body = () => {
    let far: string, shape: string, detail: string, belly: string, feet: string;
    if (['sitting', 'grooming', 'petted', 'pawing'].includes(state.pose)) {
      const backFoot = { x: 58, y: 124 - bob }, grooming = state.pose === 'grooming';
      const reach = state.pose === 'pawing' ? pawReach(poseTime) : undefined;
      const frontFoot = reach ?? { x: grooming ? 111 : 107, y: grooming ? 79 + Math.sin(poseTime * 9) * 2 : 124 - bob };
      far = leg({ x: 94, y: 91 }, { x: 94, y: 108 }, { x: 92, y: 120 - bob }, { x: 92, y: 123 - bob });
      const torso = 'M39,120 C30,104 39,84 55,75 C72,66 87,71 96,86 Q108,94 108,111 L105,125 Q76,131 52,128 Z';
      const rear = `M44,114 Q56,111 62,${backFoot.y - 5} Q70,${backFoot.y - 4} 70,${backFoot.y + 2} Q69,${backFoot.y + 5} 58,${backFoot.y + 5} L46,${backFoot.y + 5} Q39,${backFoot.y + 1} 44,114 Z`;
      // The swiping foreleg is drawn last, over the face, so it never hides inside the body.
      const front = reach ? '' : leg({ x: 105, y: 90 }, { x: 103, y: grooming ? 100 : 107 }, { x: grooming ? 110 : 104, y: frontFoot.y - 4 }, frontFoot);
      shape = path(torso, fur, 'none') + path(rear, fur, 'none') + path(front, fur, 'none');
      detail = path('M44,100 C58,96 69,104 64,115 Q62,119 57,120', 'none', ink, 1.9) + path('M47,80 Q48,87 55,90 M60,73 Q61,82 67,85', 'none', stripe, 4);
      belly = ellipse(94, 101, 16, 22, cream); feet = toes(backFoot) + (reach ? '' : toes(frontFoot));
    } else {
      const farRear = movingLeg(60, true, .75), farFront = movingLeg(94, false, .5);
      const nearRear = movingLeg(48, true, .25), nearFront = movingLeg(107, false, 0);
      far = farRear.d + ' ' + farFront.d;
      const torso = `M35,${92 - stretch * 10} C35,${75 - stretch * 8} 54,${65 - stretch * 8} 78,69 C96,70 111,${81 + stretch * 9} 112,${96 + stretch * 9} Q111,${112 + stretch * 4} 88,113 L57,${113 - stretch * 8} Q36,${111 - stretch * 10} 35,${92 - stretch * 10} Z`;
      shape = path(torso, fur, 'none') + path(nearRear.d, fur, 'none') + path(nearFront.d, fur, 'none');
      detail = path(`M45,${91 - stretch * 7} Q60,${89 - stretch * 7} 62,${103 - stretch * 7}`, 'none', ink, 1.7) + path(`M46,${76 - stretch * 7} Q49,${85 - stretch * 7} 56,${87 - stretch * 7} M59,${70 - stretch * 5} Q61,${80 - stretch * 5} 68,${82 - stretch * 5}`, 'none', stripe, 4);
      belly = ellipse(88, 99, 21, 18, cream); feet = toes(nearRear.foot) + toes(nearFront.foot);
    }
    const shapes = group({ id: `${prefix}-body` }, shape);
    const clip = node('clipPath', { id: `${prefix}-clip` }, node('use', { href: `#${prefix}-body` }));
    return (markup ? `<defs>${shapes}${clip}</defs>` : '') + path(far, '#E8BD80', '#88634B', 2.3)
      + node('use', { href: `#${prefix}-body`, filter: `url(#${prefix}-outline)` })
      + group({ 'clip-path': `url(#${prefix}-clip)` }, belly) + detail + feet;
  };
  const face = () => {
    const closed = state.pose === 'petted' || state.pose === 'grooming' || t % 5.3 < .16;
    const eyesOpen = group({ opacity: closed ? 0 : 1 }, ellipse(93, 65, 4.5, 6, ink) + ellipse(119, 65, 4.5, 6, ink) + ellipse(94, 63, 1.5, 2, '#fff') + ellipse(120, 63, 1.5, 2, '#fff'));
    const eyesClosed = group({ opacity: closed ? 1 : 0 }, path('M88,65 Q93,70 98,65 M114,65 Q119,70 124,65', 'none', ink, 1.7));
    const art = path('M76,48 L75,24 Q75,19 80,22 L96,35 Q107,32 116,36 L129,22 Q133,19 133,25 L131,49 Q140,61 134,78 Q129,91 107,93 Q83,92 76,78 Q69,63 76,48 Z', fur)
      + path('M80,29 L82,44 L91,38 Z M128,29 L118,39 L128,44 Z', pink, 'none')
      + ellipse(105, 79, 21, 11, cream) + path('M99,37 L102,47 M107,36 L107,46 M115,38 L112,47', 'none', stripe, 3.5) + eyesOpen + eyesClosed
      + ellipse(85, 76, 5, 2.6, '#EFB3A0') + ellipse(128, 76, 5, 2.6, '#EFB3A0')
      + path('M102,74 Q106,71 110,74 L106,78 Z', pink, 'none')
      + path('M106,78 L106,81 Q102,86 99,81 M106,81 Q110,86 113,81', 'none', ink, 1.7)
      + path('M87,78 L70,75 M87,82 L71,85 M124,78 L141,75 M124,82 L141,85', 'none', ink, 1.2);
    return group({ transform: `translate(${stretch * 9} ${stretch * 14}) rotate(${stretch * 12 - contentment * 5 + (state.pose === 'grooming' ? -7 + Math.sin(poseTime * 9) * 2 : 0)} 106 82)` }, art);
  };
  const sleeping = () => node('ellipse', { cx: 76, cy: 105, rx: 45, ry: 24, fill: fur, stroke: ink, 'stroke-width': 2.8 }) + path('M49,86 Q50,96 57,99 M61,82 Q62,93 68,95', 'none', stripe, 5)
    + path('M88,96 L90,77 L103,87 L119,82 L119,97 Q129,106 123,115 Q113,125 94,118 Q80,111 88,96 Z', fur)
    + path('M93,83 L94,92 L100,89 Z', pink, 'none')
    + path('M92,104 Q97,109 102,104 M111,104 Q116,109 121,103', 'none', ink, 1.7)
    + path('M104,111 L108,114 L112,110', pink, 'none')
    + path('M38,109 C44,134 92,129 88,117 C86,111 72,112 64,116', 'none', ink, 15)
    + path('M38,109 C44,134 92,129 88,117 C86,111 72,112 64,116', 'none', fur, 10)
    + node('text', { x: 129, y: 84 - Math.sin(t) * 3, fill: stripe, 'font-size': 14, 'font-family': 'system-ui', 'pointer-events': 'none' }, markup ? 'z' : '')
    + node('text', { x: 139, y: 71 - Math.sin(t + 1) * 3, fill: stripe, 'font-size': 14, 'font-family': 'system-ui', 'pointer-events': 'none' }, markup ? 'z' : '');
  const tail = `M43,100 C13,99 15,${62 + Math.sin(t * 2.5) * 6 - stretch * 8} 28,${60 + Math.sin(t * 2.5) * 6 - stretch * 8}`;
  const swipe = state.pose === 'pawing' ? (() => {
    const reach = pawReach(poseTime), fade = pawSwishFade(poseTime);
    const trails = group({ opacity: fade * .5, 'pointer-events': 'none' },
      path(`M${reach.x - 36},${reach.y - 9} Q${reach.x - 22},${reach.y - 7} ${reach.x - 12},${reach.y - 4}`, 'none', ink, 2.4)
      + path(`M${reach.x - 31},${reach.y + 6} Q${reach.x - 19},${reach.y + 4} ${reach.x - 11},${reach.y + 2}`, 'none', ink, 1.9));
    // Same shoulder and joint shape as the seated foreleg, so the pose blends without a pop.
    const arm = path(leg({ x: 105, y: 90 }, { x: (105 + reach.x) / 2 + 2, y: (90 + reach.y) / 2 + 4 }, { x: reach.x - 5, y: reach.y - 4 }, reach), fur);
    const pad = path(`M${reach.x - 1},${reach.y - 1} Q${reach.x + 4},${reach.y + 2} ${reach.x - 1},${reach.y + 5}`, 'none', pink, 3);
    return trails + arm + pad;
  })() : '';
  const groomingPaw = state.pose === 'grooming' ? path(leg({ x: 106, y: 104 }, { x: 112, y: 105 }, { x: 108, y: 96 }, { x: 102, y: 92 + Math.sin(poseTime * 9) * 1.5 }), fur)
    + path(`M104,85 Q108,${88 + Math.sin(poseTime * 9) * 2} 107,91`, 'none', pink, 3) : '';
  const art = state.pose === 'sleeping' ? sleeping() : path(tail, 'none', ink, 15) + path(tail, 'none', fur, 10) + body() + face() + groomingPaw + swipe;
  const hearts = state.pose === 'petted' ? group({ opacity: contentment * .85, transform: `translate(0 ${-poseTime * 5})`, 'pointer-events': 'none' }, path('M138,36 C132,30 125,37 138,46 C151,37 144,30 138,36 Z', pink, 'none')) : '';
  const shadow = ellipse(83, 132, state.pose === 'sleeping' ? 48 : 43, 3, state.pose === 'held' ? 'transparent' : '#00000018');
  const lunge = state.pose === 'pawing' ? pawSwishFade(poseTime) * 8 : 0;
  const character = group({ transform: `translate(${lunge} ${bob})`, 'data-cat': 'true', 'pointer-events': 'visiblePainted' }, art);
  const scene = group({ transform: `translate(80 0) scale(${facing} 1) translate(-80 0)` }, shadow + character + hearts);
  const filter = markup ? `<defs><filter id="${prefix}-outline" x="-20%" y="-20%" width="140%" height="140%"><feMorphology in="SourceAlpha" operator="dilate" radius="1.4" result="outer"/><feFlood flood-color="${ink}"/><feComposite in2="outer" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>` : '';
  return { attributes, markup: markup ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 144" aria-label="작은 고양이" style="pointer-events:none">${filter}${scene}</svg>` : '' };
}
export function catSVG(state: PetState) { return catFrame(state, true).markup; }
