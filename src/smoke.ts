import { screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import type { PetController } from './main.js';
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export async function runSmoke(controller: PetController, output: string) {
  fs.mkdirSync(output, { recursive: true });
  const lines: string[] = [];
  const win = controller.window;
  controller.stopForVerification();
  try {
    await wait(200);
    assert(win.isVisible()); assert(win.isAlwaysOnTop()); assert(!win.isFocusable());
    assert.equal(await win.webContents.executeJavaScript('typeof window.require'), 'undefined');
    assert.equal(await win.webContents.executeJavaScript('typeof window.process'), 'undefined');
    assert.equal(await win.webContents.executeJavaScript('typeof window.animo.beginDrag'), 'function');
    lines.push('PASS: actual Electron overlay, no focus, isolated sandboxed preload.');
    await win.webContents.executeJavaScript("window.animoPreview.render({pose:'sitting',time:1})");
    const hit = await win.webContents.executeJavaScript(`({body:window.animoPreview.hit(innerWidth*105/160,innerHeight*60/144),corner:window.animoPreview.hit(2,2)})`);
    assert(hit.body); assert(!hit.corner);
    lines.push('PASS: SVG cat receives input; empty transparent corners pass through.');
    await win.webContents.executeJavaScript('window.animo.hover(true); window.animo.beginDrag()');
    await wait(50); assert.equal(controller.brain.pose, 'held'); assert(!controller.isMouseIgnored());
    await win.webContents.executeJavaScript('window.animo.endDrag()');
    await wait(50); assert.equal(controller.brain.pose, 'sitting'); assert(!controller.brain.roaming);
    await win.webContents.executeJavaScript('window.animo.openMenu({x:105,y:60})');
    await wait(100); assert(controller.isMenuOpen()); controller.closeMenu(); await wait(100);
    assert(!controller.isMenuOpen());
    lines.push('PASS: sandboxed renderer IPC reaches drag/drop, hover and context-menu handlers.');
    controller.setClickThrough(true); assert(controller.settings.clickThrough);
    controller.setClickThrough(false); assert(!controller.settings.clickThrough);
    lines.push('PASS: manual click-through policy toggles.');
    for (const display of screen.getAllDisplays()) {
      controller.moveToDisplay(display);
      for (const size of [.75, 1, 1.35]) {
        controller.setSize(size); await wait(50);
        const rect = win.getBounds(), area = display.workArea;
        assert(Math.abs(rect.width - 160 * size) <= 1 && Math.abs(rect.height - 144 * size) <= 1, 'DIP dimensions changed unexpectedly');
        assert(rect.x >= area.x && rect.y >= area.y && rect.x + rect.width <= area.x + area.width && rect.y + rect.height <= area.y + area.height, 'Pet escaped work area');
      }
      controller.setSize(1);
      const rect = win.getBounds();
      controller.beginDrag({ x: rect.x + 80, y: rect.y + 72 });
      controller.moveDrag({ x: rect.x + 110, y: rect.y + 52 }); controller.endDrag();
      const dropped = win.getBounds();
      assert.equal(dropped.x, rect.x + 30); assert.equal(dropped.y, rect.y - 20);
      assert.equal(controller.brain.roaming, false);
      const menu = controller.menu();
      menu.getMenuItemById('walk')!.click(); assert(controller.brain.roaming);
      menu.getMenuItemById('stay')!.click(); assert(!controller.brain.roaming);
      controller.showMenu({ x: dropped.x + 100, y: dropped.y + 60 });
      await wait(100); assert(controller.isMenuOpen());
      controller.closeMenu(); await wait(100); assert(!controller.isMenuOpen(), 'Native menu did not close');
      lines.push(`PASS: ${display.label || display.id}, scale ${display.scaleFactor}: 3 sizes, drag/drop, native menu and walk/stay actions.`);
    }
    controller.recall();
    assert.equal(controller.settings.clickThrough, false); assert.equal(controller.brain.roaming, false);
    lines.push('PASS: recall restores visibility and a controllable cat on the primary display.');
    for (const pose of ['sitting', 'walking', 'sleeping', 'held']) {
      await win.webContents.executeJavaScript(`window.animoPreview.render({pose:'${pose}',time:1.15,facingRight:true})`);
      await wait(80);
      const image = await win.webContents.capturePage();
      assert(!image.isEmpty());
      const pixel = image.toBitmap(), dimensions = image.getSize();
      assert.equal(pixel[3], 0, 'Corner should remain transparent');
      assert.equal(pixel[((dimensions.height - 1) * dimensions.width + dimensions.width - 1) * 4 + 3], 0);
      fs.writeFileSync(path.join(output, `${pose}.png`), image.toPNG());
    }
    await win.webContents.executeJavaScript("window.animoPreview.render({pose:'walking',time:.34,facingRight:false})");
    await wait(80);
    fs.writeFileSync(path.join(output, 'walking-left.png'), (await win.webContents.capturePage()).toPNG());
    lines.push('PASS: 4 poses and mirrored walking rendered; transparent corners verified.');
    lines.push(`INFO: platform=${process.platform}, Electron=${process.versions.electron}; macOS runtime verification still requires a Mac.`);
    fs.writeFileSync(path.join(output, 'electron-smoke.txt'), lines.join('\n'));
    console.log(lines.join('\n'));
  } catch (error) {
    lines.push('FAIL: ' + String(error)); fs.writeFileSync(path.join(output, 'electron-smoke.txt'), lines.join('\n')); throw error;
  }
}
