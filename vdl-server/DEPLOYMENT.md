# VDL Server — Deployment Guide

## Overview

VDL Server is a Telegram bot that downloads videos from YouTube and other platforms using yt-dlp, then sends them directly in the Telegram chat. For files larger than 50 MB, it compresses them with ffmpeg. If compression can't get the file small enough, it falls back to a temporary download link served via Cloudflare Tunnel.

## Prerequisites

- **Node.js** >= 20
- **yt-dlp** installed and in PATH
- **ffmpeg** + **ffprobe** installed and in PATH
- A **Telegram Bot Token** from [@BotFather](https://t.me/BotFather)

### Install yt-dlp (macOS)

```bash
brew install yt-dlp
```

### Install ffmpeg (macOS)

```bash
brew install ffmpeg
```

## Local Development

### 1. Clone and install

```bash
cd vdl-server
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your values
```

Required variables:
- `TELEGRAM_BOT_TOKEN` — from BotFather
- `ADMIN_TELEGRAM_IDS` — comma-separated Telegram user IDs for admin access

### 3. Start the server

```bash
npm run dev
```

The bot starts in polling mode by default (no HTTPS needed for local dev).

### 4. Delete the old database (if upgrading)

If you're upgrading from a previous version with Google Drive support, delete the old database to avoid schema conflicts:

```bash
rm -rf data/vdl.db*
```

## Cloudflare Tunnel (for temp link fallback)

When a video is too large to send via Telegram (> 50 MB even after compression), the bot serves it as a temporary download link. For this to work remotely, you need a public URL.

### Setup

1. Install cloudflared:

```bash
brew install cloudflared
```

2. Start a tunnel pointing to your local server:

```bash
cloudflared tunnel --url http://localhost:30010
```

3. Copy the generated URL (e.g. `https://abc-xyz.trycloudflare.com`) and set it in `.env`:

```
BASE_URL=https://abc-xyz.trycloudflare.com
```

4. Restart the server. When `BASE_URL` starts with `https://`, the bot automatically switches to webhook mode and registers the webhook with Telegram.

## Architecture

```
User sends URL → Telegram Bot
  → yt-dlp downloads video
  → If > 48 MB: ffmpeg two-pass compress to ~48 MB
  → If ≤ 50 MB: sendVideo directly in chat
  → If still > 50 MB: serve via temp link (Fastify static)
  → Delete local files
```

## Admin Commands

Send `/admin` to the bot (must be in `ADMIN_TELEGRAM_IDS`):

- **Stats** — user count, task count, local storage usage
- **Users** — list registered users
- **Errors** — recent failed tasks
- **Cancel All** — cancel all active downloads
- **Clear Local** — delete all temp files
