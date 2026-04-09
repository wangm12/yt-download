import 'dotenv/config'

function required(key: string): string {
  const val = process.env[key]
  if (!val) throw new Error(`Missing required env var: ${key}`)
  return val
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback
}

function optionalInt(key: string, fallback: number): number {
  const val = process.env[key]
  return val ? parseInt(val, 10) : fallback
}

export const config = {
  port: optionalInt('PORT', 3000),
  host: optional('HOST', '0.0.0.0'),
  baseUrl: optional('BASE_URL', 'http://localhost:3000'),

  telegramBotToken: required('TELEGRAM_BOT_TOKEN'),
  adminTelegramIds: optional('ADMIN_TELEGRAM_IDS', '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number),

  cookieMode: optional('COOKIE_MODE', 'browser') as 'browser' | 'file',
  cookiesFilePath: optional('COOKIES_FILE_PATH', './cookies.txt'),

  maxFileSizeMb: optionalInt('MAX_FILE_SIZE_MB', 500),

  tempDir: optional('TEMP_DIR', './tmp'),
  tempLinkExpiryHours: optionalInt('TEMP_LINK_EXPIRY_HOURS', 3),
} as const
