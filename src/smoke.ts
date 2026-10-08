import { BrowserWindow, powerMonitor, screen } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import type { PetController } from './main.js';
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
// OS input is necessary here: webContents.sendInputEvent never reaches the native menu.
async function nativeInput(action: 'left' | 'right' | 'escape' | 'move' | 'left-down' | 'left-up', point = screen.getCursorScreenPoint()) {
  const physical = screen.dipToScreenPoint(point);
  const input = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AnimoMenuInput {
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
}
'@
[void][AnimoMenuInput]::SetProcessDPIAware()
[void][AnimoMenuInput]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
if ($env:ANIMO_INPUT_ACTION -eq 'escape') {
  [AnimoMenuInput]::keybd_event(27, 0, 0, [UIntPtr]::Zero)
  [AnimoMenuInput]::keybd_event(27, 0, 2, [UIntPtr]::Zero)
} else {
  if (-not [AnimoMenuInput]::SetCursorPos([int]$env:ANIMO_INPUT_X, [int]$env:ANIMO_INPUT_Y)) { throw 'Cursor move failed' }
  if ($env:ANIMO_INPUT_ACTION -ne 'move') {
    Start-Sleep -Milliseconds 100
    $down = if ($env:ANIMO_INPUT_ACTION -eq 'right') { 8 } elseif ($env:ANIMO_INPUT_ACTION -eq 'left-up') { 4 } else { 2 }
    [AnimoMenuInput]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero)
    if ($env:ANIMO_INPUT_ACTION -in @('left', 'right')) {
      Start-Sleep -Milliseconds 50
      [AnimoMenuInput]::mouse_event($down * 2, 0, 0, 0, [UIntPtr]::Zero)
    }
  }
}
$point = New-Object AnimoMenuInput+Point
$point.X = [int]$env:ANIMO_INPUT_X; $point.Y = [int]$env:ANIMO_INPUT_Y
$hit = [AnimoMenuInput]::WindowFromPoint($point)
[uint32]$hitProcess = 0
[void][AnimoMenuInput]::GetWindowThreadProcessId($hit, [ref]$hitProcess)
Write-Output ('foreground=' + [AnimoMenuInput]::GetForegroundWindow().ToInt64() + ',hit=' + $hit.ToInt64() + ',hitProcess=' + $hitProcess)`], { windowsHide: true, timeout: 10000, env: { ...process.env, ANIMO_INPUT_ACTION: action, ANIMO_INPUT_X: String(physical.x), ANIMO_INPUT_Y: String(physical.y) } });
  if (action !== 'escape') {
    const actual = screen.getCursorScreenPoint();
    assert(Math.abs(actual.x - point.x) <= 1 && Math.abs(actual.y - point.y) <= 1, `OS input missed target: ${JSON.stringify({ action, point, physical, actual })}`);
  }
  return input.stdout.trim();
}
async function verifyMenuDismissal(controller: PetController, lines: string[]) {
  if (process.platform !== 'win32') return;
  const cursor = screen.getCursorScreenPoint();
  const target = new BrowserWindow({ width: 240, height: 140, frame: false, skipTaskbar: true, alwaysOnTop: true, show: false, title: 'Animo menu verification',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    await target.loadURL('data:text/html,<body style="background:linen">Animo menu dismissal verification</body>');
    for (const display of screen.getAllDisplays()) {
      controller.moveToDisplay(display); controller.brain.pin(); controller.sendState();
      const area = display.workArea;
      target.setBounds({ x: area.x + 30, y: area.y + 30, width: 240, height: 140 });
      target.show(); if (!target.isVisible()) target.show(); target.focus(); await wait(100);
      assert(target.isVisible());
      const outside = { x: area.x + 80, y: area.y + 80 };
      for (const action of ['left', 'right', 'escape'] as const) {
        // A real user click gives this process foreground permission on Windows.
        // Programmatic focus alone is subject to the OS foreground lock.
        await nativeInput('left', outside); await wait(100);
        const bounds = controller.window.getBounds();
        if (action === 'left') {
          await controller.window.webContents.executeJavaScript("window.animoPreview.render({pose:'sitting',facingRight:true,time:1}); window.animo.hover(true)");
          await nativeInput('right', { x: bounds.x + 105, y: bounds.y + 60 });
          await until(() => controller.isMenuOpen(), 'OS right click on cat did not open its native menu');
        } else controller.showMenu({ x: bounds.x + 100, y: bounds.y + 60 });
        await wait(100); assert(controller.isMenuOpen());
        const foreground = await nativeInput(action, outside);
        await until(() => !controller.isMenuOpen(), `Native menu stayed open after ${action} on display ${display.id}; foreground=${foreground}, owner=${controller.window.getNativeWindowHandle().readBigUInt64LE()}, target=${target.getNativeWindowHandle().readBigUInt64LE()}, ownerFocused=${controller.window.isFocused()}, targetFocused=${target.isFocused()}, bounds=${JSON.stringify(controller.window.getBounds())}`);
        assert(!controller.window.isFocusable(), 'Overlay must return to non-focusable after dismiss');
        assert(!controller.state().frozen, 'Menu dismissal must resume the cat');
      }
      lines.push(`PASS: ${display.label || display.id}: OS left/right clicks outside and Escape dismiss native menu; overlay focus and animation restored.`);
      controller.resumeForVerification();
      for (const interrupted of [false, true]) {
        await controller.window.webContents.executeJavaScript(`window.menuInputTrace=[]; if(!window.menuInputTracing){window.menuInputTracing=true; for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture']) document.addEventListener(type,e=>{window.menuInputTrace.push({type,x:e.clientX,y:e.clientY,buttons:e.buttons}); if(window.menuInputTrace.length>30) window.menuInputTrace.shift();});}`);
        controller.brain.pin(); controller.sendState();
        const bounds = controller.window.getBounds(), point = { x: bounds.x + 105, y: bounds.y + 60 };
        await controller.window.webContents.executeJavaScript("window.animoPreview.render({pose:'sitting',time:1})");
        await nativeInput('move', point);
        await until(() => !controller.isMouseIgnored(), 'Hover should enable cat input');
        if (interrupted) {
          await nativeInput('left-down', point);
          await nativeInput('move', { x: point.x + 6, y: point.y });
          await until(() => controller.brain.pose === 'held', 'Drag before hide did not start');
        }
        controller.toggleHidden(); await wait(50);
        if (interrupted) await nativeInput('left-up', point);
        controller.toggleHidden(); await wait(50);
        await controller.window.webContents.executeJavaScript("window.animoPreview.render({pose:'sitting',time:1})");
        const hit = await controller.window.webContents.executeJavaScript('window.animoPreview.hit(105,60)');
        await until(() => !controller.isMouseIgnored(), `Show did not restore hover input: display=${display.id}, interrupted=${interrupted}, hit=${hit}, cursor=${JSON.stringify(screen.getCursorScreenPoint())}, bounds=${JSON.stringify(controller.window.getBounds())}`);
        const down = await nativeInput('left-down', point);
        const moved = { x: point.x + 12, y: point.y };
        await nativeInput('move', moved);
        const trace = await controller.window.webContents.executeJavaScript('JSON.stringify(window.menuInputTrace)');
        await until(() => controller.brain.pose === 'held', `OS drag did not recover after hide/show: interrupted=${interrupted}, owner=${controller.window.getNativeWindowHandle().readBigUInt64LE()}, ownerProcess=${process.pid}, down=${down}, pose=${controller.brain.pose}, frozen=${controller.state().frozen}, ignored=${controller.isMouseIgnored()}, events=${trace}`);
        await nativeInput('left-up', moved);
        await until(() => controller.brain.pose === 'sitting' && !controller.state().frozen, 'Drop did not recover after hide/show');
      }
      controller.stopForVerification();
      lines.push(`PASS: ${display.label || display.id}: OS drag/drop works after hide/show and interrupted press.`);
    }
  } finally {
    controller.stopForVerification();
    await nativeInput('left-up');
    controller.closeMenu(); target.destroy(); await nativeInput('move', cursor);
  }
}
async function until(check: () => boolean | Promise<boolean>, message: string) {
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) { if (await check()) return; await wait(25); }
  throw new Error(message);
}
export async function runSmoke(controller: PetController, output: string) {
  fs.mkdirSync(output, { recursive: true });
  const lines: string[] = [];
  const win = controller.window;
  try {
    controller.brain.pin(); controller.sendState();
    await wait(500);
    const idleBefore = await win.webContents.executeJavaScript('window.animoPreview.stats().updates');
    await wait(1000);
    const idleUpdates = await win.webContents.executeJavaScript('window.animoPreview.stats().updates') - idleBefore;
    assert(idleUpdates > 0 && idleUpdates <= 12, 'Resting cat should update about 10 times/second');
    controller.menu().getMenuItemById('pause')!.click(); await wait(100);
    const pauseBefore = await win.webContents.executeJavaScript('window.animoPreview.stats().updates');
    await wait(350);
    assert.equal(await win.webContents.executeJavaScript('window.animoPreview.stats().updates'), pauseBefore);
    controller.menu().getMenuItemById('pause')!.click(); controller.stopForVerification();
    lines.push(`PASS: actual idle renderer updated ${idleUpdates} times in 1 second; paused renderer performed zero repeated updates.`);
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
    await verifyMenuDismissal(controller, lines);
    const pinned = win.getBounds();
    controller.brain.pin(); controller.sendState();
    await win.webContents.executeJavaScript("window.animoPreview.render({pose:'sitting',facingRight:true,time:1}); window.animo.hover(true)");
    await wait(50);
    win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(pinned.width * 105 / 160), y: Math.round(pinned.height * 60 / 144), button: 'left', clickCount: 1 });
    await wait(50); assert.equal(controller.brain.pose, 'sitting'); assert(controller.state().frozen);
    win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(pinned.width * 105 / 160), y: Math.round(pinned.height * 60 / 144), button: 'left', clickCount: 1 });
    await wait(50); assert.equal(controller.brain.pose, 'petted'); assert(!controller.brain.roaming);
    assert.deepEqual(win.getBounds(), pinned); assert(!controller.state().frozen);
    await win.webContents.executeJavaScript('window.animo.hover(true); window.animo.pet()');
    await wait(50); assert.equal(controller.brain.poseTime, 0, 'Cooldown should not restart petting');
    lines.push('PASS: native short click pets without moving/pinning again; cooldown and pet IPC work.');
    for (let i = 0; i < 61; i++) controller.brain.tick(.1);
    controller.brain.pin(); controller.sendState();
    await win.webContents.executeJavaScript("window.animoPreview.render({pose:'sitting',facingRight:true,time:1}); window.animo.hover(true)");
    await wait(50);
    win.webContents.sendInputEvent({ type: 'mouseDown', x: 105, y: 60, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 115, y: 60, button: 'left', modifiers: ['leftbuttondown'] });
    await wait(50); assert.equal(controller.brain.pose, 'held');
    win.webContents.sendInputEvent({ type: 'mouseUp', x: 115, y: 60, button: 'left', clickCount: 1 });
    await wait(50); assert.equal(controller.brain.pose, 'sitting');
    lines.push('PASS: native pointer movement crosses drag threshold; drop remains pinned.');
    await win.webContents.executeJavaScript(`(() => {
      window.animoPreview.render({pose:'sitting',time:1,facingRight:true}); window.animo.hover(true);
      for(let i=0;i<9;i++) document.dispatchEvent(new PointerEvent('pointermove',{clientX:105+i%2*12,clientY:60,screenX:100+i%2*12,screenY:100,buttons:0,bubbles:true}));
    })()`);
    await wait(50); assert.equal(controller.brain.pose, 'petted'); assert(!controller.brain.roaming);
    lines.push('PASS: repeated unpressed pointer movement reaches petting through renderer gesture handling (synthetic events).');
    controller.setClickThrough(true); assert(controller.settings.clickThrough);
    controller.setClickThrough(false); assert(!controller.settings.clickThrough);
    lines.push('PASS: manual click-through policy toggles.');
    const render = await win.webContents.executeJavaScript(`(() => {
      const preview=window.animoPreview;
      preview.render({pose:'walking',time:1,poseTime:0,gaitTime:0,speed:52,facingRight:true});
      const svg=document.querySelector('#pet svg'), node=document.querySelector('[data-cat]'), before=preview.stats();
      for(let i=1;i<=100;i++) preview.render({time:1+i*.033,poseTime:i*.033,gaitTime:i*.033},false);
      const after=preview.stats();
      preview.render({},false); preview.render({},false);
      const reused=svg===document.querySelector('#pet svg') && node===document.querySelector('[data-cat]');
      preview.render({pose:'grooming',time:5,poseTime:0},false);
      const layersAtStart=document.querySelectorAll('.cat-layer').length;
      preview.render({time:5.14,poseTime:.14},false);
      const blend=Number(document.querySelector('.cat-layer:last-child').style.opacity);
      preview.render({frozen:true},false);
      const frozenBlend=Number(document.querySelector('.cat-layer:last-child').style.opacity);
      preview.render({time:5.3,poseTime:.3,frozen:false},false);
      const layersAtEnd=document.querySelectorAll('.cat-layer').length;
      preview.render({facingRight:false,time:5.333},false);
      const turning=document.querySelector('.cat-layer:last-child svg>g').getAttribute('transform');
      return {reused,before,after,skipped:preview.stats().skipped,layersAtStart,blend,frozenBlend,layersAtEnd,turning};
    })()`);
    assert(render.reused); assert.equal(render.after.builds, render.before.builds);
    assert.equal(render.after.updates - render.before.updates, 100);
    assert(render.skipped >= 2); assert.equal(render.layersAtStart, 2); assert.equal(render.layersAtEnd, 1);
    assert(Math.abs(render.blend - .5) < .01); assert.equal(render.frozenBlend, render.blend);
    assert(!render.turning.includes('scale(-1 1)'), 'Direction should ease rather than flip instantly');
    lines.push('PASS: 100 animation frames reuse SVG and input nodes; identical frames skipped; pose blend and turn eased.');
    controller.sendState();
    powerMonitor.emit('suspend'); powerMonitor.emit('lock-screen');
    assert(controller.state().frozen);
    powerMonitor.emit('resume'); assert(controller.state().frozen, 'Lock must remain after resume');
    powerMonitor.emit('unlock-screen'); assert(!controller.state().frozen);
    lines.push('PASS: suspend/lock reasons freeze independently; resume/unlock restores state and monitor bounds (simulated events).');
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
      for (let step = 1; step <= 24; step++) {
        controller.moveDrag({ x: rect.x + 80 + step, y: rect.y + 72 - Math.min(step, 20) });
        assert(Math.abs(win.getBounds().width - 160) <= 1 && Math.abs(win.getBounds().height - 144) <= 1, 'Repeated movement changed logical size');
      }
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
    for (const pose of ['sitting', 'walking', 'sleeping', 'held', 'stretching', 'grooming', 'petted']) {
      await win.webContents.executeJavaScript(`window.animoPreview.render({pose:'${pose}',time:1.15,poseTime:1.5,gaitTime:1.15,speed:52,facingRight:true,frozen:false})`);
      await wait(80);
      const image = await win.webContents.capturePage();
      assert(!image.isEmpty());
      const pixel = image.toBitmap(), dimensions = image.getSize();
      assert.equal(pixel[3], 0, 'Corner should remain transparent');
      assert.equal(pixel[((dimensions.height - 1) * dimensions.width + dimensions.width - 1) * 4 + 3], 0);
      fs.writeFileSync(path.join(output, `${pose}.png`), image.toPNG());
    }
    await win.webContents.executeJavaScript("window.animoPreview.render({pose:'walking',time:.34,gaitTime:.34,speed:52,facingRight:false})");
    await wait(80);
    fs.writeFileSync(path.join(output, 'walking-left.png'), (await win.webContents.capturePage()).toPNG());
    lines.push('PASS: 7 poses and mirrored walking rendered; transparent corners verified.');
    const preferences = await controller.openPreferences();
    await until(async () => await preferences.webContents.executeJavaScript('document.querySelectorAll("#display option").length') === screen.getAllDisplays().length, 'Preferences did not initialize');
    assert(preferences.isVisible()); assert(preferences.isFocusable()); assert(!preferences.isAlwaysOnTop());
    assert.equal((await controller.openPreferences()).id, preferences.id, 'Settings should reuse one window');
    assert.equal(await preferences.webContents.executeJavaScript('typeof window.require'), 'undefined');
    assert.equal(await preferences.webContents.executeJavaScript('typeof window.animo'), 'undefined');
    assert.equal(await preferences.webContents.executeJavaScript('typeof window.preferences.change'), 'function');
    const invalid = await preferences.webContents.executeJavaScript(`window.preferences.change({kind:'size',value:900}).then(()=>false,()=>true)`);
    assert(invalid); assert.equal(controller.settings.size, 1);
    await preferences.webContents.executeJavaScript('document.querySelector("input[name=size][value=\\"1.35\\"]").click()');
    await until(() => controller.settings.size === 1.35, 'Size control did not apply');
    assert(Math.abs(win.getBounds().width - 216) <= 1);
    await preferences.webContents.executeJavaScript(`document.querySelector('#floor').value='desktop'; document.querySelector('#floor').dispatchEvent(new Event('change'))`);
    await until(() => !controller.brain.floorOnly, 'Walk range did not apply');
    await preferences.webContents.executeJavaScript(`document.querySelector('#click-through').click()`);
    await until(() => controller.settings.clickThrough, 'Click-through did not apply'); assert(controller.isMouseIgnored());
    await preferences.webContents.executeJavaScript(`document.querySelector('#click-through').click()`);
    await until(() => !controller.settings.clickThrough, 'Settings could not recover click-through');
    controller.menu().getMenuItemById('walk')!.click();
    await until(async () => await preferences.webContents.executeJavaScript(`document.querySelector('#roaming').checked`), 'Tray changes did not reach settings');
    await preferences.webContents.executeJavaScript(`document.querySelector('#roaming').click()`);
    await until(() => !controller.brain.roaming, 'Roaming toggle did not apply');
    lines.push('PASS: one focusable sandboxed settings window; size/range/click-through apply live; tray changes synchronize; invalid IPC rejected.');
    for (const display of screen.getAllDisplays()) {
      for (const anchor of ['bottom-left', 'bottom-center', 'bottom-right']) {
        controller.changePreferences({ kind: 'anchor', anchor, displayId: String(display.id) });
        await wait(60);
        const actual = win.getBounds(), area = display.workArea, ratio = anchor === 'bottom-left' ? 0 : anchor === 'bottom-center' ? .5 : 1;
        assert(Math.abs(actual.x - (area.x + (area.width - actual.width) * ratio)) <= 1, JSON.stringify({ anchor, actual, area, width: controller.brain.width, height: controller.brain.height }));
        assert(Math.abs(actual.y + actual.height - area.y - area.height) <= 1); assert(!controller.brain.roaming);
      }
    }
    const selected = screen.getAllDisplays().at(-1)!;
    await preferences.webContents.executeJavaScript(`document.querySelector('#display').value=${JSON.stringify(String(selected.id))}; document.querySelector('#display').dispatchEvent(new Event('change'))`);
    await until(() => controller.display.id === selected.id, 'Monitor selection did not apply');
    await preferences.webContents.executeJavaScript(`document.querySelector('[data-anchor="bottom-right"]').click()`);
    await until(() => Math.abs(win.getBounds().x + win.getBounds().width - selected.workArea.x - selected.workArea.width) <= 1, 'Anchor button did not apply');
    await preferences.webContents.executeJavaScript(`document.querySelector('#preset-name').value='문서 옆'; document.querySelector('#save-form').requestSubmit()`);
    await until(() => controller.settings.presets.length === 1, 'Save position form did not apply');
    const saved = controller.settings.presets[0]; assert.equal(saved.relativeX, 1); assert.equal(saved.relativeY, 1);
    await preferences.webContents.executeJavaScript(`document.querySelector('#preset-name').value='문서 옆'; document.querySelector('#save-form').requestSubmit()`);
    await until(async () => await preferences.webContents.executeJavaScript(`document.querySelector('#status').classList.contains('error')`), 'Duplicate names should report an error');
    assert.equal(controller.settings.presets.length, 1);
    await preferences.webContents.executeJavaScript('document.querySelector("input[name=size][value=\\"0.75\\"]").click()');
    await until(() => controller.settings.size === .75, 'Small size did not apply');
    await preferences.webContents.executeJavaScript(`document.querySelector('[data-anchor="bottom-left"]').click()`);
    await until(() => win.getBounds().x === selected.workArea.x, 'Left anchor did not apply');
    await preferences.webContents.executeJavaScript(`document.querySelector('#hide').click()`);
    await until(() => !win.isVisible(), 'Settings hide button did not apply');
    await preferences.webContents.executeJavaScript(`document.querySelector('[data-load]').click()`);
    await until(() => win.isVisible() && Math.abs(win.getBounds().x + 120 - selected.workArea.x - selected.workArea.width) <= 1, 'Saved position did not restore after resize/hide');
    assert(!controller.brain.roaming); assert(Math.abs(win.getBounds().width - 120) <= 1);
    await preferences.webContents.executeJavaScript(`document.querySelector('#pause').click()`);
    await until(() => controller.preferencesSnapshot().paused, 'Pause button did not apply');
    await preferences.webContents.executeJavaScript(`document.querySelector('#pause').click()`);
    await until(() => !controller.preferencesSnapshot().paused, 'Resume button did not apply');
    await preferences.webContents.executeJavaScript(`document.querySelector('[data-delete]').click()`);
    await until(() => controller.settings.presets.length === 0, 'Delete position button did not apply');
    lines.push('PASS: three anchors on every monitor; GUI saves/loads/deletes positions; resize and hide preserve restoration; duplicate names rejected.');
    controller.changePreferences({ kind: 'size', value: 1 });
    controller.changePreferences({ kind: 'anchor', anchor: 'bottom-right', displayId: String(selected.id) });
    controller.changePreferences({ kind: 'save-position', name: '문서 옆' });
    controller.changePreferences({ kind: 'anchor', anchor: 'bottom-center', displayId: String(selected.id) });
    controller.changePreferences({ kind: 'save-position', name: '잠깐 쉬는 곳' });
    await wait(100);
    await preferences.webContents.executeJavaScript(`document.querySelector('#preset-name').value=''`);
    await preferences.webContents.executeJavaScript(`document.querySelector('[data-load]').click()`);
    await until(async () => (await preferences.webContents.executeJavaScript(`document.querySelector('#status').textContent`)).includes('저장한 자리에 배치'), 'Saved position status did not update');
    fs.writeFileSync(path.join(output, 'preferences.png'), (await preferences.webContents.capturePage()).toPNG());
    const firstId = controller.settings.presets[0].id;
    controller.menu().getMenuItemById(`preset-${firstId}`)!.click();
    assert(!controller.brain.roaming); assert(Math.abs(win.getBounds().x + 160 - selected.workArea.x - selected.workArea.width) <= 1);
    preferences.close(); await wait(50); assert(!win.isDestroyed());
    const reopened = await controller.openPreferences();
    await until(async () => await reopened.webContents.executeJavaScript(`document.querySelectorAll('[data-load]').length`) === 2, 'Saved positions disappeared on reopen');
    reopened.close(); await wait(50);
    lines.push('PASS: saved positions work from native menus and survive settings-window close/reopen; closing settings leaves the cat running.');
    lines.push(`INFO: platform=${process.platform}, Electron=${process.versions.electron}; macOS runtime verification still requires a Mac.`);
    fs.writeFileSync(path.join(output, 'electron-smoke.txt'), lines.join('\n'));
    console.log(lines.join('\n'));
  } catch (error) {
    lines.push('FAIL: ' + String(error)); fs.writeFileSync(path.join(output, 'electron-smoke.txt'), lines.join('\n')); throw error;
  }
}
