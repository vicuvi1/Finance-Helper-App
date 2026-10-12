// Desktop app: the same web app in its own window. Files are served from a
// private app:// origin so ES modules and saved data work like on the web,
// and nothing is loaded from the internet.

const { app, BrowserWindow, protocol, net, shell, Menu, ipcMain, safeStorage, globalShortcut, Tray, nativeImage, dialog } = require('electron');
const { createTelegram } = require('./telegram.cjs');
const { createBinance } = require('./binance.cjs');
const { createDrive } = require('./gdrive.cjs');
const { createFolderSync } = require('./folder.cjs');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const SERVED = ['index.html', 'manifest.webmanifest', 'sw.js', 'css/', 'js/', 'icons/', 'fonts/'];
const ORIGIN = 'app://finance';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// Tests run the unpackaged app with their own throwaway data folder.
if (!app.isPackaged && process.env.FH_USER_DATA) app.setPath('userData', process.env.FH_USER_DATA);
// Day-first dates (10/10/2026 reads as 10 October) in date pickers, as in Moldova.
if (!process.env.FH_LANG) app.commandLine.appendSwitch('lang', 'en-GB');
else app.commandLine.appendSwitch('lang', process.env.FH_LANG);

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
    backgroundColor: '#0b0d12',
    autoHideMenuBar: true,
    show: false,
    icon: path.join(ROOT, 'icons', 'icon-512.png'),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.cjs') },
  });
  // Started with Windows in the background: stay in the tray until opened.
  // Otherwise show it when the page is drawn, and in any case after a few
  // seconds, so a slow or failed load never leaves an invisible window.
  if (!process.argv.includes('--hidden')) {
    win.once('ready-to-show', () => win.show());
    setTimeout(() => { if (!win.isDestroyed() && !win.isVisible()) win.show(); }, 4000);
  }
  win.on('close', (e) => {
    try {
      fs.writeFileSync(boundsFile(), JSON.stringify(win.getNormalBounds()));
    } catch {
      // Not critical: the window just opens at the default size next time.
    }
    // Keep running in the tray (reminders, Telegram) unless really quitting.
    if (prefs().background && !quitting) {
      e.preventDefault();
      win.hide();
      makeTray();
      // The first time: say where the app went.
      if (!prefs().trayTold) {
        savePrefs({ trayTold: true });
        try {
          tray?.displayBalloon?.({ iconType: 'info', title: 'Finance Helper is still running', content: 'It keeps your reminders and Telegram bot working. Click the icon here (by the clock) to open it, or right-click → Quit. You can turn this off in Settings.' });
        } catch { /* balloons are Windows-only */ }
      }
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

// ---------- Sync through a folder (the Google Drive folder on this PC) ----------

const folder = createFolderSync({ getPref: (k) => prefs()[k], setPref: (k, v) => savePrefs({ [k]: v }), dialog, shell, win: () => BrowserWindow.getAllWindows()[0] });
ipcMain.handle('folder-status', () => folder.status());
ipcMain.handle('folder-use', (_e, p) => folder.use(String(p)));
ipcMain.handle('folder-pick', () => folder.pick());
ipcMain.handle('folder-off', () => folder.disconnect());
ipcMain.handle('folder-open', () => folder.open());
ipcMain.handle('folder-pull', () => folder.pull());
ipcMain.handle('folder-push', (_e, text) => folder.push(String(text)));
ipcMain.handle('folder-snap-put', (_e, name, text) => folder.putSnapshot(String(name), String(text)));
ipcMain.handle('folder-snap-list', () => folder.listSnapshots());
ipcMain.handle('folder-snap-read', (_e, id) => folder.readSnapshot(String(id)));
ipcMain.handle('folder-snap-delete', (_e, id) => folder.deleteSnapshot(String(id)));

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
// Silent install (no Setup wizard to click through or lose behind other
// windows), then the app starts again by itself.
ipcMain.handle('update-install', () => { quitting = true; getUpdater()?.quitAndInstall(true, true); return true; });

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

function showWindow() {
  let [win] = BrowserWindow.getAllWindows();
  if (!win) win = createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return win;
}

app.on('second-instance', () => showWindow());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------- Running in the background ----------
// prefs.json: { background: keep running in the tray when the window is
// closed, atLogin: start with the computer (hidden) }.
let quitting = false;
let tray = null;
app.on('before-quit', () => { quitting = true; });
const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json');
function prefs() {
  try { return { background: true, atLogin: false, ...JSON.parse(fs.readFileSync(prefsFile(), 'utf8')) }; } catch { return { background: true, atLogin: false }; }
}
function makeTray() {
  if (tray) return;
  tray = new Tray(nativeImage.createFromPath(path.join(ROOT, 'icons', 'icon-192.png')).resize({ width: 16, height: 16 }));
  tray.setToolTip('Finance Helper');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Finance Helper', click: () => showWindow() },
    { label: 'New record', click: () => quickAdd() },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', () => showWindow());
}
function savePrefs(next) {
  const p = { ...prefs(), ...next };
  try { fs.writeFileSync(prefsFile(), JSON.stringify(p)); } catch { /* not critical */ }
  return p;
}
ipcMain.handle('bg-get', () => prefs());
ipcMain.handle('bg-set', (_e, next) => {
  const p = savePrefs(next);
  if (typeof next.atLogin === 'boolean' && app.isPackaged) app.setLoginItemSettings({ openAtLogin: p.atLogin, args: ['--hidden'] });
  if (p.background) makeTray();
  return p;
});
app.whenReady().then(() => { if (prefs().background || process.argv.includes('--hidden')) makeTray(); });

// ---------- Telegram bot ----------
const toPage = (channel, data) => BrowserWindow.getAllWindows()[0]?.webContents.send(channel, data);
// Tests on machines without a key store (never in the installed app).
const testMemory = !app.isPackaged && process.env.FH_TG_TEST_MEMORY === '1'
  ? (() => { let v = null; return { read: () => v, write: (o) => { v = o; }, remove: () => { v = null; } }; })() : undefined;
const telegram = createTelegram({
  app, net, safeStorage, storage: testMemory,
  onUpdates: (updates) => toPage('tg-updates', updates),
  onEvent: (ev) => toPage('tg-event', ev),
});
app.whenReady().then(() => {
  // Give the page a moment to load before messages arrive.
  setTimeout(() => telegram.start(), 4000);
});
ipcMain.handle('tg-status', () => telegram.status());
ipcMain.handle('tg-connect', async (_e, token) => telegram.connect(token));
ipcMain.handle('tg-pair', () => telegram.pair());
ipcMain.handle('tg-ack', (_e, ids) => telegram.ack(ids));
ipcMain.handle('tg-send', (_e, text, extra) => telegram.send(String(text).slice(0, 4000), extra || {}));
ipcMain.handle('tg-edit', (_e, id, text, extra) => telegram.edit(id, String(text).slice(0, 4000), extra || {}));
ipcMain.handle('tg-answer', (_e, id, text) => telegram.answer(id, text));
ipcMain.handle('tg-disconnect', () => telegram.disconnect());
ipcMain.handle('tg-load-now', () => telegram.loadNow());
ipcMain.handle('tg-relay-script', () => telegram.relayScript());
ipcMain.handle('tg-relay-connect', (_e, url) => telegram.relayConnect(url));
ipcMain.handle('tg-relay-off', () => telegram.relayOff());
ipcMain.handle('open-external', (_e, url) => { if (/^https:\/\/(t\.me|script\.google\.com)\//.test(url)) shell.openExternal(url); return true; });
