#!/bin/sh
# Builds Argo.app and packages it for a GitHub release:
#   mac/dist/Argo-<version>-<arch>.zip   (what the release should carry)
#   mac/dist/Argo-<version>-<arch>.dmg   (drag-to-Applications image)
#   mac/dist/latest.json                 (signed manifest the in-app updater reads; attach it too)
#   mac/dist/Argo.dmg                    (the same image under a fixed name: the website links to
#                                         releases/latest/download/Argo.dmg, so attach this one too)
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
cp "dist/$NAME.dmg" dist/Argo.dmg
rm -rf "$STAGE"

# The in-app updater installs only a disk image signed with the release key, whose public half is
# compiled into Sources/Argo/Update.swift. latest.json tells installed copies what to fetch.
KEY_FILE="${ARGO_PRIVATE_KEY_FILE:-$HOME/.argo-signing/ed25519.key}"
if [ -f "$KEY_FILE" ]; then
  SIG=$(swift argo-sign.swift sign "$KEY_FILE" "dist/$NAME.dmg")
  PUB=$(grep -m1 'publicKeyBase64 =' Sources/Argo/Update.swift | sed -E 's/.*"([^"]*)".*/\1/')
  # refuse to publish something the app would reject
  swift argo-sign.swift verify "$PUB" "$SIG" "dist/$NAME.dmg" >/dev/null
  cat > dist/latest.json <<JSON
{
  "version": "$VERSION",
  "notes": "",
  "url": "https://github.com/gurshh-rain/argo/releases/download/v$VERSION/$NAME.dmg",
  "signature": "$SIG"
}
JSON
else
  echo "No signing key at $KEY_FILE: latest.json not written, so installed copies will not see this release." >&2
fi
( cd dist && shasum -a 256 "$NAME.zip" "$NAME.dmg" Argo.dmg > SHA256SUMS.txt )
echo
ls -lh dist
echo
cat dist/SHA256SUMS.txt
