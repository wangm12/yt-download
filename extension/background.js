const APP_URL = 'http://127.0.0.1:18765'
const VDL_SERVER_URL = 'http://127.0.0.1:30010'

const COOKIE_SYNC_DOMAINS = [
  '.youtube.com',
  '.douyin.com',
  '.tiktok.com',
  '.xiaohongshu.com',
  '.bilibili.com',
  '.x.com',
  '.twitter.com',
  '.instagram.com',
]
const DEBOUNCE_MS = 2000

const ICON_ACTIVE = {
  16: 'icons/icon16.png',
  48: 'icons/icon48.png'
}

const MEDIA_PATTERNS = [
  { pattern: /\.m3u8(\?|#|$)/i, type: 'hls' },
  { pattern: /\.mp4(\?|#|$)/i, type: 'mp4' },
  { pattern: /\.webm(\?|#|$)/i, type: 'webm' },
  { pattern: /\.flv(\?|#|$)/i, type: 'flv' }
]
const MIN_VIDEO_SIZE = 100000
const SIZE_EXEMPT_TYPES = new Set(['hls'])
const FRAME_BUCKET_MAX = 50

// tabMedia: Map<tabId, Map<frameId, Map<url, mediaEntry>>>
const tabMedia = new Map()
let lastClickTime = 0

// --- Frame-aware storage helpers ---

function getFrameBucket(tabId, frameId) {
  if (!tabMedia.has(tabId)) tabMedia.set(tabId, new Map())
  const tab = tabMedia.get(tabId)
  if (!tab.has(frameId)) tab.set(frameId, new Map())
  return tab.get(frameId)
}

function addMediaEntry(tabId, frameId, url, entry) {
  const bucket = getFrameBucket(tabId, frameId)
  if (bucket.has(url)) return
  bucket.set(url, entry)
  // Evict oldest entries if over cap
  if (bucket.size > FRAME_BUCKET_MAX) {
    const sorted = Array.from(bucket.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp)
    const toRemove = sorted.slice(0, bucket.size - FRAME_BUCKET_MAX)
    for (const [k] of toRemove) bucket.delete(k)
  }
}

function getFrameMedia(tabId, frameId) {
  const tab = tabMedia.get(tabId)
  if (!tab) return []
  const bucket = tab.get(frameId)
  return bucket ? Array.from(bucket.values()) : []
}

function getAllTabMedia(tabId) {
  const tab = tabMedia.get(tabId)
  if (!tab) return []
  const seen = new Set()
  const result = []
  for (const bucket of tab.values()) {
    for (const [url, entry] of bucket) {
      if (!seen.has(url)) {
        seen.add(url)
        result.push(entry)
      }
    }
  }
  return result
}

// --- Action / tab event handlers ---

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.url) return
  const now = Date.now()
  if (now - lastClickTime < DEBOUNCE_MS) return
  lastClickTime = now

  if (isYouTubeUrl(tab.url)) {
    let downloadUrl = tab.url

    if (!/[?&]v=/.test(tab.url)) {
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const player = document.querySelector('#movie_player')
            return player?.getVideoUrl?.() || null
          }
        })
        if (result?.result) downloadUrl = result.result
      } catch {}
    }

    if (/[?&]v=/.test(downloadUrl)) {
      await sendDownloadRequest({ url: downloadUrl }, tab.id)
    }
  }

  if (isDouyinUrl(tab.url)) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const btn = document.getElementById('dy-dl-btn')
          if (btn) btn.click()
        }
      })
    } catch {}
  }

  if (isXUrl(tab.url)) {
    const statusUrl = getXStatusUrl(tab.url)
    if (statusUrl) {
      await sendDownloadRequest({ url: statusUrl }, tab.id)
    }
  }
})

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId)
    updateTabUI(tab)
  } catch {}
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    updateTabUI(tab)
  }
  if (changeInfo.url) {
    tabMedia.delete(tabId)
    updateBadge(tabId, 0)
  }
})

chrome.tabs.onRemoved.addListener((tabId) => {
  tabMedia.delete(tabId)
})

function updateTabUI(tab) {
  if (!tab.active || !tab.id) return
  const isYT = tab.url && isYouTubeUrl(tab.url)
  const isDouyin = tab.url && isDouyinUrl(tab.url)
  const isX = tab.url && isXUrl(tab.url)

  const noPopup = isYT || isDouyin || isX
  chrome.action.setPopup({ tabId: tab.id, popup: noPopup ? '' : 'popup.html' })
  chrome.action.setIcon({ tabId: tab.id, path: ICON_ACTIVE })

  if (!isYT) {
    const count = (isDouyin || isX) ? 0 : getAllTabMedia(tab.id).length
    updateBadge(tab.id, count)
  }
}

