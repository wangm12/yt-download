<p align="center">
  <img src="resources/icon.png" alt="YT Download" width="128" height="128" />
</p>

<h1 align="center">YT Download</h1>

<p align="center">
  A Downie-style desktop app for downloading videos from YouTube and any website, powered by <code>yt-dlp</code>.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS-blue" alt="macOS" />
  <img src="https://img.shields.io/badge/electron-33-blue" alt="Electron" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
</p>

---

## Features

- **One-click download** — Paste any URL with `Cmd+V` or click the companion Chrome extension
- **Universal media detection** — Sniffs HLS (m3u8), MP4, WebM, and FLV streams from any website
- **Chrome extension** — Detects media streams on every page; shows a picker when multiple streams are found
- **YouTube integration** — One-click download on YouTube pages with format selection (4K to 144p, MP3)
- **App-side sniffer** — For sites yt-dlp doesn't support, the app loads the page in a hidden browser and detects streams automatically
- **Playlist & channel support** — Download entire playlists or channels with organized subfolders
- **Concurrent downloads** — Configurable parallel download queue (1–10 simultaneous)
- **Real-time progress** — Live progress bar, network speed, ETA, and download phase (video/audio/merging)
- **Download management** — Pause, resume, retry, cancel, and delete individual or all tasks
- **Cookie sync** — Automatically syncs YouTube cookies from Chrome for authenticated downloads
- **Crash recovery** — Interrupted downloads are detected and can be resumed on restart
- **Dark UI** — Clean, minimal dark theme inspired by Downie

## Screenshots

<p align="center">
  <em>Main window with active downloads, playlist groups, and real-time progress</em>
</p>

## Prerequisites

Before using YT Download, install these dependencies:

```bash
# Install yt-dlp and ffmpeg via Homebrew
brew install yt-dlp ffmpeg
```

| Dependency | Purpose |
|-----------|---------|
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Video downloading engine |
| [ffmpeg](https://ffmpeg.org/) | Merging video + audio streams |

## Installation

### From DMG (recommended)

1. Download the latest `.dmg` from [Releases](https://github.com/mingjie-yt-download-ext/releases)
2. Open the DMG and drag **YT Download** to your Applications folder
3. Right-click → Open (first launch only, since the app is unsigned)

### Build from source

```bash
git clone https://github.com/user/yt-download-ext.git
cd yt-download-ext
npm install
npm run build:mac
```

The built app will be in `dist/mac-arm64/YT Download.app` and a DMG installer in `dist/`.

## Usage

### Paste a URL

1. Copy any video URL (YouTube, direct media link, or any webpage with embedded video)
2. Focus the app window and press `Cmd+V`
3. For YouTube: choose format/quality in the dialog
4. For other sites: the app tries yt-dlp first, then falls back to its built-in media sniffer — if multiple streams are found, a picker dialog lets you choose which to download
5. Download begins automatically

### Chrome Extension

1. Load the `extension/` folder in Chrome via `chrome://extensions` (Developer mode → Load unpacked)
2. The extension icon is always active on every page
3. **YouTube pages** — Click the icon to send the URL directly to the app
4. **Other pages** — Click the icon to open a popup showing all detected media streams (HLS, MP4, WebM, FLV); select streams and click Download
5. Cookies are synced automatically every 5 minutes for authenticated access

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+V` | Paste URL and start download |
| `Cmd+W` | Hide window (app stays in dock) |
| `Cmd+Q` | Quit app |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Download location | `~/Downloads` | Where files are saved |
| Concurrent downloads | 3 | Parallel downloads (1–10) |
| Show format dialog | On | Prompt for format/quality before downloading |
| Playlist subfolder | On | Organize playlist downloads into subfolders |
| Default video quality | 1080p | Used when format dialog is off |
| Default audio quality | 320kbps | Used when format dialog is off |
| Delay between downloads | 3s | Pause between starting queued downloads (rate limit mitigation) |

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                    Electron App                       │
│                                                       │
│  ┌────────────────┐     IPC      ┌────────────────┐  │
│  │  Main Process  │◄────────────►│    Renderer     │  │
│  │                │              │    (React)      │  │
│  │ • yt-dlp       │              │ • UI            │  │
│  │ • SQLite DB    │              │ • Tailwind      │  │
│  │ • Settings     │              │ • Radix UI      │  │
│  │ • HTTP Server  │              │ • Three.js      │  │
│  │ • Media Sniffer│              │ • Media Picker  │  │
│  └───────┬────────┘              └─────────────────┘  │
│          │                                            │
└──────────┼────────────────────────────────────────────┘
           │ HTTP :18765
┌──────────▼──────────┐
│  Chrome Extension   │
│ • Media sniffing    │
│ • Stream picker UI  │
│ • Cookie sync       │
│ • URL dispatch      │
└─────────────────────┘
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Electron 33 |
| Build | electron-vite, Vite |
| Frontend | React 19, TypeScript |
| Styling | Tailwind CSS, Radix UI, Lucide React |
| 3D Graphics | Three.js, React Three Fiber |
| Database | better-sqlite3 (SQLite) |
| Packaging | electron-builder |
| Download Engine | yt-dlp (external) |

### Project Structure

```
src/
├── main/                   # Electron main process
│   ├── index.ts            # App entry, windows, IPC handlers
│   ├── downloadManager.ts  # Queue, concurrency, task lifecycle
│   ├── ytdlp.ts            # yt-dlp CLI wrapper
│   ├── mediaSniffer.ts     # Hidden browser media stream detection
│   ├── database.ts         # SQLite persistence
│   ├── settings.ts         # JSON settings store
│   └── localServer.ts      # HTTP server for Chrome extension
├── preload/                # Context bridge (IPC exposure)
│   ├── index.ts
│   └── index.d.ts
└── renderer/               # React frontend
    └── src/
        ├── App.tsx         # Main app logic
        ├── components/     # UI components
        │   ├── DownloadItem.tsx
        │   ├── PlaylistGroup.tsx
        │   ├── FormatDialog.tsx
        │   ├── MediaPickerDialog.tsx
        │   ├── Settings.tsx
        │   ├── BottomBar.tsx
        │   ├── TitleBar.tsx
        │   ├── ClearDialog.tsx
        │   └── CoinLoader.tsx
        └── hooks/
            ├── useDownloads.ts
            └── useUrlHandler.ts

extension/                  # Chrome Extension (Manifest V3)
├── manifest.json
├── background.js           # Media sniffing, URL dispatch, cookie sync
├── popup.html/js/css       # Media stream picker popup
├── content.js              # Download button injection on YouTube
└── content.css
```

## Development

```bash
# Install dependencies
npm install

# Start in development mode (hot reload)
npm run dev

# Build for production
npm run build

# Package macOS app
npm run build:mac
```

## Chrome Extension Development

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `extension/` folder
4. The extension will auto-reload when files change

## License

MIT
