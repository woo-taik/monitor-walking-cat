import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, powerMonitor, screen, Tray, type Display, type MenuItemConstructorOptions } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { PetBrain } from './shared/brain.js';
import { menuPoint } from './shared/placement.js';
import { frameInterval } from './shared/cadence.js';
import { anchorPosition, relativePosition, resolvePreset } from './shared/presets.js';
import { defaults, loadSettings, saveSettings } from './settings.js';
import type { Anchor, PetState, Point, PreferencesSnapshot, Settings } from './shared/types.js';
import { runSmoke } from './smoke.js';
import { runCiSmoke } from './ci-smoke.js';

const ciSmoke = process.argv.includes('--ci-smoke-test');
const smoke = ciSmoke || process.argv.includes('--smoke-test');
const arg = (key: string) => { const i = process.argv.indexOf(key); return i >= 0 ? process.argv[i + 1] : undefined; };
app.setName('Animo');
if (smoke) {
  const dir = path.join(os.tmpdir(), `animo-smoke-${process.pid}`);
  fs.mkdirSync(dir, { recursive: true }); app.setPath('userData', dir);
}
const acquired = smoke || app.requestSingleInstanceLock();
let controller: PetController | undefined;
if (!acquired) app.quit();
else {
  app.on('second-instance', () => controller?.recall());
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    if (process.platform === 'darwin') app.dock?.hide();
    controller = new PetController(smoke);
    await controller.start();
    if (smoke) {
      try { await (ciSmoke ? runCiSmoke : runSmoke)(controller, path.resolve(arg('--output') ?? 'artifacts/electron-verification')); app.quit(); }
      catch (error) { console.error(error); app.exit(1); }
    }
  }).catch(error => { console.error(error); app.exit(1); });
  app.on('before-quit', () => controller?.dispose());
  app.on('window-all-closed', () => app.quit());
}

export class PetController {
  window!: BrowserWindow;
  preferencesWindow?: BrowserWindow;
  private preferencesOpening?: Promise<BrowserWindow>;
  brain: PetBrain;
  settings: Settings;
  tray?: Tray;
  display: Display;
  private time = 1;
  private timer?: NodeJS.Timeout;
  private saveTimer?: NodeJS.Timeout;
  private lastTick = performance.now();
  private hovered = false;
  private ignored = false;
  private dragging = false;
  private pointerPressed = false;
  private grab = { x: 0, y: 0 };
  private menuOpen = false;
  private popup?: Menu;
  private paused = false;
  private hidden = false;
  private shortcutHide = false;
  private shortcutRecall = false;
  private disposed = false;
  private warnedSave = false;
  private saveFailed = false;
  private battery = false;
  private readonly systemStops = new Set<string>();
  private lastState = '';
  private lastCursor = '';
  private verificationStopped = false;
  private readonly settingsFile = path.join(app.getPath('userData'), 'settings.json');
  isMenuOpen() { return this.menuOpen; }
  isMouseIgnored() { return this.ignored; }

  constructor(private readonly testing: boolean) {
    const legacy = process.platform === 'win32' && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Animo', 'settings.json') : undefined;
    this.settings = testing ? { ...defaults, presets: [] } : loadSettings(this.settingsFile, legacy);
    const displays = screen.getAllDisplays();
    const legacyIndex = /DISPLAY(\d+)$/.exec(this.settings.displayLabel);
    this.display = displays.find(d => String(d.id) === this.settings.displayId)
      ?? displays.find(d => d.label === this.settings.displayLabel)
      ?? (legacyIndex ? displays[Number(legacyIndex[1]) - 1] : undefined)
      ?? screen.getPrimaryDisplay();
    this.brain = new PetBrain(this.display.workArea);
    this.brain.width = Math.round(160 * this.settings.size); this.brain.height = Math.round(144 * this.settings.size);
    this.brain.floorOnly = this.settings.floorOnly; this.brain.setRoaming(this.settings.roaming);
    const area = this.display.workArea;
    this.brain.setPosition(area.x + Math.max(0, area.width - this.brain.width) * this.settings.relativeX, area.y + Math.max(0, area.height - this.brain.height) * this.settings.relativeY);
  }

