import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { PetController } from './main.js';
import { COATS, type CatCoat } from './shared/coats.js';

// Shared by desktop and CI smoke checks: real settings controls, IPC and SVG rendering.
export async function verifyCoats(controller: PetController, preferences: BrowserWindow, output: string) {
  const win = controller.window, wasPaused = controller.preferencesSnapshot().paused;
  controller.setPaused(true);
  try {
    for (const coat of Object.keys(COATS) as CatCoat[]) {
      controller.setCoat(coat === 'cheese' ? 'gray' : 'cheese');
      // Leave a pose transition in progress to catch old-color layers and static filters.
      await win.webContents.executeJavaScript("window.animoPreview.render({pose:'sitting',time:10}); window.animoPreview.render({pose:'walking',time:10.01},false)");
      const { coat: previousCoat, ...before } = controller.state();
      const position = win.getBounds();
      await preferences.webContents.executeJavaScript(`document.querySelector('input[name="coat"][value="${coat}"]').click()`);
      for (let tries = 0; tries < 100; tries++) {
        if (await win.webContents.executeJavaScript(`window.animoPreview.getState().coat === '${coat}' && document.querySelectorAll('#pet .cat-layer').length === 1`)) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      assert.equal(controller.settings.coat, coat);
      assert(await win.webContents.executeJavaScript(`window.animoPreview.getState().coat === '${coat}' && document.querySelector('#pet filter feFlood').getAttribute('flood-color') === '${COATS[coat].ink}' && document.querySelectorAll('#pet .cat-layer').length === 1`), 'Live color must replace every layer and the outline while paused');
      const { coat: currentCoat, ...after } = controller.state();
      assert.deepEqual(after, before, 'Color changes must preserve behavior and pause state');
      assert.deepEqual(win.getBounds(), position, 'Color changes must preserve placement and size');
      assert(await preferences.webContents.executeJavaScript(`document.querySelector('#preview [fill="${COATS[coat].fur}"]') !== null`));
      assert(controller.menu().getMenuItemById(`coat-${coat}`)!.checked);
      for (const pose of ['sitting', 'walking', 'sleeping', 'held', 'stretching', 'grooming', 'petted', 'pawing']) {
        await win.webContents.executeJavaScript(`window.animoPreview.render({pose:'${pose}',coat:'${coat}',time:1.15,poseTime:1.5,gaitTime:1.15,speed:52})`);
        assert(await win.webContents.executeJavaScript(`document.querySelector('#pet [fill="${COATS[coat].fur}"]') !== null && document.querySelector('#pet filter feFlood').getAttribute('flood-color') === '${COATS[coat].ink}' && document.querySelectorAll('#pet .cat-layer').length === 1`));
        const image = await win.webContents.capturePage();
        assert(!image.isEmpty());
        const pixels = image.toBitmap();
        assert.equal(pixels[3], 0);
        assert(pixels.some((value, index) => index % 4 === 3 && value > 0));
        fs.writeFileSync(path.join(output, `coat-${coat}-${pose}.png`), image.toPNG());
      }
    }
    const selectedCoat = controller.settings.coat;
    for (const value of ['purple', '__proto__', 'toString', null, 1, {}]) {
      assert(await preferences.webContents.executeJavaScript(`window.preferences.change({kind:'coat',value:${JSON.stringify(value)}}).then(()=>false,()=>true)`));
      assert.equal(controller.settings.coat, selectedCoat);
    }
    controller.menu().getMenuItemById('coat-gray')!.click();
    for (let tries = 0; tries < 100; tries++) {
      if (await preferences.webContents.executeJavaScript('document.querySelector("input[name=coat]:checked").value === "gray"')) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.equal(await preferences.webContents.executeJavaScript('document.querySelector("input[name=coat]:checked").value'), 'gray');
    assert.equal(controller.state().coat, 'gray');
  } finally { controller.setPaused(wasPaused); controller.sendState(); }
}
