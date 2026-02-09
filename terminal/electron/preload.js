/**
 * PayTerm Electron Preload Script
 *
 * Exposes safe APIs to the renderer process via contextBridge.
 */

const { contextBridge, ipcRenderer } = require('electron')

// Expose settings API
contextBridge.exposeInMainWorld('electronAPI', {
  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  clearSettings: () => ipcRenderer.invoke('clear-settings'),

  // App control
  quitApp: () => ipcRenderer.invoke('quit-app'),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  reloadApp: () => ipcRenderer.invoke('reload-app'),

  // Platform info
  platform: process.platform,
  isElectron: true,
})
