const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const [, , profile, tokenFile] = process.argv;
if (!profile || !tokenFile) throw new Error('Provide a profile path and token file path');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', path.resolve(profile));
app.whenReady().then(() => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is unavailable');
  const target = path.join(app.getPath('userData'), 'collaboration.bin');
  let value = {};
  if (fs.existsSync(target)) value = JSON.parse(safeStorage.decryptString(fs.readFileSync(target)));
  value.server = 'https://195.19.213.200';
  value.workspaceToken = fs.readFileSync(tokenFile, 'utf8').trim();
  value.name ||= 'Max';
  fs.writeFileSync(target, safeStorage.encryptString(JSON.stringify(value)), { mode: 0o600 });
  fs.unlinkSync(tokenFile);
  app.quit();
}).catch(error => { console.error(error.message); app.exit(1); });
