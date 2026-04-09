TEMP_DIR := tmp

.PHONY: dev build start server tunnel clean clean-serve clean-dl status \
       docker-build docker-up docker-down docker-logs

# Local dev (polling mode, no tunnel)
dev:
	npm run dev

# Production build
build:
	npm run build

# Start built server
start:
	npm run start

# Start with Cloudflare Tunnel (auto-detects URL, sets BASE_URL, starts server)
server:
	@bash scripts/start-with-tunnel.sh

# Tunnel only (no server)
tunnel:
	cloudflared tunnel run vdl

clean: clean-serve clean-dl
	@echo "All temp files deleted."

clean-serve:
	@echo "Cleaning serve files..."
	@du -sh $(TEMP_DIR)/serve 2>/dev/null || true
	@rm -rf $(TEMP_DIR)/serve/*
	@echo "Done."

clean-dl:
	@echo "Cleaning download files..."
	@du -sh $(TEMP_DIR)/dl 2>/dev/null || true
	@rm -rf $(TEMP_DIR)/dl/*
	@echo "Done."

status:
	@echo "=== Serve files ==="
	@ls -lh $(TEMP_DIR)/serve/ 2>/dev/null || echo "(empty)"
	@echo ""
	@echo "=== Download dirs ==="
	@ls -lh $(TEMP_DIR)/dl/ 2>/dev/null || echo "(empty)"
	@echo ""
	@echo "=== Total disk usage ==="
	@du -sh $(TEMP_DIR) 2>/dev/null || echo "0B"

# --- Docker ---

docker-build:
	docker compose build

docker-up:
	docker compose up -d

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f
