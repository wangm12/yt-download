import { spawn, execSync } from 'child_process'
import { existsSync, readdirSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { config } from './config.js'

const EXTRA_PATH_DIRS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  join(process.env.HOME ?? '', '.local/bin'),
]

function spawnEnv(): Record<string, string> {
  const existing = process.env.PATH ?? ''
  const dirs = new Set(existing.split(':').concat(EXTRA_PATH_DIRS))
  return { ...process.env as Record<string, string>, PATH: [...dirs].join(':') }
}

export interface CompactOption {
  height: number
  estimatedSizeMB: number
  formatString: string
}

export interface VideoInfo {
  id: string
  title: string
  thumbnail: string
  duration: number
  channel: string
  webpage_url: string
  filesize_approx: number
  compactOption: CompactOption | null
}

export interface DownloadProgress {
  percent: number
  speed: string
  eta: string
  phase: string
}

function getYtdlpPath(): string {
  const candidates = ['/opt/homebrew/bin/yt-dlp', '/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp']
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  try {
    return execSync('which yt-dlp', { encoding: 'utf-8' }).trim()
  } catch {
    return 'yt-dlp'
  }
}

function cookieArgs(): string[] {
  if (config.cookieMode === 'browser') {
    return ['--cookies-from-browser', 'chrome']
  }
  if (config.cookieMode === 'file' && config.cookiesFilePath) {
    const absPath = resolve(config.cookiesFilePath)
    if (existsSync(absPath)) {
      console.log(`[ytdlp] Using cookie file: ${absPath}`)
      return ['--cookies', absPath]
    }
    console.warn(`[ytdlp] Cookie file not found: ${absPath}`)
  }
  return []
}

const COMPACT_TARGET_MB = 45
const SAFETY_MARGIN = 1.15

function findCompactOption(formats: any[] | undefined, duration: number | undefined): CompactOption | null {
  if (!formats || !Array.isArray(formats) || !duration || duration <= 0) return null

  const videoFormats = formats.filter(f =>
    f.vcodec && f.vcodec !== 'none' &&
    f.height && typeof f.height === 'number'
  )

  // yt-dlp picks the best (largest) audio track, so use max
  const audioFormats = formats.filter(f =>
    f.acodec && f.acodec !== 'none' &&
    (!f.vcodec || f.vcodec === 'none') &&
    (f.filesize || f.filesize_approx)
  )
  const audioSizes = audioFormats.map(f => Number(f.filesize ?? f.filesize_approx ?? 0)).filter(s => s > 0)
  const bestAudioSize = audioSizes.length > 0
    ? Math.max(...audioSizes)
    : (128 * 1024 / 8) * duration

  console.log(`[ytdlp] Audio track estimate: ${(bestAudioSize / 1024 / 1024).toFixed(1)}MB (from ${audioSizes.length} audio formats, using max)`)

  // Group video-only formats by height, pick the smallest video size per height
  const byHeight = new Map<number, { size: number; formatId: string }>()
  for (const f of videoFormats) {
    const size = Number(f.filesize ?? f.filesize_approx ?? 0)
    if (size <= 0) continue
    const h = f.height as number
    const existing = byHeight.get(h)
    if (!existing || size < existing.size) {
      byHeight.set(h, { size, formatId: String(f.format_id) })
    }
  }

  const targetBytes = COMPACT_TARGET_MB * 1024 * 1024

  // Apply safety margin to account for container overhead and estimation error
  const heights = [...byHeight.entries()]
    .map(([h, { size, formatId }]) => ({
      height: h,
      totalSize: (size + bestAudioSize) * SAFETY_MARGIN,
      formatId,
    }))
    .sort((a, b) => b.height - a.height)

  console.log(`[ytdlp] Format analysis (with ${Math.round((SAFETY_MARGIN - 1) * 100)}% margin): ${heights.map(h => `${h.height}p=${(h.totalSize / 1024 / 1024).toFixed(0)}MB`).join(', ')}`)

  const fit = heights.find(h => h.totalSize <= targetBytes)
  if (!fit) return null

  return {
    height: fit.height,
    estimatedSizeMB: fit.totalSize / (1024 * 1024),
    formatString: `bv[height<=${fit.height}][ext=mp4]+ba[ext=m4a]/bv[height<=${fit.height}]+ba/best[height<=${fit.height}]`,
  }
}

