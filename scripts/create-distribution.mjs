import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { archiveName, readVersion } from './release-info.mjs';
const version = readVersion();
const base = path.resolve(process.env.ANIMO_PACKAGE_OUT ?? 'release');
const folder = path.join(base, `Animo-${process.platform}-${process.arch}`);
const archive = path.join(base, archiveName(version, process.platform, process.arch));
if (process.platform === 'win32') {
  if (!fs.existsSync(path.join(folder, 'Animo.exe'))) throw new Error('Windows package missing');
  fs.writeFileSync(path.join(folder, 'README-Windows.txt'), 'Animo ' + version + '\nExtract the entire folder and run Animo.exe. Keep all runtime files together.\nRight click the cat or tray icon for settings. Ctrl+Alt+C: hide/show. Ctrl+Alt+R: recall.\n');
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Compress-Archive -LiteralPath $env:ANIMO_ARCHIVE_FOLDER -DestinationPath $env:ANIMO_ARCHIVE_FILE -Force'],
    { windowsHide: true, stdio: 'inherit', env: { ...process.env, ANIMO_ARCHIVE_FOLDER: folder, ANIMO_ARCHIVE_FILE: archive } });
} else if (process.platform === 'darwin') {
  if (!fs.existsSync(path.join(folder, 'Animo.app'))) throw new Error('Mac package missing');
  fs.copyFileSync('scripts/Open-Animo.command', path.join(folder, 'Open-Animo.command')); fs.chmodSync(path.join(folder, 'Open-Animo.command'), 0o755);
  fs.writeFileSync(path.join(folder, 'README-Mac.txt'), `Animo ${version} — development build, not notarized.\nExtract with macOS Archive Utility. Run Open-Animo.command beside Animo.app to apply a local ad-hoc signature and open it. No Node.js installation needed.\nmacOS may require approval in Privacy & Security. Automated CI verifies launch, rendering and IPC; physical input, Retina monitors and Spaces still require manual verification.\n`);
  if (fs.existsSync(archive)) fs.unlinkSync(archive);
  execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', folder, archive], { stdio: 'inherit' });
}
const checksum = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
fs.writeFileSync(archive + '.sha256', `${checksum}  ${path.basename(archive)}\n`);
console.log(archive);
