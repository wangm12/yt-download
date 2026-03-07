import { spawn, ChildProcess, execSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import * as settings from './settings'

const EXTRA_PATH_DIRS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
  join(process.env.HOME ?? '', '.local/bin'),
  join(process.env.HOME ?? '', '.deno/bin')
]

function spawnEnv(): Record<string, string> {
  const existing = process.env.PATH ?? ''
  const dirs = new Set(existing.split(':').concat(EXTRA_PATH_DIRS))

  const ffmpegPath = settings.get('ffmpegPath')
  if (ffmpegPath) {
    const ffmpegDir = ffmpegPath.replace(/\/[^/]+$/, '')
    dirs.add(ffmpegDir)
  }

  return { ...process.env as Record<string, string>, PATH: [...dirs].join(':') }
}

export interface VideoInfo {
  id: string
  title: string
  thumbnail: string
  duration: number
  channel: string
  view_count: number
  formats: FormatInfo[]
  playlist_title?: string
  playlist_count?: number
  entries?: VideoInfo[]
  _type?: string
  webpage_url: string
}

export interface FormatInfo {
  format_id: string
  ext: string
  height?: number
  filesize?: number
  acodec?: string
  vcodec?: string
}

export interface DownloadOptions {
  url: string
  format: string
  quality?: number
  outputDir: string
  cookiesPath?: string
  sleepInterval?: number
  isPlaylist?: boolean
  playlistTitle?: string
  onProgress?: (progress: DownloadProgress) => void
}

export interface DownloadProgress {
  percent: number
  speed: string
  eta: string
  downloaded: string
  total: string
  phase: 'video' | 'audio' | 'merging' | ''
}

export interface DownloadProcess {
  process: ChildProcess
  onProgress: (cb: (progress: DownloadProgress) => void) => void
  cancel: () => void
  getStderr: () => string
}

const YOUTUBE_REGEX = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\/.+/
const PLAYLIST_REGEX = /[?&]list=/
const CHANNEL_REGEX = /youtube\.com\/(@[\w-]+|channel\/[\w-]+|c\/[\w-]+|user\/[\w-]+)(\/|$)/

export function isValidYouTubeUrl(url: string): boolean {
  return YOUTUBE_REGEX.test(url) && url.trim().length > 0
}

export function isPlaylistUrl(url: string): boolean {
  return PLAYLIST_REGEX.test(url) || CHANNEL_REGEX.test(url)
}

export function getYtdlpPath(customPath?: string): string {
  if (customPath && existsSync(customPath)) {
    return customPath
  }
  const homebrewPath = '/opt/homebrew/bin/yt-dlp'
  if (existsSync(homebrewPath)) {
    return homebrewPath
  }
  try {
    const result = execSync('which yt-dlp', { encoding: 'utf-8' }).trim()
    return result || homebrewPath
  } catch {
    return homebrewPath
  }
}

function parseVideoInfoFromJson(json: Record<string, unknown>): VideoInfo {
  const thumbnails = json.thumbnails as Array<{ url: string }> | undefined
  const thumbnail = thumbnails?.[0]?.url ?? (json.thumbnail as string) ?? ''
  const formats = (json.formats as Array<Record<string, unknown>>) ?? []
  const formatInfos: FormatInfo[] = formats
    .filter((f) => f.format_id && f.ext)
    .map((f) => ({
      format_id: String(f.format_id),
      ext: String(f.ext),
      height: typeof f.height === 'number' ? f.height : undefined,
      filesize: typeof f.filesize === 'number' ? f.filesize : undefined,
      acodec: f.acodec as string | undefined,
      vcodec: f.vcodec as string | undefined
    }))

  return {
    id: String(json.id ?? ''),
    title: String(json.title ?? 'Unknown'),
    thumbnail,
    duration: typeof json.duration === 'number' ? json.duration : 0,
    channel: String(json.channel ?? json.uploader ?? ''),
    view_count: typeof json.view_count === 'number' ? json.view_count : 0,
    formats: formatInfos,
    playlist_title: json.playlist_title as string | undefined,
    playlist_count: typeof json.playlist_count === 'number' ? json.playlist_count : undefined,
    webpage_url: String(json.webpage_url ?? json.url ?? ''),
    _type: json._type as string | undefined
  }
}

