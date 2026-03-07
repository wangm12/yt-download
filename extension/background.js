const APP_URL = 'http://127.0.0.1:18765'
const YOUTUBE_COOKIE_DOMAIN = '.youtube.com'
const DEBOUNCE_MS = 2000

const ICON_ACTIVE = {
  16: 'icons/icon16.png',
  48: 'icons/icon48.png'
}
const ICON_GRAY = {
  16: 'icons/icon16-gray.png',
  48: 'icons/icon48-gray.png'
}

let lastClickTime = 0

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.url) return
  const now = Date.now()
  if (now - lastClickTime < DEBOUNCE_MS) return
  lastClickTime = now

  if (isYouTubeUrl(tab.url)) {
    await sendDownloadRequest(tab.url, tab.id)
  }
})

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId)
    updateIconForTab(tab)
  } catch {}
})

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    updateIconForTab(tab)
  }
})

function updateIconForTab(tab) {
  if (!tab.active) return
  const icon = tab.url && isYouTubeUrl(tab.url) ? ICON_ACTIVE : ICON_GRAY
  chrome.action.setIcon({ tabId: tab.id, path: icon })
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'DOWNLOAD_VIDEO') {
    sendDownloadRequest(message.url)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ error: true }))
    return true
  }
  return false
})

function isYouTubeUrl(url) {
  return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)/.test(url)
}

async function sendDownloadRequest(videoUrl, tabId) {
  try {
    await syncCookies()
    const res = await fetch(`${APP_URL}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: videoUrl })
    })
    return res.ok
  } catch {
    console.warn('YT Download app is not running, launching via protocol')
    launchViaProtocol(videoUrl, tabId)
    return false
  }
}

function launchViaProtocol(videoUrl, tabId) {
  const ytdlUrl = `ytdl://download?url=${encodeURIComponent(videoUrl)}`
  if (tabId) {
    chrome.scripting.executeScript({
      target: { tabId },
      func: (url) => { window.location.href = url },
      args: [ytdlUrl]
    }).catch(() => {})
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
