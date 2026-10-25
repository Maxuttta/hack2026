const { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { compile, run, compare, probe, analyze, safeName } = require('./java.cjs');

let window;
let projectRoot = null;
let pendingInvitation = process.argv.find(arg => arg.startsWith('java-blueprints://')) || null;
const profileArg = process.argv.find(arg => arg.startsWith('--profile-dir='));
if (profileArg) app.setPath('userData', path.resolve(profileArg.slice('--profile-dir='.length)));
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.quit();
else app.on('second-instance', (_event, argv) => {
  const invitation = argv.find(arg => arg.startsWith('java-blueprints://'));
  if (invitation) {
    pendingInvitation = invitation;
    if (window && !window.webContents.isLoading()) window.webContents.send('collab:invite', invitation);
  }
  if (window) { if (window.isMinimized()) window.restore(); window.focus(); }
});
function failSafe(handler) {
  return async (_event, payload) => {
    try { return await handler(payload || {}); }
    catch (error) { return { error: error.message || String(error) }; }
  };
}

async function readJavaProject(root) {
  const files = {};
  async function walk(directory, depth) {
    if (depth > 10 || Object.keys(files).length >= 200) return;
    for (const item of await fs.readdir(directory, { withFileTypes: true })) {
      if (item.name === '.git' || item.name === 'node_modules' || item.name === 'target' || item.name === 'build' || item.name === 'out') continue;
      const full = path.join(directory, item.name);
      if (item.isDirectory()) await walk(full, depth + 1);
      else if (item.isFile() && item.name.endsWith('.java')) {
        const relative = path.relative(root, full).replaceAll('\\', '/');
        files[relative] = await fs.readFile(full, 'utf8');
      }
    }
  }
  await walk(root, 0);
  if (!Object.keys(files).length) throw new Error('The selected folder contains no .java files');
  return files;
}

async function writeProject(root, files) {
  if (!files || typeof files !== 'object') throw new Error('No files to save');
  for (const [name, source] of Object.entries(files)) {
    const relative = safeName(name);
    if (typeof source !== 'string' || source.length > 2_000_000) throw new Error(`Invalid file: ${relative}`);
    const target = path.resolve(root, relative);
    if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error('Path is outside the project');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, source, 'utf8');
  }
}

function statePath() { return path.join(app.getPath('userData'), 'session.json'); }
function secretsPath() { return path.join(app.getPath('userData'), 'collaboration.bin'); }

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;
  if (app.isPackaged) app.setAsDefaultProtocolClient('java-blueprints');
  Menu.setApplicationMenu(null);
  window = new BrowserWindow({
    width: 1600, height: 1000, minWidth: 900, minHeight: 620,
    show: false, frame: false, autoHideMenuBar: true, backgroundColor: '#1e1f22',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true
    }
  });
  window.once('ready-to-show', () => window.show());
  window.loadFile(path.join(__dirname, '..', 'index.html'));
  window.webContents.on('did-finish-load', () => {
    if (pendingInvitation) window.webContents.send('collab:invite', pendingInvitation);
    pendingInvitation = null;
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  ipcMain.handle('window:minimize', () => window.minimize());
  ipcMain.handle('window:toggleMaximize', () => window.isMaximized() ? window.unmaximize() : window.maximize());
  ipcMain.handle('window:close', () => window.close());
  ipcMain.handle('collab:credentials:get', failSafe(async () => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is unavailable');
    try { return JSON.parse(safeStorage.decryptString(await fs.readFile(secretsPath()))); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  }));
  ipcMain.handle('collab:credentials:set', failSafe(async (value) => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is unavailable');
    const body = JSON.stringify(value);
    if (body.length > 100000) throw new Error('Credentials are too large');
    await fs.mkdir(path.dirname(secretsPath()), { recursive: true });
    await fs.writeFile(secretsPath(), safeStorage.encryptString(body), { mode: 0o600 });
    return { saved: true };
  }));

  ipcMain.handle('project:open', failSafe(async () => {
    const selection = await dialog.showOpenDialog(window, { properties: ['openDirectory'], title: 'Open Java project' });
    if (selection.canceled) return { canceled: true };
    const root = selection.filePaths[0];
    const files = await readJavaProject(root);
    projectRoot = root;
    return { root, files };
  }));

  ipcMain.handle('project:save', failSafe(async ({ files }) => {
    if (!projectRoot) {
      const selection = await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'], title: 'Project folder' });
      if (selection.canceled) return { canceled: true };
      projectRoot = selection.filePaths[0];
    }
    await writeProject(projectRoot, files);
    return { root: projectRoot, count: Object.keys(files).length };
  }));

  ipcMain.handle('project:export', failSafe(async ({ files }) => {
    const selection = await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'], title: 'Export Java files' });
    if (selection.canceled) return { canceled: true };
    await writeProject(selection.filePaths[0], files);
    return { root: selection.filePaths[0], count: Object.keys(files).length };
  }));

  ipcMain.handle('java:compile', failSafe(async ({ files }) => compile(files)));
  ipcMain.handle('java:analyze', failSafe(async ({ files }) => analyze(files)));
  ipcMain.handle('java:run', failSafe(async ({ files, mainClass, stdin }) => run(files, mainClass, stdin)));
  ipcMain.handle('java:compare', failSafe(async ({ baseline, current, cases, mainClass }) => compare(baseline, current, cases, mainClass)));
  ipcMain.handle('java:probe', failSafe(async ({ baseline, current, cases, mainClass }) => probe(baseline, current, cases, mainClass)));

  ipcMain.handle('state:load', failSafe(async () => {
    try {
      const data = JSON.parse(await fs.readFile(statePath(), 'utf8'));
      projectRoot = data.root && await fs.stat(data.root).then(x => x.isDirectory()).catch(() => false) ? data.root : null;
      return { ...data, root: projectRoot };
    } catch { return null; }
  }));
  ipcMain.handle('state:save', failSafe(async ({ files, baseline, tests, active, autoCheck }) => {
    const state = { files, baseline, tests, active, autoCheck, root: projectRoot };
    const body = JSON.stringify(state);
    if (body.length > 10_000_000) throw new Error('Project is too large for automatic saving');
    await fs.mkdir(path.dirname(statePath()), { recursive: true });
    await fs.writeFile(statePath(), body, 'utf8');
    return { saved: true };
  }));
});

app.on('window-all-closed', () => app.quit());
