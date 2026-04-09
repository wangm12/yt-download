import { Bot, InlineKeyboard, InputFile, webhookCallback } from 'grammy'
import { statSync, readdirSync } from 'fs'
import { rm } from 'fs/promises'
import { resolve, dirname, basename } from 'path'
import { config } from '../config.js'
import * as db from '../db.js'
import * as queue from '../queue.js'
import { storeForServing } from '../storage/temp-link.js'
import { getVideoInfo, type CompactOption } from '../ytdlp.js'
import { getDouyinInfo } from '../douyin.js'

export const bot = new Bot(config.telegramBotToken)

bot.catch((err) => {
  console.error('Bot error:', err.message || err)
})

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

const SUPPORTED_PLATFORMS = [
  /youtube\.com|youtu\.be/i,
  /tiktok\.com/i,
  /douyin\.com/i,
  /xiaohongshu\.com|xhslink\.com/i,
  /twitter\.com|x\.com/i,
  /bilibili\.com|b23\.tv/i,
  /instagram\.com/i,
  /facebook\.com|fb\.watch/i,
  /vimeo\.com/i,
  /reddit\.com/i,
  /twitch\.tv/i,
]

function extractUrl(text: string): string | null {
  const urlMatch = text.match(/https?:\/\/[^\s]+/i)
  if (!urlMatch) return null
  return urlMatch[0].replace(/[，。！？；：、）》」』\]\)>]+$/, '').trim()
}

function isSupportedUrl(url: string): boolean {
  return SUPPORTED_PLATFORMS.some((re) => re.test(url)) || /^https?:\/\/.+/i.test(url)
}

function isAdmin(telegramId: number): boolean {
  return config.adminTelegramIds.includes(telegramId)
}

const TELEGRAM_FILE_LIMIT = 50 * 1024 * 1024

// --- /start ---
bot.command('start', async (ctx) => {
  const telegramId = ctx.from?.id
  if (!telegramId) return

  let user = db.findUserByTelegramId(telegramId)
  if (!user) {
    user = db.createUser(telegramId, ctx.from?.username)
  }

  await ctx.reply(
    'Welcome! Send me a video link and I\'ll download it for you.\n\n' +
    'Supported: YouTube, TikTok, Instagram, Twitter/X, Bilibili, Xiaohongshu, and more.'
  )
})

// --- /admin ---
bot.command('admin', async (ctx) => {
  if (!isAdmin(ctx.from!.id)) {
    await ctx.reply('Unauthorized')
    return
  }

  const args = ctx.match?.trim().split(/\s+/) ?? []
  const subcommand = args[0]

  if (subcommand === 'stats') {
    await showStats(ctx)
    return
  }

  if (subcommand === 'clear-local') {
    const keyboard = new InlineKeyboard()
      .text('Yes, delete all local files', 'confirm_clear_local')
      .row()
      .text('Cancel', 'confirm_cancel')
    await ctx.reply('This will delete ALL local temp files. Are you sure?', { reply_markup: keyboard })
    return
  }

  if (subcommand === 'cancel-all') {
    const keyboard = new InlineKeyboard()
      .text('Yes, cancel all tasks', 'confirm_cancel_all')
      .row()
      .text('Cancel', 'confirm_cancel')
    const active = db.getDB().prepare("SELECT COUNT(*) as c FROM tasks WHERE status IN ('queued','downloading','compressing')").get() as { c: number }
    await ctx.reply(`This will cancel ${active.c} active task(s). Are you sure?`, { reply_markup: keyboard })
    return
  }

  if (subcommand === 'users') {
    const users = db.getDB().prepare('SELECT * FROM users ORDER BY created_at DESC').all() as db.UserRow[]
    if (users.length === 0) {
      await ctx.reply('No users registered.')
      return
    }
    const lines = users.map((u, i) =>
      `${i + 1}. ${u.username ? `@${u.username}` : u.telegram_id}`
    )
    await ctx.reply(`Users (${users.length}):\n\n${lines.join('\n')}`)
    return
  }

  if (subcommand === 'errors') {
    const errors = db.getDB().prepare("SELECT * FROM tasks WHERE status = 'error' ORDER BY updated_at DESC LIMIT 10").all() as db.TaskRow[]
    if (errors.length === 0) {
      await ctx.reply('No recent errors.')
      return
    }
    const lines = errors.map(t =>
      `- ${t.title || t.url.slice(0, 40)}\n  ${t.error?.slice(0, 100) ?? 'Unknown'}`
    )
    await ctx.reply(`Recent errors:\n\n${lines.join('\n\n')}`)
    return
  }

  const keyboard = new InlineKeyboard()
    .text('Stats', 'admin_stats')
    .text('Users', 'admin_users')
    .row()
    .text('Errors', 'admin_errors')
    .text('Cancel All', 'admin_cancel_all')
    .row()
    .text('Clear Local', 'admin_clear_local')

  await ctx.reply('Admin panel:', { reply_markup: keyboard })
})

