import { useState, useEffect, useCallback } from 'react'
import { Folder } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Stepper } from './Stepper'
import type { SettingsData } from '@/types'

const VIDEO_QUALITIES = ['2160', '1080', '720', '360', '240', '144']
const AUDIO_QUALITIES = ['320', '256', '128']

export function SettingsPage() {
  const [settings, setSettings] = useState<SettingsData>({
    downloadDir: '',
    concurrency: 3,
    showFormatDialog: true,
    playlistSubfolder: true,
    defaultVideoQuality: '1080',
    defaultAudioQuality: '320',
    sleepInterval: 3,
    ytdlpPath: '',
    ffmpegPath: ''
  })

  useEffect(() => {
    if (!window.api) return
    window.api.getSettings().then((res) => {
      const data = (res as { data?: SettingsData })?.data ?? res
      if (data) setSettings((prev) => ({ ...prev, ...data }))
    })
  }, [])

  const onUpdate = useCallback(async (key: string, value: unknown) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
    if (window.api) await window.api.updateSettings(key, value)
  }, [])

  const handleBrowse = async () => {
    if (!window.api?.selectDownloadFolder) return
    try {
      const result = await window.api.selectDownloadFolder()
      if (result) onUpdate('downloadDir', result)
    } catch {
      // ignore
    }
  }

  const handleDone = () => {
    window.api?.closeWindow()
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      <header
        className="h-11 flex-shrink-0 relative flex items-center bg-elevated border-b border-border"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-foreground pointer-events-none">
          Settings
        </span>
      </header>

      <div
        className="flex-1 overflow-y-auto p-6"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <section className="mb-8">
          <h3 className="text-sm font-semibold text-foreground mb-4">General</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-muted-foreground mb-2">Download Location</label>
              <div className="flex gap-2">
                <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-surface border border-border">
                  <Folder className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <span className="text-sm text-foreground truncate">{settings.downloadDir}</span>
                </div>
                <button
                  onClick={handleBrowse}
                  className="px-4 py-2 rounded-lg bg-elevated border border-border text-sm font-medium text-foreground hover:bg-surface transition-colors"
                >
                  Browse
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs text-muted-foreground mb-2">Concurrent Downloads</label>
              <Stepper
                value={settings.concurrency}
                min={1}
                max={10}
                onChange={(v) => onUpdate('concurrency', v)}
              />
            </div>

            <ToggleRow
              label="Show Format Dialog"
              checked={settings.showFormatDialog}
              onChange={(v) => onUpdate('showFormatDialog', v)}
            />

            <ToggleRow
              label="Playlist/Channel Subfolder"
              checked={settings.playlistSubfolder}
              onChange={(v) => onUpdate('playlistSubfolder', v)}
            />

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-foreground">Chrome Extension</p>
                <p className="text-xs text-muted-foreground">
                  {settings.cookiesPath ? 'Connected — cookies synced' : 'Detect videos & sync cookies'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {settings.cookiesPath && (
                  <span className="px-2.5 py-1 rounded-md bg-accent-green/20 text-accent-green text-xs font-medium">
                    Connected
                  </span>
                )}
                <button
                  onClick={() => window.api?.installChromeExtension?.()}
                  className="px-3 py-1.5 rounded-lg bg-elevated border border-border text-xs font-medium text-foreground hover:bg-surface transition-colors"
                >
                  Install Guide
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs text-muted-foreground mb-2">Delay Between Downloads</label>
              <Stepper
                value={settings.sleepInterval}
                min={0}
                max={30}
                suffix="s"
                onChange={(v) => onUpdate('sleepInterval', v)}
              />
            </div>
          </div>
        </section>

        <section className="mb-8">
          <h3 className="text-sm font-semibold text-foreground mb-4">Default Format</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-muted-foreground mb-2">Video Quality</label>
              <select
                value={settings.defaultVideoQuality}
                onChange={(e) => onUpdate('defaultVideoQuality', e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-white/30"
              >
                {VIDEO_QUALITIES.map((q) => (
                  <option key={q} value={q}>{q}p</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-2">Audio Quality</label>
              <select
                value={settings.defaultAudioQuality}
                onChange={(e) => onUpdate('defaultAudioQuality', e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-white/30"
              >
                {AUDIO_QUALITIES.map((q) => (
                  <option key={q} value={q}>{q}kbps</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-foreground mb-4">Advanced</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-muted-foreground mb-2">yt-dlp Path</label>
              <input
                type="text"
                value={settings.ytdlpPath ?? ''}
                readOnly
                className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm text-muted-foreground focus:outline-none focus:ring-2 focus:ring-white/30"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-2">ffmpeg Path</label>
              <input
                type="text"
                value={settings.ffmpegPath ?? ''}
                readOnly
                className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm text-muted-foreground focus:outline-none focus:ring-2 focus:ring-white/30"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-2">Version</label>
              <p className="text-sm text-muted-foreground">1.0.0</p>
            </div>
          </div>
        </section>
      </div>

      <footer
        className="flex-shrink-0 p-4 border-t border-border bg-elevated"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={handleDone}
          className="w-full py-2.5 rounded-lg bg-accent-indigo text-background font-medium hover:bg-accent-indigo-dark transition-colors"
        >
          Done
        </button>
      </footer>
    </div>
  )
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <label className="text-sm text-foreground">{label}</label>
      <button
        onClick={() => onChange(!checked)}
        className={cn('w-11 h-6 rounded-full transition-colors', checked ? 'bg-foreground' : 'bg-border')}
      >
        <span
          className={cn(
            'block w-5 h-5 rounded-full bg-background shadow transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0.5'
          )}
        />
      </button>
    </div>
  )
}
