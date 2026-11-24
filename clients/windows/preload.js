'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('SPP_NATIVE', { exit: () => ipcRenderer.send('spp-exit'), fullscreen: () => ipcRenderer.send('spp-fullscreen'), platform: 'windows' });
