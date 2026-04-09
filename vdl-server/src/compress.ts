import { spawn, execSync } from 'child_process'
import { stat } from 'fs/promises'
import { join, dirname, basename } from 'path'

const TELEGRAM_LIMIT_MB = 48
const AUDIO_BITRATE_KBPS = 128
const MIN_VIDEO_BITRATE_KBPS = 500

function findBinary(name: string): string {
  const candidates = [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, `/usr/bin/${name}`]
  for (const p of candidates) {
    try { execSync(`test -f ${p}`, { stdio: 'ignore' }); return p } catch {}
  }
  try { return execSync(`which ${name}`, { encoding: 'utf-8' }).trim() } catch {}
  return name
}

function getDuration(inputPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const ffprobe = findBinary('ffprobe')
    const proc = spawn(ffprobe, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      inputPath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] })

    let out = ''
    proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
    proc.on('close', (code) => {
      const dur = parseFloat(out.trim())
      if (code !== 0 || isNaN(dur)) return reject(new Error(`ffprobe failed (code ${code})`))
      resolve(dur)
    })
    proc.on('error', reject)
  })
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = findBinary('ffmpeg')
    console.log(`[compress] Running: ffmpeg ${args.join(' ')}`)
    const proc = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg failed (code ${code}): ${stderr.slice(-500)}`))
      resolve()
    })
    proc.on('error', reject)
  })
}

export async function needsCompression(filePath: string): Promise<boolean> {
  const s = await stat(filePath)
  return s.size > TELEGRAM_LIMIT_MB * 1024 * 1024
}

/**
 * Check if compression would produce acceptable quality.
 * Returns false if the video is too long for the target size (bitrate would be too low).
 */
export async function canCompressWithDecentQuality(filePath: string, targetMB: number = TELEGRAM_LIMIT_MB): Promise<boolean> {
  try {
    const duration = await getDuration(filePath)
    const targetBits = targetMB * 8 * 1024
    const videoBitrateKbps = Math.floor(targetBits / duration - AUDIO_BITRATE_KBPS)
    console.log(`[compress] Quality check: duration=${duration.toFixed(0)}s, target bitrate=${videoBitrateKbps}kbps, min=${MIN_VIDEO_BITRATE_KBPS}kbps`)
    return videoBitrateKbps >= MIN_VIDEO_BITRATE_KBPS
  } catch {
    return false
  }
}

/**
 * Two-pass encode to fit within targetMB. Returns path to compressed file.
 * Uses ultrafast preset for speed.
 */
export async function compressToSize(
  inputPath: string,
  targetMB: number = TELEGRAM_LIMIT_MB,
  onProgress?: (phase: string) => void,
): Promise<string> {
  const duration = await getDuration(inputPath)
  const targetBits = targetMB * 8 * 1024
  const videoBitrateKbps = Math.max(100, Math.floor(targetBits / duration - AUDIO_BITRATE_KBPS))

  const outputPath = join(dirname(inputPath), `compressed_${basename(inputPath)}`)
  const passLogPrefix = join(dirname(inputPath), 'ffmpeg2pass')

  console.log(`[compress] Starting: duration=${duration.toFixed(0)}s, target=${targetMB}MB, video_bitrate=${videoBitrateKbps}kbps`)

  onProgress?.('compressing (pass 1/2)')
  await runFfmpeg([
    '-y', '-i', inputPath,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', `${videoBitrateKbps}k`,
    '-pass', '1', '-passlogfile', passLogPrefix,
    '-an', '-f', 'null', '/dev/null',
  ])

  onProgress?.('compressing (pass 2/2)')
  await runFfmpeg([
    '-y', '-i', inputPath,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', `${videoBitrateKbps}k`,
    '-pass', '2', '-passlogfile', passLogPrefix,
    '-c:a', 'aac', '-b:a', `${AUDIO_BITRATE_KBPS}k`,
    outputPath,
  ])

  const outputStat = await stat(outputPath)
  console.log(`[compress] Done: ${basename(inputPath)} -> ${(outputStat.size / 1024 / 1024).toFixed(1)}MB at ${videoBitrateKbps}kbps`)

  return outputPath
}
