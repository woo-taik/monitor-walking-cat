import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { PetController } from './main.js';
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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
    for (const pose of ['sitting', 'walking', 'sleeping', 'held', 'stretching', 'grooming', 'petted']) {
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
