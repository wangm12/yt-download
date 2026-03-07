import { BrowserWindow, session } from 'electron'

export interface DetectedMedia {
  url: string
  type: 'hls' | 'mp4' | 'webm' | 'flv'
  size: number | null
  contentType: string | null
}

export interface SniffResult {
  media: DetectedMedia[]
  pageTitle: string
}

const MEDIA_PATTERNS: { pattern: RegExp; type: DetectedMedia['type'] }[] = [
  { pattern: /\.m3u8(\?|#|$)/i, type: 'hls' },
  { pattern: /\.mp4(\?|#|$)/i, type: 'mp4' },
  { pattern: /\.webm(\?|#|$)/i, type: 'webm' },
  { pattern: /\.flv(\?|#|$)/i, type: 'flv' }
]

const MIN_VIDEO_SIZE = 100_000
const SIZE_EXEMPT_TYPES = new Set<string>(['hls'])
const DEFAULT_TIMEOUT_MS = 25_000
const GRACE_AFTER_PLAY_MS = 8_000

const AUTOPLAY_SCRIPT = `
(function() {
  function tryPlay() {
    // Click common play buttons
    const selectors = [
      'button[class*="play"]', '[class*="play-btn"]', '[class*="play_btn"]',
      '[class*="playBtn"]', '[class*="vjs-big-play"]', '.plyr__control--overlaid',
      '[aria-label*="play" i]', '[aria-label*="Play" i]', '[title*="play" i]',
      '[title*="Play" i]', '.video-play', '.player-play', '.play-button',
      'button[data-plyr="play"]', '.dplayer-play-icon', '[class*="icon-play"]',
      '.mejs__overlay-play', '.jw-icon-display'
    ];
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      els.forEach(el => { try { el.click(); } catch {} });
    }

    // Auto-play all <video> elements
    const videos = document.querySelectorAll('video');
    videos.forEach(v => {
      try {
        v.muted = true;
        v.play().catch(() => {});
      } catch {}
    });

    // Click into iframes to trigger lazy players
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach(iframe => {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (doc) {
          const vids = doc.querySelectorAll('video');
          vids.forEach(v => { try { v.muted = true; v.play().catch(() => {}); } catch {} });
        }
      } catch {}
    });

    // Scroll to video elements to trigger lazy loading
    const firstVideo = document.querySelector('video, [class*="player"], [class*="video"]');
    if (firstVideo) {
      try { firstVideo.scrollIntoView({ behavior: 'instant' }); } catch {}
    }
  }

  // Run immediately and again after short delays
  tryPlay();
  setTimeout(tryPlay, 1000);
  setTimeout(tryPlay, 3000);
})();
`

function detectMediaType(
  url: string,
  responseHeaders?: Electron.WebRequest.HeadersReceivedResponse['responseHeaders']
): DetectedMedia['type'] | null {
  for (const { pattern, type } of MEDIA_PATTERNS) {
    if (pattern.test(url)) return type
  }

  if (responseHeaders) {
    const ctHeader = Object.keys(responseHeaders).find(
      (k) => k.toLowerCase() === 'content-type'
    )
    const ct = ctHeader ? responseHeaders[ctHeader]?.[0]?.toLowerCase() : null
    if (ct) {
      if (ct.includes('mpegurl') || ct.includes('x-mpegurl')) return 'hls'
      if (ct.includes('video/mp4')) return 'mp4'
      if (ct.includes('video/webm')) return 'webm'
      if (ct.includes('video/x-flv')) return 'flv'
    }
  }

  return null
}

function getHeaderValue(
  headers: Record<string, string[]> | undefined,
  name: string
): string | null {
  if (!headers) return null
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase())
  return key ? headers[key]?.[0] ?? null : null
}

export async function sniffMedia(
  targetUrl: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<SniffResult> {
  const detected = new Map<string, DetectedMedia>()
  const ses = session.fromPartition('sniffer-' + Date.now())

  ses.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  )

  const win = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    x: -10000,
    y: -10000,
    width: 1280,
    height: 720,
    enableLargerThanScreen: true,
    focusable: false,
    fullscreenable: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  })
  win.webContents.setAudioMuted(true)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.on('show', () => {
    win.setPosition(-10000, -10000)
    win.hide()
  })
  win.on('enter-full-screen', () => win.setFullScreen(false))
  win.on('enter-html-full-screen', () => {
    win.webContents.executeJavaScript('document.exitFullscreen().catch(()=>{})').catch(() => {})
  })

  ses.webRequest.onHeadersReceived(
    { urls: ['<all_urls>'] },
    (details, callback) => {
      const mediaType = detectMediaType(details.url, details.responseHeaders)
      if (mediaType && !detected.has(details.url)) {
        if (!SIZE_EXEMPT_TYPES.has(mediaType)) {
          const cl = getHeaderValue(details.responseHeaders, 'content-length')
          if (cl && parseInt(cl) < MIN_VIDEO_SIZE) {
            callback({ cancel: false })
            return
          }
        }

        const cl = getHeaderValue(details.responseHeaders, 'content-length')
        const ct = getHeaderValue(details.responseHeaders, 'content-type')
        detected.set(details.url, {
          url: details.url,
          type: mediaType,
          size: cl ? parseInt(cl) : null,
          contentType: ct
        })
      }
      callback({ cancel: false })
    }
  )

  return new Promise<SniffResult>((resolve) => {
    let settled = false
    let graceTimer: ReturnType<typeof setTimeout> | null = null

    const finish = (): void => {
      if (settled) return
      settled = true
      if (graceTimer) clearTimeout(graceTimer)
      let pageTitle = ''
      try {
        pageTitle = win.webContents.getTitle() || ''
      } catch {}
      try {
        win.destroy()
      } catch {}
      resolve({ media: Array.from(detected.values()), pageTitle })
    }

    const hardTimeout = setTimeout(finish, timeoutMs)

    win.webContents.on('did-finish-load', () => {
      win.webContents.executeJavaScript(AUTOPLAY_SCRIPT).catch(() => {})

      graceTimer = setTimeout(() => {
        clearTimeout(hardTimeout)
        finish()
      }, GRACE_AFTER_PLAY_MS)
    })

    win.webContents.on('did-fail-load', (_e, code) => {
      if (code !== -3) {
        clearTimeout(hardTimeout)
        finish()
      }
    })

    win.loadURL(targetUrl).catch(() => {
      clearTimeout(hardTimeout)
      finish()
    })
  })
}