function updateBadge(tabId, count) {
  if (count > 0) {
    chrome.action.setBadgeText({ tabId, text: String(count) })
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#27272A' })
    chrome.action.setIcon({ tabId, path: ICON_ACTIVE })
  } else {
    chrome.action.setBadgeText({ tabId, text: '' })
  }
}

// --- webRequest sniffer (frame-aware) ---

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId < 0) return
    if (isYouTubeUrl(details.url)) return
    if (isDouyinUrl(details.initiator || '') || isDouyinUrl(details.url)) return
    if (isXUrl(details.initiator || '') || /video\.twimg\.com/.test(details.url)) return
    if (details.statusCode < 200 || details.statusCode >= 400) return

    let mediaType = null
    for (const { pattern, type } of MEDIA_PATTERNS) {
      if (pattern.test(details.url)) {
        mediaType = type
        break
      }
    }

    if (!mediaType) {
      const contentType = getHeader(details.responseHeaders, 'content-type')
      if (contentType) {
        if (contentType.includes('mpegurl') || contentType.includes('x-mpegurl')) {
          mediaType = 'hls'
        } else if (contentType.includes('video/mp4')) {
          mediaType = 'mp4'
        } else if (contentType.includes('video/webm')) {
          mediaType = 'webm'
        } else if (contentType.includes('video/x-flv')) {
          mediaType = 'flv'
        }
      }
    }
    if (!mediaType) return

    if (!SIZE_EXEMPT_TYPES.has(mediaType)) {
      const contentLength = getHeader(details.responseHeaders, 'content-length')
      if (contentLength && parseInt(contentLength) < MIN_VIDEO_SIZE) return
    }

    const contentLength = getHeader(details.responseHeaders, 'content-length')
    const frameId = details.frameId ?? 0
    addMediaEntry(details.tabId, frameId, details.url, {
      url: details.url,
      type: mediaType,
      size: contentLength ? parseInt(contentLength) : null,
      initiator: details.initiator || '',
      timestamp: Date.now()
    })

    updateBadge(details.tabId, getAllTabMedia(details.tabId).length)
  },
  { urls: ['<all_urls>'], types: ['media', 'xmlhttprequest', 'other'] },
  ['responseHeaders']
)

function getHeader(headers, name) {
  if (!headers) return null
  const header = headers.find((h) => h.name.toLowerCase() === name.toLowerCase())
  return header ? header.value : null
}

// --- Message handlers ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Existing: YouTube content.js download button
  if (message.type === 'DOWNLOAD_VIDEO') {
    sendDownloadRequest({ url: message.url }, sender.tab?.id)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ error: true }))
    return true
  }

  // Existing: popup queries all media for the active tab
  if (message.type === 'GET_MEDIA') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id
      if (!tabId) {
        sendResponse({ media: [], tabUrl: '', tabTitle: '' })
        return
      }
      const media = getAllTabMedia(tabId)
      sendResponse({ media, tabUrl: tabs[0].url || '', tabTitle: tabs[0].title || '' })
    })
    return true
  }

  // Existing: popup triggers multi-item download
  if (message.type === 'DOWNLOAD_MEDIA') {
    const { items, tabUrl, tabTitle } = message
    const baseTitle = tabTitle || 'download'
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tabId = tabs[0]?.id || null
      const requests = items.map((item, i) => ({
        url: item.url,
        type: item.type,
        referer: item.initiator || tabUrl || '',
        title: items.length > 1 ? `${baseTitle} (${i + 1})` : baseTitle
      }))

      try {
        await syncCookies()
        const firstRes = await fetch(`${APP_URL}/download`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requests[0])
        })
        if (firstRes.ok) {
          for (let i = 1; i < requests.length; i++) {
            await fetch(`${APP_URL}/download`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(requests[i])
            })
          }
          sendResponse({ ok: true })
          return
        }
      } catch {
        // App not running — launch via protocol then retry
      }

      launchViaProtocol(requests[0], tabId)

      if (requests.length > 1) {
        const retryRemaining = async (attempt) => {
          if (attempt > 5) return
          await new Promise((r) => setTimeout(r, 2000))
          try {
            const ping = await fetch(`${APP_URL}/ping`)
            if (ping.ok) {
              for (let i = 1; i < requests.length; i++) {
                await fetch(`${APP_URL}/download`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(requests[i])
                })
              }
              return
            }
          } catch {}
          retryRemaining(attempt + 1)
        }
        retryRemaining(0)
      }

      sendResponse({ ok: true })
    })
    return true
  }

  // New: content overlay queries media for its specific frame, with tab-level fallback
  if (message.type === 'GET_FRAME_MEDIA') {
    const tabId = sender.tab?.id
    const frameId = sender.frameId ?? 0
    if (!tabId) {
      sendResponse({ media: [], source: 'none', frameId })
      return true
    }
    let media = getFrameMedia(tabId, frameId)
    let source = 'frame'
    if (media.length === 0) {
      media = getAllTabMedia(tabId)
      source = 'tab-fallback'
    }
    sendResponse({
      media,
      source,
      frameId,
      isYouTube: isYouTubeUrl(sender.tab.url || ''),
      pageTitle: sender.tab.title || ''
    })
    return true
  }

  // New: content overlay triggers single-item download using sender context
  if (message.type === 'DOWNLOAD_MEDIA_FROM_CONTENT') {
    const { item } = message
    const tabId = sender.tab?.id
    const tabUrl = sender.tab?.url || ''
    const tabTitle = sender.tab?.title || 'download'

    if (!item || !item.url) {
      sendResponse({ ok: false, error: 'Missing item or url' })
      return true
    }

    const request = {
      url: item.url,
      type: item.type,
      referer: item.initiator || tabUrl,
      title: tabTitle
    }

    ;(async () => {
      try {
        await syncCookies()
        const res = await fetch(`${APP_URL}/download`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request)
        })
        if (res.ok) {
          sendResponse({ ok: true })
          return
        }
        throw new Error(`HTTP ${res.status}`)
      } catch {
        // App not running — launch via protocol
        try {
          launchViaProtocol(request, tabId)
          sendResponse({ ok: true })
        } catch (err) {
          sendResponse({ ok: false, error: String(err) })
        }
      }
    })()
    return true
  }

  return false
})

