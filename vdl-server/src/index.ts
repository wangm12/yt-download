import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { resolve } from 'path'
import { mkdirSync, writeFileSync, renameSync } from 'fs'

import { config } from './config.js'
import { initDB } from './db.js'
import { bot, getTelegramWebhookCallback } from './bot/index.js'
import { recoverOnStartup } from './queue.js'
import { getServeDir, getFilePath, consumeOneTimeToken } from './storage/temp-link.js'
import { startCleanupJob, stopCleanupJob } from './cleanup.js'

interface CookieEntry {
  domain: string
  path: string
  secure: boolean
  httpOnly?: boolean
  expirationDate?: number
  name: string
  value: string
}

function toNetscapeLine(c: CookieEntry): string {
  const domain = c.domain.startsWith('.') ? c.domain : `.${c.domain}`
  const includeSubdomains = domain.startsWith('.') ? 'TRUE' : 'FALSE'
  const secure = c.secure ? 'TRUE' : 'FALSE'
  const expiry = c.expirationDate ? Math.floor(c.expirationDate) : 0
  return `${domain}\t${includeSubdomains}\t${c.path}\t${secure}\t${expiry}\t${c.name}\t${c.value}`
}

async function main() {
  console.log('Starting VDL Server...')

  initDB()
  console.log('Database initialized')

  recoverOnStartup()
  startCleanupJob()

  const tempDirAbs = resolve(config.tempDir)
  mkdirSync(resolve(tempDirAbs, 'dl'), { recursive: true })
  mkdirSync(resolve(tempDirAbs, 'serve'), { recursive: true })

  const app = Fastify({ logger: true })

  await app.register(fastifyStatic, {
    root: getServeDir(),
    prefix: '/api/files/',
    decorateReply: true,
  })

  app.get('/api/health', async () => ({ ok: true, uptime: process.uptime() }))

  app.get('/api/dl/:token', async (request, reply) => {
    const { token } = request.params as { token: string }
    const entry = consumeOneTimeToken(token)
    if (!entry) {
      return reply.code(410).send('This download link has expired or was already used.')
    }

    const filePath = getFilePath(entry.fileId)
    if (!filePath) {
      return reply.code(404).send('File not found.')
    }

    const { createReadStream, statSync: fsStat } = await import('fs')
    const st = fsStat(filePath)
    reply.header('Content-Type', 'video/mp4')
    reply.header('Content-Length', st.size)
    reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(entry.fileName)}"`)
    return reply.send(createReadStream(filePath))
  })

  app.post('/api/cookies', async (request, reply) => {
    const cookies = request.body as CookieEntry[]
    if (!Array.isArray(cookies)) {
      return reply.code(400).send({ error: 'Expected array of cookies' })
    }

    const header = '# Netscape HTTP Cookie File\n# Auto-synced from Chrome via V-Download extension\n\n'
    const lines = cookies.map(toNetscapeLine).join('\n')
    const content = header + lines + '\n'

    const cookiesPath = resolve(config.cookiesFilePath)
    const tmpPath = cookiesPath + '.tmp'
    writeFileSync(tmpPath, content, 'utf-8')
    renameSync(tmpPath, cookiesPath)

    console.log(`[cookies] Synced ${cookies.length} cookies to ${cookiesPath}`)
    return { ok: true, count: cookies.length }
  })

  const useWebhook = config.baseUrl.startsWith('https://')

  if (useWebhook) {
    app.post('/api/webhook/telegram', getTelegramWebhookCallback())
  }

  await app.listen({ port: config.port, host: config.host })
  console.log(`Server listening on ${config.host}:${config.port}`)

  await bot.api.setMyCommands([
    { command: 'start', description: 'Start the bot' },
    { command: 'admin', description: 'Admin panel (admins only)' },
  ])

  if (useWebhook) {
    const webhookUrl = `${config.baseUrl}/api/webhook/telegram`
    await bot.api.setWebhook(webhookUrl)
    console.log(`Telegram webhook set to ${webhookUrl}`)
  } else {
    console.log('No HTTPS base URL, starting Telegram bot in polling mode...')
    bot.start({ onStart: () => console.log('Telegram bot started (polling)') })
  }

  const shutdown = async () => {
    console.log('\nShutting down...')
    stopCleanupJob()
    await bot.stop()
    await app.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