async function showStats(ctx: any) {
  const userCount = db.getDB().prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }
  const taskCount = db.getDB().prepare('SELECT COUNT(*) as c FROM tasks').get() as { c: number }
  const activeCount = db.getDB().prepare("SELECT COUNT(*) as c FROM tasks WHERE status IN ('queued','downloading','compressing')").get() as { c: number }

  let localInfo = '—'
  try {
    const serveDir = resolve(config.tempDir, 'serve')
    const dlDir = resolve(config.tempDir, 'dl')
    let localFiles = 0, localBytes = 0
    for (const dir of [serveDir, dlDir]) {
      try {
        for (const f of readdirSync(dir)) {
          localFiles++
          try { localBytes += statSync(`${dir}/${f}`).size } catch {}
        }
      } catch {}
    }
    localInfo = `${localFiles} files, ${formatBytes(localBytes)}`
  } catch {}

  return `Stats:\n` +
    `- Users: ${userCount.c}\n` +
    `- Total tasks: ${taskCount.c}\n` +
    `- Active: ${activeCount.c}\n\n` +
    `Local storage:\n- ${localInfo}`
}

// --- Admin panel button handlers ---
bot.callbackQuery('admin_stats', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery('Unauthorized')
  await ctx.answerCallbackQuery()
  const text = await showStats(ctx)
  await ctx.editMessageText(text, { reply_markup: new InlineKeyboard().text('Back', 'admin_menu') })
})

bot.callbackQuery('admin_users', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery('Unauthorized')
  await ctx.answerCallbackQuery()
  const users = db.getDB().prepare('SELECT * FROM users ORDER BY created_at DESC').all() as db.UserRow[]
  const text = users.length === 0
    ? 'No users.'
    : `Users (${users.length}):\n\n` + users.map((u, i) =>
        `${i + 1}. ${u.username ? `@${u.username}` : u.telegram_id}`
      ).join('\n')
  await ctx.editMessageText(text, { reply_markup: new InlineKeyboard().text('Back', 'admin_menu') })
})

bot.callbackQuery('admin_errors', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery('Unauthorized')
  await ctx.answerCallbackQuery()
  const errors = db.getDB().prepare("SELECT * FROM tasks WHERE status = 'error' ORDER BY updated_at DESC LIMIT 10").all() as db.TaskRow[]
  const text = errors.length === 0
    ? 'No recent errors.'
    : `Recent errors:\n\n` + errors.map(t =>
        `- ${t.title || t.url.slice(0, 40)}\n  ${t.error?.slice(0, 100) ?? 'Unknown'}`
      ).join('\n\n')
  await ctx.editMessageText(text, { reply_markup: new InlineKeyboard().text('Back', 'admin_menu') })
})