export async function getVideoInfo(
  url: string,
  cookiesPath?: string,
  ytdlpPath?: string
): Promise<VideoInfo | { entries: VideoInfo[]; playlist_title?: string; playlist_channel?: string; playlist_count?: number }> {
  const path = getYtdlpPath(ytdlpPath)
  const isPlaylist = isPlaylistUrl(url)

  const args: string[] = [
    '--dump-json',
    '--no-download',
    '--no-warnings',
    '--no-check-certificate'
  ]

  if (cookiesPath && existsSync(cookiesPath)) {
    args.push('--cookies', cookiesPath)
  }

  if (isPlaylist) {
    args.push('--flat-playlist')
  }

  args.push(url)

  return new Promise((resolve, reject) => {
    const proc = spawn(path, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: spawnEnv()
    })

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    proc.on('close', (code) => {
      if (code !== 0 && code !== null) {
        reject(new Error(`yt-dlp exited with code ${code}: ${stderr || stdout}`))
        return
      }

      try {
        if (isPlaylist) {
          const lines = stdout.trim().split('\n').filter(Boolean)
          const entries: VideoInfo[] = []
          let playlistTitle: string | undefined
          let playlistChannel: string | undefined
          let playlistCount = 0

          for (const line of lines) {
            const json = JSON.parse(line) as Record<string, unknown>
            if (json._type === 'playlist') {
              playlistTitle = json.title as string
              playlistCount = (json.n_entries as number) ?? 0
            } else if (json._type === 'video' || json._type === 'url' || json.id) {
              if (!playlistTitle && json.playlist_title) {
                playlistTitle = json.playlist_title as string
              }
              if (!playlistChannel && (json.playlist_channel || json.playlist_uploader)) {
                playlistChannel = (json.playlist_channel ?? json.playlist_uploader) as string
              }
              if (!playlistCount && json.playlist_count) {
                playlistCount = json.playlist_count as number
              }
              entries.push(parseVideoInfoFromJson(json))
            }
          }

          resolve({
            entries,
            playlist_title: playlistTitle,
            playlist_channel: playlistChannel,
            playlist_count: playlistCount || entries.length
          })
        } else {
          const lines = stdout.trim().split('\n').filter(Boolean)
          if (lines.length > 1) {
            const entries: VideoInfo[] = []
            for (const line of lines) {
              const json = JSON.parse(line) as Record<string, unknown>
              if (json._type === 'video' || json.id) {
                entries.push(parseVideoInfoFromJson(json))
              }
            }
            resolve({ entries, playlist_count: entries.length })
          } else {
            const json = JSON.parse(lines[0]) as Record<string, unknown>
            resolve(parseVideoInfoFromJson(json))
          }
        }
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })

    proc.on('error', (err) => {
      reject(err)
    })
  })
}

const PROGRESS_REGEX = /\[download\]\s+(\d+\.?\d*)%\s+of\s+([~\d.]+\s*\S+)\s+at\s+(\S+)\s+ETA\s+(\S+)/i
const DEST_REGEX = /\[download\]\s+Destination:\s+(.+)/
const MERGER_REGEX = /\[Merger\]/i

function parseProgressLine(line: string, currentPhase: string): { progress: DownloadProgress | null; phase?: string } {
  if (MERGER_REGEX.test(line)) {
    return { progress: null, phase: 'merging' }
  }

  const destMatch = line.match(DEST_REGEX)
  if (destMatch) {
    const dest = destMatch[1]
    const isAudio = /\.m4a|\.mp3|\.opus|\.ogg|\.webm.*audio/i.test(dest) || /\.f\d+\.m4a/.test(dest)
    return { progress: null, phase: isAudio ? 'audio' : 'video' }
  }

  const match = line.match(PROGRESS_REGEX)
  if (!match) return { progress: null }

  const percent = parseFloat(match[1]) || 0
  const total = match[2]?.trim() ?? ''
  const rawSpeed = match[3]?.trim() ?? ''
  const rawEta = match[4]?.trim() ?? ''

  const speed = rawSpeed === 'Unknown' || rawSpeed === 'UnknownB/s' ? '' : rawSpeed
  const eta = rawEta === 'Unknown' ? '' : rawEta

  return {
    progress: {
      percent,
      speed,
      eta,
      downloaded: '',
      total,
      phase: (currentPhase as DownloadProgress['phase']) || ''
    }
  }
}

export function download(
  options: DownloadOptions,
  ytdlpPath?: string
): DownloadProcess {
  const path = getYtdlpPath(ytdlpPath)
  const {
    url,
    format,
    quality = 1080,
    outputDir,
    cookiesPath,
    sleepInterval = 3,
    isPlaylist = false,
    playlistTitle,
    onProgress: progressCb
  } = options

  let onProgress: (progress: DownloadProgress) => void = progressCb ?? (() => {})

  const outputTemplate = isPlaylist && playlistTitle
    ? join(outputDir, `${playlistTitle}/%(title)s.%(ext)s`)
    : join(outputDir, '%(title)s.%(ext)s')

  let formatStr: string
  if (format === 'audio' || format === 'mp3') {
    formatStr = 'bestaudio/best'
  } else {
    formatStr = `bv[height<=${quality}][ext=mp4]+ba[ext=m4a]/bv[height<=${quality}]+ba/best[height<=${quality}]/bestvideo+bestaudio/best`
  }

  const args: string[] = [
    '--newline',
    '--continue',
    '--merge-output-format', 'mp4',
    '-f', formatStr,
    '-o', outputTemplate,
    '--no-warnings',
    '--no-check-certificate'
  ]

  if (cookiesPath && existsSync(cookiesPath)) {
    args.push('--cookies', cookiesPath)
  }

  if (sleepInterval > 0) {
    args.push('--sleep-interval', String(sleepInterval))
  }

  if (format === 'audio' || format === 'mp3') {
    args.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0')
  }

  args.push(url)

  const proc = spawn(path, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: spawnEnv()
  })

  let currentPhase = ''
  let stderrBuf = ''

  const parseLine = (line: string) => {
    const result = parseProgressLine(line, currentPhase)
    if (result.phase) {
      currentPhase = result.phase
    }
    if (result.progress) {
      onProgress(result.progress)
    }
  }

  proc.stdout?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n')) {
      parseLine(line)
    }
  })

  proc.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    stderrBuf += text
    for (const line of text.split('\n')) {
      parseLine(line)
    }
  })

  const downloadProcess: DownloadProcess = {
    process: proc,
    onProgress: (cb: (progress: DownloadProgress) => void) => {
      onProgress = cb
    },
    cancel: () => {
      try {
        proc.kill('SIGTERM')
      } catch {
        proc.kill('SIGKILL')
      }
    },
    getStderr: () => stderrBuf
  }

  return downloadProcess
}
