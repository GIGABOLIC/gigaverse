#!/bin/bash
# GigaVerse deploy — exports platform.db and pushes to GitHub Pages
# Usage: deploy.sh [label]   label defaults to "Activation export"

set -e
cd "$(dirname "$0")"

LABEL="${1:-Activation export}"

echo "[deploy] Starting export — $(date)"
node export.js

echo "[deploy] Staging changes…"
git add -A

# Only commit if there are actual changes
if git diff --staged --quiet; then
    echo "[deploy] No changes since last export — skipping commit"
else
    git commit -m "${LABEL} $(date '+%Y-%m-%d %H:%M')"
    echo "[deploy] Pushing to GitHub…"
    git push origin main
    echo "[deploy] Done — $(date)"
fi
