# VDL Server

Video download Telegram bot powered by yt-dlp. Send a video URL, get it back in chat or as a download link.

## Features

- **Telegram Bot** — send a video link, get the video directly in chat (< 50MB) or a download link
- **Multi-platform** — YouTube, Douyin, TikTok, Bilibili, Xiaohongshu, X/Twitter, Instagram, and any site supported by yt-dlp
- **Douyin fallback** — server-side scraping when yt-dlp's extractor fails
- **Quality options** — full quality (download link) or compact (sent in chat)
- **Cookie sync** — Chrome extension syncs cookies for authenticated downloads
- **Auto-cleanup** — configurable expiry for temporary download links
- **Cloudflare Tunnel** — stable public URL for webhook and download links

## Quick Start

```bash
cp .env.example .env
# Edit .env with your Telegram bot token and admin ID

npm install
npm run build
make server          # starts Cloudflare Tunnel + server
```

## Docker

```bash
cp .env.example .env
# Edit .env

make docker-build
make docker-up
make docker-logs     # tail logs
```

## Architecture

```
vdl-server/
├── src/
│   ├── index.ts          # Fastify server entry point
│   ├── config.ts         # Environment configuration
│   ├── db.ts             # SQLite database (users, tasks)
│   ├── ytdlp.ts          # yt-dlp CLI wrapper
│   ├── compress.ts       # ffmpeg two-pass compression
│   ├── douyin.ts         # Douyin direct CDN fallback
│   ├── queue.ts          # Download task queue
│   ├── cleanup.ts        # Periodic cleanup for expired files
│   ├── bot/
│   │   └── index.ts      # Telegram bot (grammY)
│   └── storage/
│       └── temp-link.ts  # Temporary download links + one-time tokens
├── scripts/
│   └── start-with-tunnel.sh  # Cloudflare Tunnel + server launcher
├── public/               # Static files
├── Dockerfile
├── docker-compose.yml
├── Makefile
└── .env.example
```

## Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Start the bot |
| `/admin` | Admin panel — stats, users, errors, cancel tasks, clear files |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | — | From @BotFather |
| `ADMIN_TELEGRAM_IDS` | No | — | Comma-separated Telegram user IDs |
| `PORT` | No | `3000` | Server port |
| `HOST` | No | `0.0.0.0` | Bind address |
| `BASE_URL` | No | `http://localhost:3000` | Public URL (set by tunnel script) |
| `COOKIE_MODE` | No | `browser` | `browser` or `file` |
| `COOKIES_FILE_PATH` | No | `./cookies.txt` | Path to Netscape cookie file |
| `TEMP_DIR` | No | `./tmp` | Temp file directory |
| `TEMP_LINK_EXPIRY_HOURS` | No | `3` | Hours before download links expire |
| `MAX_FILE_SIZE_MB` | No | `500` | Max download size |

## Makefile Targets

| Target | Description |
|--------|-------------|
| `make dev` | Local dev with polling (no tunnel) |
| `make server` | Cloudflare Tunnel + production server |
| `make clean` | Delete all temp files |
| `make status` | Show temp file disk usage |
| `make docker-build` | Build Docker image |
| `make docker-up` | Start container |
| `make docker-down` | Stop container |
| `make docker-logs` | Tail container logs |
