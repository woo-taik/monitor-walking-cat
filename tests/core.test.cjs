const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PetBrain, clampPosition } = require('../dist/node/shared/brain.js');
const { legStep } = require('../dist/node/shared/gait.js');
const { menuPoint } = require('../dist/node/shared/placement.js');
const { validateSettings, loadSettings, saveSettings } = require('../dist/node/settings.js');
const { PetGesture } = require('../dist/node/shared/gesture.js');
const { frameInterval } = require('../dist/node/shared/cadence.js');
const { anchorPosition, relativePosition, resolvePreset } = require('../dist/node/shared/presets.js');
function rng() { let seed = 42; return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }
test('roaming stays within negative monitor work areas and visits all poses', () => {
  const brain = new PetBrain({ x: -1920, y: -1080, width: 1920, height: 1032 }, rng());
  const poses = new Set();
  for (let i = 0; i < 100000; i++) {
    brain.tick(i % 71 === 0 ? 20 : .033); poses.add(brain.pose);
    assert(brain.x >= -1920 && brain.x + brain.width <= 0 && brain.y >= -1080 && brain.y + brain.height <= -48);
  }
  for (const pose of ['walking', 'sleeping', 'sitting', 'stretching', 'grooming']) assert(poses.has(pose));
});

test('petting has a cooldown, preserves roaming and pinned coordinates, and cannot interrupt a held cat', () => {
  const brain = new PetBrain({ x: 0, y: 0, width: 1920, height: 1080 }, rng());
  brain.pin(500, 220);
  assert(brain.pet()); assert.equal(brain.pose, 'petted'); assert(!brain.pet());
  for (let i = 0; i < 61; i++) brain.tick(.1);
  assert.equal(brain.x, 500); assert.equal(brain.y, 220); assert.equal(brain.roaming, false);
  assert(brain.pet()); brain.hold(); assert(!brain.pet());
  brain.setRoaming(true); for (let i = 0; i < 70; i++) brain.tick(.1);
  assert(brain.pet()); assert.equal(brain.roaming, true);
});

test('walking accelerates smoothly, stops within bounds and ties gait progress to actual travel', () => {
  const brain = new PetBrain({ x: -1000, y: 0, width: 1000, height: 500 }, () => .8);
  brain.setRoaming(true);
  while (brain.pose !== 'walking') brain.tick(.033);
  let previousSpeed = 0, distance = 0, stopped = false;
  for (let i = 0; i < 2000; i++) {
    const previousX = brain.x, previousY = brain.y;
    brain.tick(.033); distance += Math.hypot(brain.x - previousX, brain.y - previousY);
    if (brain.pose !== 'walking') { stopped = true; break; }
    assert(Math.abs(brain.speed - previousSpeed) <= 150 * .033 + 1e-6);
    assert(brain.speed <= 52); previousSpeed = brain.speed;
  }
  assert(stopped); assert.equal(brain.speed, 0);
  assert(Math.abs(brain.gaitTime * 52 - distance) < .21);
});

test('short clicks pet, threshold movement drags, and only deliberate repeated movement strokes', () => {
  const gesture = new PetGesture();
  gesture.begin({ x: 100, y: 100 });
  assert.equal(gesture.move({ x: 104, y: 100 }, true, 0), undefined);
  assert.equal(gesture.release(true), 'pet');
  gesture.begin({ x: 100, y: 100 });
  assert.equal(gesture.move({ x: 106, y: 100 }, true, 0), 'drag');
  assert.equal(gesture.move({ x: 110, y: 100 }, false, 0), undefined);
  assert.equal(gesture.release(false), 'drop');
  gesture.begin({ x: 0, y: 0 }); gesture.cancel(); assert.equal(gesture.release(true), undefined);
  for (let i = 0; i < 20; i++) assert.equal(gesture.move({ x: 100, y: 100 }, true, i * 100), undefined);
  let strokes = 0;
  for (let i = 0; i < 8; i++) if (gesture.move({ x: 100 + i % 2 * 12, y: 100 }, true, 2000 + i * 10) === 'stroke') strokes++;
  assert.equal(strokes, 1);
  gesture.move({ x: 0, y: 0 }, false, 3000);
  assert.equal(gesture.move({ x: 100, y: 100 }, true, 4000), undefined);
});

