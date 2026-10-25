# Java Blueprints collaboration service

Node 20+ service. Run one process per data directory. Java source is stored as data and is never executed here.

```sh
npm install --omit=dev
export COLLAB_ACCESS_TOKEN="$(openssl rand -hex 32)"
export COLLAB_DATA_DIR=/var/lib/java-blueprints
export HOST=127.0.0.1
export PORT=8787
npm start
```

Keep the workspace token in a protected server environment file and enter it only when creating/listing projects. Do not bundle it in the application. Bind to localhost behind an HTTPS reverse proxy with WebSocket upgrade support. The application connects via HTTPS/WSS. Back up the data directory. Run as an unprivileged dedicated service user.

`COLLAB_ORIGIN` optionally restricts the CORS origin; default `*` supports the desktop file origin and web clients. Authentication uses explicit bearer tokens, never cookies. `/health` is public. Token values are never returned by project reads or logged. Project capability tokens are stored as SHA-256 hashes.

## HTTP API

All protected requests use `Authorization: Bearer <token>` and JSON. Limits: 12 MiB project including CRDT history, 2 MiB per source file, 500 files, 2,000 positions, 50 connected collaborators per room.

- `GET /health` → `{ok:true}`.
- `GET /api/projects` (workspace token) → `{projects:[{id,name,revision,updatedAt,fileCount,online}]}`.
- `POST /api/projects` (workspace token), `{name,files:{"Main.java":"..."},positions:{}}` → `{project,ownerToken}`. Save this owner capability locally; the server cannot retrieve it later.
- `GET /api/projects/:id` (workspace, owner, editor or viewer token) → `{project,role}`.
- `POST /api/projects/:id/invites` (workspace or owner token), `{role:"editor"|"viewer"}` → `{token,role,projectId}`. Invite links should put the token in their URL fragment, so it is not sent in HTTP requests or proxy logs.

Project shape: `{id,name,files,positions,revision,updatedAt}`. Files use relative slash-separated names. Positions are `{nodeId:{x,y}}`; scope IDs by file when needed.

## WebSocket protocol

Connect to `/ws?project=<id>`. Within five seconds send:

```json
{"type":"auth","token":"project capability","clientId":"stable uuid","name":"Alice","color":"#6c95eb"}
```

The server sends `welcome` with `{clientId,role,project,revision,clients,state}`. `state` is base64 `Y.encodeStateAsUpdate(doc)`. Use **Yjs 13.x**:

- `doc.getMap('files')`: keys are filenames, values are `Y.Text`.
- `doc.getMap('positions')`: keys are node IDs, values are plain `{x,y}`.
- Apply welcome state with `Y.applyUpdate(doc, bytes, 'remote')`. Do not initialize a second independent copy of the same file text from the project JSON; that would duplicate content when merged.
- Edit existing `Y.Text` with insert/delete operations. Do not replace it with a new `Y.Text` on every keystroke. Concurrent text edits then merge at character granularity.
- Send local document updates as `{type:'crdt',update:<base64>}`; the server persists before broadcasting `{type:'crdt',update,clientId,revision,updatedAt}` to every participant, including sender. Applying an echoed Yjs update is idempotent. Ignore updates originating from `'remote'` when sending.
- Offline clients retain their Y.Doc and queued updates. On reconnect, apply welcome state to the retained document, then send queued updates (or full `Y.encodeStateAsUpdate(localDoc)`). Do not replace the local document, because that would lose offline edits.
- `{type:'sync'}` requests `{type:'snapshot',project,revision,state}`.
- `{type:'presence',file,selection,cursor:{x,y}}` broadcasts `{type:'presence',clients:[{clientId,name,color,file,selection,cursor}]}`. `cursor` uses graph world coordinates. Send at most 20 updates/second. `null` removes the cursor. Presence is ephemeral.
- Viewer tokens receive all updates and can publish presence; attempted CRDT writes receive `{type:'error',error:'Viewers cannot edit'}` and are not applied. Disable editing controls in the client.
- Errors have `{type:'error',error}`. Auth failures close with code 4001. Reconnect transient disconnects with backoff; surface authentication errors instead of retrying forever.

The server snapshots the complete Yjs state and readable files into one atomically replaced JSON document on disk for each accepted update. Independent text edits converge. Concurrent moves of the same node use Yjs map conflict resolution (one deterministic winning position). File deletion versus editing follows Yjs map semantics; a deleted file stays deleted. The revision is an observation counter, not a compare-and-swap precondition.
