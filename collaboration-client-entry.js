import * as Y from 'yjs';

(() => {
  const api = window.blueprintsWorkbench;
  if (!api) return;
  const DEFAULT_SERVER = 'https://195.19.213.200';
  const toolbar = document.querySelector('.workspace-toolbar');
  const share = document.createElement('button');
  share.id = 'collabButton';
  share.title = 'Share project and collaborate live';
  share.innerHTML = '<svg class="ui-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3.5 19v-1.5A4.5 4.5 0 0 1 8 13h2a4.5 4.5 0 0 1 4.5 4.5V19zM16 5.2a3 3 0 0 1 0 5.6M18 13.5a4 4 0 0 1 2.5 4V19"/></svg> Share <span id="collabCount"></span>';
  toolbar.insertBefore(share, toolbar.querySelector('[data-command="analyze"]'));
  const avatars = document.createElement('div');
  avatars.className = 'collab-avatars';
  share.after(avatars);
  const modal = document.createElement('div');
  modal.className = 'collab-modal-backdrop';
  modal.hidden = true;
  modal.innerHTML = `<section class="collab-modal" role="dialog" aria-modal="true" aria-label="Collaboration">
    <header><div><strong>Live collaboration</strong><small>Share Java code and graph positions in real time</small></div><button data-collab-close aria-label="Close">×</button></header>
    <div class="collab-modal-body">
      <div class="collab-status" id="collabStatus">Local project</div>
      <label>Server address<input id="collabServer" value="${DEFAULT_SERVER}" spellcheck="false"></label>
      <label>Display name<input id="collabName" placeholder="Your name" maxlength="60"></label>
      <div class="collab-section" id="collabSetup">
        <label>Workspace access key<input id="collabWorkspaceToken" type="password" placeholder="Access key from the workspace owner" autocomplete="off"></label>
        <div class="collab-row"><button data-collab-action="create" class="collab-primary">Create shared project</button><button data-collab-action="list">Open workspace projects</button></div>
        <label>Invitation code<input id="collabInvite" placeholder="Paste a Java Blueprints invitation code" spellcheck="false"></label>
        <button data-collab-action="join">Join project</button>
        <div id="collabProjects" class="collab-projects"></div>
      </div>
      <div class="collab-section" id="collabConnected" hidden>
        <div class="collab-row"><strong id="collabProjectName"></strong><span id="collabRole"></span></div>
        <div id="collabMembers" class="collab-members"></div>
        <div class="collab-row"><button data-collab-action="editor" class="collab-primary">Copy edit link</button><button data-collab-action="viewer">Copy view link</button></div>
        <button data-collab-action="leave">Leave shared project</button>
      </div>
    </div>
  </section>`;
  document.body.appendChild(modal);
  const $ = selector => modal.querySelector(selector);
  const status = $('#collabStatus');
  const serverField = $('#collabServer');
  const nameField = $('#collabName');
  const tokenField = $('#collabWorkspaceToken');
  const inviteField = $('#collabInvite');
  let secrets = {};
  let socket = null;
  let doc = null;
  let room = null;
  let role = null;
  let reconnectTimer = null;
  let syncTimer = null;
  let renderTimer = null;
  let presenceTimer = 0;
  let localCursor = null;
  let localCursorFile = null;
  let applying = false;
  let remotePending = false;
  let members = [];
  const clientId = crypto.randomUUID();
  const color = ['#82b1ff','#b58cff','#f5a45d','#60c9a5','#e888ae'][Math.floor(Math.random()*5)];

  function setStatus(message, tone = '') { status.textContent = message; status.dataset.tone = tone; }
  function serverURL() {
    const url = new URL(serverField.value.trim());
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname))) throw new Error('Use an HTTPS server address');
    return url.origin;
  }
  async function loadSecrets() {
    if (window.blueprintsDesktop) {
      const result = await window.blueprintsDesktop.invoke('collab:credentials:get');
      if (result?.error) throw new Error(result.error);
      secrets = result || {};
    } else {
      try { secrets = JSON.parse(localStorage.getItem('java-blueprints-collab') || '{}'); } catch { secrets = {}; }
    }
    serverField.value = secrets.server || DEFAULT_SERVER;
    nameField.value = secrets.name || '';
    tokenField.value = secrets.workspaceToken || '';
  }
  async function saveSecrets() {
    secrets.server = serverField.value.trim();
    secrets.name = nameField.value.trim() || 'Collaborator';
    secrets.workspaceToken = tokenField.value.trim();
    if (window.blueprintsDesktop) {
      const result = await window.blueprintsDesktop.invoke('collab:credentials:set', secrets);
      if (result?.error) throw new Error(result.error);
    } else localStorage.setItem('java-blueprints-collab', JSON.stringify(secrets));
  }
  async function request(path, method, bearer, data) {
    const response = await fetch(serverURL() + path, {
      method, headers: { Authorization: `Bearer ${bearer}`, ...(data ? {'Content-Type':'application/json'} : {}) },
      body: data ? JSON.stringify(data) : undefined, cache: 'no-store'
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Server returned ${response.status}`);
    return result;
  }
  function encode(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }
  function decode(value) {
    const binary = atob(value);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  }
  function send(message) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); }
  function visible() {
    $('#collabSetup').hidden = !!room;
    $('#collabConnected').hidden = !room;
    $('#collabProjectName').textContent = room?.name || '';
    $('#collabRole').textContent = role || '';
    share.classList.toggle('connected', !!room && socket?.readyState === WebSocket.OPEN);
    document.getElementById('collabCount').textContent = room ? `· ${members.length + 1}` : '';
    const ownerOnly = role !== 'owner';
    for (const button of modal.querySelectorAll('[data-collab-action="editor"],[data-collab-action="viewer"]')) button.disabled = ownerOnly;
  }
  function applyPermissions() {
    const viewer = !!room && role === 'viewer';
    document.body.classList.toggle('collab-viewer', viewer);
    document.getElementById('code').readOnly = viewer;
    document.querySelectorAll('.workspace-toolbar [data-command]').forEach(button => {
      if (['load-demo','optimize-example','extract-method','baseline'].includes(button.dataset.command)) button.disabled = viewer;
    });
  }
  function updatePresence(clients) {
    members = clients.filter(item => item.clientId !== clientId);
    avatars.replaceChildren();
    $('#collabMembers').replaceChildren();
    for (const member of clients) {
      const dot = document.createElement('span');
      dot.className = 'collab-avatar';
      dot.style.setProperty('--member-color', member.color);
      dot.textContent = (member.name || '?').slice(0, 1).toUpperCase();
      dot.title = `${member.name}${member.file ? ` · ${member.file}` : ''}${member.clientId === clientId ? ' (you)' : ''}`;
      avatars.appendChild(dot);
      const row = document.createElement('div');
      row.className = 'collab-member';
      row.innerHTML = `<span class="collab-member-dot"></span><span></span><small></small>`;
      row.querySelector('.collab-member-dot').style.background = member.color;
      row.querySelector('span:nth-child(2)').textContent = member.name + (member.clientId === clientId ? ' (you)' : '');
      row.querySelector('small').textContent = member.file || 'Browsing';
      $('#collabMembers').appendChild(row);
    }
    visible();
    drawCursors();
  }
  function drawCursors() {
    const world = document.getElementById('world');
    world.querySelectorAll('.collab-cursor').forEach(el => el.remove());
    for (const member of members) {
      if (!member.cursor || member.file !== api.getProject().active) continue;
      const cursor = document.createElement('div');
      cursor.className = 'collab-cursor';
      cursor.style.left = `${member.cursor.x}px`;
      cursor.style.top = `${member.cursor.y}px`;
      cursor.style.color = member.color;
      cursor.style.setProperty('--cursor-color', member.color);
      cursor.innerHTML = '<svg viewBox="0 0 20 24"><path d="M2 2 2 20 7 15 11 23 15 21 11 13 18 13Z" fill="currentColor" stroke="#1e1f22" stroke-width="1"/></svg><span></span>';
      cursor.querySelector('span').textContent = member.name;
      world.appendChild(cursor);
    }
  }
  function renderRemote() {
    if (!doc || applying) return;
    applying = true;
    try {
      const remote = doc.getMap('files');
      const local = api.getProject().files;
      for (const name of Object.keys(local)) if (!remote.has(name)) api.applyRemoteFile(name, null);
      for (const [name, value] of remote) if (value instanceof Y.Text) api.applyRemoteFile(name, value.toString());
      for (const [key, position] of doc.getMap('positions')) api.applyRemotePosition(key, position);
    } finally { applying = false; remotePending = false; }
    drawCursors();
  }
  function queueRemote() {
    remotePending = true;
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderRemote, 45);
  }
  function patchText(text, next) {
    const old = text.toString();
    if (old === next) return;
    let start = 0;
    while (start < old.length && start < next.length && old[start] === next[start]) start++;
    let end = 0;
    while (end < old.length - start && end < next.length - start && old[old.length - 1 - end] === next[next.length - 1 - end]) end++;
    text.delete(start, old.length - start - end);
    text.insert(start, next.slice(start, next.length - end));
  }
  function syncLocal() {
    if (!doc || !room || !['owner','editor'].includes(role) || applying || remotePending) return;
    const project = api.getProject();
    const files = doc.getMap('files');
    const positions = doc.getMap('positions');
    doc.transact(() => {
      for (const name of [...files.keys()]) if (!Object.hasOwn(project.files, name)) files.delete(name);
      for (const [name, source] of Object.entries(project.files)) {
        let value = files.get(name);
        if (!(value instanceof Y.Text)) { value = new Y.Text(); files.set(name, value); }
        patchText(value, source);
      }
      for (const [key, position] of Object.entries(project.positions)) {
        const old = positions.get(key);
        if (!old || old.x !== position.x || old.y !== position.y) positions.set(key, position);
      }
      const prefix = `${project.active}:`;
      for (const key of [...positions.keys()]) {
        if (key.startsWith(prefix) && !Object.hasOwn(project.positions, key)) positions.delete(key);
      }
    }, 'local');
  }
  function connect(project, token) {
    clearTimeout(reconnectTimer);
    clearTimeout(renderTimer);
    remotePending = false;
    if (socket) { socket.onclose = null; socket.close(); }
    const retainedDoc = room?.id === project.id ? doc : null;
    const firstConnect = !retainedDoc;
    if (doc && doc !== retainedDoc) doc.destroy();
    room = project; role = null;
    doc = retainedDoc || new Y.Doc();
    if (!retainedDoc) doc.on('update', (update, origin) => { if (origin === 'local') send({ type: 'crdt', update: encode(update) }); else queueRemote(); });
    const wsURL = new URL(serverURL());
    wsURL.protocol = wsURL.protocol === 'https:' ? 'wss:' : 'ws:';
    wsURL.pathname = '/ws'; wsURL.searchParams.set('project', project.id);
    const connection = new WebSocket(wsURL.toString());
    socket = connection;
    setStatus('Connecting…'); visible();
    connection.onopen = () => send({ type:'auth', token, clientId, name:nameField.value.trim() || 'Collaborator', color });
    connection.onmessage = event => {
      if (socket !== connection) return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'welcome' || message.type === 'snapshot') {
        role = message.role || role;
        room = message.project;
        applyPermissions();
        Y.applyUpdate(doc, decode(message.state), 'remote');
        if (firstConnect) {
          const files = {};
          for (const [name, value] of doc.getMap('files')) files[name] = value.toString();
          api.replaceRemoteProject(files);
          setTimeout(() => document.getElementById('fitGraph').click(), 250);
        }
        clearTimeout(renderTimer);
        renderRemote();
        updatePresence(message.clients || []);
        setStatus(`Connected · ${room.name}`, 'ok');
        if (role !== 'viewer') send({ type:'crdt', update:encode(Y.encodeStateAsUpdate(doc)) });
        visible();
      } else if (message.type === 'crdt') {
        // Flush edits made since the last poll before merging a concurrent update.
        // Rendering the merge immediately keeps the textarea and Y.Text in sync.
        syncLocal();
        Y.applyUpdate(doc, decode(message.update), 'remote');
        clearTimeout(renderTimer);
        renderRemote();
      } else if (message.type === 'presence') updatePresence(message.clients || []);
      else if (message.type === 'error') setStatus(message.error, 'error');
    };
    connection.onclose = event => {
      if (socket !== connection || !room) return;
      if (event.code === 4001) { setStatus('Access denied. Check your invitation or workspace key.', 'error'); return; }
      setStatus('Connection lost · reconnecting…', 'error');
      visible();
      reconnectTimer = setTimeout(() => connect(room, token), 2000);
    };
    connection.onerror = () => setStatus('Connection error', 'error');
    clearInterval(syncTimer);
    syncTimer = setInterval(syncLocal, 180);
  }
  function parseInvitation(value) {
    const raw = value.trim();
    if (!raw) throw new Error('Paste an invitation code');
    let encoded = raw;
    if (raw.startsWith('https:') || raw.startsWith('java-blueprints:')) encoded = new URL(raw).hash.slice(1);
    if (encoded.startsWith('JB-')) encoded = encoded.slice(3);
    const data = JSON.parse(decodeURIComponent(escape(atob(encoded))));
    if (!data.projectId || !data.token || !data.server) throw new Error('Invalid invitation code');
    return data;
  }
  function invitation(data) {
    return 'java-blueprints://join#JB-' + btoa(unescape(encodeURIComponent(JSON.stringify(data))));
  }
  async function copyText(value) {
    try { await navigator.clipboard.writeText(value); return; } catch {}
    const input = document.createElement('textarea');
    input.value = value; input.style.position = 'fixed'; input.style.opacity = '0';
    document.body.appendChild(input); input.select();
    const copied = document.execCommand('copy'); input.remove();
    if (!copied) throw new Error('Clipboard is unavailable');
  }
  async function action(kind) {
    try {
      if (kind === 'leave') {
        clearTimeout(reconnectTimer); clearTimeout(renderTimer); clearInterval(syncTimer);
        remotePending = false;
        socket?.close(); socket = null; doc?.destroy(); doc = null; room = null; role = null;
        applyPermissions();
        members = []; avatars.replaceChildren(); visible(); setStatus('Local project'); return;
      }
      if (kind === 'create') {
        const workspaceToken = tokenField.value.trim();
        if (!workspaceToken) throw new Error('Enter the workspace access key');
        const project = api.getProject();
        const name = prompt('Project name', project.active.replace(/\.java$/i, '') || 'Java Blueprints');
        if (name === null) return;
        const created = await request('/api/projects', 'POST', workspaceToken, { name: name.trim() || 'Java Blueprints', files: project.files, positions: project.positions });
        secrets.projects ||= {};
        secrets.projects[created.project.id] = created.ownerToken;
        await saveSecrets();
        connect(created.project, created.ownerToken);
        return;
      }
      if (kind === 'list') {
        const workspaceToken = tokenField.value.trim();
        if (!workspaceToken) throw new Error('Enter the workspace access key');
        const result = await request('/api/projects', 'GET', workspaceToken);
        const list = $('#collabProjects'); list.replaceChildren();
        if (!result.projects.length) { list.textContent = 'No shared projects yet'; return; }
        for (const project of result.projects) {
          const button = document.createElement('button');
          button.textContent = `${project.name} · ${project.fileCount} files · ${project.online} online`;
          button.onclick = async () => { await saveSecrets(); connect(project, workspaceToken); };
          list.appendChild(button);
        }
        return;
      }
      if (kind === 'join') {
        const data = parseInvitation(inviteField.value);
        serverField.value = data.server;
        const result = await request(`/api/projects/${encodeURIComponent(data.projectId)}`, 'GET', data.token);
        secrets.projects ||= {}; secrets.projects[data.projectId] = data.token;
        await saveSecrets(); connect(result.project, data.token); return;
      }
      if (kind === 'editor' || kind === 'viewer') {
        if (role !== 'owner') throw new Error('Only the project owner can create invitations');
        const token = secrets.projects?.[room.id] || tokenField.value.trim();
        const result = await request(`/api/projects/${room.id}/invites`, 'POST', token, { role: kind });
        const text = invitation({ server: serverURL(), projectId: room.id, token: result.token, role: kind });
        await copyText(text);
        setStatus(`${kind === 'editor' ? 'Edit' : 'View'} invitation copied to clipboard`, 'ok');
      }
    } catch (error) { setStatus(error.message || String(error), 'error'); }
  }
  share.onclick = () => { modal.hidden = false; visible(); };
  modal.addEventListener('click', event => {
    if (event.target === modal || event.target.closest('[data-collab-close]')) modal.hidden = true;
    const button = event.target.closest('[data-collab-action]');
    if (button) action(button.dataset.collabAction);
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !modal.hidden) modal.hidden = true; });
  document.getElementById('graphCanvas').addEventListener('pointermove', event => {
    if (!room || socket?.readyState !== WebSocket.OPEN || Date.now() - presenceTimer < 80) return;
    presenceTimer = Date.now();
    const rect = document.getElementById('world').getBoundingClientRect();
    const scale = rect.width / document.getElementById('world').offsetWidth;
    localCursorFile = api.getProject().active;
    localCursor = {x:(event.clientX-rect.left)/scale,y:(event.clientY-rect.top)/scale};
    send({ type:'presence', file:localCursorFile, cursor:localCursor });
  });
  setInterval(() => {
    if (room && socket?.readyState === WebSocket.OPEN) {
      const file = api.getProject().active;
      send({ type:'presence', file, cursor:localCursorFile === file ? localCursor : null });
    }
  }, 3000);
  // Direct edits should enter the CRDT in the same event turn. The interval remains
  // a fallback for node moves and commands that update the project programmatically.
  document.getElementById('code').addEventListener('input', syncLocal);
  document.getElementById('flow').addEventListener('change', syncLocal);
  const ready = loadSecrets().catch(error => setStatus(error.message, 'error'));
  window.blueprintsDesktop?.onInvitation(async url => {
    await ready;
    inviteField.value = url;
    modal.hidden = false;
    action('join');
  });
  window.blueprintsCollaboration = { action, open: () => share.click(), refreshPermissions: applyPermissions, get state() { return { project:room, role, connected:socket?.readyState === WebSocket.OPEN, members }; } };
})();
