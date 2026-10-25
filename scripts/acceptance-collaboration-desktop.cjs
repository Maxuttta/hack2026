const { _electron } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const projectRoot = path.join(__dirname, '..');
const executablePath = path.join(projectRoot, 'dist', 'win-unpacked', 'Java Blueprints.exe');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'java-blueprints-desktop-collab-'));
const accessKey = crypto.randomBytes(32).toString('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function waitFor(predicate, description, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await predicate()) return; } catch {}
    await delay(50);
  }
  throw new Error(`Timed out: ${description}`);
}
async function request(base, route, method, token, data) {
  const response = await fetch(base + route, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

(async () => {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [path.join(projectRoot, 'collaboration-server', 'server.mjs')], {
    env: { ...process.env, COLLAB_ACCESS_TOKEN: accessKey, COLLAB_DATA_DIR: path.join(temp, 'data'), HOST: '127.0.0.1', PORT: String(port) },
    stdio: 'ignore', windowsHide: true
  });
  const apps = [];
  try {
    await waitFor(async () => (await fetch(base + '/health')).ok, 'collaboration server');
    const source = 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("ready");\n    }\n}\n';
    const created = await request(base, '/api/projects', 'POST', accessKey, { name: 'Desktop acceptance', files: { 'Main.java': source }, positions: {} });
    const viewer = await request(base, `/api/projects/${created.project.id}/invites`, 'POST', created.ownerToken, { role: 'viewer' });
    async function launch(profile, token) {
      const app = await _electron.launch({ executablePath, args: [`--profile-dir=${path.join(temp, profile)}`], timeout: 60000 });
      apps.push(app);
      const page = await app.firstWindow();
      await page.waitForSelector('#collabButton');
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.locator('#collabButton').click();
      await page.locator('#collabServer').fill(base);
      const invitation = 'JB-' + Buffer.from(JSON.stringify({ server: base, projectId: created.project.id, token })).toString('base64');
      await page.locator('#collabInvite').fill(invitation);
      await page.locator('[data-collab-action="join"]').click();
      await page.waitForFunction(() => window.blueprintsCollaboration?.state.connected, null, { timeout: 15000 });
      return { page, errors };
    }
    const owner = await launch('owner', created.ownerToken);
    const guest = await launch('viewer', viewer.token);
    assert.equal(await guest.page.evaluate(() => window.blueprintsCollaboration.state.role), 'viewer');
    assert.equal(await guest.page.locator('#code').getAttribute('readonly'), '');
    await owner.page.locator('#code').fill(source.replace('ready', 'collaborating'));
    await guest.page.waitForFunction(() => document.getElementById('code').value.includes('collaborating'), null, { timeout: 15000 });
    await owner.page.evaluate(() => {
      const item = graphNodes[0];
      item.x += 77;
      renderGraph();
      document.getElementById('flow').dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(async () => {
      const saved = await request(base, `/api/projects/${created.project.id}`, 'GET', created.ownerToken);
      return saved.project.files['Main.java'].includes('collaborating') && Object.values(saved.project.positions).length > 0;
    }, 'server disk update');
    const saved = await request(base, `/api/projects/${created.project.id}`, 'GET', created.ownerToken);
    assert.equal(owner.errors.length + guest.errors.length, 0, [...owner.errors, ...guest.errors].join('\n'));
    console.log(JSON.stringify({ desktopClients: 2, viewerReadOnly: true, liveCodeSynchronized: true, positionCount: Object.keys(saved.project.positions).length, persistedOnServer: true, pageErrors: [] }, null, 2));
  } finally {
    for (const app of apps.reverse()) try { await app.close(); } catch {}
    server.kill();
    await Promise.race([new Promise(resolve => server.once('exit', resolve)), delay(3000)]);
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
