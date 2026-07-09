#!/bin/bash
# Builds "Galleria.app" on your Desktop: a one-click launcher with an icon that
# you can drag into the Dock. Re-run it anytime; it just rebuilds the app.
# It bakes THIS clone's location into the launcher, so each person who runs it
# gets an app pointing at their own copy.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd -P)"
APP="$HOME/Desktop/Galleria.app"

echo "Building Galleria.app  (points at: $REPO)"

# Sharp (used to render the icon) ships with the app's dependencies.
if ! node -e "import('sharp')" >/dev/null 2>&1; then
  echo "error: dependencies not installed yet — run 'npm install' first." >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
ICONSET="$WORK/Galleria.iconset"
mkdir -p "$ICONSET"

# 1. Icon: SVG -> the 10 PNG sizes -> .icns
node "$SCRIPT_DIR/make-icon.mjs" "$SCRIPT_DIR/icon.svg" "$ICONSET"
iconutil -c icns "$ICONSET" -o "$WORK/galleria.icns"

# 2. Bundle skeleton
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$WORK/galleria.icns" "$APP/Contents/Resources/galleria.icns"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Galleria</string>
  <key>CFBundleDisplayName</key><string>Galleria</string>
  <key>CFBundleIdentifier</key><string>co.maistudio.galleria.launcher</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>galleria</string>
  <key>CFBundleIconFile</key><string>galleria</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
</dict>
</plist>
PLIST

# 3. The launcher itself. Builds the web app, then EXECs the server so node IS the
#    app's process — quitting the app (Dock -> Quit, or force-quit) kills node
#    directly and frees the port. A Terminal-like PATH makes node/npm resolvable.
cat > "$APP/Contents/MacOS/galleria" <<LAUNCH
#!/bin/zsh
export PATH="\$(/bin/zsh -lc 'echo \$PATH' 2>/dev/null):/opt/homebrew/bin:/usr/local/bin:\$HOME/.npm-global/bin:\$PATH"
cd "$REPO" || exit 1
npm run build -w web || exit 1
exec node_modules/.bin/tsx server/src/index.ts
LAUNCH
chmod +x "$APP/Contents/MacOS/galleria"

# 4. Nudge Finder to notice the new icon
touch "$APP"

echo "Done -> $APP"
echo "Double-click it, or drag it into your Dock."
