// Desktop app: the same web app in its own window. Files are served from a
// private app:// origin so ES modules and saved data work like on the web,
// and nothing is loaded from the internet.

const { app, BrowserWindow, protocol, net, shell, Menu, ipcMain, safeStorage, globalShortcut } = require('electron');
const { createBinance } = require('./binance.cjs');
const { createDrive } = require('./gdrive.cjs');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const SERVED = ['index.html', 'manifest.webmanifest', 'sw.js', 'css/', 'js/', 'icons/', 'fonts/'];
const ORIGIN = 'app://finance';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();

const boundsFile = () => path.join(app.getPath('userData'), 'window.json');

function loadBounds() {
  try {
    return JSON.parse(fs.readFileSync(boundsFile(), 'utf8'));
  } catch {
    return { width: 1280, height: 820 };
  }
}

function createWindow() {
  const win = new BrowserWindow({
    ...loadBounds(),
    minWidth: 380,
    minHeight: 560,
    title: 'Finance Helper',
    backgroundColor: '#0b0d10',
    autoHideMenuBar: true,
    show: false,
    icon: path.join(ROOT, 'icons', 'icon-512.png'),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.cjs') },
  });
  win.once('ready-to-show', () => win.show());
  win.on('close', () => {
    try {
      fs.writeFileSync(boundsFile(), JSON.stringify(win.getNormalBounds()));
    } catch {
      // Not critical: the window just opens at the default size next time.
    }
  });

  // Links to websites open in the normal browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN)) {
      e.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });

  win.loadURL(`${ORIGIN}/index.html`);
  return win;
}

// Sites the app may read through the main process (no browser CORS limits
// here). Anything else is refused.
const FETCH_HOSTS = new Set([
  'open.er-api.com', 'www.bnm.md', 'api.binance.com', 'api.coingecko.com', 'api.github.com',
]);

ipcMain.handle('fetch-text', async (_e, url) => {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !FETCH_HOSTS.has(u.hostname)) throw new Error(`Not allowed: ${u.hostname}`);
  const r = await net.fetch(url, { headers: { 'User-Agent': `FinanceHelper/${app.getVersion()}` } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
});

ipcMain.handle('app-info', () => ({ version: app.getVersion(), platform: process.platform, packaged: app.isPackaged }));

// ---------- Binance (read-only key, stored encrypted) ----------

const binance = createBinance({ app, net, safeStorage });
ipcMain.handle('binance-status', () => binance.status());
ipcMain.handle('binance-connect', async (_e, key, secret) => {
  const k = String(key || '').trim();
  const s = String(secret || '').trim();
  if (!/^[A-Za-z0-9]{20,128}$/.test(k) || !/^[A-Za-z0-9]{20,128}$/.test(s)) throw new Error('That doesn\'t look like a Binance API key and secret.');
  binance.saveKeys(k, s);
  try {
    return await binance.balances(); // proves the key works
  } catch (e) {
    binance.forget();
    throw e;
  }
});
ipcMain.handle('binance-balances', () => binance.balances());
ipcMain.handle('binance-forget', () => { binance.forget(); return true; });

// ---------- Daily backups in Documents/Finance Helper/Backups ----------

const backupDir = () => path.join(app.getPath('documents'), 'Finance Helper', 'Backups');
const safeName = (n) => /^finance-helper-\d{4}-\d{2}-\d{2}\.json$/.test(n);
ipcMain.handle('backup-write', (_e, name, text) => {
  if (!safeName(name)) throw new Error('Bad backup name');
  fs.mkdirSync(backupDir(), { recursive: true });
  fs.writeFileSync(path.join(backupDir(), name), String(text));
  return backupDir();
});
ipcMain.handle('backup-list', () => {
  try {
    return fs.readdirSync(backupDir()).filter(safeName).map((n) => ({ name: n, size: fs.statSync(path.join(backupDir(), n)).size })).sort((a, b) => b.name.localeCompare(a.name));
  } catch { return []; }
});
ipcMain.handle('backup-read', (_e, name) => {
  if (!safeName(name)) throw new Error('Bad backup name');
  return fs.readFileSync(path.join(backupDir(), name), 'utf8');
});
ipcMain.handle('backup-delete', (_e, name) => {
  if (safeName(name)) fs.rmSync(path.join(backupDir(), name), { force: true });
  return true;
});
ipcMain.handle('backup-folder', () => { fs.mkdirSync(backupDir(), { recursive: true }); return shell.openPath(backupDir()); });

// ---------- Google Drive sync ----------

const drive = createDrive({ app, net, safeStorage, shell });
ipcMain.handle('drive-status', () => drive.status());
ipcMain.handle('drive-connect', (_e, clientId, clientSecret) => {
  const id = String(clientId || '').trim();
  const secret = String(clientSecret || '').trim();
  if (!/\.apps\.googleusercontent\.com$/.test(id)) throw new Error('The Client ID should end with .apps.googleusercontent.com');
  if (secret.length < 10) throw new Error('Paste the Client secret too.');
  return drive.connect(id, secret);
});
ipcMain.handle('drive-pull', () => drive.pull());
ipcMain.handle('drive-push', (_e, text) => drive.push(String(text)));
ipcMain.handle('drive-disconnect', () => drive.disconnect());
ipcMain.handle('drive-snap-put', (_e, name, text) => drive.putSnapshot(String(name), String(text)));
ipcMain.handle('drive-snap-list', () => drive.listSnapshots());
ipcMain.handle('drive-snap-read', (_e, id) => drive.readSnapshot(String(id)));
ipcMain.handle('drive-snap-delete', (_e, id) => drive.deleteSnapshot(String(id)));

// ---------- Updates (GitHub Releases, via electron-updater) ----------
// The page asks; nothing downloads or installs without a click, except the
// quiet check at start-up and every 4 hours.

let updater = null;
const send = (channel, payload) => {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload);
};

