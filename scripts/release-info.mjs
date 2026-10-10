import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function readVersion(root = '.') {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const version = manifest.version;
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version)) throw new Error('Unsupported app version');
  if (lock.version !== version || lock.packages[''].version !== version) throw new Error('package.json and lockfile versions differ');
  return version;
}
export function validateTag(tag, version) {
  if (tag !== `v${version}`) throw new Error(`Release tag must match app version: expected v${version}, got ${tag}`);
}
export function archiveName(version, platform, arch) {
  if (!['win32:x64', 'darwin:arm64', 'darwin:x64'].includes(`${platform}:${arch}`)) throw new Error('Unsupported release target');
  return `Animo-${version}-${platform === 'win32' ? 'windows' : 'macos'}-${arch}.zip`;
}
export function installerName(version, platform, arch) {
  if (!['win32:x64', 'darwin:arm64', 'darwin:x64'].includes(`${platform}:${arch}`)) throw new Error('Unsupported release target');
  return `Animo-${version}-${platform === 'win32' ? 'windows' : 'macos'}-${arch}.${platform === 'win32' ? 'exe' : 'pkg'}`;
}
export function expectedArchives(version) {
  return [archiveName(version, 'win32', 'x64'), archiveName(version, 'darwin', 'arm64'), archiveName(version, 'darwin', 'x64')];
}
export function expectedDownloads(version) {
  return [
    ...expectedArchives(version),
    installerName(version, 'win32', 'x64'),
    installerName(version, 'darwin', 'arm64'),
    installerName(version, 'darwin', 'x64')
  ];
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = readVersion();
  if (process.env.GITHUB_REF_TYPE === 'tag') validateTag(process.env.GITHUB_REF_NAME, version);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nprerelease=${version.includes('-')}\n`);
  console.log(`Animo ${version}`);
}
