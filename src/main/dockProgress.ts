import { app, nativeImage, NativeImage } from 'electron'
import { join } from 'path'
import { writeFileSync } from 'fs'
import { execFile } from 'child_process'
import { tmpdir } from 'os'

let idleIcon: NativeImage | null = null
let pendingTimeout: ReturnType<typeof setTimeout> | null = null
let lastUpdateTime = 0
let latestPercent = 0
let latestSpeedBytes = 0
let isActive = false

const THROTTLE_MS = 2000
const TMP_SVG = join(tmpdir(), 'vdl-dock-progress.svg')
const TMP_PNG = join(tmpdir(), 'vdl-dock-progress.png')

const ARROW_PATH =
  'M448,200 L576,200 Q596,200 596,220 L596,500 L700,500 Q730,500 710,530 L532,740 Q512,764 492,740 L314,530 Q294,500 324,500 L428,500 L428,220 Q428,200 448,200 Z'

function resourcePath(relative: string): string {
  return join(__dirname, '../../resources', relative)
}

export function init(): void {
  if (process.platform !== 'darwin') return

  const idlePath = resourcePath('icon.png')
  idleIcon = nativeImage.createFromPath(idlePath)
  if (idleIcon && !idleIcon.isEmpty()) {
    app.dock.setIcon(idleIcon)
  }
  app.dock.setBadge('')
}

function generateSvg(percent: number, speedText: string): string {
  const clamped = Math.max(0, Math.min(100, percent))
  const hasSpeed = !!speedText

  // Arrow spans y=200..764
  // When speed text present: speed pill replaces base line at y=785..915
  // When no speed text: base line at y=800..876
  const fillTop = 200
  const fillBottom = hasSpeed ? 915 : 876
  const fillRange = fillBottom - fillTop
  const fillHeight = Math.round(fillRange * (clamped / 100))

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#27272A"/>
      <stop offset="100%" style="stop-color:#18181B"/>
    </linearGradient>
    <clipPath id="fill">
      <rect x="0" y="${fillTop}" width="1024" height="${fillHeight}"/>
    </clipPath>
  </defs>
  <rect x="0" y="0" width="1024" height="1024" rx="220" ry="220" fill="url(#bg)"/>
  <path d="${ARROW_PATH}" fill="white" opacity="0.15"/>`

  if (hasSpeed) {
    svg += `
  <rect x="112" y="785" width="800" height="130" rx="65" fill="black" opacity="0.45"/>
  <g clip-path="url(#fill)">
    <path d="${ARROW_PATH}" fill="white" opacity="0.95"/>
    <rect x="112" y="785" width="800" height="130" rx="65" fill="white" opacity="0.95"/>
  </g>
  <text x="512" y="855" text-anchor="middle" dominant-baseline="central"
        font-family="-apple-system, Helvetica Neue, sans-serif"
        font-size="100" font-weight="bold" fill="white">${speedText}</text>`
  } else {
    svg += `
  <rect x="280" y="800" width="464" height="76" rx="38" fill="white" opacity="0.15"/>
  <g clip-path="url(#fill)">
    <path d="${ARROW_PATH}" fill="white" opacity="0.95"/>
    <rect x="280" y="800" width="464" height="76" rx="38" fill="white" opacity="0.95"/>
  </g>`
  }

  svg += '\n</svg>'
  return svg
}

function doUpdate(): void {
  if (process.platform !== 'darwin') return

  lastUpdateTime = Date.now()
  const speedText = formatBadgeSpeed(latestSpeedBytes)
  const svg = generateSvg(latestPercent, speedText)

  try {
    writeFileSync(TMP_SVG, svg)
  } catch {
    return
  }

  execFile('rsvg-convert', ['-w', '512', '-h', '512', TMP_SVG, '-o', TMP_PNG], (err) => {
    if (err) return
    try {
      const img = nativeImage.createFromPath(TMP_PNG)
      if (!img.isEmpty()) {
        app.dock.setIcon(img)
      }
    } catch {
      /* ignore */
    }
  })
}

export function updateProgress(percent: number, speedBytes: number, activeCount?: number): void {
  if (process.platform !== 'darwin') return

  latestPercent = percent
  latestSpeedBytes = speedBytes
  isActive = true

  if (activeCount != null && activeCount > 0) {
    app.dock.setBadge(activeCount > 99 ? '99+' : String(activeCount))
  } else {
    app.dock.setBadge('')
  }

  const now = Date.now()
  const elapsed = now - lastUpdateTime

  if (elapsed >= THROTTLE_MS) {
    if (pendingTimeout) {
      clearTimeout(pendingTimeout)
      pendingTimeout = null
    }
    doUpdate()
  } else if (!pendingTimeout) {
    pendingTimeout = setTimeout(() => {
      pendingTimeout = null
      doUpdate()
    }, THROTTLE_MS - elapsed)
  }
}

export function reset(): void {
  if (process.platform !== 'darwin') return

  if (pendingTimeout) {
    clearTimeout(pendingTimeout)
    pendingTimeout = null
  }

  latestPercent = 0
  latestSpeedBytes = 0
  isActive = false

  if (idleIcon && !idleIcon.isEmpty()) {
    app.dock.setIcon(idleIcon)
  }
  app.dock.setBadge('')
}

export function formatBadgeSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return ''

  const KiB = 1024
  const MiB = 1024 * KiB
  const GiB = 1024 * MiB

  if (bytesPerSec >= GiB) return `${(bytesPerSec / GiB).toFixed(2)}GiB/s`
  if (bytesPerSec >= MiB) return `${(bytesPerSec / MiB).toFixed(2)}MiB/s`
  if (bytesPerSec >= KiB) return `${(bytesPerSec / KiB).toFixed(1)}KiB/s`
  return `${Math.round(bytesPerSec)}B/s`
}
