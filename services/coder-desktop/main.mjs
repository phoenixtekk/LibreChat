// Analytikul Coder — desktop shell (Electron).
// A native window for the Analytikul web app that bundles the local bridge and
// starts it in-process, so the agent can build on this machine with nothing to run
// by hand. Pairing is still done once from the rail (or reused from the saved token).

import { app, BrowserWindow, shell, Menu, ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_URL = process.env.ANALYTIKUL_URL || 'https://analytikul.ai';
const BRIDGE = path.join(__dirname, '..', 'coder-bridge', 'bridge.mjs');
const CONFIG_PATH = path.join(os.homedir(), '.analytikul-coder-bridge.json');

let bridgeProc = null;
let mainWindow = null;

// Run the bundled bridge as a Node child (Electron re-exec'd in node mode). It reads
// its saved pairing from ~/.analytikul-coder-bridge.json, so no inline code is needed.
function startBridge() {
  try {
    bridgeProc = spawn(process.execPath, [BRIDGE], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'ignore',
      windowsHide: true,
    });
    bridgeProc.on('exit', () => {
      bridgeProc = null;
    });
  } catch {
    bridgeProc = null;
  }
}

function stopBridge() {
  if (bridgeProc) {
    try {
      bridgeProc.kill();
    } catch {
      /* already gone */
    }
    bridgeProc = null;
  }
}

// Auto-pair: the renderer (logged in) fetches a pairing code and hands it here; we
// persist it and (re)start the bridge with it — so the desktop app needs no manual pairing.
ipcMain.handle('atk:pair', (_event, code) => {
  if (!code) return false;
  try {
    writeFileSync(CONFIG_PATH, JSON.stringify({ pair: code }), { mode: 0o600 });
  } catch {
    return false;
  }
  stopBridge();
  startBridge();
  return true;
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    title: 'Analytikul Coder',
    backgroundColor: '#0b1020',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  mainWindow.loadURL(APP_URL);
  // Open external links (docs, OAuth) in the system browser, not inside the shell.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

Menu.setApplicationMenu(null);

app.whenReady().then(() => {
  startBridge();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopBridge();
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', stopBridge);
