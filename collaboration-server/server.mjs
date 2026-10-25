import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';

const token = process.env.COLLAB_ACCESS_TOKEN;
if (!token || token.length < 24) throw new Error('COLLAB_ACCESS_TOKEN must contain at least 24 characters');
const root = path.resolve(process.env.COLLAB_DATA_DIR || './data');
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
const rooms = new Map();
const MAX_BYTES = 12 * 1024 * 1024;
const authorized = value => typeof value === 'string' && crypto.timingSafeEqual(crypto.createHash('sha256').update(value).digest(), crypto.createHash('sha256').update(token).digest());
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const idOK = id => /^[a-f0-9-]{36}$/.test(id);
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function capability(project, secret) { return authorized(secret) ? 'owner' : typeof secret === 'string' ? project.capabilities?.[digest(secret)] || null : null; }
function issueCapability(project, role) { const secret = crypto.randomBytes(32).toString('base64url'); project.capabilities ||= {}; project.capabilities[digest(secret)] = role; return secret; }
function makeDoc(project) {
  const doc = new Y.Doc();
  if (project.crdt) Y.applyUpdate(doc, Buffer.from(project.crdt, 'base64'));
  else doc.transact(() => {
    for (const [name, source] of Object.entries(project.files)) { const text = new Y.Text(); text.insert(0, source); doc.getMap('files').set(name, text); }
    for (const [id, position] of Object.entries(project.positions)) doc.getMap('positions').set(id, position);
  });
  return doc;
}
function materialize(doc) {
  const files = Object.create(null), positions = doc.getMap('positions').toJSON();
  for (const [name, text] of doc.getMap('files')) { if (!(text instanceof Y.Text)) fail('File content must be Y.Text'); files[name] = text.toString(); }
  validatePatch({ files, positions });
  if (Object.keys(files).length > 500 || Object.keys(positions).length > 2000) fail('Project item limit exceeded');
  return { files, positions };
}
function applyCrdt(room, encoded, clientId) {
  if (typeof encoded !== 'string' || encoded.length > MAX_BYTES || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) fail('Invalid CRDT update');
  const bytes = Buffer.from(encoded, 'base64');
  const candidate = new Y.Doc();
  try {
    Y.applyUpdate(candidate, Y.encodeStateAsUpdate(room.doc));
    Y.applyUpdate(candidate, bytes);
    const data = materialize(candidate);
    const crdt = Buffer.from(Y.encodeStateAsUpdate(candidate)).toString('base64');
    const next = { ...room.project, ...data, crdt, revision: room.project.revision + 1, updatedAt: new Date().toISOString() };
    if (Buffer.byteLength(JSON.stringify(next)) > MAX_BYTES) fail('Project size limit exceeded', 413);
    atomic(path.join(root, `${next.id}.json`), next);
    Y.applyUpdate(room.doc, bytes);
    room.project = next;
    broadcast(room, { type: 'crdt', update: encoded, clientId, revision: next.revision, updatedAt: next.updatedAt });
  } finally { candidate.destroy(); }
}
function atomic(file, value) {
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
function getRoom(id) {
  if (!idOK(id)) fail('Invalid project ID');
  if (!rooms.has(id)) {
    const file = path.join(root, `${id}.json`);
    if (!fs.existsSync(file)) fail('Project not found', 404);
    const project = JSON.parse(fs.readFileSync(file, 'utf8'));
    rooms.set(id, { project, doc: makeDoc(project), clients: new Set() });
  }
  return rooms.get(id);
}
function publicProject(project) {
  const { versions, operations, capabilities, crdt, ...result } = project;
  return result;
}
function validatePatch(patch) {
  if (!plain(patch) || Object.keys(patch).some(k => !['files', 'positions'].includes(k))) fail('Invalid patch');
  for (const group of ['files', 'positions']) {
    if (patch[group] === undefined) continue;
    if (!plain(patch[group]) || Object.keys(patch[group]).length > 2000) fail(`Invalid ${group}`);
    for (const [key, value] of Object.entries(patch[group])) {
      if (!key || key.length > 512 || ['__proto__', 'constructor', 'prototype'].includes(key)) fail('Invalid key');
      if (group === 'files') {
        if (key.includes('\\') || key.startsWith('/') || key.split('/').some(part => !part || part === '.' || part === '..') || /[\x00-\x1f:]/.test(key)) fail('Invalid file path');
        if (value !== null && (typeof value !== 'string' || Buffer.byteLength(value) > 2 * 1024 * 1024)) fail('Invalid file content');
      } else if (value !== null && (!plain(value) || !Number.isFinite(value.x) || !Number.isFinite(value.y) || Math.abs(value.x) > 1e7 || Math.abs(value.y) > 1e7 || Object.keys(value).some(k => !['x', 'y'].includes(k)))) fail('Invalid node position');
    }
  }
}
function send(socket, message) { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); }
function broadcast(room, message) { for (const client of room.clients) send(client, message); }
function presence(room) {
  return [...room.clients].map(client => ({ clientId: client.clientId, name: client.displayName, color: client.color, ...client.presence }));
}
async function body(request) {
  const parts = []; let bytes = 0;
  for await (const part of request) { bytes += part.length; if (bytes > MAX_BYTES) fail('Request too large', 413); parts.push(part); }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { fail('Invalid JSON'); }
}
function respond(response, status, value) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); }
const server = http.createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', process.env.COLLAB_ORIGIN || '*');
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/health') { respond(response, 200, { ok: true, service: 'java-blueprints-collaboration' }); return; }
    const secret = request.headers.authorization?.replace(/^Bearer /, '');
    if (url.pathname === '/api/projects' && request.method === 'GET') {
      if (!authorized(secret)) fail('Workspace authentication required', 401);
      const projects = fs.readdirSync(root).filter(name => /^[a-f0-9-]{36}\.json$/.test(name)).map(name => {
        const p = JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
        return { id: p.id, name: p.name, revision: p.revision, updatedAt: p.updatedAt, fileCount: Object.keys(p.files).length, online: rooms.get(p.id)?.clients.size || 0 };
      }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      respond(response, 200, { projects }); return;
    }
    if (url.pathname === '/api/projects' && request.method === 'POST') {
      if (!authorized(secret)) fail('Workspace authentication required', 401);
      const input = await body(request);
      if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120) fail('Project name required (max 120 characters)');
      validatePatch({ files: input.files || {}, positions: input.positions || {} });
      if (Object.keys(input.files || {}).length > 500) fail('Too many files');
      const project = { id: crypto.randomUUID(), name: input.name.trim(), files: input.files || {}, positions: input.positions || {}, revision: 0, updatedAt: new Date().toISOString(), versions: {}, operations: [] };
      const ownerToken = issueCapability(project, 'owner');
      const doc = makeDoc(project);
      project.crdt = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');
      if (Buffer.byteLength(JSON.stringify(project)) > MAX_BYTES) fail('Project size limit exceeded', 413);
      atomic(path.join(root, `${project.id}.json`), project);
      rooms.set(project.id, { project, doc, clients: new Set() });
      respond(response, 201, { project: publicProject(project), ownerToken }); return;
    }
    const match = url.pathname.match(/^\/api\/projects\/([a-f0-9-]{36})(?:\/(invites))?$/);
    if (match) {
      const room = getRoom(match[1]);
      const role = capability(room.project, secret);
      if (!role) fail('Project authentication required', 401);
      if (request.method === 'POST' && match[2] === 'invites') {
        if (role !== 'owner') fail('Only the project owner can invite', 403);
        const input = await body(request);
        if (!['editor', 'viewer'].includes(input.role)) fail('Invalid invite role');
        if (Object.keys(room.project.capabilities || {}).length >= 200) fail('Invite limit reached');
        const inviteToken = issueCapability(room.project, input.role);
        atomic(path.join(root, `${room.project.id}.json`), room.project);
        respond(response, 201, { token: inviteToken, role: input.role, projectId: room.project.id }); return;
      }
      if (request.method === 'GET' && !match[2]) { respond(response, 200, { project: publicProject(room.project), role }); return; }
    }
    fail('Not found', 404);
  } catch (error) { respond(response, error.status || 500, { error: error.status ? error.message : 'Internal server error' }); if (!error.status) console.error(error); }
});
server.requestTimeout = 15000;
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_BYTES });
wss.on('connection', (socket, request) => {
  let room;
  socket.alive = true;
  socket.on('pong', () => { socket.alive = true; });
  const timer = setTimeout(() => socket.close(4001, 'Authentication timeout'), 5000);
  socket.on('message', raw => {
    try {
      const input = JSON.parse(raw.toString());
      if (!plain(input)) fail('Invalid message');
      if (!room) {
        if (input.type !== 'auth') { socket.close(4001, 'Authentication failed'); return; }
        const candidateRoom = getRoom(new URL(request.url, 'http://localhost').searchParams.get('project') || '');
        const role = capability(candidateRoom.project, input.token);
        if (!role) { socket.close(4001, 'Authentication failed'); return; }
        if (candidateRoom.clients.size >= 50) fail('Room is full');
        room = candidateRoom; socket.role = role;
        socket.clientId = typeof input.clientId === 'string' && /^[\w-]{1,128}$/.test(input.clientId) ? input.clientId : crypto.randomUUID();
        socket.displayName = String(input.name || 'Collaborator').slice(0, 60);
        socket.color = /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : '#6c95eb';
        socket.presence = {};
        room.clients.add(socket); clearTimeout(timer);
        send(socket, { type: 'welcome', clientId: socket.clientId, role, project: publicProject(room.project), revision: room.project.revision, clients: presence(room), state: Buffer.from(Y.encodeStateAsUpdate(room.doc)).toString('base64') });
        broadcast(room, { type: 'presence', clients: presence(room) }); return;
      }
      if (input.type === 'crdt') { if (socket.role === 'viewer') fail('Viewers cannot edit', 403); applyCrdt(room, input.update, socket.clientId); }
      else if (input.type === 'presence') {
        const now = Date.now(); if (now - (socket.lastPresence || 0) < 40) return; socket.lastPresence = now;
        socket.presence = { file: typeof input.file === 'string' ? input.file.slice(0, 512) : null, selection: typeof input.selection === 'string' ? input.selection.slice(0, 512) : null, cursor: plain(input.cursor) && Number.isFinite(input.cursor.x) && Number.isFinite(input.cursor.y) ? { x: input.cursor.x, y: input.cursor.y } : null };
        broadcast(room, { type: 'presence', clients: presence(room) });
      } else if (input.type === 'sync') send(socket, { type: 'snapshot', project: publicProject(room.project), revision: room.project.revision, state: Buffer.from(Y.encodeStateAsUpdate(room.doc)).toString('base64') });
      else fail('Unknown message type');
    } catch (error) { send(socket, { type: 'error', error: error.status ? error.message : 'Invalid message' }); }
  });
  socket.on('error', () => {});
  socket.on('close', () => { clearTimeout(timer); if (room) { room.clients.delete(socket); broadcast(room, { type: 'presence', clients: presence(room) }); } });
});
const heartbeat = setInterval(() => { for (const socket of wss.clients) { if (!socket.alive) { socket.terminate(); continue; } socket.alive = false; socket.ping(); } }, 30000);
server.listen(Number(process.env.PORT || 8787), process.env.HOST || '127.0.0.1', () => console.log('Java Blueprints collaboration ready'));
function shutdown() { clearInterval(heartbeat); for (const socket of wss.clients) socket.close(1001, 'Server restarting'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
