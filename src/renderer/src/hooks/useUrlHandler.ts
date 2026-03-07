import { useState, useCallback } from 'react'
import type { VideoInfo, SettingsData } from '@/types'
import { extractUrlFromClipboard, isMediaUrl, isYouTubeUrl, filenameFromUrl } from '@/utils/youtube'
import type { DetectedMedia } from '@/components/MediaPickerDialog'

interface PendingPlaylistMeta {
  title?: string
  url: string
}

export type LoadingPhase = '' | 'info' | 'sniffing'

export function useUrlHandler(settings: SettingsData) {
  const [loading, setLoading] = useState(false)
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>('')
  const [errorMsg, setErrorMsg] = useState('')
  const [showFormatDialog, setShowFormatDialog] = useState(false)
  const [pendingVideoInfo, setPendingVideoInfo] = useState<VideoInfo | null>(null)
  const [pendingEntries, setPendingEntries] = useState<VideoInfo[] | null>(null)
  const [pendingPlaylistMeta, setPendingPlaylistMeta] = useState<PendingPlaylistMeta | null>(null)

  const [sniffedMedia, setSniffedMedia] = useState<DetectedMedia[] | null>(null)
  const [sniffedPageUrl, setSniffedPageUrl] = useState('')
  const [sniffedPageTitle, setSniffedPageTitle] = useState('')

  const clearPending = useCallback(() => {
    setShowFormatDialog(false)
    setPendingVideoInfo(null)
    setPendingEntries(null)
    setPendingPlaylistMeta(null)
  }, [])

  const clearSniffed = useCallback(() => {
    setSniffedMedia(null)
    setSniffedPageUrl('')
    setSniffedPageTitle('')
  }, [])

  const handleUrl = useCallback(async (url: string, meta?: { type?: string; referer?: string; title?: string; headers?: Record<string, string> }) => {
    if (loading) return
    if (!window.api) {
      setErrorMsg('App API not available')
      return
    }

    setErrorMsg('')
    setLoading(true)
    setLoadingPhase('info')
    try {
      if (isMediaUrl(url) && !isYouTubeUrl(url)) {
        const title = meta?.title || filenameFromUrl(url)
        await window.api.startDownload({
          url,
          title,
          format: 'video',
          quality: settings.defaultVideoQuality,
          referer: meta?.referer,
          customHeaders: meta?.headers,
          mediaType: meta?.type
        })
        setLoading(false)
        setLoadingPhase('')
        return
      }

      const res = await window.api.getVideoInfo(url)
      const resObj = res as { data?: unknown; error?: string }
      if (resObj?.error) {
        const err = resObj.error
        if (err.includes('Unsupported URL')) {
          setLoadingPhase('sniffing')
          try {
            const sniffRes = await (window.api as { sniffMedia: (url: string) => Promise<{ data?: { media: DetectedMedia[]; pageTitle: string }; error?: string }> }).sniffMedia(url)
            const sniffData = sniffRes?.data
            if (sniffData?.media && sniffData.media.length > 0) {
              setSniffedMedia(sniffData.media)
              setSniffedPageUrl(url)
              setSniffedPageTitle(sniffData.pageTitle || '')
            } else {
              setErrorMsg('No media streams found on this page')
            }
          } catch {
            setErrorMsg('Failed to scan page for media')
          }
          setLoading(false)
          setLoadingPhase('')
          return
        } else {
          setErrorMsg(err)
        }
        setLoading(false)
        setLoadingPhase('')
        return
      }
      const info = resObj?.data ?? res
      if (!info) {
        setErrorMsg('Failed to fetch video info')
        setLoading(false)
        setLoadingPhase('')
        return
      }

      const infoObj = info as Record<string, unknown>
      const entries = infoObj?.entries as unknown[] | undefined

      if (Array.isArray(entries) && entries.length > 0) {
        const allEntries = entries.map((e) => {
          const eo = e as Record<string, unknown>
          return {
            id: String(eo.id ?? ''),
            title: String(eo.title ?? ''),
            thumbnail: String(eo.thumbnail ?? ''),
            duration: Number(eo.duration ?? 0),
            channel: String(eo.channel ?? ''),
            view_count: Number(eo.view_count ?? 0),
            webpage_url: String(eo.webpage_url ?? eo.url ?? '')
          } as VideoInfo
        })
        const playlistChannel = String(infoObj.playlist_channel ?? allEntries[0]?.channel ?? '')
        const playlistTitle = String(infoObj.playlist_title ?? (playlistChannel || 'Playlist'))

        if (settings.showFormatDialog) {
          const summary: VideoInfo = {
            ...allEntries[0],
            title: playlistTitle,
            channel: playlistChannel,
            playlist_title: playlistTitle,
            playlist_count: allEntries.length
          }
          setPendingVideoInfo(summary)
          setPendingEntries(allEntries)
          setPendingPlaylistMeta({ title: playlistTitle, url })
          setShowFormatDialog(true)
        } else {
          for (let i = 0; i < allEntries.length; i++) {
            const entry = allEntries[i]
            const videoUrl = entry.webpage_url || `https://www.youtube.com/watch?v=${entry.id}`
            await window.api.startDownload({
              url: videoUrl,
              title: entry.title,
              format: 'video',
              quality: settings.defaultVideoQuality,
              thumbnail: entry.thumbnail,
              duration: entry.duration,
              playlistId: playlistTitle,
              playlistIndex: i,
              playlistTitle
            })
          }
        }
      } else {
        const videoInfo: VideoInfo = {
          id: String(infoObj?.id ?? ''),
          title: String(infoObj?.title ?? ''),
          thumbnail: String(infoObj?.thumbnail ?? ''),
          duration: Number(infoObj?.duration ?? 0),
          channel: String(infoObj?.channel ?? ''),
          view_count: Number(infoObj?.view_count ?? 0),
          webpage_url: String(infoObj?.webpage_url ?? infoObj?.url ?? url)
        }

        if (settings.showFormatDialog) {
          setPendingVideoInfo(videoInfo)
          setPendingEntries(null)
          setPendingPlaylistMeta(null)
          setShowFormatDialog(true)
        } else {
          await window.api.startDownload({
            url,
            title: videoInfo.title,
            format: 'video',
            quality: settings.defaultVideoQuality,
            thumbnail: videoInfo.thumbnail,
            duration: videoInfo.duration
          })
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
      setLoadingPhase('')
    }
  }, [loading, settings.showFormatDialog, settings.defaultVideoQuality])

  const handlePaste = useCallback(async () => {
    if (loading || !window.api) return
    const text = await window.api.readClipboard()
    const url = extractUrlFromClipboard(text)
    if (!url) {
      if (text.trim()) setErrorMsg('Not a valid URL (paste an HTTP link)')
      return
    }
    await handleUrl(url)
  }, [loading, handleUrl])

  const handleExternalUrl = useCallback(async (rawUrl: string) => {
    let url = rawUrl
    let meta: { type?: string; referer?: string; title?: string; headers?: Record<string, string> } | undefined

    if (url.startsWith('ytdl://')) {
      try {
        const parsed = new URL(url)
        url = decodeURIComponent(parsed.searchParams.get('url') || '')
        const type = parsed.searchParams.get('type') || undefined
        const referer = parsed.searchParams.get('referer') || undefined
        const title = parsed.searchParams.get('title') || undefined
        const headersStr = parsed.searchParams.get('headers')
        const headers = headersStr ? JSON.parse(headersStr) : undefined
        if (type || referer || title || headers) {
          meta = { type, referer, title, headers }
        }
      } catch {
        return
      }
    }

    if (!url) return
    handleUrl(url, meta)
  }, [handleUrl])

  return {
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
    handleUrl,
    handlePaste,
    handleExternalUrl,
    clearPending,
    clearSniffed,
    setShowFormatDialog
  }
}
