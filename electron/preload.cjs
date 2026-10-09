// The only bridge between the page and the desktop app. The page gets a few
// named functions, never Node or Electron itself.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  fetchText: (url) => ipcRenderer.invoke('fetch-text', url),
  appInfo: () => ipcRenderer.invoke('app-info'),
  binance: {
    status: () => ipcRenderer.invoke('binance-status'),
    connect: (key, secret) => ipcRenderer.invoke('binance-connect', key, secret),
    balances: () => ipcRenderer.invoke('binance-balances'),
    forget: () => ipcRenderer.invoke('binance-forget'),
  },
  drive: {
    status: () => ipcRenderer.invoke('drive-status'),
    connect: (clientId, clientSecret) => ipcRenderer.invoke('drive-connect', clientId, clientSecret),
    pull: () => ipcRenderer.invoke('drive-pull'),
    push: (text) => ipcRenderer.invoke('drive-push', text),
    disconnect: () => ipcRenderer.invoke('drive-disconnect'),
  },
  update: {
    check: () => ipcRenderer.invoke('update-check'),
    download: () => ipcRenderer.invoke('update-download'),
    install: () => ipcRenderer.invoke('update-install'),
    onEvent: (cb) => ipcRenderer.on('update-event', (_e, data) => cb(data)),
  },
});
