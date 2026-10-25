const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const WebSocket = require('../collaboration-server/node_modules/ws');
const Y = require('../collaboration-server/node_modules/yjs');

const root = path.join(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'java-blueprints-collab-'));
const accessKey = 'local-acceptance-' + require('node:crypto').randomBytes(24).toString('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitFor(predicate, description, timeout = 8000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const result = await predicate();
    if (result) return result;
    await delay(40);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function startServer(port) {
  const child = spawn(process.execPath, [path.join(root, 'collaboration-server', 'server.mjs')], {
    cwd: root,
    env: { ...process.env, COLLAB_ACCESS_TOKEN: accessKey, COLLAB_DATA_DIR: dataDir, HOST: '127.0.0.1', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
  });
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk.toString(); });
  return { child, errors: () => errors };
}

async function request(base, route, method = 'GET', key = accessKey, data) {
  const response = await fetch(base + route, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(data ? { 'Content-Type': 'application/json' } : {}) },
    body: data ? JSON.stringify(data) : undefined
  });
  return { status: response.status, body: await response.json() };
}

async function connect(base, id, key, name) {
  const socket = new WebSocket(base.replace('http:', 'ws:') + `/ws?project=${id}`);
  const messages = [];
  socket.on('message', raw => messages.push(JSON.parse(raw.toString())));
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  socket.send(JSON.stringify({ type: 'auth', token: key, clientId: name.toLowerCase(), name, color: '#3366cc' }));
  const welcome = await waitFor(() => messages.find(message => message.type === 'welcome'), `${name} welcome`);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Buffer.from(welcome.state, 'base64'), 'remote');
  socket.on('message', raw => {
    const message = JSON.parse(raw.toString());
    if (message.type === 'crdt') Y.applyUpdate(doc, Buffer.from(message.update, 'base64'), 'remote');
  });
  doc.on('update', (update, origin) => {
    if (origin === 'local') socket.send(JSON.stringify({ type: 'crdt', update: Buffer.from(update).toString('base64') }));
  });
  return { socket, doc, messages, welcome };
}

async function stopServer(server) {
  if (!server || server.child.exitCode !== null) return;
  server.child.kill();
  await Promise.race([new Promise(resolve => server.child.once('exit', resolve)), delay(3000)]);
}

(async () => {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let server = startServer(port);
  const clients = [];
  try {
    await waitFor(async () => {
      try { return (await fetch(base + '/health')).ok; } catch { return false; }
    }, 'local collaboration server');
    const initial = 'public class Main { public static void main(String[] args) { System.out.println("ready"); } }';
    const created = await request(base, '/api/projects', 'POST', accessKey, { name: 'Acceptance project', files: { 'Main.java': initial }, positions: {} });
    assert.equal(created.status, 201);
    const id = created.body.project.id;
    const ownerKey = created.body.ownerToken;
    const invite = await request(base, `/api/projects/${id}/invites`, 'POST', ownerKey, { role: 'editor' });
    const viewerInvite = await request(base, `/api/projects/${id}/invites`, 'POST', ownerKey, { role: 'viewer' });
    assert.equal(invite.status, 201);
    assert.equal(viewerInvite.status, 201);
    const [owner, editor, viewer] = await Promise.all([
      connect(base, id, ownerKey, 'Owner'),
      connect(base, id, invite.body.token, 'Editor'),
      connect(base, id, viewerInvite.body.token, 'Viewer')
    ]);
    clients.push(owner, editor, viewer);
    assert.equal(viewer.welcome.role, 'viewer');
    const ownerText = owner.doc.getMap('files').get('Main.java');
    const editorText = editor.doc.getMap('files').get('Main.java');
    owner.doc.transact(() => ownerText.insert(0, '// owner\n'), 'local');
    editor.doc.transact(() => editorText.insert(editorText.length, '\n// editor'), 'local');
    await waitFor(() => {
      const values = clients.map(client => client.doc.getMap('files').get('Main.java')?.toString());
      return values.every(value => value?.includes('// owner') && value?.includes('// editor')) && new Set(values).size === 1;
    }, 'concurrent text convergence');
    const converged = owner.doc.getMap('files').get('Main.java').toString();
    const invalid = new Y.Doc();
    invalid.getMap('files').set('Main.java', new Y.Text('viewer-wrote'));
    viewer.socket.send(JSON.stringify({ type: 'crdt', update: Buffer.from(Y.encodeStateAsUpdate(invalid)).toString('base64') }));
    await waitFor(() => viewer.messages.some(message => message.type === 'error' && /Viewers cannot edit/.test(message.error)), 'viewer rejection');
    assert.equal((await request(base, `/api/projects/${id}`, 'GET', ownerKey)).body.project.files['Main.java'], converged);
    for (const client of clients) { client.socket.close(); client.doc.destroy(); }
    await stopServer(server);
    server = startServer(port);
    await waitFor(async () => { try { return (await fetch(base + '/health')).ok; } catch { return false; } }, 'server restart');
    const persisted = await request(base, `/api/projects/${id}`, 'GET', ownerKey);
    assert.equal(persisted.body.project.files['Main.java'], converged);
    assert.equal(persisted.body.project.name, 'Acceptance project');
    console.log(JSON.stringify({ projectId: id, clients: 3, concurrentTextConverged: true, viewerWriteRejected: true, diskPersistence: true, revision: persisted.body.project.revision }, null, 2));
  } finally {
    for (const client of clients) try { client.socket.close(); client.doc.destroy(); } catch {}
    await stopServer(server);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
