#!/usr/bin/env bash
# Descarga Chrome for Testing (Linux x64) para probar el juego con WebGPU.
# Uso: tools/get-chrome.sh [versión]   → deja el binario en .chrome/chrome-linux64/chrome
set -euo pipefail
VERSION="${1:-154.0.8037.57}"
DIR="$(cd "$(dirname "$0")/.." && pwd)/.chrome"
mkdir -p "$DIR"
if [ ! -x "$DIR/chrome-linux64/chrome" ]; then
  curl -fSL -o "$DIR/chrome.zip" "https://storage.googleapis.com/chrome-for-testing-public/${VERSION}/linux64/chrome-linux64.zip"
  unzip -q -o "$DIR/chrome.zip" -d "$DIR"
  rm "$DIR/chrome.zip"
fi
"$DIR/chrome-linux64/chrome" --version
