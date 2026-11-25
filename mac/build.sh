#!/bin/sh
# Builds Argo.app with Command Line Tools only (no Xcode needed).
set -e
cd "$(dirname "$0")"
# The macOS 27 SDK needs Xcode's SwiftUI macro plugin; the 26 SDK does not.
if ! xcode-select -p | grep -q Xcode.app; then
  SDK=$(ls -d /Library/Developer/CommandLineTools/SDKs/MacOSX26*.sdk 2>/dev/null | head -1)
  [ -n "$SDK" ] && export SDKROOT="$SDK"
fi
swift build -c release
APP=build/Argo.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/orchestrator"
cp .build/release/Argo "$APP/Contents/MacOS/Argo"
cp Resources/*.png "$APP/Contents/Resources/"
# The editor in file panes is Monaco, the same build the Windows app loads. It is taken from the Windows
# app's packages when they are installed, and otherwise fetched once (pinned, checked by npm) into .build/.
MONACO_VERSION=0.52.2
MONACO=../windows/node_modules/monaco-editor/min/vs
if [ ! -f "$MONACO/loader.js" ] || ! grep -q "\"version\": \"$MONACO_VERSION\"" ../windows/node_modules/monaco-editor/package.json 2>/dev/null; then
  CACHE=.build/monaco-$MONACO_VERSION
  if [ ! -f "$CACHE/min/vs/loader.js" ]; then
    mkdir -p "$CACHE"
    npm pack "monaco-editor@$MONACO_VERSION" --pack-destination "$CACHE" >/dev/null
    tar -xzf "$CACHE/monaco-editor-$MONACO_VERSION.tgz" -C "$CACHE" --strip-components 1 package/min
    rm -f "$CACHE/monaco-editor-$MONACO_VERSION.tgz"
  fi
  MONACO=$CACHE/min/vs
fi
mkdir -p "$APP/Contents/Resources/editor"
cp Resources/editor/index.html "$APP/Contents/Resources/editor/"
# the translations of Monaco's own menus are not used
rsync -a --exclude 'nls.messages.*.js' "$MONACO/" "$APP/Contents/Resources/editor/vs/"
cp -R ../orchestrator/src ../orchestrator/package.json "$APP/Contents/Resources/orchestrator/"
# the icon is generated from the logo with: swift make-icon.swift ../web/public/argo.png
cp AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Argo</string>
  <key>CFBundleDisplayName</key><string>Argo</string>
  <key>CFBundleIdentifier</key><string>dev.argo.mac</string>
  <key>CFBundleExecutable</key><string>Argo</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION:-0.1.0}</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
codesign --force --sign - "$APP" >/dev/null 2>&1 || true
echo "Built $APP"
