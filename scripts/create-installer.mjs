import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installerName, readVersion } from './release-info.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = readVersion(root);
const platform = ['win32', 'darwin'].includes(process.argv[2]) ? process.argv[2] : process.platform;
const arch = platform === process.argv[2] ? (process.argv[3] ?? process.arch) : (process.argv[2] ?? process.arch);
const base = path.resolve(root, process.env.ANIMO_PACKAGE_OUT ?? 'release');
const folder = path.join(base, `Animo-${platform}-${arch}`);
const output = path.join(base, installerName(version, platform, arch));
fs.mkdirSync(base, { recursive: true });

if (platform === 'win32') {
  if (!fs.existsSync(path.join(folder, 'Animo.exe'))) throw new Error('Package Animo.exe before creating the installer');
  const candidates = [
    process.env.NSIS_MAKENSIS,
    'C:\\Program Files (x86)\\NSIS\\makensis.exe',
    'C:\\Program Files\\NSIS\\makensis.exe',
    '/opt/homebrew/bin/makensis',
    '/usr/local/bin/makensis',
    process.platform === 'win32' ? 'makensis.exe' : 'makensis'
  ].filter(Boolean);
  let makensis;
  for (const candidate of candidates) {
    if (candidate === 'makensis.exe' || candidate === 'makensis' || fs.existsSync(candidate)) { makensis = candidate; break; }
  }
  const option = process.platform === 'win32' ? '/' : '-';
  execFileSync(makensis, [
    `${option}V3`, `${option}DAPP_VERSION=${version}`, `${option}DAPP_SOURCE=${folder}`, `${option}DOUT_FILE=${output}`,
    `${option}DICON_FILE=${path.join(root, 'assets', 'animo.ico')}`,
    path.join(root, 'scripts', 'windows-installer.nsi')
  ], { cwd: root, stdio: 'inherit' });
} else if (platform === 'darwin') {
  const app = path.join(folder, 'Animo.app');
  if (!fs.existsSync(app)) throw new Error('Package Animo.app before creating the installer');
  const stage = path.join(root, 'artifacts', `installer-stage-${arch}`);
  fs.rmSync(stage, { recursive: true, force: true });
  try {
    fs.mkdirSync(path.join(stage, 'Applications'), { recursive: true });
    fs.mkdirSync(path.join(stage, 'Library', 'Application Support', 'Animo'), { recursive: true });
    execFileSync('/usr/bin/ditto', [app, path.join(stage, 'Applications', 'Animo.app')]);
    for (const license of ['LICENSE', 'LICENSES.chromium.html']) {
      fs.copyFileSync(path.join(folder, license), path.join(stage, 'Library', 'Application Support', 'Animo', license));
    }
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', path.join(stage, 'Applications', 'Animo.app')], { stdio: 'inherit' });
    execFileSync('/usr/bin/pkgbuild', [
      '--root', stage, '--install-location', '/', '--identifier', 'com.animo.desktopcat',
      '--version', version, '--scripts', path.join(root, 'scripts', 'mac-installer'),
      '--ownership', 'recommended', output
    ], { stdio: 'inherit' });
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
  const payload = execFileSync('/usr/sbin/pkgutil', ['--payload-files', output], { encoding: 'utf8' });
  if (!payload.includes('Applications/Animo.app/Contents/MacOS/Animo') || !payload.includes('Library/Application Support/Animo/LICENSES.chromium.html')) {
    throw new Error('Mac installer payload is incomplete');
  }
} else {
  throw new Error(`Unsupported installer target: ${platform}-${arch}`);
}

const checksum = createHash('sha256').update(fs.readFileSync(output)).digest('hex');
fs.writeFileSync(output + '.sha256', `${checksum}  ${path.basename(output)}\n`);
console.log(output);
