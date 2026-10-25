const { contextBridge, ipcRenderer } = require('electron');

const channels = new Set([
  'project:open', 'project:save', 'project:export',
  'java:compile', 'java:run', 'java:compare', 'java:probe', 'java:analyze',
  'state:load', 'state:save',
  'window:minimize', 'window:toggleMaximize', 'window:close',
  'collab:credentials:get', 'collab:credentials:set'
]);

contextBridge.exposeInMainWorld('blueprintsDesktop', {
  invoke(channel, payload) {
    if (!channels.has(channel)) return Promise.reject(new Error('Unknown command'));
    return ipcRenderer.invoke(channel, payload);
  },
  onInvitation(callback) {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('collab:invite', (_event, url) => callback(url));
  }
});
