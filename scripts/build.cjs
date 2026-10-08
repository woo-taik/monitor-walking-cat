const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
process.chdir(path.join(__dirname, '..'));
for (const config of ['tsconfig.node.json', 'tsconfig.web.json']) {
  const result = spawnSync(process.execPath, [path.resolve('node_modules/typescript/bin/tsc'), '-p', config], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
fs.mkdirSync('dist/web', { recursive: true });
for (const file of ['index.html', 'style.css']) fs.copyFileSync(`src/${file}`, `dist/web/${file}`);
fs.cpSync('assets', 'dist/assets', { recursive: true });
