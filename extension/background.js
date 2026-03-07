const APP_URL = 'http://127.0.0.1:18765'
const YOUTUBE_COOKIE_DOMAIN = '.youtube.com'
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

const tabMedia = new Map()
let lastClickTime = 0

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.url) return
  const now = Date.now()
  if (now - lastClickTime < DEBOUNCE_MS) return
  lastClickTime = now

  if (isYouTubeUrl(tab.url)) {
    await sendDownloadRequest({ url: tab.url }, tab.id)
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

  chrome.action.setPopup({ tabId: tab.id, popup: isYT ? '' : 'popup.html' })
  chrome.action.setIcon({ tabId: tab.id, path: ICON_ACTIVE })

  if (!isYT) {
    const count = tabMedia.get(tab.id)?.size || 0
    updateBadge(tab.id, count)
  }
}

function updateBadge(tabId, count) {
  if (count > 0) {
    chrome.action.setBadgeText({ tabId, text: String(count) })
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#7C3AED' })
    chrome.action.setIcon({ tabId, path: ICON_ACTIVE })
  } else {
    chrome.action.setBadgeText({ tabId, text: '' })
  }
}

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId < 0) return
    if (isYouTubeUrl(details.url)) return
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

    if (!tabMedia.has(details.tabId)) {
      tabMedia.set(details.tabId, new Map())
    }
    const mediaMap = tabMedia.get(details.tabId)
    if (mediaMap.has(details.url)) return

    const contentLength = getHeader(details.responseHeaders, 'content-length')
    mediaMap.set(details.url, {
      url: details.url,
      type: mediaType,
      size: contentLength ? parseInt(contentLength) : null,
      initiator: details.initiator || '',
      timestamp: Date.now()
    })

    updateBadge(details.tabId, mediaMap.size)
  },
  { urls: ['<all_urls>'], types: ['media', 'xmlhttprequest', 'other'] },
  ['responseHeaders']
)

function getHeader(headers, name) {
  if (!headers) return null
  const header = headers.find((h) => h.name.toLowerCase() === name.toLowerCase())
  return header ? header.value : null
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'DOWNLOAD_VIDEO') {
    sendDownloadRequest({ url: message.url }, sender.tab?.id)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ error: true }))
    return true
  }

  if (message.type === 'GET_MEDIA') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id
      if (!tabId) {
        sendResponse({ media: [], tabUrl: '' })
        return
      }
      const mediaMap = tabMedia.get(tabId)
      const media = mediaMap ? Array.from(mediaMap.values()) : []
      sendResponse({ media, tabUrl: tabs[0].url || '' })
    })
    return true
  }

  if (message.type === 'DOWNLOAD_MEDIA') {
    const { items, tabUrl } = message
    Promise.all(
      items.map((item) =>
        sendDownloadRequest({
          url: item.url,
          type: item.type,
          referer: item.initiator || tabUrl || '',
          title: item.title
        })
      )
    )
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ error: true }))
    return true
  }

  return false
})

function isYouTubeUrl(url) {
  return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)/.test(url)
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
    console.warn('YT Download app is not running, launching via protocol')
    launchViaProtocol(request.url, tabId)
    return false
  }
}

function launchViaProtocol(videoUrl, tabId) {
  const ytdlUrl = `ytdl://download?url=${encodeURIComponent(videoUrl)}`
  if (tabId) {
    chrome.scripting
      .executeScript({
        target: { tabId },
        func: (url) => {
          window.location.href = url
        },
        args: [ytdlUrl]
      })
      .catch(() => {})
  }
}

async function syncCookies() {
  try {
    const cookies = await chrome.cookies.getAll({ domain: YOUTUBE_COOKIE_DOMAIN })
    const mapped = cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      expirationDate: c.expirationDate
    }))

    const res = await fetch(`${APP_URL}/cookies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mapped)
    })

    if (res.ok) {
      console.log(`Synced ${mapped.length} cookies to YT Download app`)
    }
  } catch {
    // App not running, silently ignore
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