  async start() {
    this.window = new BrowserWindow({
      x: Math.round(this.brain.x), y: Math.round(this.brain.y), width: this.brain.width, height: this.brain.height,
      title: 'Animo · 작은 고양이', transparent: true, backgroundColor: '#00000000', frame: false,
      resizable: false, maximizable: false, minimizable: false, fullscreenable: false, focusable: false,
      skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: false, acceptFirstMouse: true,
      hiddenInMissionControl: true, ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
      icon: path.join(__dirname, '../assets/animo.png'),
      webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false }
    });
    this.window.setAlwaysOnTop(true, 'floating');
    this.configureWorkspaces();
    this.window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.window.webContents.on('will-navigate', event => event.preventDefault());
    this.window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    this.window.webContents.on('render-process-gone', () => { if (!this.disposed) app.quit(); });
    this.window.on('closed', () => { if (!this.disposed) app.quit(); });
    this.registerIPC();
    await this.window.loadFile(path.join(__dirname, '../web/index.html'), { query: this.testing ? { preview: '1' } : {} });
    this.window.showInactive();
    this.setHovered(false);
    this.createTray();
    if (!this.testing) {
      const prefix = process.platform === 'darwin' ? 'Command+Option' : 'Control+Alt';
      this.shortcutHide = globalShortcut.register(`${prefix}+C`, () => this.toggleHidden());
      this.shortcutRecall = globalShortcut.register(`${prefix}+R`, () => this.recall());
      this.saveTimer = setInterval(() => this.save(), 15000);
    }
    this.lastTick = performance.now();
    this.battery = powerMonitor.isOnBatteryPower();
    powerMonitor.on('suspend', this.suspend); powerMonitor.on('resume', this.resume);
    powerMonitor.on('lock-screen', this.lock); powerMonitor.on('unlock-screen', this.unlock);
    powerMonitor.on('on-battery', this.onBattery); powerMonitor.on('on-ac', this.onAC);
    this.scheduleTick();
    screen.on('display-added', this.refreshDisplays);
    screen.on('display-removed', this.refreshDisplays);
    screen.on('display-metrics-changed', this.refreshDisplays);
    this.sendState();
  }

  private registerIPC() {
    const trusted = (event: Electron.IpcMainEvent) => event.sender === this.window.webContents && event.senderFrame === this.window.webContents.mainFrame;
    ipcMain.on('pet:ready', event => { if (trusted(event)) this.sendState(); });
    ipcMain.on('pet:hover', (event, over) => { if (trusted(event) && typeof over === 'boolean') this.setHovered(over); });
    ipcMain.on('pet:press', event => { if (trusted(event) && !this.settings.clickThrough) this.beginPress(); });
    ipcMain.on('pet:pet', event => { if (trusted(event) && this.hovered && !this.settings.clickThrough) this.pet(); });
    ipcMain.on('pet:drag-start', event => { if (trusted(event) && !this.settings.clickThrough) this.beginDrag(screen.getCursorScreenPoint()); });
    ipcMain.on('pet:drag-end', event => { if (trusted(event)) this.endDrag(); });
    ipcMain.on('pet:menu', (event, point) => {
      if (trusted(event) && !this.settings.clickThrough && point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
        const bounds = this.window.getBounds();
        this.showMenu({ x: bounds.x + Math.max(0, Math.min(bounds.width, point.x)), y: bounds.y + Math.max(0, Math.min(bounds.height, point.y)) });
      }
    });
    const preferencesTrusted = (event: Electron.IpcMainInvokeEvent) => this.preferencesWindow && !this.preferencesWindow.isDestroyed()
      && event.sender === this.preferencesWindow.webContents && event.senderFrame === this.preferencesWindow.webContents.mainFrame;
    ipcMain.handle('preferences:read', event => {
      if (!preferencesTrusted(event)) throw new Error('설정 창에서만 사용할 수 있습니다.');
      return this.preferencesSnapshot();
    });
    ipcMain.handle('preferences:change', (event, command: unknown) => {
      if (!preferencesTrusted(event)) throw new Error('설정 창에서만 사용할 수 있습니다.');
      return this.changePreferences(command);
    });
  }

  async openPreferences(): Promise<BrowserWindow> {
    if (this.preferencesOpening) return this.preferencesOpening;
    if (this.preferencesWindow && !this.preferencesWindow.isDestroyed()) {
      this.showPreferences(this.preferencesWindow); return this.preferencesWindow;
    }
    this.endDrag();
    const win = new BrowserWindow({ width: 760, height: 800, minWidth: 640, minHeight: 580, title: 'Animo 설정', show: false,
      backgroundColor: '#f9f7f3', autoHideMenuBar: true, icon: path.join(__dirname, '../assets/animo.png'),
      webPreferences: { preload: path.join(__dirname, 'preferences-preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
    this.preferencesWindow = win;
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.on('closed', () => { if (this.preferencesWindow === win) this.preferencesWindow = undefined; });
    const opening = (async () => {
      try { await win.loadFile(path.join(__dirname, '../web/preferences.html')); if (win.isDestroyed()) throw new Error('설정 창이 닫혔습니다.'); this.showPreferences(win); return win; }
      catch (error) { if (!win.isDestroyed()) win.destroy(); throw error; }
    })();
    this.preferencesOpening = opening;
    try { return await opening; } finally { if (this.preferencesOpening === opening) this.preferencesOpening = undefined; }
  }
  private showPreferences(win: BrowserWindow) {
    if (win.isMinimized()) win.restore();
    win.show();
    // Windows launchers may supply SW_HIDE for the first normal ShowWindow call.
    // The overlay uses showInactive; an explicit settings request must still show.
    if (process.platform === 'win32' && !win.isVisible()) win.show();
    win.focus();
  }
  preferencesSnapshot(): PreferencesSnapshot {
    return { size: this.settings.size, roaming: this.brain.roaming, floorOnly: this.brain.floorOnly, clickThrough: this.settings.clickThrough,
      allWorkspaces: this.settings.allWorkspaces, hidden: this.hidden, paused: this.paused, platform: process.platform, displayId: String(this.display.id),
      displays: screen.getAllDisplays().map((d, index) => ({ id: String(d.id), name: `모니터 ${index + 1}${d.id === screen.getPrimaryDisplay().id ? ' (주 화면)' : ''}${d.label ? ` · ${d.label}` : ''}` })),
      presets: this.settings.presets.map(p => ({ ...p })) };
  }
  private publishPreferences() {
    if (this.preferencesWindow && !this.preferencesWindow.isDestroyed() && !this.preferencesWindow.webContents.isDestroyed()) this.preferencesWindow.webContents.send('preferences:state', this.preferencesSnapshot());
  }
  private requireDisplay(id: unknown) {
    const display = typeof id === 'string' ? screen.getAllDisplays().find(d => String(d.id) === id) : undefined;
    if (!display) throw new Error('모니터가 연결되어 있지 않습니다. 다른 모니터를 선택해 주세요.');
    return display;
  }
  private place(display: Display, point: Point) {
    this.endDrag(); this.display = display; this.brain.setBounds(display.workArea); this.brain.pin(point.x, point.y); this.moveWindow();
    if (this.hidden) this.showPet();
    this.sendState(); this.refreshTray(); this.save(); this.restartTick();
  }
  private placeAnchor(anchor: Anchor, display: Display) {
    this.place(display, anchorPosition(anchor, display.workArea, this.brain.width, this.brain.height));
  }
  private savePosition(name: string) {
    const clean = name.trim();
    if (!clean || clean.length > 28) throw new Error('자리 이름을 1~28자로 입력해 주세요.');
    if (this.settings.presets.length >= 8) throw new Error('자리는 최대 8개까지 저장할 수 있습니다.');
    if (this.settings.presets.some(p => p.name === clean)) throw new Error('같은 이름의 자리가 있습니다. 다른 이름을 입력해 주세요.');
    this.endDrag();
    const bounds = this.window.getBounds(), display = screen.getDisplayMatching(bounds);
    this.settings.presets = [...this.settings.presets, { id: randomUUID(), name: clean, displayId: String(display.id), displayLabel: display.label,
      ...relativePosition(bounds, display.workArea, this.brain.width, this.brain.height) }];
    this.refreshTray(); this.save();
  }
  private loadPosition(id: string) {
    const preset = this.settings.presets.find(p => p.id === id);
    if (!preset) throw new Error('저장한 자리를 찾지 못했습니다.');
    const result = resolvePreset(preset, screen.getAllDisplays().map(d => ({ id: String(d.id), workArea: d.workArea })), String(screen.getPrimaryDisplay().id), this.brain.width, this.brain.height);
    this.place(this.requireDisplay(result.displayId), result.point); return result.fallback;
  }
  changePreferences(command: unknown): { snapshot: PreferencesSnapshot; notice?: string } {
    if (!command || typeof command !== 'object') throw new Error('설정을 확인해 주세요.');
    const c = command as Record<string, unknown>; let notice: string | undefined;
    const boolean = () => { if (typeof c.value !== 'boolean') throw new Error('설정 값을 확인해 주세요.'); return c.value; };
    const id = () => { if (typeof c.id !== 'string') throw new Error('자리를 선택해 주세요.'); return c.id; };
    switch (c.kind) {
      case 'size': if (typeof c.value !== 'number' || ![.75, 1, 1.35].includes(c.value)) throw new Error('고양이 크기를 선택해 주세요.'); this.setSize(c.value); break;
      case 'roaming': this.setRoaming(boolean()); break;
      case 'floor-only': this.setFloorOnly(boolean()); break;
      case 'click-through': this.setClickThrough(boolean()); break;
      case 'paused': this.setPaused(boolean()); break;
      case 'hidden': if (boolean() !== this.hidden) this.toggleHidden(); break;
      case 'all-workspaces': {
        const value = boolean(); if (process.platform !== 'darwin') throw new Error('Mac에서 사용할 수 있는 설정입니다.');
        this.settings.allWorkspaces = value; this.configureWorkspaces(); this.refreshTray(); this.save(); break;
      }
      case 'display': this.moveToDisplay(this.requireDisplay(c.id)); break;
      case 'anchor': {
        if (typeof c.anchor !== 'string' || !['bottom-left', 'bottom-center', 'bottom-right'].includes(c.anchor)) throw new Error('배치할 자리를 선택해 주세요.');
        this.placeAnchor(c.anchor as Anchor, this.requireDisplay(c.displayId)); notice = '선택한 자리에 배치했습니다. 산책은 멈췄어요.'; break;
      }
      case 'save-position': if (typeof c.name !== 'string') throw new Error('자리 이름을 입력해 주세요.'); this.savePosition(c.name); notice = '현재 위치를 저장했습니다.'; break;
      case 'load-position': notice = this.loadPosition(id()) ? '저장했던 모니터가 연결되어 있지 않아 주 화면에 배치했습니다.' : '저장한 자리에 배치했습니다. 산책은 멈췄어요.'; break;
      case 'delete-position': {
        const key = id(); if (!this.settings.presets.some(p => p.id === key)) throw new Error('저장한 자리를 찾지 못했습니다.');
        this.settings.presets = this.settings.presets.filter(p => p.id !== key); this.refreshTray(); this.save(); notice = '저장한 자리를 삭제했습니다.'; break;
      }
      default: throw new Error('지원하지 않는 설정입니다.');
    }
    if (this.saveFailed && !['paused', 'hidden'].includes(String(c.kind))) notice = '변경은 적용했지만 설정 파일을 저장하지 못했습니다. 다음 실행에서 복원되지 않을 수 있어요.';
    return { snapshot: this.preferencesSnapshot(), notice };
  }

  private tick() {
    if (this.disposed || this.window.isDestroyed()) return;
    const now = performance.now(), delta = Math.min(.25, (now - this.lastTick) / 1000); this.lastTick = now;
    if (this.hidden || this.systemStops.size) return;
    if (this.dragging) { this.moveDrag(screen.getCursorScreenPoint()); if (!this.paused) this.time += delta; }
    else if (!this.paused && !this.menuOpen && !this.pointerPressed) {
      this.brain.tick(delta); this.time += delta; this.moveWindow();
    }
    this.sendState();
    this.sendCursor();
  }
  private sendCursor() {
    const cursor = screen.getCursorScreenPoint(), bounds = this.window.getBounds();
    const local = { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
    if (this.settings.clickThrough || local.x < 0 || local.y < 0 || local.x >= bounds.width || local.y >= bounds.height) { local.x = -1; local.y = -1; }
    const key = `${local.x},${local.y}`;
    if (key !== this.lastCursor) { this.lastCursor = key; this.window.webContents.send('pet:cursor', local); }
  }

  private scheduleTick() {
    if (this.disposed || this.verificationStopped) return;
    const frozen = !this.dragging && (this.paused || this.menuOpen || this.pointerPressed);
    const pose = this.dragging || (this.brain.poseTime < .4 && !frozen) ? 'walking' : this.brain.pose;
    this.timer = setTimeout(() => { this.tick(); this.scheduleTick(); }, frameInterval(pose, frozen, this.hidden || this.systemStops.size > 0, this.battery));
  }
  private restartTick() { if (this.timer) clearTimeout(this.timer); this.scheduleTick(); }
  private systemStop(reason: string, stopped: boolean) {
    if (stopped) { this.endDrag(); this.closeMenu(); this.save(); this.systemStops.add(reason); }
    else { this.systemStops.delete(reason); if (!this.systemStops.size) this.refreshDisplays(); }
    this.lastTick = performance.now(); this.sendState();
    if (this.timer) clearTimeout(this.timer); this.scheduleTick();
  }
  private suspend = () => this.systemStop('suspend', true);
  private resume = () => this.systemStop('suspend', false);
  private lock = () => this.systemStop('lock', true);
  private unlock = () => this.systemStop('lock', false);
  private onBattery = () => { this.battery = true; };
  private onAC = () => { this.battery = false; };

  state(): PetState { return { pose: this.brain.pose, facingRight: this.brain.facingRight, time: this.time, size: this.settings.size,
    clickThrough: this.settings.clickThrough, frozen: this.paused || this.hidden || this.menuOpen || (this.pointerPressed && !this.dragging) || this.systemStops.size > 0,
    poseTime: this.brain.poseTime, gaitTime: this.brain.gaitTime, speed: this.brain.speed / (this.brain.width / 160) }; }
  sendState() {
    if (this.window.isDestroyed()) return;
    const state = this.state(), key = JSON.stringify(state);
    if (key !== this.lastState) { this.lastState = key; this.window.webContents.send('pet:state', state); }
  }
  private moveWindow() {
    const rect = this.window.getBounds(), x = Math.round(this.brain.x), y = Math.round(this.brain.y);
    // Keep logical dimensions explicit: on mixed-DPI Windows screens, position-only
    // moves can accumulate rounding in a frameless non-resizable window's size.
    if (rect.x !== x || rect.y !== y || Math.abs(rect.width - this.brain.width) > 1 || Math.abs(rect.height - this.brain.height) > 1)
      this.window.setBounds({ x, y, width: this.brain.width, height: this.brain.height }, false);
  }
  setHovered(value: boolean) { this.hovered = value; this.applyMousePolicy(); }
  private applyMousePolicy(force = false) {
    const next = !this.menuOpen && !this.dragging && !this.pointerPressed && (this.settings.clickThrough || !this.hovered);
    if (force || this.ignored !== next) { this.window.setIgnoreMouseEvents(next, { forward: true }); this.ignored = next; }
  }
  setClickThrough(value: boolean) { this.endDrag(); this.settings.clickThrough = value; this.applyMousePolicy(); this.sendState(); this.refreshTray(); this.save(); }
  beginPress() {
    if (this.settings.clickThrough || this.menuOpen || this.hidden || this.systemStops.size || this.pointerPressed) return;
    const bounds = this.window.getBounds(), cursor = screen.getCursorScreenPoint();
    this.grab = { x: cursor.x - bounds.x, y: cursor.y - bounds.y }; this.pointerPressed = true;
    this.applyMousePolicy(); this.sendState(); this.restartTick();
  }
  pet() {
    if (this.dragging || this.pointerPressed || this.settings.clickThrough || this.menuOpen || this.paused || this.hidden || this.systemStops.size) return false;
    const accepted = this.brain.pet(); if (accepted) { this.sendState(); this.refreshTray(); this.restartTick(); } return accepted;
  }
  beginDrag(cursor: Point) {
    if (this.dragging || this.settings.clickThrough || this.menuOpen || this.hidden || this.systemStops.size) return;
    const bounds = this.window.getBounds();
    if (!this.pointerPressed) this.grab = { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
    this.dragging = true;
    this.brain.hold(); this.applyMousePolicy(); this.sendState(); this.restartTick();
  }
  moveDrag(cursor: Point) { if (this.dragging) this.window.setBounds({ x: Math.round(cursor.x - this.grab.x), y: Math.round(cursor.y - this.grab.y), width: this.brain.width, height: this.brain.height }, false); }
  endDrag() {
    this.pointerPressed = false;
    if (!this.dragging) { this.applyMousePolicy(); this.sendState(); this.restartTick(); return; }
    this.dragging = false;
    const rect = this.window.getBounds();
    this.display = screen.getDisplayMatching(rect); this.brain.setBounds(this.display.workArea);
    this.brain.pin(rect.x, rect.y); this.moveWindow(); this.applyMousePolicy(); this.sendState(); this.refreshTray(); this.save(); this.restartTick();
  }
  setRoaming(value: boolean) { this.brain.setRoaming(value); this.sendState(); this.refreshTray(); this.save(); }
  setFloorOnly(value: boolean) { this.brain.floorOnly = value; this.brain.setRoaming(this.brain.roaming); this.sendState(); this.refreshTray(); this.save(); }
  setPaused(value: boolean) { this.endDrag(); this.paused = value; this.sendState(); this.refreshTray(); this.restartTick(); }
  setSize(size: number) {
    if (![.75, 1, 1.35].includes(size)) return;
    const foot = { x: this.brain.x + this.brain.width / 2, y: this.brain.y + this.brain.height };
    this.settings.size = size; this.brain.width = Math.round(160 * size); this.brain.height = Math.round(144 * size);
    this.brain.setPosition(foot.x - this.brain.width / 2, foot.y - this.brain.height);
    // Transparent windows stay non-resizable by the user; programmatic bounds still work.
    this.window.setBounds({ x: Math.round(this.brain.x), y: Math.round(this.brain.y), width: this.brain.width, height: this.brain.height });
    this.sendState(); this.refreshTray(); this.save();
  }
  moveToDisplay(display: Display) {
    this.endDrag(); this.display = display; this.brain.setBounds(display.workArea);
    this.brain.setPosition(display.workArea.x + (display.workArea.width - this.brain.width) / 2, display.workArea.y + display.workArea.height - this.brain.height);
    this.moveWindow(); this.refreshTray(); this.save();
  }
  private refreshDisplays = () => {
    if (this.disposed || this.dragging) return;
    this.display = screen.getDisplayMatching(this.window.getBounds());
    this.brain.setBounds(this.display.workArea); this.moveWindow(); this.refreshTray(); this.save();
  };
  private configureWorkspaces() {
    if (process.platform === 'darwin') this.window.setVisibleOnAllWorkspaces(this.settings.allWorkspaces, { visibleOnFullScreen: true, skipTransformProcessType: true });
  }
  toggleHidden() {
    this.closeMenu(); this.endDrag();
    if (this.hidden) this.showPet();
    else { this.hidden = true; this.window.hide(); this.resetPointerInput(); }
    this.sendState();
    this.refreshTray(); this.restartTick();
  }
  private resetPointerInput() {
    this.window.webContents.send('pet:reset-input');
    this.hovered = false; this.lastCursor = '';
    // Reapply native input policy and hover position after a visibility transition.
    this.applyMousePolicy(true);
    if (!this.hidden) this.sendCursor();
  }
  private showPet() { this.hidden = false; this.window.showInactive(); this.resetPointerInput(); }
  recall() {
    this.endDrag(); this.settings.clickThrough = false; this.paused = false; this.hidden = false;
    this.showPet(); this.moveToDisplay(screen.getPrimaryDisplay()); this.brain.pin();
    this.setHovered(false); this.sendState(); this.refreshTray(); this.save();
  }
  menu(): Menu {
    const checkbox = (id: string, label: string, checked: boolean, click: () => void): MenuItemConstructorOptions => ({ id, label, type: 'checkbox', checked, click });
    const template: MenuItemConstructorOptions[] = [
      { label: 'Animo · 작은 고양이', enabled: false }, { type: 'separator' },
      { id: 'settings', label: '설정…', click: () => { void this.openPreferences().catch(error => { console.error(error); }); } },
      checkbox('walk', '산책 모드', this.brain.roaming, () => this.setRoaming(true)),
      checkbox('stay', '이 자리에 머물기', !this.brain.roaming, () => this.setRoaming(false)),
      checkbox('floor', '화면 아래쪽에서만 산책', this.brain.floorOnly, () => this.setFloorOnly(!this.brain.floorOnly)),
      checkbox('pause', '잠시 멈추기', this.paused, () => this.setPaused(!this.paused)),
      { type: 'separator' },
      { label: '고양이 크기', submenu: [['작게', .75], ['보통', 1], ['크게', 1.35]].map(([label, size]) => checkbox(`size-${size}`, String(label), this.settings.size === size, () => this.setSize(Number(size)))) },
      { label: '모니터로 이동', submenu: screen.getAllDisplays().map((display, index) => checkbox(`display-${display.id}`, `모니터 ${index + 1}${display.id === screen.getPrimaryDisplay().id ? ' (주 화면)' : ''}`, display.id === this.display.id, () => this.moveToDisplay(display))) },
      { label: '자리 배치', submenu: [
        ...(['bottom-left', 'bottom-center', 'bottom-right'] as const).map((anchor, index) => ({ label: ['왼쪽 아래', '가운데 아래', '오른쪽 아래'][index], click: () => this.placeAnchor(anchor, this.display) })),
        ...(this.settings.presets.length ? [{ type: 'separator' as const }, ...this.settings.presets.map(p => ({ id: `preset-${p.id}`, label: process.platform === 'win32' ? p.name.replace(/&/g, '&&') : p.name, click: () => { const fallback = this.loadPosition(p.id); if (fallback) void dialog.showMessageBox({ title: 'Animo', message: '저장했던 모니터가 연결되어 있지 않아 주 화면에 배치했습니다.' }); } }))] : [])
      ] },
      checkbox('click-through', '고양이도 클릭 통과', this.settings.clickThrough, () => this.setClickThrough(!this.settings.clickThrough)),
      { id: 'hide', label: this.hidden ? '고양이 보이기' : '고양이 숨기기', click: () => this.toggleHidden() },
      { id: 'recall', label: '고양이 찾기 · 위치 초기화', click: () => this.recall() }
    ];
    if (process.platform === 'darwin') template.push(checkbox('workspaces', '모든 데스크톱에서 표시', this.settings.allWorkspaces, () => { this.settings.allWorkspaces = !this.settings.allWorkspaces; this.configureWorkspaces(); this.refreshTray(); this.save(); }));
    template.push({ type: 'separator' }, { label: '사용 방법', click: () => {
      const prefix = process.platform === 'darwin' ? '⌘+⌥' : 'Ctrl+Alt';
      void dialog.showMessageBox({ title: 'Animo 사용 방법', message: '끌어서 놓으면 그 자리에 머뭅니다.', detail:
        `고양이 또는 ${process.platform === 'darwin' ? '메뉴 막대' : '트레이'} 아이콘을 우클릭해 산책을 시작하세요.\n\n` +
        `짧게 클릭하거나 커서로 문지르면 쓰다듬습니다. 조금 끌면 배치할 수 있습니다.\n‘고양이도 클릭 통과’를 켜면 아이콘 메뉴에서 조작하세요.\n${prefix}+C: 숨기기 / 보이기${this.shortcutHide ? '' : ' (단축키 사용 불가)'}\n${prefix}+R: 고양이 찾기${this.shortcutRecall ? '' : ' (단축키 사용 불가)'}\n\n설정은 종료할 때와 15초마다 저장됩니다.` });
    } }, { id: 'quit', label: '종료', click: () => app.quit() });
    return Menu.buildFromTemplate(template);
  }
  showMenu(point: Point) {
    if (this.menuOpen || this.dragging) return;
    const display = screen.getDisplayNearestPoint(point);
    const { x, y } = menuPoint(point, this.window.getBounds(), display.workArea);
    const popup = this.menu();
    this.menuOpen = true; this.popup = popup; this.applyMousePolicy(); this.sendState(); this.restartTick();
    // Windows native menus need an active owner to dismiss on outside input and Escape.
    // The cat normally never takes focus; allow it only for this explicit menu request.
    const focusOwner = process.platform === 'win32';
    const closed = () => {
      if (this.popup !== popup) return;
      this.menuOpen = false; this.popup = undefined;
      if (this.window.isDestroyed()) return;
      if (focusOwner) this.window.setFocusable(false);
      this.applyMousePolicy(); this.sendState(); this.restartTick();
    };
    try {
      if (focusOwner) { this.window.setFocusable(true); this.window.focus(); }
      popup.popup({ window: this.window, x, y, callback: closed });
    } catch (error) { closed(); throw error; }
  }
  closeMenu() { this.popup?.closePopup(this.window); }
  private createTray() {
    const image = nativeImage.createFromPath(path.join(__dirname, '../assets', process.platform === 'darwin' ? 'trayTemplate.png' : 'animo.png'));
    const icon = image.resize({ width: process.platform === 'darwin' ? 20 : 32 });
    if (process.platform === 'darwin') icon.setTemplateImage(true);
    this.tray = new Tray(icon); this.tray.setToolTip('Animo · 작은 고양이');
    this.refreshTray();
    this.tray.on('double-click', () => this.recall());
  }
  private refreshTray() { this.tray?.setContextMenu(this.menu()); this.publishPreferences(); }
  save() {
    if (this.testing || this.disposed) return;
    const a = this.display.workArea;
    Object.assign(this.settings, { displayId: String(this.display.id), displayLabel: this.display.label,
      relativeX: Math.max(0, Math.min(1, (this.brain.x - a.x) / Math.max(1, a.width - this.brain.width))),
      relativeY: Math.max(0, Math.min(1, (this.brain.y - a.y) / Math.max(1, a.height - this.brain.height))),
      roaming: this.brain.roaming, floorOnly: this.brain.floorOnly });
    try { saveSettings(this.settingsFile, this.settings); this.saveFailed = false; }
    catch (error) { this.saveFailed = true; console.error('Settings save failed:', error); if (!this.warnedSave) { this.warnedSave = true; void dialog.showMessageBox({ title: 'Animo', type: 'warning', message: '설정을 저장하지 못했습니다. 다음 실행에서는 위치가 초기화될 수 있습니다.' }); } }
  }
  dispose() {
    if (this.disposed) return;
    this.save(); this.disposed = true;
    this.preferencesWindow?.destroy();
    if (this.timer) clearTimeout(this.timer); if (this.saveTimer) clearInterval(this.saveTimer);
    globalShortcut.unregisterAll(); this.tray?.destroy();
    screen.removeListener('display-added', this.refreshDisplays); screen.removeListener('display-removed', this.refreshDisplays); screen.removeListener('display-metrics-changed', this.refreshDisplays);
    powerMonitor.removeListener('suspend', this.suspend); powerMonitor.removeListener('resume', this.resume);
    powerMonitor.removeListener('lock-screen', this.lock); powerMonitor.removeListener('unlock-screen', this.unlock);
    powerMonitor.removeListener('on-battery', this.onBattery); powerMonitor.removeListener('on-ac', this.onAC);
  }
  stopForVerification() { this.verificationStopped = true; if (this.timer) clearTimeout(this.timer); }
  resumeForVerification() { this.verificationStopped = false; this.lastTick = performance.now(); this.restartTick(); }
}
