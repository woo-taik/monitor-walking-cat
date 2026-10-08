import fs from 'node:fs';
import path from 'node:path';

// Keep English fallback and Korean, including Mac region/gender variants.
export const keepLocale = name => /^(?:en|ko)(?:[-_].*)?$/.test(name) || name === 'Base';

export function trimLocales(folder, platform) {
  let removed = 0, bytes = 0;
  const trim = (directory, extension) => {
    const entries = fs.readdirSync(directory).filter(name => name.endsWith(extension));
    // A broken package must never silently lose its language fallback.
    if (!entries.some(name => /^en(?:[-_].*)?$/.test(name.slice(0, -extension.length)))) {
      throw new Error(`English runtime locale missing: ${directory}`);
    }
    for (const name of entries) {
      if (keepLocale(name.slice(0, -extension.length))) continue;
      const target = path.resolve(directory, name);
      if (path.dirname(target) !== path.resolve(directory)) throw new Error('Locale outside package directory');
      const size = entry => {
        const stat = fs.lstatSync(entry);
        if (!stat.isDirectory()) return stat.size;
        return fs.readdirSync(entry).reduce((sum, child) => sum + size(path.join(entry, child)), 0);
      };
      bytes += size(target);
      fs.rmSync(target, { recursive: true });
      removed++;
    }
  };
  if (platform === 'win32') {
    trim(path.join(folder, 'locales'), '.pak');
  } else if (platform === 'darwin') {
    const walk = directory => {
      const entries = fs.readdirSync(directory);
      if (entries.some(name => name.endsWith('.lproj'))) trim(directory, '.lproj');
      for (const name of fs.readdirSync(directory)) {
        const entry = path.join(directory, name);
        // Framework links point at the versioned directories visited separately.
        if (!name.endsWith('.lproj') && fs.lstatSync(entry).isDirectory()) walk(entry);
      }
    };
    walk(path.join(folder, 'Animo.app'));
  }
  console.log(`Kept Korean/English runtime locales; removed ${removed} entries (${(bytes / 1e6).toFixed(1)} MB).`);
  return { removed, bytes };
}
