import { useState } from 'react'
import { X, Download, Globe } from 'lucide-react'

export interface DetectedMedia {
  url: string
  type: 'hls' | 'mp4' | 'webm' | 'flv'
  size: number | null
  contentType: string | null
}

interface MediaPickerDialogProps {
  media: DetectedMedia[]
  pageUrl: string
  pageTitle?: string
  onClose: () => void
  onDownload: (items: DetectedMedia[]) => void
}

const TYPE_STYLES: Record<string, string> = {
  hls: 'bg-accent-indigo/20 text-accent-indigo',
  mp4: 'bg-blue-500/20 text-blue-400',
  webm: 'bg-emerald-500/20 text-emerald-400',
  flv: 'bg-amber-500/20 text-amber-400'
}

function getDisplayName(url: string): string {
  try {
    const pathname = new URL(url).pathname
    const filename = pathname.split('/').pop()
    if (filename && filename.length > 0 && filename !== '/') {
      const decoded = decodeURIComponent(filename)
      return decoded.length > 55 ? decoded.substring(0, 52) + '...' : decoded
    }
  } catch {}
  return url.length > 55 ? url.substring(0, 52) + '...' : url
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${(bytes / 1073741824).toFixed(2)} GB`
}

export function MediaPickerDialog({ media, pageUrl, pageTitle, onClose, onDownload }: MediaPickerDialogProps) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set(media.map((_, i) => i)))

  const toggle = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  const handleDownload = () => {
    const items = media.filter((_, i) => selected.has(i))
    if (items.length > 0) onDownload(items)
  }

  let pageDomain = ''
  try {
    pageDomain = new URL(pageUrl).hostname
  } catch {}

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[460px] bg-background rounded-xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-elevated p-4 flex items-center gap-2.5">
          <Globe size={16} className="text-muted-foreground flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground truncate">
                {pageTitle || 'Detected Media'}
              </h2>
              <span className="bg-accent-indigo text-white text-[11px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0">
                {media.length}
              </span>
            </div>
            {pageDomain && (
              <p className="text-[11px] text-muted-foreground mt-0.5">{pageDomain}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-border transition-colors flex-shrink-0"
          >
            <X size={16} className="text-muted-foreground" />
          </button>
        </div>

        <div className="max-h-[320px] overflow-y-auto divide-y divide-border/50">
          {media.map((item, index) => (
            <label
              key={item.url}
              className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-elevated/50 transition-colors"
            >
              <input
                type="checkbox"
                checked={selected.has(index)}
                onChange={() => toggle(index)}
                className="mt-0.5 accent-accent-indigo flex-shrink-0 cursor-pointer"
              />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-foreground truncate" title={item.url}>
                  {getDisplayName(item.url)}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[11px] text-muted-foreground truncate max-w-[140px]">
                    {getDomain(item.url)}
                  </span>
                  <span className={`text-[10px] font-semibold uppercase px-1.5 py-px rounded ${TYPE_STYLES[item.type] || 'bg-surface text-muted-foreground'}`}>
                    {item.type}
                  </span>
                  <span className="text-[11px] text-tertiary-foreground">
                    {item.size ? formatSize(item.size) : 'Unknown size'}
                  </span>
                </div>
              </div>
            </label>
          ))}
        </div>

        <div className="p-3 bg-elevated border-t border-border">
          <button
            onClick={handleDownload}
            disabled={selected.size === 0}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-accent-indigo text-white text-sm font-semibold hover:bg-accent-indigo-dark transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download size={14} />
            Download {selected.size > 0 ? `(${selected.size})` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
