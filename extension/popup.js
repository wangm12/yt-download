document.addEventListener('DOMContentLoaded', () => {
  chrome.runtime.sendMessage({ type: 'GET_MEDIA' }, (response) => {
    const { media = [], tabUrl = '', tabTitle = '' } = response || {}
    renderMedia(media, tabUrl, tabTitle)
  })
})

function renderMedia(media, tabUrl, tabTitle) {
  const list = document.getElementById('list')
  const empty = document.getElementById('empty')
  const footer = document.getElementById('footer')
  const count = document.getElementById('count')
  const headerTitle = document.getElementById('header-title')

  if (headerTitle && tabTitle) {
    headerTitle.textContent = tabTitle
    headerTitle.title = tabTitle
  }

  if (media.length === 0) {
    empty.style.display = 'flex'
    footer.style.display = 'none'
    count.textContent = ''
    return
  }

  empty.style.display = 'none'
  footer.style.display = 'flex'
  count.textContent = media.length

  media.forEach((item, index) => {
    const row = document.createElement('div')
    row.className = 'media-item'

    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = true
    checkbox.id = `media-${index}`
    checkbox.dataset.index = index

    const info = document.createElement('label')
    info.htmlFor = `media-${index}`
    info.className = 'media-info'

    const name = document.createElement('div')
    name.className = 'media-name'
    name.textContent = getDisplayName(item.url)
    name.title = item.url

    const meta = document.createElement('div')
    meta.className = 'media-meta'

    const domain = document.createElement('span')
    domain.className = 'media-domain'
    try {
      domain.textContent = new URL(item.url).hostname
    } catch {
      domain.textContent = ''
    }

    const typeBadge = document.createElement('span')
    typeBadge.className = `media-type type-${item.type}`
    typeBadge.textContent = item.type.toUpperCase()

    const size = document.createElement('span')
    size.className = 'media-size'
    size.textContent = item.size ? formatSize(item.size) : 'Unknown size'

    meta.appendChild(domain)
    meta.appendChild(typeBadge)
    meta.appendChild(size)
    info.appendChild(name)
    info.appendChild(meta)
    row.appendChild(checkbox)
    row.appendChild(info)
    list.appendChild(row)
  })

  document.getElementById('download-btn').addEventListener('click', () => {
    const checkboxes = list.querySelectorAll('input[type="checkbox"]:checked')
    const selected = Array.from(checkboxes).map((cb) => media[cb.dataset.index])

    if (selected.length === 0) return

    const btn = document.getElementById('download-btn')
    btn.textContent = 'Sending...'
    btn.disabled = true

    chrome.runtime.sendMessage(
      {
        type: 'DOWNLOAD_MEDIA',
        items: selected,
        tabUrl,
        tabTitle
      },
      () => {
        window.close()
      }
    )
  })
}

function getDisplayName(url) {
  try {
    const pathname = new URL(url).pathname
    const filename = pathname.split('/').pop()
    if (filename && filename.length > 0 && filename !== '/') {
      const decoded = decodeURIComponent(filename)
      return decoded.length > 60 ? decoded.substring(0, 57) + '...' : decoded
    }
  } catch {}
  return url.length > 60 ? url.substring(0, 57) + '...' : url
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${(bytes / 1073741824).toFixed(2)} GB`
}
