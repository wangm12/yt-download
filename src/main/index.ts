import { app, BrowserWindow, protocol, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { optimizer, is } from '@electron-toolkit/utils'
import * as database from './database'
import * as downloadManager from './downloadManager'
import { startPoTokenServer } from './poTokenServer'
import { startLocalServer, stopLocalServer, setDownloadHandler, DownloadRequest } from './localServer'
import { registerDownloadHandlers } from './ipc/downloads'
import { registerSettingsHandlers } from './ipc/settings'
import { registerWindowHandlers } from './ipc/window'

let mainWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let pendingYtdlUrl: string | null = null
let pendingMediaRequests = new Map<string, DownloadRequest>()
let isQuitting = false

const VITE_DEV_SERVER_URL = process.env.ELECTRON_RENDERER_URL

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'ytdl',
    privileges: { standard: true, secure: true, supportFetchAPI: false }
  }
])

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

const launchUrl = process.argv.find((arg) => arg.startsWith('ytdl://'))
if (launchUrl) {
  pendingYtdlUrl = launchUrl
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 680,
    height: 520,
    icon: join(__dirname, '../../resources/icon.png'),
    backgroundColor: '#1A1A1E',
    titleBarStyle: 'hiddenInset',
    frame: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  downloadManager.setMainWindow(mainWindow)

  if (is.dev && VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('close', (e) => {
    if (process.platform === 'darwin' && !isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    downloadManager.setMainWindow(null)
  })

  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if ((input.meta || input.control) && input.key === 'w') {
      mainWindow?.hide()
    }
  })

  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingYtdlUrl && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ytdl-url', pendingYtdlUrl)
      pendingYtdlUrl = null
    }
  })
}

function handleDownloadRequest(request: DownloadRequest): void {
  const params = new URLSearchParams({ url: request.url })
  if (request.type) params.set('type', request.type)
  if (request.referer) params.set('referer', request.referer)
  if (request.title) params.set('title', request.title)
  if (request.headers) params.set('headers', JSON.stringify(request.headers))
  const ytdlUrl = `ytdl://download?${params.toString()}`
  handleYtdlUrl(ytdlUrl)
}

function handleYtdlUrl(url: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.send('ytdl-url', url)
  } else {
    pendingYtdlUrl = url
  }
}

function setupIpcHandlers(): void {
  registerDownloadHandlers()
  registerSettingsHandlers()
  registerWindowHandlers({
    getMainWindow: () => mainWindow,
    getSettingsWindow: () => settingsWindow,
    setSettingsWindow: (win) => { settingsWindow = win }
  })
}

app.whenReady().then(() => {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))

  if (process.platform === 'darwin') {
    const iconPath = join(__dirname, '../../resources/icon.png')
    const dockIcon = nativeImage.createFromPath(iconPath)
    if (!dockIcon.isEmpty()) {
      app.dock.setIcon(dockIcon)
    }
  }

  database.initDB()
  downloadManager.loadFromDbAndRecover()
  startPoTokenServer()
  startLocalServer()
  setDownloadHandler((request) => handleDownloadRequest(request))
  app.setAsDefaultProtocolClient('ytdl')
  setupIpcHandlers()
  optimizer.registerFramelessWindowIpc()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
    } else {
      createWindow()
    }
  })
})

app.on('open-url', (event, url) => {
  event.preventDefault()
  if (url.startsWith('ytdl://')) {
    if (app.isReady()) {
      handleYtdlUrl(url)
    } else {
      pendingYtdlUrl = url
    }
  }
})

app.on('second-instance', (_event, commandLine) => {
  const deepLink = commandLine.find((arg) => arg.startsWith('ytdl://'))
  if (deepLink) {
    handleYtdlUrl(deepLink)
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
  }
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  database.closeDB()
  stopLocalServer()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
