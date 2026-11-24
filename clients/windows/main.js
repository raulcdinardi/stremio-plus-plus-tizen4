'use strict';
// Stremio++ desktop shell: a window around the bundled TV app (app-ui/, copied from the repo's app/ at build time).
const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// Server candidates, in priority order: Tailscale (works on any network) first, home LAN as the fallback.
// Override with env STREMIOPP_SERVERS="url,url" or a servers.txt next to the exe (one URL per line).
const DEFAULT_SERVERS = ['http://100.64.0.10:8790', 'http://192.168.1.10:8790'];
function servers() {
  if (process.env.STREMIOPP_SERVERS) return process.env.STREMIOPP_SERVERS.split(',').map((s) => s.trim()).filter(Boolean);
  try {
    const f = path.join(path.dirname(process.execPath), 'servers.txt');
    const l = fs.readFileSync(f, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter((s) => /^https?:\/\//.test(s));
    if (l.length) return l;
  } catch (e) { /* none */ }
  return DEFAULT_SERVERS;
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport,VaapiVideoDecoder');
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
function create() {
  win = new BrowserWindow({
    width: 1280, height: 720, minWidth: 640, minHeight: 360, backgroundColor: '#000000', title: 'Stremio++', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false },
  });
  Menu.setApplicationMenu(null);
  win.on('page-title-updated', (e) => e.preventDefault()); // keep the window title "Stremio++" whatever the page says
  const q = 'client=windows&saver=0&servers=' + encodeURIComponent(servers().join(','));
  win.loadFile(path.join(__dirname, 'app-ui', 'index.html'), { search: q });
  win.webContents.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown') return;
    if (i.key === 'F11' || (i.alt && i.key === 'Enter')) { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    else if (i.key === 'F12' && i.control) win.webContents.toggleDevTools();
  });
  // the mouse "back" button (and the keyboard's browser-back key) is Back inside the app
  win.on('app-command', (e, cmd) => { if (cmd === 'browser-backward') { e.preventDefault(); win.webContents.executeJavaScript("window.SPP_CLIENT&&SPP_CLIENT.back&&SPP_CLIENT.back()").catch(() => {}); } });
  win.webContents.setWindowOpenHandler((d) => { shell.openExternal(d.url); return { action: 'deny' }; });
  win.on('closed', () => { win = null; });
}
ipcMain.on('spp-exit', () => app.quit());
ipcMain.on('spp-fullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); });
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(create);
app.on('window-all-closed', () => app.quit());
