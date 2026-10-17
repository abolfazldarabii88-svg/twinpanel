'use strict';

const path = require('node:path');
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('twinPanel', {
  getTelegramNativePreloadPath: () => path.join(__dirname, 'telegram-native', 'preload.js'),
  registerTelegramPanel: webContentsId => ipcRenderer.invoke('twinpanel:register-telegram-panel', Number(webContentsId)),
  toggleNativeTelegram: () => ipcRenderer.invoke('twinpanel:toggle-native-telegram'),
  toggleFullscreen: () => ipcRenderer.invoke('twinpanel:toggle-fullscreen'),
  getVersion: () => ipcRenderer.invoke('twinpanel:app-version'),
  checkForUpdates: () => ipcRenderer.invoke('twinpanel:check-updates'),
  downloadUpdate: () => ipcRenderer.invoke('twinpanel:download-update'),
  installUpdate: () => ipcRenderer.invoke('twinpanel:install-update'),
  onFullscreenChanged: callback => ipcRenderer.on('twinpanel:fullscreen-changed', (_event, value) => callback(value)),
  onCommand: callback => ipcRenderer.on('twinpanel:command', (_event, command) => callback(command)),
  onUpdateStatus: callback => ipcRenderer.on('twinpanel:update-status', (_event, status) => callback(status)),
  onMediaState: callback => ipcRenderer.on('twinpanel:media-state', (_event, state) => callback(state)),
  onGptAudioState: callback => ipcRenderer.on('twinpanel:gpt-audio-state', (_event, audible) => callback(audible))
});
