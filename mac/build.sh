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
cp -R ../orchestrator/src ../orchestrator/package.json "$APP/Contents/Resources/orchestrator/"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Argo</string>
  <key>CFBundleDisplayName</key><string>Argo</string>
  <key>CFBundleIdentifier</key><string>dev.argo.mac</string>
  <key>CFBundleExecutable</key><string>Argo</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
codesign --force --sign - "$APP" >/dev/null 2>&1 || true
echo "Built $APP"
