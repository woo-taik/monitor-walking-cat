import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const base = path.resolve(process.env.ANIMO_PACKAGE_OUT ?? 'release', `Animo-${process.platform}-${process.arch}`);
const executable = path.join(base, process.platform === 'win32' ? 'Animo.exe' : 'Animo.app/Contents/MacOS/Animo');
try {
  const result = await promisify(execFile)(executable, ['--ci-smoke-test', '--output', path.resolve('artifacts/ci-verification')], { timeout: 60000, windowsHide: true });
  console.log(result.stdout);
  if (result.stderr) console.error(result.stderr);
} catch (error) { console.error(error.stdout, error.stderr); throw error; }
