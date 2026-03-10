import { v4 as uuidv4 } from 'uuid'
import { BrowserWindow } from 'electron'
import * as db from './database'
import * as settings from './settings'
import * as ytdlp from './ytdlp'
import { dirname } from 'path'
import { stat, readdir, unlink } from 'fs/promises'
import { join } from 'path'

export type TaskStatus = 'queued' | 'downloading' | 'complete' | 'error' | 'interrupted' | 'cancelled' | 'paused'

export interface DownloadTask {
  id: string
  url: string
  title: string
  format: string
  quality: string
  status: TaskStatus
  progress: number
  filePath: string | null
  thumbnail: string | null
  duration: number | null
  metadata: Record<string, unknown>
  playlistId: string | null
  playlistIndex: number | null
  error: string | null
  createdAt: string
  updatedAt: string
}

interface AddTaskOptions {
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
}

let activeDownloads = new Map<string, { cancel: () => void; getStderr?: () => string; getDestinations?: () => string[] }>()
const taskExtraMeta = new Map<string, { mediaType?: string; referer?: string; customHeaders?: Record<string, string> }>()
let mainWindow: BrowserWindow | null = null

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win
}

function emitToRenderer(channel: string, data: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data)
  }
}

function taskFromRecord(r: db.DownloadRecord): DownloadTask {
  return {
    id: r.id,
    url: r.url,
    title: r.title,
    format: r.format,
    quality: r.quality,
    status: r.status as TaskStatus,
    progress: r.progress,
    filePath: r.file_path,
    thumbnail: r.thumbnail,
    duration: r.duration,
    metadata: r.channel ? { channel: r.channel } : {},
    playlistId: r.playlist_id,
    playlistIndex: r.playlist_index,
    error: r.error,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

function emitProgress(task: DownloadTask): void {
  emitToRenderer('download-progress', task)
}

export function addTask(options: AddTaskOptions): DownloadTask {
  const id = uuidv4()
  const outputDir = options.outputDir ?? settings.get('downloadDir')
  const quality = options.quality ?? settings.get('defaultVideoQuality')

  const task: DownloadTask = {
    id,
    url: options.url,
    title: options.title,
    format: options.format,
    quality,
    status: 'queued',
    progress: 0,
    filePath: null,
    thumbnail: options.thumbnail ?? null,
    duration: options.duration ?? null,
    metadata: {
      ...(options.metadata ?? {}),
      ...(options.mediaType ? { mediaType: options.mediaType } : {}),
      ...(options.referer ? { referer: options.referer } : {}),
      ...(options.customHeaders ? { customHeaders: options.customHeaders } : {})
    },
    playlistId: options.playlistId ?? null,
    playlistIndex: options.playlistIndex ?? null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  if (options.mediaType || options.referer || options.customHeaders) {
    taskExtraMeta.set(id, {
      mediaType: options.mediaType,
      referer: options.referer,
      customHeaders: options.customHeaders
    })
  }

  db.insertDownload({
    id: task.id,
    url: task.url,
    title: task.title,
    format: task.format,
    quality: task.quality,
    status: task.status,
    progress: task.progress,
    file_path: null,
    file_size: null,
    thumbnail: task.thumbnail,
    duration: task.duration,
    channel: null,
    playlist_id: task.playlistId,
    playlist_index: task.playlistIndex,
    error: null
  })

  emitToRenderer('new-download', task)
  processQueue()
  return task
}

async function runTask(task: DownloadTask): Promise<void> {
  const outputDir = settings.get('downloadDir')
  const cookiesPath = settings.getCookiesPath()
  const sleepInterval = settings.get('sleepInterval')
  const ytdlpPath = settings.get('ytdlpPath')
  const playlistSubfolder = settings.get('playlistSubfolder')

  const qualityNum = parseInt(task.quality, 10) || 1080
  const isPlaylist = task.playlistId != null
  const sanitizedPlaylistId = task.playlistId?.replace(/[/\\?*:|"<>]/g, '-')
  const outDir = playlistSubfolder && isPlaylist && sanitizedPlaylistId
    ? join(outputDir, sanitizedPlaylistId)
    : outputDir

  const taskMeta = task.metadata as Record<string, unknown> | undefined
  const cached = taskExtraMeta.get(task.id)
  const mediaType = cached?.mediaType || (taskMeta?.mediaType as string) || undefined
  const referer = cached?.referer || (taskMeta?.referer as string) || undefined
  const customHeaders = cached?.customHeaders || (taskMeta?.customHeaders as Record<string, string>) || undefined
  const dp = ytdlp.download(
    {
      url: task.url,
      format: task.format,
      quality: qualityNum,
      outputDir: outDir,
      cookiesPath: cookiesPath || undefined,
      sleepInterval,
      isPlaylist: false,
      playlistTitle: undefined,
      referer,
      customHeaders,
      outputTitle: mediaType ? task.title : undefined
    },
    ytdlpPath
  )

  activeDownloads.set(task.id, { cancel: dp.cancel, getStderr: dp.getStderr, getDestinations: dp.getDestinations })
  dp.onProgress((progress) => {
    task.progress = progress.percent
    task.status = 'downloading'
    task.updatedAt = new Date().toISOString()
    db.updateDownload(task.id, { status: 'downloading', progress: progress.percent })
    emitToRenderer('download-progress', {
      ...task,
      speed: progress.speed,
      eta: progress.eta,
      totalSize: progress.total,
      phase: progress.phase
    })
  })

  return new Promise((resolve) => {
    dp.process.on('close', async (code, signal) => {
      activeDownloads.delete(task.id)

      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        const current = db.getDownloads().find((r) => r.id === task.id)
        if (current?.status !== 'paused') {
          task.status = 'cancelled'
          task.error = 'Cancelled by user'
          db.updateDownload(task.id, { status: 'cancelled', error: 'Cancelled by user' })
        } else {
          task.status = 'paused'
          task.error = null
        }
        emitProgress(taskFromRecord(db.getDownloads().find((r) => r.id === task.id)!))
        resolve()
        processQueue()
        return
      }

      if (code !== 0) {
        task.status = 'error'
        const stderr = dp.getStderr().trim()
        const errorLine = stderr.split('\n').filter((l) => l.includes('ERROR:')).pop()
        task.error = errorLine || `yt-dlp exited with code ${code}`
        db.updateDownload(task.id, { status: 'error', error: task.error })
        emitProgress(task)
        resolve()
        processQueue()
        return
      }

      let filePath: string | null = null
      let fileSize: number | null = null
      const ext = task.format === 'audio' || task.format === 'mp3' ? 'mp3' : 'mp4'
      const sanitizedTitle = task.title.replace(/[/\\?*:|"<>]/g, '-')
      const expectedPath = join(outDir, `${sanitizedTitle}.${ext}`)

      try {
        const st = await stat(expectedPath)
        filePath = expectedPath
        fileSize = st.size
      } catch {
        try {
          const files = await readdir(outDir)
          const extLower = ext.toLowerCase()
          const candidates = files
            .filter((f) => f.toLowerCase().endsWith(extLower))
            .map((f) => join(outDir, f))
          let newest: { path: string; mtime: number } | null = null
          for (const p of candidates) {
            const st = await stat(p)
            if (!newest || st.mtimeMs > newest.mtime) {
              newest = { path: p, mtime: st.mtimeMs }
            }
          }
          if (newest) {
            filePath = newest.path
            const st = await stat(newest.path)
            fileSize = st.size
          }
        } catch {
          // Leave filePath null
        }
      }

      task.filePath = filePath
      task.status = 'complete'
      task.progress = 100
      task.updatedAt = new Date().toISOString()
      taskExtraMeta.delete(task.id)
      db.updateDownload(task.id, {
        status: 'complete',
        progress: 100,
        file_path: filePath,
        file_size: fileSize
      })

      emitProgress(task)
      resolve()
      processQueue()
    })

    dp.process.on('error', (err) => {
      activeDownloads.delete(task.id)
      task.status = 'error'
      task.error = err.message
      db.updateDownload(task.id, { status: 'error', error: err.message })
      emitProgress(task)
      resolve()
      processQueue()
    })
  })
}

let processing = false
async function processQueue(): Promise<void> {
  if (processing) return
  processing = true

  try {
    const concurrency = settings.get('concurrency')
    const all = db.getDownloads()
    const effectiveActive = Math.max(all.filter((r) => r.status === 'downloading').length, activeDownloads.size)
    const queued = all.filter((r) => r.status === 'queued')

    if (effectiveActive >= concurrency || queued.length === 0) {
      return
    }

    const slotCount = concurrency - effectiveActive
    const toStart = queued.slice(0, slotCount)

    for (const r of toStart) {
      db.updateDownload(r.id, { status: 'downloading' })
      const task = taskFromRecord({ ...r, status: 'downloading' })
      task.status = 'downloading'
      runTask(task).catch(() => {})
    }
  } finally {
    processing = false
  }
}

export function cancelTask(id: string): boolean {
  const active = activeDownloads.get(id)
  if (active) {
    active.cancel()
    activeDownloads.delete(id)
  }

  const tasks = db.getDownloads()
  const record = tasks.find((r) => r.id === id)
  if (record && (record.status === 'queued' || record.status === 'downloading')) {
    db.updateDownload(id, { status: 'cancelled', error: 'Cancelled by user' })
    const updated = db.getDownloads().find((r) => r.id === id)
    if (updated) {
      emitProgress(taskFromRecord(updated))
    }
    processQueue()
    return true
  }
  return false
}

export function pauseTask(id: string): boolean {
  const tasks = db.getDownloads()
  const record = tasks.find((r) => r.id === id)
  if (record && (record.status === 'queued' || record.status === 'downloading')) {
    db.updateDownload(id, { status: 'paused', error: null })

    const active = activeDownloads.get(id)
    if (active) {
      active.cancel()
      activeDownloads.delete(id)
    }
    const updated = db.getDownloads().find((r) => r.id === id)
    if (updated) {
      emitProgress(taskFromRecord(updated))
    }
    processQueue()
    return true
  }
  return false
}

export function retryTask(id: string): boolean {
  const tasks = db.getDownloads()
  const record = tasks.find((r) => r.id === id)
  if (record && (record.status === 'error' || record.status === 'interrupted' || record.status === 'cancelled' || record.status === 'paused')) {
    db.updateDownload(id, { status: 'queued', progress: 0, error: null })
    const updated = db.getDownloads().find((r) => r.id === id)
    if (updated) {
      emitProgress(taskFromRecord(updated))
    }
    processQueue()
    return true
  }
  return false
}

export function deleteTask(id: string): void {
  cancelTask(id)
  taskExtraMeta.delete(id)
  db.deleteDownload(id)
}

export async function deleteTaskWithFiles(id: string): Promise<void> {
  const record = db.getDownloads().find((r) => r.id === id)

  const active = activeDownloads.get(id)
  const capturedDests = active?.getDestinations?.() ?? []

  cancelTask(id)

  if (record) {
    const baseOutputDir = settings.get('downloadDir')
    const playlistSubfolder = settings.get('playlistSubfolder')
    const isPlaylist = record.playlist_id != null
    const sanitizedPlaylistId = record.playlist_id?.replace(/[/\\?*:|"<>]/g, '-')

    const searchDir = record.file_path
      ? dirname(record.file_path)
      : (playlistSubfolder && isPlaylist && sanitizedPlaylistId)
        ? join(baseOutputDir, sanitizedPlaylistId)
        : baseOutputDir

    const ext = record.format === 'audio' || record.format === 'mp3' ? 'mp3' : 'mp4'
    const sanitizedTitle = record.title.replace(/[/\\?*:|"<>]/g, '-')

    const filesToDelete: string[] = []

    if (record.file_path) filesToDelete.push(record.file_path)

    const knownBases = new Set<string>()
    knownBases.add(sanitizedTitle)

    for (const dest of capturedDests) {
      filesToDelete.push(dest)
      filesToDelete.push(dest + '.part')
      filesToDelete.push(dest + '.ytdl')
      const base = dest.replace(/\.[^.]+$/, '').split('/').pop() ?? ''
      if (base) knownBases.add(base)
    }

    try {
      const files = await readdir(searchDir)
      for (const f of files) {
        for (const base of knownBases) {
          if (
            f.startsWith(base) &&
            (f.endsWith('.part') || f.endsWith('.ytdl') ||
             /\.f\d+\.\w+$/.test(f) || /\.f\d+\.\w+\.part$/.test(f) ||
             f === `${base}.${ext}` || f === `${base}.mp4` || f === `${base}.webm`)
          ) {
            filesToDelete.push(join(searchDir, f))
            break
          }
        }
      }
    } catch { /* dir may not exist */ }

    const unique = [...new Set(filesToDelete)]
    await Promise.allSettled(unique.map((p) => unlink(p)))
  }

  db.deleteDownload(id)
}

export function getAll(): DownloadTask[] {
  return db.getDownloads().map(taskFromRecord)
}

export function clearCompleted(): void {
  db.clearCompleted()
  emitToRenderer('download-progress', { cleared: true })
}

export function clearAll(): void {
  for (const [id] of activeDownloads) {
    cancelTask(id)
  }
  db.clearAll()
  emitToRenderer('download-progress', { cleared: true })
}

export function pauseAll(): void {
  const all = db.getDownloads()
  for (const r of all) {
    if (r.status === 'downloading' || r.status === 'queued') {
      pauseTask(r.id)
    }
  }
}

export function resumeAll(): void {
  const all = db.getDownloads()
  for (const r of all) {
    if (r.status === 'paused' || r.status === 'interrupted' || r.status === 'cancelled' || r.status === 'error') {
      retryTask(r.id)
    }
  }
}

export function loadFromDbAndRecover(): void {
  const all = db.getDownloads()
  for (const r of all) {
    if (r.status === 'downloading') {
      db.updateDownload(r.id, { status: 'interrupted', error: 'App was closed during download' })
    }
  }
}
