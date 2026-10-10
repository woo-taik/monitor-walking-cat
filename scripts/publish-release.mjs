import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expectedDownloads, readVersion, validateTag } from './release-info.mjs';

export function verifyAssets(directory, version) {
  const names = expectedDownloads(version);
  const expected = names.flatMap(name => [name, name + '.sha256']).sort();
  if (JSON.stringify(fs.readdirSync(directory).sort()) !== JSON.stringify(expected)) throw new Error('Release must contain three ZIPs, three installers and their checksums');
  return names.map(name => {
    const checksum = createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex');
    const line = `${checksum}  ${name}`;
    if (fs.readFileSync(path.join(directory, name + '.sha256'), 'utf8').trim() !== line) throw new Error(`Checksum mismatch: ${name}`);
    return line;
  }).join('\n') + '\n';
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = readVersion(), tag = process.env.GITHUB_REF_NAME, repo = process.env.GITHUB_REPOSITORY;
  validateTag(tag, version);
  if (!repo || process.env.GITHUB_REF_TYPE !== 'tag') throw new Error('Publishing requires a repository tag event');
  const directory = path.resolve('artifacts/release-assets');
  const checksums = verifyAssets(directory, version);
  const checksumFile = path.join(directory, 'SHA256SUMS.txt'); fs.writeFileSync(checksumFile, checksums);
  const notesFile = path.resolve('artifacts/release-notes.md');
  fs.writeFileSync(notesFile, `Animo ${version}\n\n- Windows x64: run the .exe installer. It installs per user and creates a desktop shortcut. The ZIP remains available for portable use.\n- macOS Apple Silicon: use arm64. Intel Mac: use x64. Open the .pkg installer to install in Applications and create a desktop shortcut for the active user. The ZIP remains available for portable use.\n- Mac packages are development builds with ad-hoc signatures, **not Developer ID signed or notarized**. macOS may require approval in Privacy & Security.\n- CI checks launch, rendering and settings IPC; physical monitor input and Spaces require manual verification.\n- SHA256SUMS.txt contains checksums for all six downloads.\n`);
  const gh = args => execFileSync('gh', [...args, '--repo', repo], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  let existing;
  try { existing = JSON.parse(gh(['release', 'view', tag, '--json', 'isDraft'])); }
  catch (error) { if (!String(error.stderr).toLowerCase().includes('release not found')) throw error; }
  if (existing && !existing.isDraft) throw new Error('Release is already published; refusing to replace its assets');
  if (!existing) gh(['release', 'create', tag, '--verify-tag', '--draft', '--title', `Animo ${version}`, '--notes-file', notesFile, ...(version.includes('-') ? ['--prerelease'] : [])]);
  gh(['release', 'upload', tag, ...expectedDownloads(version).map(name => path.join(directory, name)), checksumFile, '--clobber']);
  // Publish only after all uploads succeed. A partial upload remains a retryable draft.
  gh(['release', 'edit', tag, '--draft=false', '--latest=' + !version.includes('-')]);
  console.log(gh(['release', 'view', tag, '--json', 'url', '--jq', '.url']).trim());
}
