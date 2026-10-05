// Safe bridge between the Analytikul web app (renderer) and the Electron main process.
// Exposes only a tiny, explicit surface — no Node access leaks to the page.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('analytikulDesktop', {
  isDesktop: true,
  // Hand a pairing code (fetched from the logged-in session) to the bundled bridge.
  pair: (code) => ipcRenderer.invoke('atk:pair', String(code || '')),
});
