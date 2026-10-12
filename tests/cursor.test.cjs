const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const { prepareCursorPush, isCursorPushReady, pushCursor, cancelCursorPush } = require('../dist/node/cursor.js');

test('cursor helper warms without movement, dispatches without respawning, and cancels cleanly', { skip: !['win32', 'darwin'].includes(process.platform), timeout: 5000 }, async () => {
  const spawn = childProcess.spawn;
  const warnings = [];
  let launches = 0, received = 0, fail = false, hold = false;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  mock.method(console, 'warn', (...args) => warnings.push(args.join(' ')));
  // Exercise real child pipes and readiness/exit timing without moving a CI desktop.
  mock.method(childProcess, 'spawn', (_file, _args, options) => {
    launches++;
    const script = fail ? 'process.exit(1)' : `
      setTimeout(() => { process.stdout.write('REA'); setTimeout(() => process.stdout.write('DY\\r\\n'), 10); }, 80);
      let input = ''; process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => input += chunk);
      process.stdin.on('end', () => {
        process.stdout.write('RECEIVED\\n');
        const valid = JSON.stringify(JSON.parse(input)) === '[[12,35]]';
        setTimeout(() => process.exit(valid ? 0 : 2), ${hold ? 1000 : 10});
      });`;
    const child = spawn(process.execPath, ['-e', script], options);
    child.stdout.on('data', chunk => { if (String(chunk).includes('RECEIVED')) received++; });
    return child;
  });
  try {
    const prepared = prepareCursorPush();
    assert.equal(prepareCursorPush(), prepared, 'preparation must reuse the same child');
    assert(!isCursorPushReady());
    assert(await prepared); assert(isCursorPushReady());
    assert.equal(received, 0, 'warming must not send movement');
    assert(await pushCursor([{ x: 12.2, y: 34.8 }]));
    assert.equal(launches, 1, 'the contact must use the warm process');
    assert.equal(received, 1); assert(!isCursorPushReady());

    const cancelled = prepareCursorPush(); cancelCursorPush();
    assert.equal(await cancelled, false, 'cancel during startup must settle readiness');
    assert(!isCursorPushReady());

    hold = true;
    assert(await prepareCursorPush());
    const push = pushCursor([{ x: 12, y: 35 }]);
    assert.equal(await pushCursor([{ x: 12, y: 35 }]), false, 'overlapping pushes must be dropped');
    for (let i = 0; i < 100 && received < 2; i++) await wait(5);
    assert.equal(received, 2);
    cancelCursorPush(); assert.equal(await push, false, 'cancel during a push must settle completion');

    fail = true;
    assert.equal(await prepareCursorPush(), false, 'startup failure must not permit a swipe');
    assert(warnings.some(line => line.includes('failed')));
  } finally { cancelCursorPush(); mock.restoreAll(); }
});
