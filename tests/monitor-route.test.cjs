const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PetBrain } = require('../dist/node/shared/brain.js');
const { monitorRoute, desktopBounds } = require('../dist/node/shared/monitor-route.js');
const { approachTarget, inPushRange, pawPoint } = require('../dist/node/shared/keepawake.js');
const display = (id, bounds, workArea = bounds) => ({ id, bounds, workArea });
const intersects = (p, width, height, area) => p.x < area.x + area.width && p.x + width > area.x && p.y < area.y + area.height && p.y + height > area.y;

function walk(brain, route, screens) {
  for (const waypoint of route) {
    brain.approach(waypoint.point.x, waypoint.point.y);
    for (let i = 0; i < 5000 && brain.pose === 'walking'; i++) {
      const before = { x: brain.x, y: brain.y }; brain.tick(.25);
      assert(Math.hypot(brain.x - before.x, brain.y - before.y) <= 13 * brain.width / 160 + .01, 'crossing must walk, not jump');
      assert(screens.some(d => intersects(brain, brain.width, brain.height, d.bounds)), 'the cat must stay visible while crossing adjoining monitors');
    }
    assert.equal(brain.pose, 'sitting');
    assert(Math.abs(brain.x - waypoint.point.x) < .01 && Math.abs(brain.y - waypoint.point.y) < .01);
  }
}

test('monitor routes cross offset/negative displays and return to the original spot in both roaming modes', () => {
  const screens = [display(1, { x: 0, y: 0, width: 1440, height: 900 }, { x: 0, y: 0, width: 1440, height: 852 }),
    display(2, { x: -1280, y: -240, width: 1280, height: 1024 }, { x: -1280, y: -240, width: 1280, height: 976 })];
  assert.deepEqual(desktopBounds(screens), { x: -1280, y: -240, width: 2720, height: 1092 });
  for (const scale of [.75, 1, 1.35]) for (const roaming of [false, true]) {
    const brain = new PetBrain(screens[0].workArea);
    brain.width = Math.round(160 * scale); brain.height = Math.round(144 * scale);
    brain.pin(600, 500); brain.setRoaming(roaming);
    const home = { x: brain.x, y: brain.y }, cursor = { x: -640, y: 200 };
    const target = approachTarget(cursor, screens[1].workArea, brain.width, brain.height, screens[1].bounds);
    brain.setBounds(desktopBounds(screens));
    const outbound = monitorRoute(screens, 1, 2, home, target.point, brain.width, brain.height);
    assert.deepEqual(outbound.map(w => w.displayId), [1, 2, 2]);
    walk(brain, outbound, screens);
    assert(inPushRange(pawPoint(brain, brain.width, brain.height, target.facingRight), cursor, scale));
    walk(brain, monitorRoute(screens, 2, 1, brain, home, brain.width, brain.height), screens);
    brain.setBounds(screens[0].workArea);
    assert.equal(brain.x, home.x); assert.equal(brain.y, home.y); assert.equal(brain.roaming, roaming);
  }
});

test('routes use intervening displays in an L layout instead of walking through empty space', () => {
  const screens = [display(1, { x: 0, y: 0, width: 1000, height: 800 }),
    display(2, { x: 1000, y: 0, width: 1000, height: 800 }),
    display(3, { x: 1300, y: -800, width: 700, height: 800 })];
  const brain = new PetBrain(screens[0].workArea); brain.pin(100, 600); brain.setBounds(desktopBounds(screens));
  const route = monitorRoute(screens, 1, 3, brain, { x: 1500, y: -500 }, brain.width, brain.height);
  assert.deepEqual(route.map(w => w.displayId), [1, 2, 2, 3, 3]);
  walk(brain, route, screens);
});

test('single-display routes clamp their destination and unavailable displays reject stale trips', () => {
  const screens = [display(1, { x: -900, y: -800, width: 900, height: 800 })];
  assert.deepEqual(monitorRoute(screens, 1, 1, { x: -500, y: -500 }, { x: 20, y: 20 }, 160, 144),
    [{ displayId: 1, point: { x: -160, y: -144 } }]);
  assert.throws(() => monitorRoute(screens, 1, 2, { x: -500, y: -500 }, { x: 20, y: 20 }, 160, 144), /unavailable/);
  assert.throws(() => desktopBounds([]), /No displays/);
});