bot.callbackQuery('admin_cancel_all', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery('Unauthorized')
  await ctx.answerCallbackQuery()
  const active = db.getDB().prepare("SELECT COUNT(*) as c FROM tasks WHERE status IN ('queued','downloading','compressing')").get() as { c: number }
  await ctx.editMessageText(
    `Cancel ${active.c} active task(s)?`,
    { reply_markup: new InlineKeyboard().text('Yes, cancel all', 'confirm_cancel_all').row().text('Cancel', 'admin_menu') }
  )
})

bot.callbackQuery('admin_clear_local', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery('Unauthorized')
  await ctx.answerCallbackQuery()
  await ctx.editMessageText(
    'Delete ALL local temp files?',
    { reply_markup: new InlineKeyboard().text('Yes, delete all', 'confirm_clear_local').row().text('Cancel', 'admin_menu') }
  )
})

bot.callbackQuery('admin_menu', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery('Unauthorized')
  await ctx.answerCallbackQuery()
  const keyboard = new InlineKeyboard()
    .text('Stats', 'admin_stats')
    .text('Users', 'admin_users')
    .row()
    .text('Errors', 'admin_errors')
    .text('Cancel All', 'admin_cancel_all')
    .row()
    .text('Clear Local', 'admin_clear_local')
  await ctx.editMessageText('Admin panel:', { reply_markup: keyboard })
})

// --- Admin confirmation callbacks ---
bot.callbackQuery('confirm_clear_local', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery('Unauthorized')
  await ctx.answerCallbackQuery('Clearing...')
  await ctx.editMessageText('Deleting all local files...')

  try {
    const { readdir, stat: fsStat } = await import('fs/promises')
    const serveDir = resolve(config.tempDir, 'serve')
    const dlDir = resolve(config.tempDir, 'dl')
    let deleted = 0
    let freedBytes = 0

    for (const dir of [serveDir, dlDir]) {
      try {
        const entries = await readdir(dir)
        for (const f of entries) {
          const fullPath = `${dir}/${f}`
          try {
            const st = await fsStat(fullPath)
            freedBytes += st.isDirectory() ? 0 : st.size
          } catch {}
          await rm(fullPath, { recursive: true, force: true })
          deleted++
        }
      } catch {}
    }

    console.log(`[admin] Cleared ${deleted} item(s), freed ${formatBytes(freedBytes)}`)
    await ctx.editMessageText(`Deleted ${deleted} item(s), freed ${formatBytes(freedBytes)}.`)
  } catch (err) {
    await ctx.editMessageText(`Error: ${err instanceof Error ? err.message : String(err)}`)
  }
})

bot.callbackQuery('confirm_cancel_all', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery('Unauthorized')
  await ctx.answerCallbackQuery('Cancelling...')

  const active = db.getDB().prepare("SELECT id FROM tasks WHERE status IN ('queued','downloading','compressing')").all() as Array<{ id: string }>
  for (const task of active) {
    queue.cancelTask(task.id)
  }
  await ctx.editMessageText(`Cancelled ${active.length} task(s).`)
})

bot.callbackQuery('confirm_cancel', async (ctx) => {
  await ctx.answerCallbackQuery('Cancelled')
  await ctx.editMessageText('Operation cancelled.')
})

