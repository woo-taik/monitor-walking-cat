import { contextBridge, ipcRenderer } from 'electron';
import type { PetAPI, PetState, Point } from './shared/types.js';
const api: PetAPI = {
  onState(callback) { const listener = (_event: unknown, state: PetState) => callback(state); ipcRenderer.on('pet:state', listener); return () => ipcRenderer.removeListener('pet:state', listener); },
  onCursor(callback) { const listener = (_event: unknown, point: Point) => callback(point); ipcRenderer.on('pet:cursor', listener); return () => ipcRenderer.removeListener('pet:cursor', listener); },
  onResetInput(callback) { const listener = () => callback(); ipcRenderer.on('pet:reset-input', listener); return () => ipcRenderer.removeListener('pet:reset-input', listener); },
  ready: () => ipcRenderer.send('pet:ready'),
  hover: (overCat: boolean) => ipcRenderer.send('pet:hover', overCat),
  press: () => ipcRenderer.send('pet:press'),
  pet: () => ipcRenderer.send('pet:pet'),
  beginDrag: () => ipcRenderer.send('pet:drag-start'),
  endDrag: () => ipcRenderer.send('pet:drag-end'),
  openMenu: (point: Point) => ipcRenderer.send('pet:menu', point)
};
contextBridge.exposeInMainWorld('animo', api);
