import { contextBridge, ipcRenderer } from 'electron';
import type { PreferencesAPI, PreferencesCommand, PreferencesSnapshot } from './shared/types.js';
const api: PreferencesAPI = {
  read: () => ipcRenderer.invoke('preferences:read'),
  change: (command: PreferencesCommand) => ipcRenderer.invoke('preferences:change', command),
  onChange(callback) {
    const listener = (_event: unknown, state: PreferencesSnapshot) => callback(state);
    ipcRenderer.on('preferences:state', listener);
    return () => ipcRenderer.removeListener('preferences:state', listener);
  }
};
contextBridge.exposeInMainWorld('preferences', api);