function getUpdater() {
  if (updater || !app.isPackaged) return updater;
  ({ autoUpdater: updater } = require('electron-updater'));
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  updater.on('update-available', (i) => send('update-event', { type: 'available', version: i.version, date: i.releaseDate }));
  updater.on('update-not-available', () => send('update-event', { type: 'none' }));
  updater.on('download-progress', (p) => send('update-event', { type: 'progress', percent: Math.round(p.percent) }));
  updater.on('update-downloaded', (i) => send('update-event', { type: 'ready', version: i.version }));
  updater.on('error', (e) => send('update-event', { type: 'error', message: String(e?.message || e).split('\n')[0] }));
  return updater;
}

ipcMain.handle('update-check', async () => {
  const u = getUpdater();
  if (!u) return { type: 'dev', message: 'Updates work in the installed app, not in development.' };
  const r = await u.checkForUpdates();
  // No answer at all means this copy can't self-update (e.g. the portable
  // .exe or an unpacked folder); never report that as "up to date".
  if (!r?.updateInfo) return { type: 'error', message: 'This copy of the app can\'t update itself. Install it with the Setup file once; after that updates are one click.' };
  const latest = r.updateInfo.version;
  return { type: latest && latest !== app.getVersion() ? 'available' : 'none', version: latest, date: r?.updateInfo?.releaseDate };
});
ipcMain.handle('update-download', async () => { await getUpdater()?.downloadUpdate(); return true; });
ipcMain.handle('update-install', () => { getUpdater()?.quitAndInstall(false, true); return true; });

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(ROOT, rel));
    const allowed = SERVED.some((p) => (p.endsWith('/') ? rel.startsWith(p) : rel === p));
    if (!allowed || !file.startsWith(ROOT + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  createWindow();
  // Quiet check shortly after start and every 4 hours; the page shows it.
  const quietCheck = () => getUpdater()?.checkForUpdates().catch(() => {});
  setTimeout(quietCheck, 8000);
  setInterval(quietCheck, 4 * 3600 * 1000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Ctrl+Alt+N (Cmd+Alt+N on a Mac) from anywhere: bring the app forward
// with a new record open.
const HOTKEY = 'CommandOrControl+Alt+N';
let hotkeyOk = false;

function quickAdd() {
  let [win] = BrowserWindow.getAllWindows();
  if (!win) win = createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', () => win.webContents.send('quick-add'));
  else win.webContents.send('quick-add');
}

app.whenReady().then(() => {
  try { hotkeyOk = globalShortcut.register(HOTKEY, quickAdd); } catch { hotkeyOk = false; }
});
app.on('will-quit', () => globalShortcut.unregisterAll());
ipcMain.handle('hotkey-status', () => ({ key: process.platform === 'darwin' ? 'Cmd+Alt+N' : 'Ctrl+Alt+N', ok: hotkeyOk }));

app.on('second-instance', () => {
  const [win] = BrowserWindow.getAllWindows();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
