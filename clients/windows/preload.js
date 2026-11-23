'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('SPP_NATIVE', { exit: () => ipcRenderer.send('spp-exit'), platform: 'windows' });
