// The only bridge between the page and the desktop app. The page gets a few
// named functions, never Node or Electron itself.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  fetchText: (url) => ipcRenderer.invoke('fetch-text', url),
  appInfo: () => ipcRenderer.invoke('app-info'),
  update: {
    check: () => ipcRenderer.invoke('update-check'),
    download: () => ipcRenderer.invoke('update-download'),
    install: () => ipcRenderer.invoke('update-install'),
    onEvent: (cb) => ipcRenderer.on('update-event', (_e, data) => cb(data)),
  },
});