// --- Main message handler: URLs ---
bot.on('message:text', async (ctx) => {
  const telegramId = ctx.from.id
  let user = db.findUserByTelegramId(telegramId)

  if (!user) {
    user = db.createUser(telegramId, ctx.from?.username)
  }

  const text = ctx.message.text.trim()

  if (text.startsWith('/')) return

  const url = extractUrl(text)
  if (!url) {
    await ctx.reply('Send me a video URL to download.')
    return
  }

  if (!isSupportedUrl(url)) {
    await ctx.reply('This URL doesn\'t look like a supported video platform.')
    return
  }

  console.log(`[bot] User ${telegramId} sent URL: ${url}`)
  const statusMsg = await ctx.reply('Checking video info...')

  try {
    const info = await getVideoInfo(url)
    const sizeMB = info.filesize_approx / (1024 * 1024)
    console.log(`[bot] Video info: title="${info.title}", size≈${sizeMB.toFixed(1)}MB, duration=${info.duration}s`)

    if (info.filesize_approx === 0) {
      console.log(`[bot] filesize_approx is 0, cannot determine size — downloading full quality`)
    }

    if (info.filesize_approx > 0 && info.filesize_approx > TELEGRAM_FILE_LIMIT) {
      const sizeStr = formatBytes(info.filesize_approx)
      const durationStr = info.duration > 0
        ? `${Math.floor(info.duration / 60)}:${String(Math.floor(info.duration % 60)).padStart(2, '0')}`
        : ''

      const choiceId = storePendingUrl(url, user.id, info.compactOption)
      const keyboard = new InlineKeyboard()
        .text('📥 Full quality (download link)', `q:full:${choiceId}`)

      if (info.compactOption) {
        const cLabel = `📱 ${info.compactOption.height}p (~${Math.round(info.compactOption.estimatedSizeMB)} MB, send in chat)`
        keyboard.row().text(cLabel, `q:compact:${choiceId}`)
      }

      let msgText = `*${esc(info.title)}*\n\n` +
        `📊 Estimated size: *${esc(sizeStr)}*` +
        (durationStr ? ` \\| Duration: *${esc(durationStr)}*` : '') + `\n\n` +
        `This video is too large to send directly in Telegram \\(50 MB limit\\)\\.\n\n`

      if (info.compactOption) {
        msgText += `Choose an option:`
      } else {
        msgText += `No lower resolution fits under 50 MB for this video\\.`
      }

      await bot.api.editMessageText(ctx.chat.id, statusMsg.message_id, msgText, {
        parse_mode: 'MarkdownV2',
        reply_markup: keyboard,
      })
      return
    }

    const taskId = queue.submitTask(user.id, url, 'full')
    taskMessageMap.set(taskId, { chatId: ctx.chat.id, messageId: statusMsg.message_id })
    console.log(`[bot] Task ${taskId} created (auto-full, ≈${sizeMB.toFixed(1)}MB), message ${statusMsg.message_id}`)
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.warn(`[bot] Failed to get video info:`, errMsg)

    if (/douyin/i.test(url)) {
      console.log(`[bot] Douyin URL detected, trying direct fallback for info...`)
      try {
        const douyinInfo = await getDouyinInfo(url)
        if (douyinInfo) {
          console.log(`[bot] Douyin info: title="${douyinInfo.title}", author="${douyinInfo.author}"`)
          await bot.api.editMessageText(ctx.chat.id, statusMsg.message_id, `Found: *${esc(douyinInfo.title)}*\nDownloading\\.\\.\\.`, { parse_mode: 'MarkdownV2' }).catch(() => {})
        }
      } catch (e) {
        console.warn(`[bot] Douyin info fallback also failed:`, e instanceof Error ? e.message : e)
      }
    }

    const taskId = queue.submitTask(user.id, url, 'full')
    taskMessageMap.set(taskId, { chatId: ctx.chat.id, messageId: statusMsg.message_id })
    console.log(`[bot] Task ${taskId} created (info-failed fallback), message ${statusMsg.message_id}`)
  }
})

// --- Pending quality choices (URL too long for callback data) ---
const pendingChoices = new Map<string, { url: string; userId: number; compactOption: CompactOption | null }>()
let choiceCounter = 0

function storePendingUrl(url: string, userId: number, compactOption: CompactOption | null): string {
  const id = String(++choiceCounter)
  pendingChoices.set(id, { url, userId, compactOption })
  setTimeout(() => pendingChoices.delete(id), 10 * 60 * 1000)
  return id
}

