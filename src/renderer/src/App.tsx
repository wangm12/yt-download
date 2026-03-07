import { useEffect, useState, useCallback } from 'react'
import { TitleBar } from '@/components/TitleBar'
import { BottomBar } from '@/components/BottomBar'
import { DownloadItem } from '@/components/DownloadItem'
import { PlaylistGroup } from '@/components/PlaylistGroup'
import { FormatDialog } from '@/components/FormatDialog'
import { MediaPickerDialog } from '@/components/MediaPickerDialog'
import type { DetectedMedia } from '@/components/MediaPickerDialog'
import { ClearDialog } from '@/components/ClearDialog'
import { SettingsPage } from '@/components/Settings'
import { CoinLoader } from '@/components/CoinLoader'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { DownloadActionsProvider } from '@/contexts/DownloadActionsContext'
import { useDownloads } from '@/hooks/useDownloads'
import { useSettings } from '@/hooks/useSettings'
import { useUrlHandler } from '@/hooks/useUrlHandler'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { groupDownloadsByPlaylist } from '@/utils/downloads'
import { parseSpeedToBytes, formatSpeed } from '@/utils/format'
import type { Download, Playlist } from '@/types'

export default function App() {
  const [route, setRoute] = useState(window.location.hash)

  useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  if (route === '#/settings') {
    return <SettingsPage />
  }

  return (
    <ErrorBoundary>
      <MainApp />
    </ErrorBoundary>
  )
}

