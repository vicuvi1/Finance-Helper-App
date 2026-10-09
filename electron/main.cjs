// Desktop app: the same web app in its own window. Files are served from a
// private app:// origin so ES modules and saved data work like on the web,
// and nothing is loaded from the internet.

const { app, BrowserWindow, protocol, net, shell, Menu, ipcMain } = require('electron');
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
