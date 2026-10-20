import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { screen } from 'electron';
import type { PetController } from './main.js';
import { verifyCoats } from './verify-coats.js';
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function verifyMonitorVisits(controller: PetController, lines: string[]) {
  const homeDisplay = screen.getPrimaryDisplay(), destinations = screen.getAllDisplays();
  controller.setKeepAwake(true);
  for (const target of destinations) for (const roaming of [false, true]) {
    controller.changePreferences({ kind: 'anchor', anchor: 'bottom-center', displayId: String(homeDisplay.id) });
    controller.setRoaming(roaming);
    const home = { x: controller.brain.x, y: controller.brain.y };
    const cursor = { x: target.workArea.x + target.workArea.width / 2, y: target.workArea.y + target.workArea.height / 2 };
    let state = controller.startNudgeForVerification(cursor), visited = false;
    const saved = state.savedPosition;
    assert.equal(state.phase, 'approach');
    for (let i = 0; i < 4000 && state.phase !== 'idle'; i++) {
      state = controller.stepNudgeForVerification(.25, cursor);
      assert.deepEqual(state.savedPosition, saved, 'a temporary monitor visit must never replace the saved home');
      if (state.phase === 'paw') { assert.equal(state.displayId, target.id); visited = true; }
    }
    assert(visited, `Cat did not reach cursor display ${target.id}`);
    assert.equal(state.phase, 'idle', 'Visit must return home and finish');
    assert.equal(controller.display.id, homeDisplay.id);
    assert(Math.abs(controller.brain.x - home.x) < 1 && Math.abs(controller.brain.y - home.y) < 1);
    assert.equal(controller.brain.roaming, roaming);
    const bounds = controller.window.getBounds();
    assert(Math.abs(bounds.width - controller.brain.width) <= 1 && Math.abs(bounds.height - controller.brain.height) <= 1);
  }
  const target = destinations.at(-1)!;
  const cursor = { x: target.workArea.x + target.workArea.width / 2, y: target.workArea.y + target.workArea.height / 2 };
  if (destinations.length > 1) {
    const first = destinations.find(d => d.id !== homeDisplay.id)!;
    const firstCursor = { x: first.workArea.x + first.workArea.width / 2, y: first.workArea.y + first.workArea.height / 2 };
    controller.changePreferences({ kind: 'anchor', anchor: 'bottom-center', displayId: String(homeDisplay.id) });
    const initial = controller.startNudgeForVerification(firstCursor);
    for (let i = 0; i < 5; i++) controller.stepNudgeForVerification(.25, firstCursor);
    const redirected = destinations.find(d => d.id !== first.id)!;
    const nextCursor = { x: redirected.workArea.x + redirected.workArea.width / 2, y: redirected.workArea.y + redirected.workArea.height / 2 };
    let state = controller.stepNudgeForVerification(.25, nextCursor), visited = false;
    for (let i = 0; i < 4000 && state.phase !== 'idle'; i++) {
      state = controller.stepNudgeForVerification(.25, nextCursor);
      assert.deepEqual(state.savedPosition, initial.savedPosition, 'retargeting must retain the original home');
      if (state.phase === 'paw') { assert.equal(state.displayId, redirected.id); visited = true; }
    }
    assert(visited); assert.equal(state.phase, 'idle');
  }
  controller.startNudgeForVerification(cursor);
  controller.beginDrag({ x: controller.window.getBounds().x + 105, y: controller.window.getBounds().y + 60 });
  const drop = { x: homeDisplay.workArea.x + 200, y: homeDisplay.workArea.y + 200 };
  controller.moveDrag({ x: drop.x + 105, y: drop.y + 60 }); controller.endDrag();
  assert.equal(controller.stepNudgeForVerification(.25, cursor).phase, 'idle', 'Dragging must cancel all remaining route waypoints');
  assert(Math.abs(controller.brain.x - drop.x) <= 1 && Math.abs(controller.brain.y - drop.y) <= 1);
  assert(!controller.brain.roaming, 'a user drop must stay pinned after a cancelled visit');
  controller.startNudgeForVerification(cursor);
  controller.setPaused(true);
  assert.equal(controller.stepNudgeForVerification(.25, cursor).phase, 'idle', 'Pause must discard the visit route');
  controller.setPaused(false);
  controller.startNudgeForVerification(cursor);
  controller.moveToDisplay(homeDisplay);
  assert.equal(controller.stepNudgeForVerification(.25, cursor).phase, 'idle', 'Explicit monitor selection must discard the visit route');
  controller.startNudgeForVerification(cursor);
  screen.emit('display-metrics-changed', {}, homeDisplay, ['workArea']);
  assert.equal(controller.stepNudgeForVerification(.25, cursor).phase, 'idle', 'Layout changes must discard stale display routes');
  controller.setKeepAwake(false); controller.setRoaming(false);
  lines.push(`PASS: cursor visits and return home on ${destinations.length} connected display(s), pinned and roaming; cursor monitor changes retarget visits; saved home stays unchanged; drag, pause, monitor selection and layout changes cancel visits (simulated time, no cursor movement).`);
}

