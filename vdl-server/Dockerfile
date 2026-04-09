FROM node:20-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# -----------------------------------------------------------
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      curl \
      python3 \
      python3-pip \
      ca-certificates \
      gnupg \
    && pip3 install --break-system-packages yt-dlp \
    && curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
       | gpg --dearmor -o /usr/share/keyrings/cloudflare-archive-keyring.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/cloudflare-archive-keyring.gpg] https://pkg.cloudflare.com/cloudflared any main" \
       > /etc/apt/sources.list.d/cloudflared.list \
    && apt-get update && apt-get install -y --no-install-recommends cloudflared \
    && apt-get purge -y gnupg && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist/ dist/
COPY scripts/ scripts/
COPY public/ public/

RUN mkdir -p data tmp/dl tmp/serve \
    && chmod +x scripts/start-with-tunnel.sh

EXPOSE 30010

CMD ["bash", "scripts/start-with-tunnel.sh"]
