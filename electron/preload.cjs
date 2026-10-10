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
    putSnapshot: (name, text) => ipcRenderer.invoke('drive-snap-put', name, text),
    listSnapshots: () => ipcRenderer.invoke('drive-snap-list'),
    readSnapshot: (id) => ipcRenderer.invoke('drive-snap-read', id),
    deleteSnapshot: (id) => ipcRenderer.invoke('drive-snap-delete', id),
  },
  folder: {
    status: () => ipcRenderer.invoke('folder-status'),
    use: (p) => ipcRenderer.invoke('folder-use', p),
    pick: () => ipcRenderer.invoke('folder-pick'),
    disconnect: () => ipcRenderer.invoke('folder-off'),
    open: () => ipcRenderer.invoke('folder-open'),
    pull: () => ipcRenderer.invoke('folder-pull'),
    push: (text) => ipcRenderer.invoke('folder-push', text),
    putSnapshot: (name, text) => ipcRenderer.invoke('folder-snap-put', name, text),
    listSnapshots: () => ipcRenderer.invoke('folder-snap-list'),
    readSnapshot: (id) => ipcRenderer.invoke('folder-snap-read', id),
    deleteSnapshot: (id) => ipcRenderer.invoke('folder-snap-delete', id),
  },
  backups: {
    write: (name, text) => ipcRenderer.invoke('backup-write', name, text),
    list: () => ipcRenderer.invoke('backup-list'),
    read: (name) => ipcRenderer.invoke('backup-read', name),
    remove: (name) => ipcRenderer.invoke('backup-delete', name),
    openFolder: () => ipcRenderer.invoke('backup-folder'),
  },
  hotkey: () => ipcRenderer.invoke('hotkey-status'),
  background: {
    get: () => ipcRenderer.invoke('bg-get'),
    set: (p) => ipcRenderer.invoke('bg-set', p),
  },
  telegram: {
    status: () => ipcRenderer.invoke('tg-status'),
    connect: (token) => ipcRenderer.invoke('tg-connect', token),
    pair: () => ipcRenderer.invoke('tg-pair'),
    ack: (ids) => ipcRenderer.invoke('tg-ack', ids),
    send: (text, extra) => ipcRenderer.invoke('tg-send', text, extra),
    edit: (id, text, extra) => ipcRenderer.invoke('tg-edit', id, text, extra),
    answer: (id, text) => ipcRenderer.invoke('tg-answer', id, text),
    disconnect: () => ipcRenderer.invoke('tg-disconnect'),
    openLink: (url) => ipcRenderer.invoke('open-external', url),
    onUpdates: (cb) => ipcRenderer.on('tg-updates', (_e, u) => cb(u)),
    onEvent: (cb) => ipcRenderer.on('tg-event', (_e, ev) => cb(ev)),
  },
  onQuickAdd: (cb) => ipcRenderer.on('quick-add', () => cb()),
  update: {
    check: () => ipcRenderer.invoke('update-check'),
    download: () => ipcRenderer.invoke('update-download'),
    install: () => ipcRenderer.invoke('update-install'),
    onEvent: (cb) => ipcRenderer.on('update-event', (_e, data) => cb(data)),
  },
});
