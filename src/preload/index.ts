import { contextBridge, ipcRenderer } from 'electron'

const api = {
  getVideoInfo: (url: string) => ipcRenderer.invoke('get-video-info', url),
  startDownload: (options: {
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
    mediaType?: string
    referer?: string
    customHeaders?: Record<string, string>
  }) => ipcRenderer.invoke('start-download', options),
  cancelDownload: (id: string) => ipcRenderer.invoke('cancel-download', id),
  pauseDownload: (id: string) => ipcRenderer.invoke('pause-download', id),
  deleteTask: (id: string) => ipcRenderer.invoke('delete-task', id),
  deleteTaskWithFiles: (id: string) => ipcRenderer.invoke('delete-task-with-files', id),
  retryDownload: (id: string) => ipcRenderer.invoke('retry-download', id),
  getDownloads: () => ipcRenderer.invoke('get-downloads'),
  resumeAll: () => ipcRenderer.invoke('resume-all'),
  pauseAll: () => ipcRenderer.invoke('pause-all'),
  clearDownloads: (mode: string) => ipcRenderer.invoke('clear-downloads', mode),
  openFileLocation: (path: string) => ipcRenderer.invoke('open-file-location', path),
  openFile: (path: string) => ipcRenderer.invoke('open-file', path),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (key: string, value: unknown) => ipcRenderer.invoke('update-settings', key, value),
  onDownloadProgress: (callback: (data: unknown) => void) => {
    const sub = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on('download-progress', sub)
    return () => ipcRenderer.removeListener('download-progress', sub)
  },
  onNewDownload: (callback: (data: unknown) => void) => {
    const sub = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on('new-download', sub)
    return () => ipcRenderer.removeListener('new-download', sub)
  },
  selectDownloadFolder: () => ipcRenderer.invoke('select-download-folder'),
  openSettings: () => ipcRenderer.invoke('open-settings'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  onSettingsChanged: (callback: () => void) => {
    const sub = () => callback()
    ipcRenderer.on('settings-changed', sub)
    return () => ipcRenderer.removeListener('settings-changed', sub)
  },
  onYtdlUrl: (callback: (url: string) => void) => {
    const sub = (_event: Electron.IpcRendererEvent, url: string) => callback(url)
    ipcRenderer.on('ytdl-url', sub)
    return () => ipcRenderer.removeListener('ytdl-url', sub)
  },
  sniffMedia: (url: string) => ipcRenderer.invoke('sniff-media', url),
  readClipboard: () => ipcRenderer.invoke('read-clipboard'),
  installChromeExtension: () => ipcRenderer.invoke('install-chrome-extension'),
  platform: process.platform
}

contextBridge.exposeInMainWorld('api', api)
