import { catSVG } from './cat.js';
import type { Anchor, PreferencesAPI, PreferencesCommand, PreferencesSnapshot } from './shared/types.js';
declare global { interface Window { preferences?: PreferencesAPI } }
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id)! as T;
const status = byId('status'), name = byId<HTMLInputElement>('preset-name');
let snapshot: PreferencesSnapshot | undefined, displayKey = '', presetKey = '', queue = Promise.resolve();
function message(text: string, error = false) { status.textContent = text; status.classList.toggle('error', error); }
function render(next: PreferencesSnapshot) {
  snapshot = next;
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="size"]')) radio.checked = Number(radio.value) === next.size;
  byId<HTMLInputElement>('roaming').checked = next.roaming;
  byId<HTMLSelectElement>('floor').value = next.floorOnly ? 'floor' : 'desktop';
  byId<HTMLInputElement>('click-through').checked = next.clickThrough;
  byId<HTMLInputElement>('keep-awake').checked = next.keepAwake;
  byId<HTMLInputElement>('workspaces').checked = next.allWorkspaces;
  byId('workspaces-row').hidden = next.platform !== 'darwin';
  byId('ghost-note').hidden = !next.clickThrough;
  byId('pause').textContent = next.paused ? '다시 움직이기' : '잠시 멈추기';
  byId('hide').textContent = next.hidden ? '보이기' : '숨기기';
  byId('mode').textContent = next.hidden ? '잠깐 숨어 있어요' : next.paused ? '잠시 멈춰 있어요' : next.roaming ? '느긋하게 산책 중' : '이 자리에서 쉬는 중';
  const current = next.displays.find(d => d.id === next.displayId);
  byId('summary').textContent = `${current?.name ?? '현재 모니터'} · ${next.floorOnly ? '화면 아래쪽' : '화면 전체'}`;
  const preview = byId('preview'); preview.style.width = `${160 * next.size}px`; preview.style.height = `${144 * next.size}px`;
  preview.innerHTML = catSVG({ pose: next.roaming && !next.paused ? 'walking' : 'sitting', facingRight: true, time: 1.15, size: next.size,
    frozen: next.paused, clickThrough: next.clickThrough, poseTime: 1.15, gaitTime: 1.15, speed: next.roaming ? 52 : 0 });
  const nextDisplayKey = JSON.stringify(next.displays);
  if (displayKey !== nextDisplayKey) {
    byId<HTMLSelectElement>('display').replaceChildren(...next.displays.map(d => { const option = document.createElement('option'); option.value = d.id; option.textContent = d.name; return option; }));
    displayKey = nextDisplayKey;
  }
  byId<HTMLSelectElement>('display').value = next.displayId;
  const nextPresetKey = JSON.stringify([next.presets, next.displays]);
  if (presetKey !== nextPresetKey) {
    byId('presets').replaceChildren(...next.presets.map(p => {
      const row = document.createElement('li'), load = document.createElement('button'), remove = document.createElement('button');
      load.type = remove.type = 'button'; load.className = 'preset-load'; remove.className = 'preset-delete';
      load.dataset.load = p.id; remove.dataset.delete = p.id;
      const title = document.createElement('strong'), subtitle = document.createElement('small'); title.textContent = p.name;
      subtitle.textContent = next.displays.find(d => d.id === p.displayId)?.name ?? '모니터 연결 해제 · 주 화면에 배치';
      load.append(title, subtitle); load.setAttribute('aria-label', `${p.name} 자리로 이동`);
      remove.textContent = '삭제'; remove.setAttribute('aria-label', `${p.name} 자리 삭제`);
      load.addEventListener('click', () => post({ kind: 'load-position', id: p.id }));
      remove.addEventListener('click', () => post({ kind: 'delete-position', id: p.id }));
      row.append(load, remove); return row;
    }));
    presetKey = nextPresetKey;
  }
  byId('empty-presets').hidden = next.presets.length > 0;
  byId('preset-count').textContent = `${next.presets.length} / 8`;
  byId<HTMLButtonElement>('save-position').disabled = next.presets.length >= 8;
}
function post(command: PreferencesCommand) {
  queue = queue.then(async () => {
    if (!window.preferences) throw new Error('설정을 연결하지 못했습니다. 창을 다시 열어 주세요.');
    message('반영하고 있어요…');
    const result = await window.preferences.change(command); render(result.snapshot);
    if (command.kind === 'save-position' && name.value.trim() === command.name.trim()) name.value = '';
    message(result.notice ?? '바로 반영했습니다. 설정은 자동으로 저장됩니다.');
  }).catch(error => message(String(error.message ?? error).replace(/^Error invoking remote method '[^']+': Error: /, ''), true));
}
for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="size"]')) radio.addEventListener('change', () => post({ kind: 'size', value: Number(radio.value) }));
for (const [id, kind] of [['roaming', 'roaming'], ['click-through', 'click-through'], ['keep-awake', 'keep-awake'], ['workspaces', 'all-workspaces']] as const) byId<HTMLInputElement>(id).addEventListener('change', event => post({ kind, value: (event.target as HTMLInputElement).checked }));
byId<HTMLSelectElement>('floor').addEventListener('change', event => post({ kind: 'floor-only', value: (event.target as HTMLSelectElement).value === 'floor' }));
byId<HTMLSelectElement>('display').addEventListener('change', event => post({ kind: 'display', id: (event.target as HTMLSelectElement).value }));
byId('pause').addEventListener('click', () => { if (snapshot) post({ kind: 'paused', value: !snapshot.paused }); });
byId('hide').addEventListener('click', () => { if (snapshot) post({ kind: 'hidden', value: !snapshot.hidden }); });
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-anchor]')) button.addEventListener('click', () => post({ kind: 'anchor', anchor: button.dataset.anchor as Anchor, displayId: byId<HTMLSelectElement>('display').value }));
byId('save-form').addEventListener('submit', event => { event.preventDefault(); if (name.value.trim()) post({ kind: 'save-position', name: name.value.trim() }); });
if (window.preferences) { window.preferences.onChange(render); window.preferences.read().then(render).catch(() => message('설정을 불러오지 못했습니다. 창을 다시 열어 주세요.', true)); }
else message('설정을 연결하지 못했습니다. 창을 다시 열어 주세요.', true);
