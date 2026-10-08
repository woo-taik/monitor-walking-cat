import fs from 'node:fs';
import path from 'node:path';
import type { PositionPreset, Settings } from './shared/types.js';
export const defaults: Settings = {
  version: 3, displayId: '', displayLabel: '', relativeX: .65, relativeY: 1, size: 1,
  roaming: true, floorOnly: true, clickThrough: false, allWorkspaces: true, presets: []
};
export function validateSettings(value: unknown): Settings {
  const v = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
  const finite = (key: string, low: number, high: number) => typeof v[key] === 'number' && Number.isFinite(v[key])
    ? Math.max(low, Math.min(high, v[key] as number)) : defaults[key as keyof Settings] as number;
  const bool = (key: keyof Settings) => typeof v[key] === 'boolean' ? v[key] as boolean : defaults[key] as boolean;
  const presets: PositionPreset[] = [];
  if (Array.isArray(v.presets)) for (const p of v.presets.slice(0, 100)) {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(p.id)
      || typeof p.name !== 'string' || !p.name.trim() || p.name.trim().length > 28
      || typeof p.displayId !== 'string' || p.displayId.length > 128
      || !Number.isFinite(p.relativeX) || !Number.isFinite(p.relativeY)) continue;
    if (presets.some(existing => existing.id === p.id || existing.name === p.name.trim())) continue;
    presets.push({ id: p.id, name: p.name.trim(), displayId: p.displayId, displayLabel: typeof p.displayLabel === 'string' ? p.displayLabel.slice(0, 256) : '',
      relativeX: Math.max(0, Math.min(1, p.relativeX)), relativeY: Math.max(0, Math.min(1, p.relativeY)) });
    if (presets.length === 8) break;
  }
  return { version: 3, displayId: typeof v.displayId === 'string' ? v.displayId : '', displayLabel: typeof v.displayLabel === 'string' ? v.displayLabel : '',
    relativeX: finite('relativeX', 0, 1), relativeY: finite('relativeY', 0, 1), size: finite('size', .65, 1.5),
    roaming: bool('roaming'), floorOnly: bool('floorOnly'), clickThrough: bool('clickThrough'), allWorkspaces: bool('allWorkspaces'), presets };
}
export function loadSettings(file: string, legacyFile?: string): Settings {
  try { return validateSettings(JSON.parse(fs.readFileSync(file, 'utf8'))); }
  catch {
    if (legacyFile && !fs.existsSync(file)) {
      try {
        const v = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
        return validateSettings({ displayLabel: v.Monitor, relativeX: v.RelativeX, relativeY: v.RelativeY, size: v.Size, roaming: v.Roaming, floorOnly: v.FloorOnly, clickThrough: v.ClickThrough });
      } catch { /* First launch without a WPF configuration. */ }
    }
    return { ...defaults, presets: [] };
  }
}
export function saveSettings(file: string, settings: Settings) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(validateSettings(settings), null, 2));
  fs.renameSync(file + '.tmp', file);
}