// CI checks the packaged runtime and resources without injecting desktop input.
// Physical monitor, native menu dismissal and Spaces checks remain in --smoke-test/manual testing.
export async function runCiSmoke(controller: PetController, output: string) {
  fs.mkdirSync(output, { recursive: true });
  const lines: string[] = [];
  const win = controller.window;
  const focusForInput = async () => {
    // sendInputEvent requires a focused BrowserWindow (especially on macOS).
    // This is a test-only precondition; normal launches keep the overlay non-focusable.
    win.setFocusable(true); win.focus();
    for (let tries = 0; tries < 100 && !win.isFocused(); tries++) await wait(25);
    assert(win.isFocused(), 'Synthetic input requires focused test window');
  };
  try {
    controller.stopForVerification(); controller.brain.pin(); controller.sendState();
    assert(!win.isFocusable()); assert(win.isAlwaysOnTop());
    assert.equal(await win.webContents.executeJavaScript('typeof window.require'), 'undefined');
    assert.equal(await win.webContents.executeJavaScript('typeof window.animo.beginDrag'), 'function');
    lines.push('PASS: packaged overlay starts with isolated preload and no keyboard focus.');
    await focusForInput();
    await win.webContents.executeJavaScript("window.animoPreview.render({pose:'sitting',time:1})");
    for (const ignored of [false, true, false]) {
      win.webContents.sendInputEvent({ type: 'mouseMove', x: ignored ? 2 : 105, y: ignored ? 2 : 60 });
      for (let tries = 0; tries < 100 && controller.isMouseIgnored() !== ignored; tries++) await wait(25);
      assert.equal(controller.isMouseIgnored(), ignored, 'Renderer hover must follow the painted cat, not the transparent window bounds');
    }
    // Native leave events can be lost when the overlay starts ignoring input.
    // The main process cursor update must still clear the renderer's hover.
    win.webContents.send('pet:cursor', { x: -1, y: -1 });
    for (let tries = 0; tries < 100 && !controller.isMouseIgnored(); tries++) await wait(25);
    assert(controller.isMouseIgnored(), 'Cursor polling must restore click-through without a native mouseleave');
    lines.push('PASS: renderer hover follows the painted cat; transparent corners and cursor updates outside the window restore click-through.');
    // Hide can interrupt a press before pointerup/cancel reaches the renderer.
    // A new drag must still start rather than retaining the previous gesture/capture.
    for (const interrupted of [false, true]) {
      await focusForInput();
      await win.webContents.executeJavaScript("window.animoPreview.render({pose:'sitting',time:1}); window.animo.hover(true)");
      if (interrupted) {
        win.webContents.sendInputEvent({ type: 'mouseDown', x: 105, y: 60, button: 'left', clickCount: 1 });
        await wait(50); assert(controller.state().frozen);
      }
      controller.toggleHidden(); await wait(50); assert(!win.isVisible());
      controller.toggleHidden(); await wait(50); assert(win.isVisible());
      await focusForInput();
      await win.webContents.executeJavaScript("window.animoPreview.render({pose:'sitting',time:1}); window.animo.hover(true)");
      win.webContents.sendInputEvent({ type: 'mouseDown', x: 105, y: 60, button: 'left', clickCount: 1 });
      win.webContents.sendInputEvent({ type: 'mouseMove', x: 115, y: 60, button: 'left', modifiers: ['leftbuttondown'] });
      await wait(50); assert.equal(controller.brain.pose, 'held');
      win.webContents.sendInputEvent({ type: 'mouseUp', x: 115, y: 60, button: 'left', clickCount: 1 });
      await wait(50); assert.equal(controller.brain.pose, 'sitting'); assert(!controller.state().frozen);
    }
    lines.push('PASS: hide/show restores dragging, including an interrupted pointer capture (renderer input).');
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 2, y: 2 });
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 105, y: 60, button: 'left', modifiers: ['leftbuttondown'] });
    await wait(50); assert.equal(controller.brain.pose, 'sitting', 'A drag entering from another app must not be captured');
    win.webContents.sendInputEvent({ type: 'mouseUp', x: 105, y: 60, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 104, y: 60 });
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 115, y: 60, button: 'left', modifiers: ['leftbuttondown'] });
    await wait(50); assert.equal(controller.brain.pose, 'held', 'Missing first down should recover from held-button movement over cat');
    win.webContents.sendInputEvent({ type: 'mouseUp', x: 115, y: 60, button: 'left', clickCount: 1 });
    await wait(50); assert(!controller.state().frozen);
    lines.push('PASS: swallowed first mouse-down recovers dragging; incoming drags from another app are ignored.');
    win.setFocusable(false); assert(!win.isFocusable());
    verifyMonitorVisits(controller, lines);
    for (const pose of ['sitting', 'walking', 'sleeping', 'held', 'stretching', 'grooming', 'petted', 'pawing']) {
      await win.webContents.executeJavaScript(`window.animoPreview.render({pose:'${pose}',time:1.15,poseTime:1.5,gaitTime:1.15,speed:52,facingRight:true,frozen:false})`);
      await wait(80);
      assert(await win.webContents.executeJavaScript('document.querySelectorAll("#pet svg path").length > 0'));
      const image = await win.webContents.capturePage();
      assert(!image.isEmpty());
      const pixels = image.toBitmap();
      assert.equal(pixels[3], 0, 'Overlay corner should be transparent');
      assert(pixels.some((value, index) => index % 4 === 3 && value > 0), 'Cat pixels missing');
      fs.writeFileSync(path.join(output, `${pose}.png`), image.toPNG());
    }
    lines.push('PASS: all seven poses render from packaged resources with transparency.');
    const preferences = await controller.openPreferences();
    for (let tries = 0; tries < 100; tries++) {
      if (await preferences.webContents.executeJavaScript('document.querySelectorAll("#display option").length > 0')) break;
      await wait(25);
    }
    assert.equal(await preferences.webContents.executeJavaScript('typeof window.require'), 'undefined');
    assert.equal(await preferences.webContents.executeJavaScript('typeof window.animo'), 'undefined');
    await verifyCoats(controller, preferences, output);
    lines.push('PASS: three coat controls apply while paused; all 24 coat/pose combinations render; placement and behavior stay unchanged; tray synchronizes; invalid coats rejected.');
    await preferences.webContents.executeJavaScript("window.preferences.change({kind:'size',value:.75})");
    assert.equal(controller.settings.size, .75);
    await preferences.webContents.executeJavaScript("window.preferences.change({kind:'save-position',name:'CI position'})");
    const snapshot = await preferences.webContents.executeJavaScript('window.preferences.read()');
    assert.equal(snapshot.presets[0].name, 'CI position');
    assert.equal(await preferences.webContents.executeJavaScript('document.querySelectorAll("#display option").length'), snapshot.displays.length);
    fs.writeFileSync(path.join(output, 'preferences.png'), (await preferences.webContents.capturePage()).toPNG());
    preferences.close(); assert(!win.isDestroyed());
    lines.push('PASS: packaged settings HTML/CSS/preload initialize; settings and position IPC work.');
    lines.push(`INFO: ${process.platform}/${process.arch}, Electron ${process.versions.electron}; automated runtime checks do not verify physical input, Spaces or notarization.`);
  } catch (error) { lines.push(`FAIL: ${String(error)}`); throw error; }
  finally { fs.writeFileSync(path.join(output, 'ci-smoke.txt'), lines.join('\n') + '\n'); console.log(lines.join('\n')); }
}
