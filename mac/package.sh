#!/bin/sh
# Builds Argo.app and packages it for a GitHub release:
#   mac/dist/Argo-<version>-<arch>.zip   (what the release should carry)
#   mac/dist/Argo-<version>-<arch>.dmg   (drag-to-Applications image)
# Usage: mac/package.sh [version]      e.g. mac/package.sh 0.1.0
set -e
cd "$(dirname "$0")"
VERSION="${1:-0.1.0}"
ARCH=$(uname -m)
export VERSION
./build.sh
NAME="Argo-$VERSION-$ARCH"
rm -rf dist && mkdir dist
# ditto keeps the code signature and extended attributes intact, which plain zip does not
ditto -c -k --sequesterRsrc --keepParent build/Argo.app "dist/$NAME.zip"
STAGE=$(mktemp -d)
cp -R build/Argo.app "$STAGE/"
ln -s /Applications "$STAGE/Applications"
hdiutil create -quiet -volname "Argo $VERSION" -srcfolder "$STAGE" -ov -format UDZO "dist/$NAME.dmg"
rm -rf "$STAGE"
( cd dist && shasum -a 256 "$NAME.zip" "$NAME.dmg" > SHA256SUMS.txt )
echo
ls -lh dist
echo
cat dist/SHA256SUMS.txt