// --- Quality choice callback handlers ---
bot.callbackQuery(/^q:(full|compact):(\d+)$/, async (ctx) => {
  const match = ctx.callbackQuery.data.match(/^q:(full|compact):(\d+)$/)
  if (!match) return ctx.answerCallbackQuery('Invalid')

  const quality = match[1] as queue.QualityMode
  const choiceId = match[2]
  const pending = pendingChoices.get(choiceId)
  if (!pending) return ctx.answerCallbackQuery('Expired — please send the URL again')

  pendingChoices.delete(choiceId)

  let user = db.findUserByTelegramId(ctx.from.id)
  if (!user) user = db.createUser(ctx.from.id, ctx.from.username)

  await ctx.answerCallbackQuery(quality === 'full' ? 'Downloading full quality...' : 'Downloading compact version...')
  await ctx.editMessageText('Processing...').catch(() => {})

  const compactFormat = quality === 'compact' && pending.compactOption
    ? pending.compactOption.formatString
    : undefined
  const taskId = queue.submitTask(user.id, pending.url, quality, compactFormat)
  taskMessageMap.set(taskId, { chatId: ctx.chat!.id, messageId: ctx.callbackQuery.message!.message_id })
  console.log(`[bot] Quality choice: ${quality}, task ${taskId} for URL ${pending.url}${compactFormat ? ` (format: ${pending.compactOption!.height}p)` : ''}`)
})

// --- Progress/completion callbacks ---

interface TaskMessage { chatId: number; messageId: number }
const taskMessageMap = new Map<string, TaskMessage>()
const lastProgressUpdate = new Map<string, number>()

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

queue.onProgress((taskId, progress, title) => {
  const msg = taskMessageMap.get(taskId)
  if (!msg) return

  const now = Date.now()
  const last = lastProgressUpdate.get(taskId) ?? 0
  if (now - last < 3000 && progress.percent < 100 && progress.phase !== 'compressing') return
  if (now - last < 5000 && progress.phase === 'compressing') return
  lastProgressUpdate.set(taskId, now)

  let text: string

  if (progress.phase === 'compressing' || progress.phase.startsWith('compressing')) {
    const frameIdx = Math.floor(now / 200) % SPINNER.length
    text = `${title ? `*${esc(title)}*\n\n` : ''}` +
      `🗜 Compressing for Telegram\\.\\.\\.\n` +
      `\`${SPINNER[frameIdx]} Please wait\``
  } else {
    const phaseLabel = progress.phase === 'merging' ? '🔀 Merging' :
      progress.phase === 'audio' ? '🎵 Audio' :
      progress.phase === 'info' ? '🔍 Getting info' : '📥 Downloading'

    const pct = Math.round(progress.percent)
    const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5))

    text = `${title ? `*${esc(title)}*\n\n` : ''}` +
      `${phaseLabel}\n` +
      `\`[${bar}] ${pct}%\`\n` +
      (progress.speed ? `Speed: ${esc(progress.speed)}\n` : '') +
      (progress.eta ? `ETA: ${esc(progress.eta)}` : '')
  }

  bot.api.editMessageText(msg.chatId, msg.messageId, text, { parse_mode: 'MarkdownV2' }).catch(() => {})
})

