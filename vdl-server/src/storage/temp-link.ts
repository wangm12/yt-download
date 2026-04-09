import { copyFile, rm } from 'fs/promises'
import { join, resolve } from 'path'
import { mkdirSync, existsSync } from 'fs'
import { randomBytes } from 'crypto'
import { config } from '../config.js'

const SERVE_DIR = resolve(join(config.tempDir, 'serve'))

mkdirSync(SERVE_DIR, { recursive: true })

export function getServeDir(): string {
  return SERVE_DIR
}

export async function storeForServing(filePath: string, fileName: string): Promise<{ fileId: string; shareUrl: string; downloadUrl: string }> {
  const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
  const fileId = `${Date.now()}-${safeFileName}`
  const dest = join(SERVE_DIR, fileId)
  console.log(`[temp-link] Copying ${filePath} -> ${dest}`)
  await copyFile(filePath, dest)

  const shareUrl = `${config.baseUrl}/api/files/${encodeURIComponent(fileId)}`
  const token = createOneTimeToken(fileId, fileName)
  const downloadUrl = `${config.baseUrl}/api/dl/${token}`
  console.log(`[temp-link] Stored: fileId=${fileId}, shareUrl=${shareUrl}, downloadUrl=${downloadUrl}`)
  return { fileId, shareUrl, downloadUrl }
}

export async function deleteServedFile(fileId: string): Promise<void> {
  const filePath = join(SERVE_DIR, fileId)
  if (existsSync(filePath)) {
    await rm(filePath, { force: true })
  }
}

export function getFilePath(fileId: string): string | null {
  const filePath = join(SERVE_DIR, fileId)
  if (!existsSync(filePath)) return null
  if (!filePath.startsWith(SERVE_DIR)) return null
  return filePath
}

// --- One-time download tokens ---

const oneTimeTokens = new Map<string, { fileId: string; fileName: string }>()

function createOneTimeToken(fileId: string, fileName: string): string {
  const token = randomBytes(12).toString('hex')
  oneTimeTokens.set(token, { fileId, fileName })
  console.log(`[temp-link] Created one-time token ${token} for fileId=${fileId}`)
  setTimeout(() => {
    if (oneTimeTokens.delete(token)) {
      console.log(`[temp-link] One-time token ${token} expired (TTL)`)
    }
  }, config.tempLinkExpiryHours * 60 * 60 * 1000)
  return token
}

export function consumeOneTimeToken(token: string): { fileId: string; fileName: string } | null {
  const entry = oneTimeTokens.get(token)
  if (!entry) return null
  oneTimeTokens.delete(token)
  console.log(`[temp-link] One-time token ${token} consumed for fileId=${entry.fileId}`)
  return entry
}