export async function getVideoInfo(url: string): Promise<VideoInfo> {
  const ytdlp = getYtdlpPath()
  const args = [
    '--dump-json',
    '--no-download',
    '--no-warnings',
    '--no-check-certificate',
    '--no-playlist',
    '--remote-components', 'ejs:github',
    ...cookieArgs(),
    url,
  ]

  return new Promise((resolve, reject) => {
    const proc = spawn(ytdlp, args, { stdio: ['ignore', 'pipe', 'pipe'], env: spawnEnv() })
    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp info failed (code ${code}): ${stderr.slice(0, 500)}`))
        return
      }
      try {
        const lines = stdout.trim().split('\n').filter(Boolean)
        const json = JSON.parse(lines[lines.length - 1])
        const thumbnails = json.thumbnails as Array<{ url: string }> | undefined

        let filesizeApprox = 0
        if (json.filesize_approx) {
          filesizeApprox = Number(json.filesize_approx)
        } else if (json.filesize) {
          filesizeApprox = Number(json.filesize)
        } else if (json.requested_formats && Array.isArray(json.requested_formats)) {
          for (const fmt of json.requested_formats) {
            filesizeApprox += Number(fmt.filesize_approx ?? fmt.filesize ?? 0)
          }
        }

        const compactOption = findCompactOption(json.formats, json.duration)

        console.log(`[ytdlp] Info: id=${json.id}, duration=${json.duration}s, filesize_approx=${(filesizeApprox / 1024 / 1024).toFixed(1)}MB, compact=${compactOption ? `${compactOption.height}p ~${compactOption.estimatedSizeMB.toFixed(0)}MB` : 'none'}`)

        resolve({
          id: String(json.id ?? ''),
          title: String(json.title ?? 'Unknown'),
          thumbnail: thumbnails?.[thumbnails.length - 1]?.url ?? json.thumbnail ?? '',
          duration: typeof json.duration === 'number' ? json.duration : 0,
          channel: String(json.channel ?? json.uploader ?? ''),
          webpage_url: String(json.webpage_url ?? json.url ?? url),
          filesize_approx: filesizeApprox,
          compactOption,
        })
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })

    proc.on('error', reject)
  })
}

const PROGRESS_REGEX = /\[download\]\s+(\d+\.?\d*)%\s+of\s+[~\d.]+\s*\S+\s+at\s+(.+?)\s+ETA\s+(\S+)/i
const MERGER_REGEX = /\[Merger\]/i
const DEST_REGEX = /\[download\]\s+Destination:\s+(.+)/
const MERGE_DEST_REGEX = /\[Merger\]\s+Merging formats into "(.+)"/

export function download(
  url: string,
  outputDir: string,
  onProgress?: (p: DownloadProgress) => void,
  formatOverride?: string,
): { promise: Promise<string>; cancel: () => void } {
  const ytdlp = getYtdlpPath()
  const outputTemplate = join(outputDir, '%(title)s.%(ext)s')
  const formatStr = formatOverride ?? 'bv[height<=1080][ext=mp4]+ba[ext=m4a]/bv[height<=1080]+ba/best[height<=1080]/bestvideo+bestaudio/best'
  console.log(`[ytdlp] Download format: ${formatStr}`)

  const args = [
    '--newline',
    '--continue',
    '--merge-output-format', 'mp4',
    '-f', formatStr,
    '-o', outputTemplate,
    '--no-warnings',
    '--no-check-certificate',
    '--no-playlist',
    '--remote-components', 'ejs:github',
    ...cookieArgs(),
    url,
  ]

  const proc = spawn(ytdlp, args, { stdio: ['ignore', 'pipe', 'pipe'], env: spawnEnv() })
  let currentPhase = 'video'
  let lastDest = ''
  let stderrBuf = ''

  const parseLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return

    if (MERGER_REGEX.test(trimmed)) {
      currentPhase = 'merging'
      console.log(`[ytdlp] Merging phase detected`)
    }

    const destMatch = DEST_REGEX.exec(trimmed)
    if (destMatch) {
      lastDest = destMatch[1].trim()
      const isAudio = /\.m4a|\.mp3|\.opus|\.ogg/i.test(lastDest)
      currentPhase = isAudio ? 'audio' : 'video'
      console.log(`[ytdlp] Destination: ${lastDest} (phase: ${currentPhase})`)
    }

    const mergeMatch = MERGE_DEST_REGEX.exec(trimmed)
    if (mergeMatch) {
      lastDest = mergeMatch[1].trim()
      console.log(`[ytdlp] Merge destination: ${lastDest}`)
    }

    if (/\[download\]\s+\d/.test(trimmed) || /already been downloaded/i.test(trimmed)) {
      // progress line or skip notice — don't log every one
    } else if (trimmed.startsWith('[')) {
      console.log(`[ytdlp] ${trimmed}`)
    }

    const m = PROGRESS_REGEX.exec(trimmed)
    if (m && onProgress) {
      const speed = m[2].trim()
      const eta = m[3].trim()
      onProgress({
        percent: parseFloat(m[1]) || 0,
        speed: /unknown/i.test(speed) ? '' : speed,
        eta: /unknown/i.test(eta) ? '' : eta,
        phase: currentPhase,
      })
    }
  }

  const promise = new Promise<string>((resolve, reject) => {
    proc.stdout.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) parseLine(line)
    })
    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stderrBuf += text
      for (const line of text.split('\n')) parseLine(line)
    })

    proc.on('close', (code) => {
      console.log(`[ytdlp] Process exited with code ${code}, lastDest=${lastDest}`)
      if (code !== 0) {
        const errorLines = stderrBuf.split('\n').filter(l => /error/i.test(l)).join('; ')
        reject(new Error(errorLines || `yt-dlp download failed with code ${code}`))
        return
      }

      let result = lastDest || outputDir

      // If lastDest points to an audio-only file, try to find the merged .mp4
      if (/\.m4a$|\.mp3$|\.opus$|\.ogg$/i.test(result)) {
        console.log(`[ytdlp] lastDest is audio file, searching for .mp4 in ${outputDir}`)
        try {
          const files = readdirSync(outputDir)
            .filter(f => f.endsWith('.mp4') && !f.startsWith('.'))
          if (files.length > 0) {
            const sorted = files
              .map(f => ({ name: f, size: statSync(join(outputDir, f)).size }))
              .sort((a, b) => b.size - a.size)
            result = join(outputDir, sorted[0].name)
            console.log(`[ytdlp] Found .mp4: ${result} (${sorted[0].size} bytes)`)
          }
        } catch (err) {
          console.warn(`[ytdlp] Failed to scan for .mp4:`, err)
        }
      }

      resolve(result)
    })

    proc.on('error', reject)
  })

  return {
    promise,
    cancel: () => {
      try { proc.kill('SIGTERM') } catch { proc.kill('SIGKILL') }
    },
  }
}
