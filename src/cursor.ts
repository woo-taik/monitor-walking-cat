import { spawn, type ChildProcess } from 'node:child_process';
import type { Point } from './shared/types.js';

type Worker = { child: ChildProcess; ready: boolean; pushing: boolean; preparation: Promise<boolean>; finish: (success: boolean) => void };
let active: Worker | undefined;

function command() {
  // Prepare native APIs before the paw animation, then wait for one path on stdin.
  // Position APIs do not synthesize input or require accessibility permission.
  if (process.platform === 'darwin') return { file: 'osascript', args: ['-l', 'JavaScript', '-e',
    `ObjC.import('CoreGraphics');ObjC.import('Foundation');
$.NSFileHandle.fileHandleWithStandardOutput.writeData($('READY\\n').dataUsingEncoding($.NSUTF8StringEncoding));
var data=$.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
var input=$.NSString.alloc.initWithDataEncoding(data,$.NSUTF8StringEncoding).js;
JSON.parse(input).forEach(function(p){$.CGWarpMouseCursorPosition($.CGPointMake(p[0],p[1]));delay(0.016)});`] };
  if (process.platform === 'win32') return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command',
    `$ErrorActionPreference='Stop';Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class AnimoCursor {
  [DllImport("user32.dll", SetLastError = true)] private static extern bool SetPhysicalCursorPos(int x, int y);
  public static void Move(int x, int y) {
    if (!SetPhysicalCursorPos(x, y)) throw new Win32Exception(Marshal.GetLastWin32Error());
  }
}
'@
[Console]::Out.WriteLine('READY');[Console]::Out.Flush()
$path = [Console]::ReadLine()
if ($path) { $points = ConvertFrom-Json -InputObject $path; foreach ($point in $points) { [AnimoCursor]::Move($point[0],$point[1]);Start-Sleep -Milliseconds 16 } }`] };
  return undefined;
}

/** Warm one helper without moving the cursor. Repeated preparation reuses it. */
export function prepareCursorPush(): Promise<boolean> {
  if (active) return active.preparation;
  const spec = command();
  if (!spec) return Promise.resolve(false);
  let child: ChildProcess;
  try { child = spawn(spec.file, spec.args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); }
  catch (error) { console.warn('Cursor push could not start:', error); return Promise.resolve(false); }
  let prepared!: (success: boolean) => void;
  const worker: Worker = { child, ready: false, pushing: false, preparation: new Promise(resolve => { prepared = resolve; }), finish: () => {} };
  active = worker;
  let output = '', errors = '';
  const timeout = setTimeout(() => {
    if (active !== worker || worker.ready) return;
    console.warn('Cursor push helper did not become ready.'); cancelCursorPush();
  }, 5000);
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', chunk => {
    if (active !== worker) return;
    output += String(chunk);
    if (!worker.ready && /(?:^|\n)READY\r?\n/.test(output)) { clearTimeout(timeout); worker.ready = true; prepared(true); }
    if (output.length > 4096) output = output.slice(-4096);
  });
  child.stderr?.on('data', chunk => { if (errors.length < 4096) errors += String(chunk).slice(0, 4096 - errors.length); });
  child.stdin?.on('error', error => {
    if (active === worker) { console.warn('Cursor push input failed:', error.message); cancelCursorPush(); }
  });
  child.on('error', error => { console.warn('Cursor push could not start:', error.message); });
  child.on('close', code => {
    clearTimeout(timeout);
    const cancelled = active !== worker;
    if (!cancelled) active = undefined;
    prepared(false);
    if (!cancelled && code !== 0) console.warn('Cursor push failed:', errors.trim() || `exit code ${code}`);
    worker.finish(!cancelled && worker.pushing && code === 0);
  });
  return worker.preparation;
}

export function isCursorPushReady() { return !!active?.ready && !active.pushing; }

/** Dispatch one prepared shove immediately. Coordinates are physical pixels. */
export async function pushCursor(path: Point[]): Promise<boolean> {
  if (!path.length || active?.pushing) return false;
  const preparation = prepareCursorPush();
  const worker = active;
  if (!await preparation || active !== worker || !worker?.ready || worker.pushing) return false;
  worker.pushing = true;
  return new Promise(resolve => {
    worker.finish = resolve;
    worker.child.stdin!.end(JSON.stringify(path.map(p => [Math.round(p.x), Math.round(p.y)])) + '\n');
  });
}

export function cancelCursorPush() {
  const worker = active; active = undefined;
  worker?.child.kill();
}
