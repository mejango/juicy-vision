/**
 * PayTerm Electron Main Process
 *
 * Runs the terminal application in kiosk mode on Raspberry Pi.
 * Handles window management, NFC communication, and API key storage.
 */

const { app, BrowserWindow, ipcMain, screen } = require('electron')
const path = require('path')
const Store = require('electron-store')

// Persistent storage for settings
const store = new Store({
  defaults: {
    apiKey: null,
    apiUrl: 'https://api.juicyvision.app',
    deviceName: 'PayTerm Device',
    kioskMode: false,
  }
})

let mainWindow = null

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize

  // Check if we should run in kiosk mode (for Raspberry Pi)
  const kioskMode = store.get('kioskMode') || process.argv.includes('--kiosk')

  mainWindow = new BrowserWindow({
    width: kioskMode ? width : 800,
    height: kioskMode ? height : 480,
    fullscreen: kioskMode,
    kiosk: kioskMode,
    frame: !kioskMode,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  // Load the UI
  const isDev = !app.isPackaged
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // Handle window close
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Prevent navigation away from the app
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) {
      event.preventDefault()
    }
  })
}

// App lifecycle
app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// IPC handlers for settings
ipcMain.handle('get-settings', () => {
  return {
    apiKey: store.get('apiKey'),
    apiUrl: store.get('apiUrl'),
    deviceName: store.get('deviceName'),
    kioskMode: store.get('kioskMode'),
  }
})

ipcMain.handle('save-settings', (event, settings) => {
  if (settings.apiKey !== undefined) store.set('apiKey', settings.apiKey)
  if (settings.apiUrl !== undefined) store.set('apiUrl', settings.apiUrl)
  if (settings.deviceName !== undefined) store.set('deviceName', settings.deviceName)
  if (settings.kioskMode !== undefined) store.set('kioskMode', settings.kioskMode)
  return true
})

ipcMain.handle('clear-settings', () => {
  store.clear()
  return true
})

// IPC handlers for app control
ipcMain.handle('quit-app', () => {
  app.quit()
})

ipcMain.handle('toggle-fullscreen', () => {
  if (mainWindow) {
    mainWindow.setFullScreen(!mainWindow.isFullScreen())
  }
})

ipcMain.handle('reload-app', () => {
  if (mainWindow) {
    mainWindow.reload()
  }
})
