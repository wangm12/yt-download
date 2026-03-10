import { createServer, IncomingMessage, ServerResponse } from 'http'
import { app } from 'electron'
import { join } from 'path'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import * as settings from './settings'

const PORT = 18765
let server: ReturnType<typeof createServer> | null = null

interface Cookie {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  expirationDate?: number
}

export interface DownloadRequest {
  url: string
  type?: string
  referer?: string
  headers?: Record<string, string>
  title?: string
}

type DownloadHandler = (request: DownloadRequest) => void
type MediaDownloadHandler = (request: DownloadRequest) => void
let onDownloadRequest: DownloadHandler | null = null
let onMediaDownloadRequest: MediaDownloadHandler | null = null

export function setDownloadHandler(handler: DownloadHandler): void {
  onDownloadRequest = handler
}

export function setMediaDownloadHandler(handler: MediaDownloadHandler): void {
  onMediaDownloadRequest = handler
}

function toNetscapeLine(c: Cookie): string {
  const domain = c.domain.startsWith('.') ? c.domain : `.${c.domain}`
  const includeSubdomains = domain.startsWith('.') ? 'TRUE' : 'FALSE'
  const secure = c.secure ? 'TRUE' : 'FALSE'
  const expiry = c.expirationDate ? Math.floor(c.expirationDate) : 0
  return `${domain}\t${includeSubdomains}\t${c.path}\t${secure}\t${expiry}\t${c.name}\t${c.value}`
}

function saveCookiesFile(cookies: Cookie[]): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const cookiesPath = join(dir, 'cookies.txt')

  const header = '# Netscape HTTP Cookie File\n# This file is auto-synced from Chrome via YT Download extension\n\n'
  const lines = cookies.map(toNetscapeLine).join('\n')
  writeFileSync(cookiesPath, header + lines + '\n', 'utf-8')

  settings.set('cookiesPath', cookiesPath)
  return cookiesPath
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function cors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function json(res: ServerResponse, status: number, data: Record<string, unknown>): void {
  cors(res)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

export function startLocalServer(): void {
  if (server) return

  server = createServer(async (req, res) => {
    cors(res)

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    if (req.method === 'POST' && req.url === '/cookies') {
      try {
        const body = await readBody(req)
        const cookies = JSON.parse(body) as Cookie[]
        if (!Array.isArray(cookies)) {
          json(res, 400, { error: 'Expected array of cookies' })
          return
        }
        const path = saveCookiesFile(cookies)
        console.log(`Cookies synced: ${cookies.length} cookies saved to ${path}`)
        json(res, 200, { ok: true, count: cookies.length, path })
      } catch (err) {
        json(res, 500, { error: String(err) })
      }
      return
    }

    if (req.method === 'POST' && req.url === '/download') {
      try {
        const body = await readBody(req)
        const parsed = JSON.parse(body) as DownloadRequest
        if (!parsed.url) {
          json(res, 400, { error: 'Missing url' })
          return
        }
        if (parsed.type && onMediaDownloadRequest) {
          onMediaDownloadRequest(parsed)
        } else if (onDownloadRequest) {
          onDownloadRequest(parsed)
        }
        json(res, 200, { ok: true, url: parsed.url })
      } catch (err) {
        json(res, 500, { error: String(err) })
      }
      return
    }

    if (req.method === 'GET' && req.url === '/ping') {
      json(res, 200, { ok: true, app: 'yt-download' })
      return
    }

    json(res, 404, { error: 'Not found' })
  })

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Local server listening on http://127.0.0.1:${PORT}`)
  })

  server.on('error', (err) => {
    console.error('Local server error:', err)
  })
}

export function stopLocalServer(): void {
  if (server) {
    server.close()
    server = null
  }
}
