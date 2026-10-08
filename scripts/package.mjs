import { packager } from '@electron/packager';
import { createPackage } from '@electron/asar';
import { downloadArtifact } from '@electron/get';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = path.resolve(root, process.env.ANIMO_PACKAGE_OUT ?? 'release');
const platform = process.argv[2] ?? process.platform;
const arch = (process.argv[3] ?? process.arch).split(',');
// Fail before Packager removes any files if an existing Windows package is open.
if (platform === 'win32' && process.platform === 'win32') {
  for (const cpu of arch) {
    const executable = path.join(releaseDir, `Animo-win32-${cpu}`, 'Animo.exe');
    const check = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '$animoBusy = @(Get-Process Animo -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $env:ANIMO_PACKAGE_PATH }); if ($animoBusy.Count -gt 0) { exit 2 }'],
      { env: { ...process.env, ANIMO_PACKAGE_PATH: executable }, stdio: 'inherit' });
    if (check.status === 2) throw new Error(`Close the running Animo before packaging: ${executable}`);
    if (check.status !== 0) throw new Error('Could not check whether the existing Windows package is running.');
  }
}
// Package only the compiled, dependency-free application; no SDKs, source or test artifacts.
const staging = path.join(root, 'artifacts', 'electron-staging');
fs.mkdirSync(staging, { recursive: true });
fs.cpSync(path.join(root, 'dist'), path.join(staging, 'dist'), { recursive: true });
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
delete manifest.devDependencies;
delete manifest.scripts;
fs.writeFileSync(path.join(staging, 'package.json'), JSON.stringify(manifest, null, 2));
if (platform === 'darwin' && process.platform === 'win32') {
  // Windows cannot materialize the framework symlinks without extra privileges.
  // Keep them as UNIX symlink entries inside the Mac archive instead.
  const appAsar = path.join(root, 'artifacts', 'animo-mac-app.asar');
  await createPackage(staging, appAsar);
  for (const cpu of arch) {
    const zip = await downloadArtifact({ version: '44.7.0', platform: 'darwin', arch: cpu, artifactName: 'electron' });
    const target = path.join(releaseDir, `Animo-darwin-${cpu}.zip`);
    const result = spawnSync('python', [path.join(root, 'scripts', 'mac-archive.py'), zip, target, appAsar, path.join(root, 'assets', 'animo.icns'), manifest.version], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error('Mac archive creation failed (Python 3 required on Windows).');
    console.log(target);
  }
  process.exit(0);
}
const output = await packager({
  dir: staging, out: releaseDir, name: 'Animo', platform, arch,
  overwrite: true, asar: true, prune: false, electronVersion: '44.7.0',
  icon: path.join(root, 'assets', platform === 'darwin' ? 'animo.icns' : 'animo.ico'),
  appBundleId: 'com.animo.desktopcat', appCategoryType: 'public.app-category.entertainment',
  darwinDarkModeSupport: true,
  extendInfo: platform === 'darwin' ? { LSUIElement: true } : undefined,
  ...(process.env.ELECTRON_DOWNLOAD_MIRROR ? { download: { mirrorOptions: { mirror: process.env.ELECTRON_DOWNLOAD_MIRROR } } } : {})
});
if (output.length !== arch.length) throw new Error('One or more requested packages were not created.');
for (const item of output) console.log(item);
