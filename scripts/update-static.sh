#!/usr/bin/env bash
# Copy the web app's static files (CSS, JS, fonts, images) into bundle/static so the installer
# ships with them and the app can draw its screens before it has ever been online.
#
#   scripts/update-static.sh ../knowly
#
# Run it whenever the website's static files change much; the app also refreshes them from
# motownai.com by itself while online, so an older bundle only matters on a fresh install.
set -euo pipefail
src="${1:?usage: scripts/update-static.sh <path to the knowly repo>}/app/static"
dest="$(cd "$(dirname "$0")/.." && pwd)/bundle/static"
[ -d "$src" ] || { echo "no static folder at $src" >&2; exit 1; }
rm -rf "$dest"
mkdir -p "$dest"
# Marketing images and the service worker aren't used by the app.
(cd "$src" && find . -type f ! -path "./landing-images/*" ! -path "./previews/*" ! -name sw.js ! -name desktop.ini -exec cp --parents {} "$dest" \;)
echo "bundled $(find "$dest" -type f | wc -l) files ($(du -sh "$dest" | cut -f1)) from $(git -C "$src" rev-parse --short HEAD 2>/dev/null || echo '?')"