function isYouTubeUrl(url) {
  return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)/.test(url)
}

function isDouyinUrl(url) {
  return /^https?:\/\/([a-z0-9-]+\.)?douyin\.com/.test(url)
}

function isXUrl(url) {
  return /^https?:\/\/(www\.)?(x\.com|twitter\.com)/.test(url)
}

function getXStatusUrl(url) {
  const m = url.match(/https:\/\/(x|twitter)\.com\/[^/]+\/status\/\d+/)
  return m ? m[0] : null
}

async function sendDownloadRequest(request, tabId) {
  try {
    await syncCookies()
    const res = await fetch(`${APP_URL}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    })
    return res.ok
  } catch {
    console.warn('V-Download app is not running, launching via protocol')
    launchViaProtocol(request, tabId)
    return false
  }
}

function launchViaProtocol(request, tabId) {
  const params = new URLSearchParams({ url: request.url || request })
  if (typeof request === 'object') {
    if (request.type) params.set('type', request.type)
    if (request.referer) params.set('referer', request.referer)
    if (request.title) params.set('title', request.title)
  }
  const ytdlUrl = `ytdl://download?${params.toString()}`

  const execTabId = tabId || undefined
  if (execTabId) {
    chrome.scripting
      .executeScript({
        target: { tabId: execTabId },
        func: (url) => {
          window.location.href = url
        },
        args: [ytdlUrl]
      })
      .catch(() => {})
  } else {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.scripting
          .executeScript({
            target: { tabId: tabs[0].id },
            func: (url) => {
              window.location.href = url
            },
            args: [ytdlUrl]
          })
          .catch(() => {})
      }
    })
  }
}

async function syncCookies() {
  try {
    const allCookies = []
    for (const domain of COOKIE_SYNC_DOMAINS) {
      const cookies = await chrome.cookies.getAll({ domain })
      allCookies.push(...cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        expirationDate: c.expirationDate
      })))
    }

    const body = JSON.stringify(allCookies)
    const headers = { 'Content-Type': 'application/json' }

    await Promise.allSettled([
      fetch(`${APP_URL}/cookies`, { method: 'POST', headers, body }).catch(() => {}),
      fetch(`${VDL_SERVER_URL}/api/cookies`, { method: 'POST', headers, body }).catch(() => {}),
    ])

    console.log(`Synced ${allCookies.length} cookies across ${COOKIE_SYNC_DOMAINS.length} domains`)
  } catch {
    // Extension context error, silently ignore
  }
}

chrome.runtime.onInstalled.addListener(() => {
  syncCookies()
})

chrome.runtime.onStartup.addListener(() => {
  syncCookies()
})

chrome.alarms.create('sync-cookies', { periodInMinutes: 5 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'sync-cookies') {
    syncCookies()
  }
})
