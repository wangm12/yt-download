import { ipcMain } from 'electron'
import * as downloadManager from '../downloadManager'
import * as ytdlp from '../ytdlp'
import * as settings from '../settings'
import { sniffMedia } from '../mediaSniffer'

export function registerDownloadHandlers(): void {
  ipcMain.handle('get-video-info', async (_event, url: string) => {
    try {
      if (!ytdlp.isValidDownloadUrl(url)) {
        return { error: 'Invalid URL' }
      }
      const cookiesPath = settings.getCookiesPath()
      const ytdlpPath = settings.get('ytdlpPath')
      const info = await ytdlp.getVideoInfo(url, cookiesPath || undefined, ytdlpPath)
      return { data: info }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('start-download', async (_event, options: {
    url: string
    title: string
    format: string
    quality?: string
    outputDir?: string
    thumbnail?: string
    duration?: number
    metadata?: Record<string, unknown>
    playlistId?: string
    playlistIndex?: number
    isPlaylist?: boolean
    playlistTitle?: string
    mediaType?: string
    referer?: string
    customHeaders?: Record<string, string>
  }) => {
    try {
      const task = downloadManager.addTask(options)
      return { data: task }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('cancel-download', async (_event, id: string) => {
    const cancelled = downloadManager.cancelTask(id)
    return { cancelled }
  })

  ipcMain.handle('pause-download', async (_event, id: string) => {
    const paused = downloadManager.pauseTask(id)
    return { paused }
  })

  ipcMain.handle('retry-download', async (_event, id: string) => {
    const retried = downloadManager.retryTask(id)
    return { retried }
  })

  ipcMain.handle('delete-task', async (_event, id: string) => {
    downloadManager.deleteTask(id)
    return { ok: true }
  })

  ipcMain.handle('delete-task-with-files', async (_event, id: string) => {
    await downloadManager.deleteTaskWithFiles(id)
    return { ok: true }
  })

  ipcMain.handle('get-downloads', async () => {
    const tasks = downloadManager.getAll()
    return { data: tasks }
  })

  ipcMain.handle('resume-all', async () => {
    downloadManager.resumeAll()
    return { ok: true }
  })

  ipcMain.handle('pause-all', async () => {
    downloadManager.pauseAll()
    return { ok: true }
  })

  ipcMain.handle('clear-downloads', async (_event, mode: string) => {
    if (mode === 'all') {
      downloadManager.clearAll()
    } else {
      downloadManager.clearCompleted()
    }
    return { ok: true }
  })

  ipcMain.handle('sniff-media', async (_event, url: string) => {
    try {
      const media = await sniffMedia(url)
      return { data: media }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })
}