function MainApp() {
  const { downloads, removeDownload, updateDownload, refreshDownloads } = useDownloads()
  const { settings, loadSettings } = useSettings()
  const {
    loading,
    loadingPhase,
    errorMsg,
    showFormatDialog,
    pendingVideoInfo,
    pendingEntries,
    pendingPlaylistMeta,
    sniffedMedia,
    sniffedPageUrl,
    sniffedPageTitle,
    handlePaste,
    handleExternalUrl,
    clearPending,
    clearSniffed,
    setShowFormatDialog
  } = useUrlHandler(settings)

  const [showClearDialog, setShowClearDialog] = useState(false)

  useKeyboardShortcuts({ onPaste: handlePaste })

  useEffect(() => {
    if (!window.api?.onYtdlUrl) return
    const unsub = window.api.onYtdlUrl((url: string) => handleExternalUrl(url))
    return unsub
  }, [handleExternalUrl])

  const handleDownload = useCallback(
    async (_url: string, format: string, quality: string) => {
      if (!window.api) return

      if (pendingEntries && pendingEntries.length > 0) {
        const playlistTitle = pendingPlaylistMeta?.title ?? 'Playlist'
        for (let i = 0; i < pendingEntries.length; i++) {
          const entry = pendingEntries[i]
          const videoUrl = entry.webpage_url || `https://www.youtube.com/watch?v=${entry.id}`
          await window.api.startDownload({
            url: videoUrl,
            title: entry.title,
            format,
            quality,
            thumbnail: entry.thumbnail,
            duration: entry.duration,
            playlistId: playlistTitle,
            playlistIndex: i,
            playlistTitle
          })
        }
      } else {
        const title = pendingVideoInfo?.title ?? 'Unknown'
        await window.api.startDownload({
          url: pendingVideoInfo?.webpage_url ?? _url,
          title,
          format,
          quality,
          thumbnail: pendingVideoInfo?.thumbnail,
          duration: pendingVideoInfo?.duration
        })
      }

      clearPending()
      loadSettings()
    },
    [pendingVideoInfo, pendingEntries, pendingPlaylistMeta, loadSettings, clearPending]
  )

  const handleMediaDownload = useCallback(
    async (items: DetectedMedia[]) => {
      if (!window.api) return
      const baseTitle = sniffedPageTitle || 'download'
      for (let i = 0; i < items.length; i++) {
        const title = items.length > 1
          ? `${baseTitle} (${i + 1})`
          : baseTitle

        await window.api.startDownload({
          url: items[i].url,
          title,
          format: 'video',
          quality: settings.defaultVideoQuality,
          referer: sniffedPageUrl || undefined,
          mediaType: items[i].type
        })
      }
      clearSniffed()
    },
    [settings.defaultVideoQuality, sniffedPageUrl, sniffedPageTitle, clearSniffed]
  )

  const handleClearCompleted = useCallback(async () => {
    if (window.api) {
      await window.api.clearDownloads('completed')
      refreshDownloads()
    }
  }, [refreshDownloads])

  const handleClearAll = useCallback(async () => {
    if (window.api) {
      await window.api.clearDownloads('all')
      refreshDownloads()
    }
  }, [refreshDownloads])

  const handleResumeAll = useCallback(async () => {
    if (window.api) {
      await window.api.resumeAll()
      refreshDownloads()
    }
  }, [refreshDownloads])

  const handlePauseAll = useCallback(async () => {
    if (window.api) {
      await window.api.pauseAll()
      refreshDownloads()
    }
  }, [refreshDownloads])

  const grouped = groupDownloadsByPlaylist(downloads)
  const completeCount = downloads.filter((d) => d.status === 'complete').length
  const resumableStatuses = ['paused', 'interrupted', 'cancelled', 'error', 'queued']
  const hasResumable = downloads.some((d) => resumableStatuses.includes(d.status))
  const hasActive = downloads.some((d) => d.status === 'downloading' || d.status === 'queued')
  const statusText = `${downloads.length} Download${downloads.length !== 1 ? 's' : ''} · ${completeCount} Complete`

  const totalSpeedBytes = downloads
    .filter((d) => d.status === 'downloading' && d.speed)
    .reduce((sum, d) => sum + parseSpeedToBytes(d.speed!), 0)
  const totalSpeed = totalSpeedBytes > 0 ? formatSpeed(totalSpeedBytes) : null

  return (
    <DownloadActionsProvider
      refreshDownloads={refreshDownloads}
      removeDownload={removeDownload}
      updateDownload={updateDownload}
    >
      <div className="h-screen flex flex-col bg-background">
        <TitleBar />

        <main className="flex-1 overflow-y-auto min-h-0 relative">
          {loading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm">
              <CoinLoader />
              <p className="text-accent-indigo text-sm animate-pulse mt-4">
                {loadingPhase === 'sniffing' ? 'Scanning page for media...' : 'Fetching video info...'}
              </p>
            </div>
          )}

          {errorMsg && (
            <div className="px-4 py-2 bg-accent-coral/10 border-b border-accent-coral/20">
              <p className="text-accent-coral text-xs">{errorMsg}</p>
            </div>
          )}

          {grouped.length === 0 && !loading ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <p className="text-muted-foreground text-sm mb-2">
                Paste a URL (Cmd+V) to add a download
              </p>
              <p className="text-tertiary-foreground text-xs">
                Supports YouTube, direct media links, and page scanning
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {grouped.map((item) =>
                'downloads' in item && Array.isArray(item.downloads) ? (
                  <PlaylistGroup key={item.id} playlist={item as Playlist} />
                ) : 'status' in item ? (
                  <DownloadItem key={item.id} download={item as Download} />
                ) : null
              )}
            </div>
          )}
        </main>

        <BottomBar
          statusText={statusText}
          totalSpeed={totalSpeed}
          hasResumable={hasResumable}
          hasActive={hasActive}
          hasDownloads={downloads.length > 0}
          onResumeAll={handleResumeAll}
          onPauseAll={handlePauseAll}
          onSettings={() => window.api?.openSettings()}
          onClear={() => setShowClearDialog(true)}
        />

        {showFormatDialog && pendingVideoInfo && (
          <FormatDialog
            videoInfo={pendingVideoInfo}
            onClose={() => {
              setShowFormatDialog(false)
              clearPending()
            }}
            onDownload={handleDownload}
            settings={settings}
          />
        )}

        {sniffedMedia && sniffedMedia.length > 0 && (
          <MediaPickerDialog
            media={sniffedMedia}
            pageUrl={sniffedPageUrl}
            pageTitle={sniffedPageTitle}
            onClose={clearSniffed}
            onDownload={handleMediaDownload}
          />
        )}

        {showClearDialog && (
          <ClearDialog
            onClose={() => setShowClearDialog(false)}
            onClearCompleted={handleClearCompleted}
            onClearAll={handleClearAll}
          />
        )}
      </div>
    </DownloadActionsProvider>
  )
}
