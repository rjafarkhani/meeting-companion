import { contextBridge, ipcRenderer } from 'electron';
import type { CompanionAPI, ServiceEvent } from '../src/shared';
const api: CompanionAPI = {
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveCredentials: (keys, persist) => ipcRenderer.invoke('credentials:save', keys, persist),
  saveSettings: (s, k, d) => ipcRenderer.invoke('settings:save', s, k, d),
  start: input => ipcRenderer.invoke('session:start', input),
  stop: () => ipcRenderer.invoke('session:stop'),
  updateSpeakers: profiles => ipcRenderer.invoke('session:speakers', profiles),
  audio: (data, commit) => ipcRenderer.send('session:audio', data, commit),
  research: claim => ipcRenderer.invoke('research', claim),
  summarize: (t, p) => ipcRenderer.invoke('summarize', t, p),
  exportFile: (name, text) => ipcRenderer.invoke('export', name, text),
  openSource: url => ipcRenderer.invoke('source:open', url),
  onEvent: fn => {
    const handler = (_event: Electron.IpcRendererEvent, data: ServiceEvent) => fn(data);
    ipcRenderer.on('service:event', handler); return () => ipcRenderer.removeListener('service:event', handler);
  },
};
contextBridge.exposeInMainWorld('companion', api);