queue.onComplete(async (taskId, filePath, title) => {
  console.log(`[bot] onComplete called: task=${taskId}, file=${filePath}, title=${title}`)

  const msg = taskMessageMap.get(taskId)
  if (!msg) {
    console.warn(`[bot] No message mapping for task ${taskId}, cannot send video`)
    return
  }
  taskMessageMap.delete(taskId)
  lastProgressUpdate.delete(taskId)

  const tmpDir = dirname(filePath)

  try {
    const fileSize = statSync(filePath).size
    console.log(`[bot] Task ${taskId}: file size = ${(fileSize / 1024 / 1024).toFixed(1)} MB, limit = ${(TELEGRAM_FILE_LIMIT / 1024 / 1024).toFixed(0)} MB`)

    if (fileSize <= TELEGRAM_FILE_LIMIT) {
      console.log(`[bot] Task ${taskId}: sending video directly via Telegram...`)
      await bot.api.editMessageText(msg.chatId, msg.messageId, `📤 Sending *${esc(title)}*\\.\\.\\.`, { parse_mode: 'MarkdownV2' }).catch(() => {})

      await bot.api.sendVideo(msg.chatId, new InputFile(filePath), {
        caption: title,
        supports_streaming: true,
      })
      console.log(`[bot] Task ${taskId}: sendVideo succeeded`)

      await bot.api.deleteMessage(msg.chatId, msg.messageId).catch(() => {})
    } else {
      console.log(`[bot] Task ${taskId}: file too large for Telegram, creating temp link...`)
      await bot.api.editMessageText(msg.chatId, msg.messageId, `📤 File too large for Telegram \\(${esc(formatBytes(fileSize))}\\), creating download link\\.\\.\\.`, { parse_mode: 'MarkdownV2' }).catch(() => {})

      const fileName = `${title.replace(/[/\\?*:|"<>]/g, '-')}.mp4`
      const { shareUrl, downloadUrl } = await storeForServing(filePath, fileName)
      console.log(`[bot] Task ${taskId}: temp link created: ${shareUrl}, one-time download: ${downloadUrl}`)

      db.updateTask(taskId, { result_url: shareUrl })

      const text = `*${esc(title)}*\n\n` +
        `File too large for Telegram \\(${esc(formatBytes(fileSize))}\\)\\.\n\n` +
        `_Link expires in ${config.tempLinkExpiryHours}h_`

      const keyboard = new InlineKeyboard()
        .url('🔗 View / Stream', shareUrl)
        .row()
        .url('⬇️ Download (one-time)', downloadUrl)

      await bot.api.editMessageText(msg.chatId, msg.messageId, text, { parse_mode: 'MarkdownV2', reply_markup: keyboard })
    }

    console.log(`[bot] Task ${taskId}: cleaning up tmpDir ${tmpDir}`)
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    console.log(`[bot] Task ${taskId}: done`)
  } catch (err) {
    console.error(`[bot] Task ${taskId}: FAILED to send video:`, err)
    const errMsg = err instanceof Error ? err.message : String(err)
    await bot.api.editMessageText(msg.chatId, msg.messageId, `Failed to send video: ${errMsg.slice(0, 200)}`, {}).catch(() => {})
    // Don't clean up on error so retry can reuse the file
  }
})

queue.onError((taskId, error, url) => {
  console.error(`[bot] Task ${taskId} error: ${error}`)
  const msg = taskMessageMap.get(taskId)
  if (!msg) return
  taskMessageMap.delete(taskId)
  lastProgressUpdate.delete(taskId)

  const retryData = `retry:${url}`
  const keyboard = new InlineKeyboard().text('Retry', retryData.slice(0, 64))

  const text = `Download failed\n\n${esc(error.slice(0, 300))}`
  bot.api.editMessageText(msg.chatId, msg.messageId, text, {
    parse_mode: 'MarkdownV2',
    reply_markup: keyboard,
  }).catch(() => {})
})

function esc(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&')
}

bot.callbackQuery(/^retry:/, async (ctx) => {
  let user = db.findUserByTelegramId(ctx.from.id)
  if (!user) {
    user = db.createUser(ctx.from.id, ctx.from?.username)
  }

  const url = ctx.callbackQuery.data?.slice('retry:'.length)
  if (!url) return ctx.answerCallbackQuery('Invalid retry data')

  await ctx.answerCallbackQuery('Retrying...')
  await ctx.editMessageText('Retrying download...').catch(() => {})

  const taskId = queue.submitTask(user.id, url)
  taskMessageMap.set(taskId, { chatId: ctx.chat!.id, messageId: ctx.callbackQuery.message!.message_id })
})

export function getTelegramWebhookCallback() {
  return webhookCallback(bot, 'fastify')
}
