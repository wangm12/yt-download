export interface StartDownloadOptions {
  url: string
  title: string
  format: string
  quality?: string
  outputDir?: string
  thumbnail?: string
  duration?: number
  metadata?: Record<string, unknown>
  playlistId?: string
  playlistIndex?: number
  isPlaylist?: boolean
  playlistTitle?: string
}

export interface WindowApi {
  getVideoInfo: (url: string) => Promise<{ data?: unknown; error?: string }>
  startDownload: (options: StartDownloadOptions) => Promise<{ data?: unknown; error?: string }>
  cancelDownload: (id: string) => Promise<{ cancelled: boolean }>
  pauseDownload: (id: string) => Promise<{ paused: boolean }>
  deleteTask: (id: string) => Promise<{ ok: boolean }>
  deleteTaskWithFiles: (id: string) => Promise<{ ok: boolean }>
  retryDownload: (id: string) => Promise<{ retried: boolean }>
  getDownloads: () => Promise<{ data: unknown[] }>
  resumeAll: () => Promise<{ ok: boolean }>
  pauseAll: () => Promise<{ ok: boolean }>
  clearDownloads: (mode: string) => Promise<{ ok: boolean }>
  openFileLocation: (path: string) => Promise<{ ok?: boolean; error?: string }>
  openFile: (path: string) => Promise<{ ok?: boolean; error?: string }>
  getSettings: () => Promise<{ data: unknown }>
  updateSettings: (key: string, value: unknown) => Promise<{ ok: boolean }>
  onDownloadProgress: (callback: (data: Record<string, unknown>) => void) => () => void
  onNewDownload: (callback: (data: Record<string, unknown>) => void) => () => void
  onYtdlUrl: (callback: (url: string) => void) => () => void
  onSettingsChanged: (callback: () => void) => () => void
  selectDownloadFolder: () => Promise<string | undefined>
  readClipboard: () => Promise<string>
  installChromeExtension: () => Promise<{ ok?: boolean; path?: string; error?: string }>
  openSettings: () => Promise<void>
  closeWindow: () => Promise<void>
  platform: NodeJS.Platform
}

declare global {
  interface Window {
    api: WindowApi
  }
}
