// Sync and backups through a folder, typically the Google Drive folder that
// "Google Drive for desktop" keeps in step with the cloud (G:\My Drive …).
// No Google Cloud keys or sign-in: the app writes a file into
// <folder>/Finance Helper/ and Drive uploads it; other computers using the
// same folder read it. Same pull/push/snapshot calls as electron/gdrive.cjs,
// so js/screens/sync.js and backups.js work with either.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SUB = 'Finance Helper';
const FILE = 'finance-helper-sync.json';
const SNAP = /^finance-helper-\d{4}-\d{2}-\d{2}\.json$/;
// "My Drive" in the languages Google Drive for desktop uses most here.
const MY_DRIVE = ['My Drive', 'Drive-ul meu', 'Мой диск', 'Mi unidad', 'Mon Drive', 'Meine Ablage', 'Il mio Drive', 'Meu Drive', 'Mijn Drive', 'Mój dysk', 'Мій диск'];

// Where Google Drive for desktop is, if it is installed.
function findDriveFolder({ platform = process.platform, home = os.homedir(), exists = fs.existsSync, readdir = fs.readdirSync } = {}) {
  const tries = [];
  if (platform === 'win32') {
    for (const letter of 'GHIJKLMNOPQRSTUVWXYZDEF') for (const name of MY_DRIVE) tries.push(`${letter}:\\${name}`);
    for (const name of MY_DRIVE) tries.push(path.win32.join(home, 'Google Drive', name));
    tries.push(path.win32.join(home, 'Google Drive'));
  } else if (platform === 'darwin') {
    const cloud = path.posix.join(home, 'Library', 'CloudStorage');
    try {
      for (const d of readdir(cloud)) if (d.startsWith('GoogleDrive')) for (const name of MY_DRIVE) tries.push(path.posix.join(cloud, d, name));
    } catch { /* not there */ }
    tries.push(path.posix.join(home, 'Google Drive', 'My Drive'), path.posix.join(home, 'Google Drive'));
  } else {
    tries.push(path.posix.join(home, 'Google Drive'), path.posix.join(home, 'GoogleDrive'));
  }
  return tries.find((p) => { try { return exists(p); } catch { return false; } }) || null;
}

function createFolderSync({ getPref, setPref, dialog, shell, win }) {
  const root = () => getPref('syncFolder') || null;
  const dir = () => path.join(root(), SUB);
  const snaps = () => path.join(dir(), 'Backups');
  const need = () => { if (!root()) throw new Error('No folder chosen.'); };

  // Write to a temporary file, then rename: Drive never uploads half a file.
  function writeSafe(file, text) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, String(text));
    fs.renameSync(tmp, file);
  }

  function use(folder) {
    const p = String(folder || '');
    if (!p || !fs.existsSync(p) || !fs.statSync(p).isDirectory()) throw new Error('That folder does not exist.');
    fs.mkdirSync(path.join(p, SUB), { recursive: true });
    // Test that we can write there.
    writeSafe(path.join(p, SUB, '.write-test'), 'ok');
    fs.rmSync(path.join(p, SUB, '.write-test'), { force: true });
    setPref('syncFolder', p);
    return status();
  }

  function status() {
    const p = root();
    return { connected: !!p && fs.existsSync(p), folder: p, suggested: p ? null : findDriveFolder(), mode: 'folder' };
  }

  return {
    status,
    use,
    async pick() {
      const r = await dialog.showOpenDialog(win(), { title: 'Choose your Google Drive folder', properties: ['openDirectory'], defaultPath: findDriveFolder() || os.homedir() });
      if (r.canceled || !r.filePaths?.[0]) return status();
      return use(r.filePaths[0]);
    },
    disconnect() { setPref('syncFolder', null); return true; },
    open() { need(); fs.mkdirSync(dir(), { recursive: true }); return shell.openPath(dir()); },
    pull() {
      need();
      try { return fs.readFileSync(path.join(dir(), FILE), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    },
    push(text) { need(); writeSafe(path.join(dir(), FILE), text); return true; },
    putSnapshot(name, text) { need(); if (!SNAP.test(name)) throw new Error('Bad backup name'); writeSafe(path.join(snaps(), name), text); return true; },
    listSnapshots() {
      need();
      try {
        return fs.readdirSync(snaps()).filter((n) => SNAP.test(n)).map((n) => ({ id: n, name: n, size: fs.statSync(path.join(snaps(), n)).size }));
      } catch { return []; }
    },
    readSnapshot(id) { need(); if (!SNAP.test(id)) throw new Error('Bad backup name'); return fs.readFileSync(path.join(snaps(), id), 'utf8'); },
    deleteSnapshot(id) { need(); if (SNAP.test(id)) fs.rmSync(path.join(snaps(), id), { force: true }); return true; },
  };
}

module.exports = { createFolderSync, findDriveFolder, MY_DRIVE };
