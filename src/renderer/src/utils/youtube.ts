export const YOUTUBE_URL_REGEX =
  /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\/.+/

const YOUTUBE_HOSTS = ['youtube.com', 'youtu.be', 'music.youtube.com']

const MEDIA_URL_REGEX = /\.(m3u8|mp4|webm|flv|mkv)(\?|#|$)/i

export function isYouTubeUrl(url: string): boolean {
  return YOUTUBE_URL_REGEX.test(url)
}

export function isMediaUrl(url: string): boolean {
  return MEDIA_URL_REGEX.test(url)
}

export function isValidDownloadUrl(url: string): boolean {
  return isYouTubeUrl(url) || isMediaUrl(url) || /^https?:\/\/.+/i.test(url)
}

export function getMediaType(url: string): string {
  if (/\.m3u8(\?|#|$)/i.test(url)) return 'hls'
  if (/\.mp4(\?|#|$)/i.test(url)) return 'mp4'
  if (/\.webm(\?|#|$)/i.test(url)) return 'webm'
  if (/\.flv(\?|#|$)/i.test(url)) return 'flv'
  return 'unknown'
}

export function filenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname
    const filename = pathname.split('/').pop()
    if (filename && filename.length > 0) {
      return decodeURIComponent(filename)
    }
  } catch {}
  return 'download'
}

export function extractUrlFromClipboard(text: string): string | null {
  const trimmed = text.trim()
  try {
    const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.toString()
    }
  } catch {}
  return null
}
