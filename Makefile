.PHONY: install dev build mac clean lint ext commit push

install:
	npm install

dev:
	npm run dev

build:
	npm run build

mac:
	npm run build:mac

clean:
	rm -rf out dist node_modules/.cache

# Reload extension in Chrome (prints reminder)
ext:
	@echo "Extension files updated. Reload at chrome://extensions"
	@echo "  extension/background.js"
	@echo "  extension/popup.html"
	@echo "  extension/popup.js"
	@echo "  extension/popup.css"

commit:
	git add -A && git commit

push:
	git push origin main

# Build then package for macOS in one step
release: build mac
