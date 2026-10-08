import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, powerMonitor, screen, Tray, type Display, type MenuItemConstructorOptions } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { PetBrain } from './shared/brain.js';
import { menuPoint } from './shared/placement.js';
import { frameInterval } from './shared/cadence.js';
import { defaults, loadSettings, saveSettings } from './settings.js';
import type { PetState, Point, Settings } from './shared/types.js';
import { runSmoke } from './smoke.js';

const smoke = process.argv.includes('--smoke-test');
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
      try { await runSmoke(controller, path.resolve(arg('--output') ?? 'artifacts/electron-verification')); app.quit(); }
      catch (error) { console.error(error); app.exit(1); }
    }
  }).catch(error => { console.error(error); app.exit(1); });
  app.on('before-quit', () => controller?.dispose());
  app.on('window-all-closed', () => app.quit());
}

export class PetController {
  window!: BrowserWindow;
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
    this.settings = testing ? { ...defaults } : loadSettings(this.settingsFile, legacy);
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
    if (rect.x !== x || rect.y !== y) this.window.setPosition(x, y, false);
  }
  setHovered(value: boolean) { this.hovered = value; this.applyMousePolicy(); }
  private applyMousePolicy() {
    const next = !this.dragging && !this.pointerPressed && (this.settings.clickThrough || !this.hovered);
    if (this.ignored !== next) { this.window.setIgnoreMouseEvents(next, { forward: true }); this.ignored = next; }
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
  moveDrag(cursor: Point) { if (this.dragging) this.window.setPosition(Math.round(cursor.x - this.grab.x), Math.round(cursor.y - this.grab.y), false); }
  endDrag() {
    this.pointerPressed = false;
    if (!this.dragging) { this.applyMousePolicy(); this.sendState(); this.restartTick(); return; }
    this.dragging = false;
    const rect = this.window.getBounds();
    this.display = screen.getDisplayMatching(rect); this.brain.setBounds(this.display.workArea);
    this.brain.pin(rect.x, rect.y); this.moveWindow(); this.applyMousePolicy(); this.sendState(); this.refreshTray(); this.save(); this.restartTick();
  }
  setRoaming(value: boolean) { this.brain.setRoaming(value); this.sendState(); this.refreshTray(); this.save(); }
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
    this.endDrag(); this.hidden = !this.hidden;
    if (this.hidden) this.window.hide(); else { this.window.showInactive(); this.sendState(); }
    this.refreshTray(); this.restartTick();
  }
  recall() {
    this.endDrag(); this.settings.clickThrough = false; this.paused = false; this.hidden = false;
    this.window.showInactive(); this.moveToDisplay(screen.getPrimaryDisplay()); this.brain.pin();
    this.setHovered(false); this.sendState(); this.refreshTray(); this.save();
  }
  menu(): Menu {
    const checkbox = (id: string, label: string, checked: boolean, click: () => void): MenuItemConstructorOptions => ({ id, label, type: 'checkbox', checked, click });
    const template: MenuItemConstructorOptions[] = [
      { label: 'Animo · 작은 고양이', enabled: false }, { type: 'separator' },
      checkbox('walk', '산책 모드', this.brain.roaming, () => this.setRoaming(true)),
      checkbox('stay', '이 자리에 머물기', !this.brain.roaming, () => this.setRoaming(false)),
      checkbox('floor', '화면 아래쪽에서만 산책', this.brain.floorOnly, () => { this.brain.floorOnly = !this.brain.floorOnly; this.brain.setRoaming(this.brain.roaming); this.refreshTray(); this.save(); }),
      checkbox('pause', '잠시 멈추기', this.paused, () => { this.paused = !this.paused; this.refreshTray(); this.sendState(); }),
      { type: 'separator' },
      { label: '고양이 크기', submenu: [['작게', .75], ['보통', 1], ['크게', 1.35]].map(([label, size]) => checkbox(`size-${size}`, String(label), this.settings.size === size, () => this.setSize(Number(size)))) },
      { label: '모니터로 이동', submenu: screen.getAllDisplays().map((display, index) => checkbox(`display-${display.id}`, `모니터 ${index + 1}${display.id === screen.getPrimaryDisplay().id ? ' (주 화면)' : ''}`, display.id === this.display.id, () => this.moveToDisplay(display))) },
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
    this.menuOpen = true; this.sendState(); this.popup = this.menu();
    this.popup.popup({ window: this.window, x, y, callback: () => { this.menuOpen = false; this.popup = undefined; this.sendState(); } });
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
  private refreshTray() { this.tray?.setContextMenu(this.menu()); }
  save() {
    if (this.testing || this.disposed) return;
    const a = this.display.workArea;
    Object.assign(this.settings, { displayId: String(this.display.id), displayLabel: this.display.label,
      relativeX: Math.max(0, Math.min(1, (this.brain.x - a.x) / Math.max(1, a.width - this.brain.width))),
      relativeY: Math.max(0, Math.min(1, (this.brain.y - a.y) / Math.max(1, a.height - this.brain.height))),
      roaming: this.brain.roaming, floorOnly: this.brain.floorOnly });
    try { saveSettings(this.settingsFile, this.settings); }
    catch (error) { console.error('Settings save failed:', error); if (!this.warnedSave) { this.warnedSave = true; void dialog.showMessageBox({ title: 'Animo', type: 'warning', message: '설정을 저장하지 못했습니다. 다음 실행에서는 위치가 초기화될 수 있습니다.' }); } }
  }
  dispose() {
    if (this.disposed) return;
    this.save(); this.disposed = true;
    if (this.timer) clearTimeout(this.timer); if (this.saveTimer) clearInterval(this.saveTimer);
    globalShortcut.unregisterAll(); this.tray?.destroy();
    screen.removeListener('display-added', this.refreshDisplays); screen.removeListener('display-removed', this.refreshDisplays); screen.removeListener('display-metrics-changed', this.refreshDisplays);
    powerMonitor.removeListener('suspend', this.suspend); powerMonitor.removeListener('resume', this.resume);
    powerMonitor.removeListener('lock-screen', this.lock); powerMonitor.removeListener('unlock-screen', this.unlock);
    powerMonitor.removeListener('on-battery', this.onBattery); powerMonitor.removeListener('on-ac', this.onAC);
  }
  stopForVerification() { this.verificationStopped = true; if (this.timer) clearTimeout(this.timer); }
}
