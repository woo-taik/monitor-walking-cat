const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');

test('release tag must match package and lockfile versions; filenames cover exactly three supported targets', async () => {
  const { readVersion, validateTag, expectedArchives, archiveName } = await import('../scripts/release-info.mjs');
  assert.equal(readVersion(), require('../package.json').version);
  assert.doesNotThrow(() => validateTag('v0.4.0', '0.4.0'));
  assert.doesNotThrow(() => validateTag('v0.5.0-beta.1', '0.5.0-beta.1'));
  for (const wrong of ['v0.3.0', '0.4.0', 'v0.4.0\nextra']) assert.throws(() => validateTag(wrong, '0.4.0'));
  assert.equal(new Set(expectedArchives('0.4.0')).size, 3);
  assert.throws(() => archiveName('0.4.0', 'linux', 'x64'));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'animo-release-version-'));
  try {
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ version: '0.4.0' }));
    fs.writeFileSync(path.join(directory, 'package-lock.json'), JSON.stringify({ version: '0.3.0', packages: { '': { version: '0.4.0' } } }));
    assert.throws(() => readVersion(directory), /versions differ/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('release requires all platform archives and matching checksums before publishing', async () => {
  const { expectedArchives } = await import('../scripts/release-info.mjs');
  const { verifyAssets } = await import('../scripts/publish-release.mjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'animo-release-assets-'));
  try {
    const names = expectedArchives('0.4.0');
    for (const name of names) {
      const data = Buffer.from('test archive ' + name);
      fs.writeFileSync(path.join(directory, name), data);
      fs.writeFileSync(path.join(directory, name + '.sha256'), `${createHash('sha256').update(data).digest('hex')}  ${name}\n`);
    }
    assert.equal(verifyAssets(directory, '0.4.0').trim().split('\n').length, 3);
    fs.writeFileSync(path.join(directory, names[0]), 'corrupted');
    assert.throws(() => verifyAssets(directory, '0.4.0'), /Checksum mismatch/);
    fs.unlinkSync(path.join(directory, names[0]));
    assert.throws(() => verifyAssets(directory, '0.4.0'), /exactly three/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
