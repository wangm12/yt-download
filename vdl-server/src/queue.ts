import { mkdirSync, existsSync, readdirSync, statSync } from 'fs'
import { rm, stat } from 'fs/promises'
import { join, resolve, basename } from 'path'
import { nanoid } from 'nanoid'
import { config } from './config.js'
import * as db from './db.js'
import * as ytdlp from './ytdlp.js'
import { needsCompression, canCompressWithDecentQuality, compressToSize } from './compress.js'
import { getDouyinInfo, downloadDouyinVideo } from './douyin.js'

const MAX_CONCURRENT = 3
const activeDownloads = new Map<string, { cancel: () => void }>()

type ProgressCallback = (taskId: string, progress: ytdlp.DownloadProgress, title?: string) => void
type CompleteCallback = (taskId: string, filePath: string, title: string) => Promise<void>
type ErrorCallback = (taskId: string, error: string, url: string) => void

let onProgressCb: ProgressCallback = () => {}
let onCompleteCb: CompleteCallback = async () => {}
let onErrorCb: ErrorCallback = () => {}

export function onProgress(cb: ProgressCallback) { onProgressCb = cb }
export function onComplete(cb: CompleteCallback) { onCompleteCb = cb }
export function onError(cb: ErrorCallback) { onErrorCb = cb }

export type QualityMode = 'full' | 'compact'

interface TaskQuality { mode: QualityMode; compactFormat?: string }
const taskQualityMap = new Map<string, TaskQuality>()

export function submitTask(userId: number, url: string, quality: QualityMode = 'full', compactFormat?: string): string {
  const taskId = nanoid(12)
  db.insertTask({ id: taskId, user_id: userId, url })
  taskQualityMap.set(taskId, { mode: quality, compactFormat })
  console.log(`[queue] Task ${taskId} submitted for user ${userId} (quality=${quality}${compactFormat ? `, format=${compactFormat}` : ''}): ${url}`)
  processQueue()
  return taskId
}

export function cancelTask(taskId: string): boolean {
  const active = activeDownloads.get(taskId)
  if (active) {
    active.cancel()
    activeDownloads.delete(taskId)
  }
  db.updateTask(taskId, { status: 'cancelled', error: 'Cancelled by user' })
  console.log(`[queue] Task ${taskId} cancelled`)
  processQueue()
  return true
}

let processingQueue = false

function processQueue(): void {
  if (processingQueue) return
  processingQueue = true

  queueMicrotask(() => {
    processingQueue = false

    const queued = db.getTasksByStatus('queued')
    if (activeDownloads.size >= MAX_CONCURRENT || queued.length === 0) return

    const slots = MAX_CONCURRENT - activeDownloads.size
    const toStart = queued.slice(0, slots)

    for (const task of toStart) {
      console.log(`[queue] Starting task ${task.id}: ${task.url}`)
      db.updateTask(task.id, { status: 'downloading' })
      runTask(task).catch((err) => {
        console.error(`[queue] Task ${task.id} uncaught error:`, err)
      })
    }
  })
}

function findExistingFile(dir: string): string | null {
  if (!existsSync(dir)) return null
  const files = readdirSync(dir).filter(f =>
    !f.startsWith('.') &&
    !f.startsWith('ffmpeg2pass') &&
    !f.startsWith('compressed_') &&
    !f.endsWith('.part') &&
    !f.endsWith('.ytdl')
  )
  if (files.length === 0) return null
  const sorted = files
    .map(f => ({ name: f, size: statSync(join(dir, f)).size }))
    .sort((a, b) => b.size - a.size)
  console.log(`[queue] Found existing file in ${dir}: ${sorted[0].name} (${sorted[0].size} bytes)`)
  return join(dir, sorted[0].name)
}

