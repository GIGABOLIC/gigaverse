#!/bin/bash
# GigaVerse daily deploy — runs via cron at 3am
# Exports data from platform.db and pushes to GitHub Pages

set -e
cd "$(dirname "$0")"

echo "[deploy] Starting export — $(date)"
node export.js

echo "[deploy] Staging changes…"
git add -A

# Only commit if there are actual changes
if git diff --staged --quiet; then
    echo "[deploy] No changes since last export — skipping commit"
else
    git commit -m "Daily export $(date '+%Y-%m-%d')"
    echo "[deploy] Pushing to GitHub…"
    git push origin main
    echo "[deploy] Done — $(date)"
fi
