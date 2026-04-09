import { readdirSync, statSync, unlinkSync, rmdirSync } from 'fs'
import { join, resolve } from 'path'
import { config } from './config.js'

const SERVE_DIR = resolve(join(config.tempDir, 'serve'))
const DL_DIR = resolve(join(config.tempDir, 'dl'))
const CHECK_INTERVAL_MS = 10 * 60 * 1000 // every 10 minutes

function cleanServeDir() {
  const maxAgeMs = config.tempLinkExpiryHours * 60 * 60 * 1000
  const now = Date.now()
  let deleted = 0

  try {
    for (const name of readdirSync(SERVE_DIR)) {
      const filePath = join(SERVE_DIR, name)
      try {
        const st = statSync(filePath)
        if (now - st.mtimeMs > maxAgeMs) {
          unlinkSync(filePath)
          deleted++
        }
      } catch {}
    }
  } catch {}

  if (deleted > 0) {
    console.log(`[cleanup] Deleted ${deleted} expired file(s) from serve/`)
  }
}

function cleanDlDir() {
  const maxAgeMs = config.tempLinkExpiryHours * 60 * 60 * 1000
  const now = Date.now()
  let deleted = 0

  try {
    for (const name of readdirSync(DL_DIR)) {
      const dirPath = join(DL_DIR, name)
      try {
        const st = statSync(dirPath)
        if (!st.isDirectory()) continue
        if (now - st.mtimeMs > maxAgeMs) {
          const files = readdirSync(dirPath)
          for (const f of files) {
            try { unlinkSync(join(dirPath, f)) } catch {}
          }
          rmdirSync(dirPath)
          deleted++
        }
      } catch {}
    }
  } catch {}

  if (deleted > 0) {
    console.log(`[cleanup] Deleted ${deleted} expired task dir(s) from dl/`)
  }
}

function runCleanup() {
  cleanServeDir()
  cleanDlDir()
}

let timer: ReturnType<typeof setInterval> | null = null

export function startCleanupJob() {
  runCleanup()
  timer = setInterval(runCleanup, CHECK_INTERVAL_MS)
  console.log(`[cleanup] Started — checking every ${CHECK_INTERVAL_MS / 60000} min, expiry = ${config.tempLinkExpiryHours}h`)
}

export function stopCleanupJob() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
