import { createWriteStream, existsSync, mkdirSync } from 'fs'
import { join, resolve } from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { config } from './config.js'

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'

export interface DouyinVideoInfo {
  id: string
  title: string
  author: string
  videoUrl: string
  duration: number
  cover: string
}

function isDouyinUrl(url: string): boolean {
  return /douyin\.com/i.test(url)
}

async function resolveShortUrl(url: string): Promise<string> {
  const res = await fetch(url, { method: 'HEAD', redirect: 'follow' })
  return res.url
}

function extractVideoId(url: string): string | null {
  const match = url.match(/video\/(\d+)/)
  return match ? match[1] : null
}

async function fetchMobilePage(videoId: string): Promise<string> {
  const url = `https://m.douyin.com/share/video/${videoId}`
  const cookiePath = resolve(config.cookiesFilePath)
  let cookieHeader = ''

  if (existsSync(cookiePath)) {
    const { readFileSync } = await import('fs')
    const content = readFileSync(cookiePath, 'utf-8')
    const cookies: string[] = []
    for (const line of content.split('\n')) {
      if (line.startsWith('#') || !line.trim()) continue
      const parts = line.split('\t')
      if (parts.length >= 7 && parts[0].includes('douyin')) {
        cookies.push(`${parts[5]}=${parts[6]}`)
      }
    }
    cookieHeader = cookies.join('; ')
  }

  const headers: Record<string, string> = {
    'User-Agent': MOBILE_UA,
    'Referer': 'https://www.douyin.com/',
  }
  if (cookieHeader) headers['Cookie'] = cookieHeader

  const res = await fetch(url, { headers, redirect: 'follow' })
  if (!res.ok) throw new Error(`Mobile page fetch failed: ${res.status}`)
  return res.text()
}

function parseRouterData(html: string): DouyinVideoInfo {
  const match = html.match(/_ROUTER_DATA\s*=\s*(\{.+?\})\s*<\/script>/s)
  if (!match) throw new Error('No _ROUTER_DATA found in mobile page')

  const data = JSON.parse(match[1])
  const pageData = data.loaderData?.['video_(id)/page']
  if (!pageData) throw new Error('No video page data in _ROUTER_DATA')

  const item = pageData.videoInfoRes?.item_list?.[0]
  if (!item) throw new Error('No video item in page data')

  const video = item.video
  if (!video?.play_addr?.uri) throw new Error('No play_addr in video data')

  const videoUri = video.play_addr.uri
  // Use no-watermark URL
  const videoUrl = `https://aweme.snssdk.com/aweme/v1/play/?video_id=${videoUri}&ratio=720p&line=0`

  const coverUrl = video.cover?.url_list?.[0] ?? ''

  return {
    id: String(item.aweme_id ?? pageData.itemId ?? ''),
    title: String(item.desc ?? 'Douyin Video').substring(0, 200),
    author: String(item.author?.nickname ?? ''),
    videoUrl,
    duration: Math.floor((video.duration ?? 0) / 1000),
    cover: coverUrl,
  }
}

export async function getDouyinInfo(url: string): Promise<DouyinVideoInfo | null> {
  if (!isDouyinUrl(url)) return null

  try {
    console.log(`[douyin] Resolving URL: ${url}`)
    const resolved = await resolveShortUrl(url)
    console.log(`[douyin] Resolved to: ${resolved}`)

    const videoId = extractVideoId(resolved)
    if (!videoId) {
      console.log(`[douyin] Could not extract video ID from: ${resolved}`)
      return null
    }
    console.log(`[douyin] Video ID: ${videoId}`)

    const html = await fetchMobilePage(videoId)
    console.log(`[douyin] Mobile page fetched: ${html.length} bytes`)

    const info = parseRouterData(html)
    console.log(`[douyin] Parsed: title="${info.title}", author="${info.author}", duration=${info.duration}s`)
    return info
  } catch (err) {
    console.warn(`[douyin] Fallback failed:`, err instanceof Error ? err.message : err)
    return null
  }
}

export async function downloadDouyinVideo(
  videoUrl: string,
  outputDir: string,
  title: string,
  onProgress?: (percent: number) => void,
): Promise<string> {
  mkdirSync(outputDir, { recursive: true })

  const safeTitle = title.replace(/[^\w\u4e00-\u9fff\s-]/g, '').substring(0, 100).trim() || 'douyin_video'
  const outputPath = join(outputDir, `${safeTitle}.mp4`)

  console.log(`[douyin] Downloading video to: ${outputPath}`)
  console.log(`[douyin] URL: ${videoUrl}`)

  const res = await fetch(videoUrl, {
    headers: {
      'User-Agent': MOBILE_UA,
      'Referer': 'https://www.douyin.com/',
    },
    redirect: 'follow',
  })

  if (!res.ok || !res.body) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`)
  }

  const contentLength = Number(res.headers.get('content-length') ?? 0)
  console.log(`[douyin] Content-Length: ${contentLength} (${(contentLength / 1024 / 1024).toFixed(1)} MB)`)

  const fileStream = createWriteStream(outputPath)
  let downloaded = 0

  const transform = new TransformStream({
    transform(chunk, controller) {
      downloaded += chunk.byteLength
      if (contentLength > 0 && onProgress) {
        onProgress(Math.min(100, (downloaded / contentLength) * 100))
      }
      controller.enqueue(chunk)
    },
  })

  const readable = Readable.fromWeb(res.body.pipeThrough(transform) as any)
  await pipeline(readable, fileStream)

  console.log(`[douyin] Download complete: ${(downloaded / 1024 / 1024).toFixed(1)} MB`)
  return outputPath
}