test('inactive/frozen pets reduce updates and battery operation never raises the frame rate', () => {
  for (const pose of ['walking', 'sleeping', 'sitting', 'held', 'stretching', 'grooming', 'petted']) {
    assert(frameInterval(pose, true, false, false) >= 100);
    assert(frameInterval(pose, false, true, false) >= 1000);
    assert(frameInterval(pose, false, false, true) >= frameInterval(pose, false, false, false));
  }
  assert(frameInterval('walking', false, false, false) <= 34);
  assert(frameInterval('sleeping', false, false, false) >= 200);
});
test('pinned position persists through animations; hold/drop/resume transitions work', () => {
  const brain = new PetBrain({ x: 0, y: 0, width: 1920, height: 1080 }, rng());
  brain.pin(500, 220);
  for (let i = 0; i < 10000; i++) brain.tick(.1);
  assert.equal(brain.x, 500); assert.equal(brain.y, 220);
  brain.hold(); brain.tick(10); assert.equal(brain.pose, 'held');
  brain.pin(600, 300); assert.equal(brain.pose, 'sitting'); assert.equal(brain.roaming, false);
  brain.setRoaming(true); for (let i = 0; i < 300; i++) brain.tick(.1);
  assert.notEqual(brain.x, 600);
});
test('monitor disconnect, oversize pet and invalid coordinates recover into visible bounds', () => {
  assert.deepEqual(clampPosition(NaN, Infinity, { x: 0, y: 0, width: 80, height: 60 }, 160, 144), { x: 0, y: 0 });
  const brain = new PetBrain({ x: 3000, y: -1000, width: 1920, height: 1080 });
  brain.setBounds({ x: 0, y: 0, width: 1920, height: 1080 });
  assert(brain.x >= 0 && brain.x <= 1760 && brain.y >= 0 && brain.y <= 936);
  brain.tick(NaN); assert(Number.isFinite(brain.x));
});
test('native popup coordinates stay local on secondary monitors with negative origins', () => {
  const window = { x: 3400, y: -220, width: 160, height: 144 };
  const area = { x: 1800, y: -1080, width: 1920, height: 1032 };
  assert.deepEqual(menuPoint({ x: 3500, y: -160 }, window, area), { x: 100, y: 60 });
  assert.deepEqual(menuPoint({ x: 5000, y: 100 }, window, area), { x: 319, y: 171 });
});
test('planted feet move backward at walking speed; swing is continuous and lifts only airborne feet', () => {
  const a = legStep(.1, 0, 'walking'), b = legStep(.2, 0, 'walking');
  assert.equal(a.lift, 0); assert.equal(b.lift, 0);
  assert(Math.abs((a.offset - b.offset) / .1 - 52) < 2);
  const contact = legStep(.68 * .64, 0, 'walking');
  const before = legStep(.68 * .64 - .00001, 0, 'walking');
  assert(Math.abs(contact.offset - before.offset) < .01);
  assert(legStep(.68 * .82, 0, 'walking').lift > 6.9);
  assert(Math.abs(legStep(.68 - .00001, 0, 'walking').offset - legStep(0, 0, 'walking').offset) < .01);
});
test('settings roundtrip, validation, corrupt-file fallback and WPF migration', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'animo-core-'));
  try {
    const file = path.join(directory, 'settings.json'), legacy = path.join(directory, 'legacy.json');
    const settings = validateSettings({ relativeX: .2, relativeY: .6, size: 1.35, roaming: false, clickThrough: true });
    saveSettings(file, settings); assert.deepEqual(loadSettings(file), settings);
    fs.writeFileSync(file, 'invalid'); assert.equal(loadSettings(file).size, 1);
    assert.equal(validateSettings({ size: 100, relativeX: -4, relativeY: 10 }).size, 1.5);
    assert.equal(validateSettings({ roaming: 'false' }).roaming, true);
    fs.unlinkSync(file); fs.writeFileSync(legacy, JSON.stringify({ Monitor: '\\\\.\\DISPLAY2', RelativeX: .7, RelativeY: 1, Size: .75, Roaming: false, ClickThrough: true }));
    const migrated = loadSettings(file, legacy);
    assert.equal(migrated.displayLabel, '\\\\.\\DISPLAY2'); assert.equal(migrated.relativeX, .7); assert.equal(migrated.size, .75); assert.equal(migrated.roaming, false); assert.equal(migrated.clickThrough, true);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('saved positions roundtrip across sizes and monitor resolution changes; missing monitor falls back to primary', () => {
  const area = { x: -1920, y: -1080, width: 1920, height: 1032 };
  for (const [width, height] of [[120,108], [160,144], [216,194]]) {
    for (const anchor of ['bottom-left', 'bottom-center', 'bottom-right']) {
      const point = anchorPosition(anchor, area, width, height);
      const p = { id: 'one', name: '문서 옆', displayId: 'secondary', displayLabel: 'Monitor', ...relativePosition(point, area, width, height) };
      const same = resolvePreset(p, [{ id: 'secondary', workArea: area }], 'secondary', width, height);
      assert.deepEqual(same.point, point); assert(!same.fallback);
      const resized = { x: 0, y: 0, width: 2560, height: 1392 };
      const restored = resolvePreset(p, [{ id: 'primary', workArea: resized }], 'primary', width, height);
      assert(restored.fallback); assert.equal(restored.displayId, 'primary');
      assert.deepEqual(restored.point, anchorPosition(anchor, resized, width, height));
    }
  }
  const small = { x: -80, y: 0, width: 80, height: 60 };
  assert.deepEqual(anchorPosition('bottom-right', small, 160, 144), { x: -80, y: 0 });
});

test('v2 settings migrate without losing options; presets validate, deduplicate, cap at eight and persist', () => {
  const old = validateSettings({ version: 2, size: .75, roaming: false, clickThrough: true, relativeX: .7 });
  assert.equal(old.version, 3); assert.equal(old.size, .75); assert(old.clickThrough); assert(!old.roaming); assert.deepEqual(old.presets, []);
  const preset = { id: 'one', name: ' 문서 옆 ', displayId: 'secondary', displayLabel: 'Monitor', relativeX: -3, relativeY: 4 };
  const checked = validateSettings({ ...old, presets: [null, { ...preset, relativeX: 'wrong' }, preset, preset,
    { ...preset, id: 'two', name: '문서 옆' }, ...Array.from({ length: 10 }, (_, i) => ({ ...preset, id: `id-${i}`, name: `자리 ${i}` }))] });
  assert.equal(checked.presets.length, 8); assert.equal(checked.presets[0].name, '문서 옆');
  assert.equal(checked.presets[0].relativeX, 0); assert.equal(checked.presets[0].relativeY, 1);
  assert.equal(new Set(checked.presets.map(p => p.id)).size, 8);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'animo-presets-'));
  try { const file = path.join(directory, 'settings.json'); saveSettings(file, checked); assert.deepEqual(loadSettings(file), checked); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
