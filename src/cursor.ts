import { spawn, type ChildProcess } from 'node:child_process';
import type { Point } from './shared/types.js';

let active: ChildProcess | undefined;

function command(points: number[][]) {
  // CoreGraphics warps the cursor and the Windows API sets its position. Neither
  // synthesizes input, so no accessibility or input-monitoring permission is requested.
  if (process.platform === 'darwin') return { file: 'osascript', args: ['-l', 'JavaScript', '-e',
    `ObjC.import('CoreGraphics');${JSON.stringify(points)}.forEach(function(p){$.CGWarpMouseCursorPosition($.CGPointMake(p[0],p[1]));delay(0.016)})`] };
  if (process.platform === 'win32') return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command',
    `Add-Type -AssemblyName System.Windows.Forms,System.Drawing;@(${points.map(p => `@(${p[0]},${p[1]})`).join(',')})|%{[System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point($_[0],$_[1]);Start-Sleep -Milliseconds 16}`] };
  return undefined;
}

/** Animate one cursor shove. Coordinates are physical pixels. Overlapping shoves are dropped. */
export function pushCursor(path: Point[]) {
  if (active || !path.length) return;
  const spec = command(path.map(p => [Math.round(p.x), Math.round(p.y)]));
  if (!spec) return;
  let child: ChildProcess;
  try { child = spawn(spec.file, spec.args, { stdio: 'ignore', windowsHide: true }); }
  catch { return; }
  active = child;
  const done = () => { if (active === child) active = undefined; };
  child.on('error', done); child.on('exit', done);
}

export function cancelCursorPush() { active?.kill(); active = undefined; }
