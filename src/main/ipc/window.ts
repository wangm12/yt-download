import { ipcMain, shell, dialog, BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

interface WindowContext {
  getMainWindow: () => BrowserWindow | null
  getSettingsWindow: () => BrowserWindow | null
  setSettingsWindow: (win: BrowserWindow | null) => void
}

export function registerWindowHandlers(ctx: WindowContext): void {
  const VITE_DEV_SERVER_URL = process.env.ELECTRON_RENDERER_URL

  ipcMain.handle('open-file-location', async (_event, path: string) => {
    try {
      shell.showItemInFolder(path)
      return { ok: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('open-file', async (_event, path: string) => {
    try {
      await shell.openPath(path)
      return { ok: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('select-download-folder', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? ctx.getMainWindow() ?? undefined
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory'],
      title: 'Select Download Location'
    })
    if (!result.canceled && result.filePaths[0]) {
      return result.filePaths[0]
    }
    return undefined
  })

  ipcMain.handle('open-settings', async () => {
    const existing = ctx.getSettingsWindow()
    if (existing && !existing.isDestroyed()) {
      existing.focus()
      return
    }

    const mainWindow = ctx.getMainWindow()
    const settingsWindow = new BrowserWindow({
      width: 480,
      height: 560,
      center: true,
      backgroundColor: '#1A1A1E',
      titleBarStyle: 'hiddenInset',
      frame: false,
      resizable: false,
      parent: mainWindow ?? undefined,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })

    ctx.setSettingsWindow(settingsWindow)

    if (is.dev && VITE_DEV_SERVER_URL) {
      settingsWindow.loadURL(`${VITE_DEV_SERVER_URL}#/settings`)
    } else {
      settingsWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/settings' })
    }

    settingsWindow.webContents.on('before-input-event', (_event, input) => {
      if ((input.meta || input.control) && input.key === 'w') {
        settingsWindow.close()
      }
    })

    settingsWindow.on('closed', () => {
      ctx.setSettingsWindow(null)
      const mw = ctx.getMainWindow()
      if (mw && !mw.isDestroyed()) {
        mw.webContents.send('settings-changed')
      }
    })
  })

  ipcMain.handle('close-window', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && win !== ctx.getMainWindow()) {
      win.close()
    }
  })

  ipcMain.handle('install-chrome-extension', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? ctx.getSettingsWindow() ?? undefined
    await dialog.showMessageBox(win!, {
      type: 'info',
      title: 'Install Chrome Extension',
      message: 'How to install the V-Download Chrome Extension',
      detail:
        '1. Open Chrome and go to chrome://extensions\n' +
        '2. Enable "Developer mode" (top right toggle)\n' +
        '3. Click "Load unpacked"\n' +
        '4. Select the extension folder from the V-Download app:\n\n' +
        '   Right-click V-Download.app → Show Package Contents → Contents → Resources → extension\n\n' +
        'Or if you cloned the repo, select the extension/ folder directly.',
      buttons: ['Open chrome://extensions', 'OK']
    }).then((result) => {
      if (result.response === 0) {
        shell.openExternal('https://chrome.google.com/extensions').catch(() => {
          shell.openExternal('chrome://extensions').catch(() => {})
        })
      }
    })
    return { ok: true }
  })
}