async function runTask(task: db.TaskRow): Promise<void> {
  const tmpDir = join(resolve(config.tempDir), 'dl', task.id)
  mkdirSync(tmpDir, { recursive: true })

  try {
    let title = task.title || 'Unknown'
    let filePath = task.file_path && existsSync(task.file_path) ? task.file_path : findExistingFile(tmpDir)
    const taskQuality = taskQualityMap.get(task.id) ?? { mode: 'full' as QualityMode }
    const quality = taskQuality.mode

    if (filePath) {
      console.log(`[queue] Task ${task.id}: reusing existing file ${filePath}`)
      onProgressCb(task.id, { percent: 100, speed: '', eta: '', phase: 'downloading' }, title)
    } else {
      let ytdlpFailed = false

      try {
        console.log(`[queue] Task ${task.id}: fetching video info...`)
        const info = await ytdlp.getVideoInfo(task.url)
        title = info.title
        db.updateTask(task.id, { title })
        console.log(`[queue] Task ${task.id}: title="${title}", duration=${info.duration}s`)
        onProgressCb(task.id, { percent: 0, speed: '', eta: '', phase: 'info' }, title)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[queue] Task ${task.id}: info fetch failed:`, msg)
        if (/douyin/i.test(task.url) && /fresh cookies|douyin/i.test(msg)) {
          ytdlpFailed = true
        }
      }

      if (!ytdlpFailed) {
        try {
          console.log(`[queue] Task ${task.id}: starting yt-dlp download to ${tmpDir} (quality=${quality})`)
          const formatOverride = quality === 'compact' && taskQuality.compactFormat
            ? taskQuality.compactFormat
            : undefined
          const { promise, cancel } = ytdlp.download(task.url, tmpDir, (progress) => {
            db.updateTask(task.id, { progress: progress.percent })
            onProgressCb(task.id, progress, title)
          }, formatOverride)

          activeDownloads.set(task.id, { cancel })
          filePath = await promise
          activeDownloads.delete(task.id)
          console.log(`[queue] Task ${task.id}: yt-dlp download complete -> ${filePath}`)
        } catch (err) {
          activeDownloads.delete(task.id)
          const msg = err instanceof Error ? err.message : String(err)
          if (/douyin/i.test(task.url)) {
            console.log(`[queue] Task ${task.id}: yt-dlp failed for Douyin, trying direct fallback: ${msg}`)
            ytdlpFailed = true
          } else {
            throw err
          }
        }
      }

      if (ytdlpFailed && !filePath) {
        console.log(`[queue] Task ${task.id}: attempting Douyin direct download fallback`)
        onProgressCb(task.id, { percent: 0, speed: '', eta: '', phase: 'resolving' }, title)

        const douyinInfo = await getDouyinInfo(task.url)
        if (!douyinInfo) throw new Error('Douyin fallback failed: could not extract video info from mobile page')

        title = douyinInfo.title || title
        db.updateTask(task.id, { title })
        console.log(`[queue] Task ${task.id}: Douyin info: "${title}" by ${douyinInfo.author}`)

        onProgressCb(task.id, { percent: 10, speed: '', eta: '', phase: 'downloading' }, title)
        filePath = await downloadDouyinVideo(douyinInfo.videoUrl, tmpDir, title, (percent) => {
          db.updateTask(task.id, { progress: percent })
          onProgressCb(task.id, { percent, speed: '', eta: '', phase: 'downloading' }, title)
        })
        console.log(`[queue] Task ${task.id}: Douyin direct download complete -> ${filePath}`)
      }
    }

    if (!filePath || !existsSync(filePath)) {
      console.error(`[queue] Task ${task.id}: downloaded file does not exist at ${filePath}`)
      const found = findExistingFile(tmpDir)
      if (found) {
        console.log(`[queue] Task ${task.id}: found alternative file: ${found}`)
        filePath = found
      } else {
        throw new Error(`Downloaded file not found: ${filePath}`)
      }
    }

    const resolvedPath: string = filePath
    const fileStat = await stat(resolvedPath)
    console.log(`[queue] Task ${task.id}: file size = ${(fileStat.size / 1024 / 1024).toFixed(1)} MB, path = ${basename(resolvedPath)}`)
    db.updateTask(task.id, { progress: 100, file_path: resolvedPath })

    let finalPath = resolvedPath
    if (quality === 'full') {
      console.log(`[queue] Task ${task.id}: full quality mode — skipping compression, will use temp link if > 50MB`)
    } else if (await needsCompression(finalPath)) {
      if (await canCompressWithDecentQuality(finalPath)) {
        console.log(`[queue] Task ${task.id}: compact mode, file > 48MB, compressing...`)
        db.updateTask(task.id, { status: 'compressing' })
        onProgressCb(task.id, { percent: 0, speed: '', eta: '', phase: 'compressing' }, title)

        const compressed = await compressToSize(finalPath, 48, (phase) => {
          console.log(`[queue] Task ${task.id}: ${phase}`)
          onProgressCb(task.id, { percent: 50, speed: '', eta: '', phase }, title)
        })

        const compressedStat = await stat(compressed)
        console.log(`[queue] Task ${task.id}: compressed to ${(compressedStat.size / 1024 / 1024).toFixed(1)} MB`)
        finalPath = compressed
        db.updateTask(task.id, { file_path: finalPath })
      } else {
        console.log(`[queue] Task ${task.id}: compact mode, file > 48MB but too long to compress with decent quality`)
      }
    } else {
      console.log(`[queue] Task ${task.id}: file <= 48MB, no compression needed`)
    }

    db.updateTask(task.id, { status: 'complete', file_path: finalPath })
    console.log(`[queue] Task ${task.id}: calling onComplete with ${finalPath}`)

    try {
      await onCompleteCb(task.id, finalPath, title)
      console.log(`[queue] Task ${task.id}: onComplete finished successfully`)
    } catch (err) {
      console.error(`[queue] Task ${task.id}: onComplete FAILED:`, err)
    }
  } catch (err) {
    activeDownloads.delete(task.id)
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[queue] Task ${task.id}: ERROR:`, message)
    db.updateTask(task.id, { status: 'error', error: message })
    onErrorCb(task.id, message, task.url)
  } finally {
    taskQualityMap.delete(task.id)
    processQueue()
  }
}

export function recoverOnStartup(): void {
  const downloading = db.getTasksByStatus('downloading')
  const compressing = db.getTasksByStatus('compressing')
  const toRecover = [...downloading, ...compressing]
  if (toRecover.length > 0) {
    console.log(`[queue] Recovering ${toRecover.length} interrupted task(s)`)
  }
  for (const task of toRecover) {
    db.updateTask(task.id, { status: 'queued', progress: 0 })
  }
  processQueue()
}
