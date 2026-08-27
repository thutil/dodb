#!/usr/bin/env bash
# Builds dodb.app and dodb_<version>_universal.dmg.
#
# Replaces what tauri-apps/tauri-action did in one step. Everything here was
# implicit under Tauri's bundler and has to be explicit now: the .app layout,
# Info.plist, the universal lipo, and the DMG.
#
# Signing is opt-in through the same environment variables the existing
# release.yml already exports, so an unsigned local build works and CI signs
# without a second code path.
#
#   APPLE_SIGNING_IDENTITY   codesign identity; unset means ad-hoc
#   APPLE_ID / APPLE_PASSWORD / APPLE_TEAM_ID   all three set means notarize
#
# Usage: scripts/build-macos.sh [version]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

VERSION="${1:-$(node -p "require('./package.json').version" 2>/dev/null || echo 0.0.0-dev)}"
DIST="$REPO_ROOT/dist"
APP="$DIST/dodb.app"
# The name is load-bearing: Casks/dodb.rb and the update-homebrew-cask job both
# hardcode dodb_<version>_universal.dmg.
DMG="$DIST/dodb_${VERSION}_universal.dmg"

echo "==> building dodb $VERSION"
rm -rf "$DIST"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

echo "==> frontend"
pnpm build:ui

# assets.go embeds ui/out at compile time, so the frontend must be built first.
echo "==> go binaries"
LDFLAGS="-X main.version=${VERSION}"
build_arch() {
    local goarch="$1" out="$2"
    echo "    ${goarch}"
    # CGO is required: the SQLite driver needs it, and so does SpatiaLite
    # extension loading. That rules out a pure cross-compile, but the macOS SDK
    # is universal so clang can target either arch from this host.
    CGO_ENABLED=1 GOOS=darwin GOARCH="$goarch" \
        CGO_CFLAGS="-mmacosx-version-min=11.0" \
        CGO_LDFLAGS="-mmacosx-version-min=11.0" \
        go build -trimpath -ldflags "$LDFLAGS" -o "$out" ./cmd/dodb
}

build_arch arm64 "$DIST/dodb-arm64"
if build_arch amd64 "$DIST/dodb-amd64"; then
    echo "==> lipo universal"
    lipo -create -output "$APP/Contents/MacOS/dodb" "$DIST/dodb-arm64" "$DIST/dodb-amd64"
else
    # Reported rather than silently shipping a single-arch binary under a name
    # that promises universal.
    echo "!!  amd64 build failed; shipping arm64 only (the DMG name still says universal)" >&2
    cp "$DIST/dodb-arm64" "$APP/Contents/MacOS/dodb"
fi
rm -f "$DIST/dodb-arm64" "$DIST/dodb-amd64"
chmod +x "$APP/Contents/MacOS/dodb"
lipo -archs "$APP/Contents/MacOS/dodb"

echo "==> bundle"
sed "s/{{VERSION}}/${VERSION}/g" build/darwin/Info.plist > "$APP/Contents/Info.plist"

# The .icns is generated from assets/icon.png rather than checked in: Tauri's
# bundler used to own the icon set, and keeping a second binary copy in the repo
# only invites the two drifting apart.
if [ -f build/darwin/icon.icns ]; then
    cp build/darwin/icon.icns "$APP/Contents/Resources/icon.icns"
elif [ -f assets/icon.png ]; then
    ICONSET="$DIST/icon.iconset"
    mkdir -p "$ICONSET"
    for size in 16 32 128 256 512; do
        sips -z $size $size assets/icon.png --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
        sips -z $((size * 2)) $((size * 2)) assets/icon.png \
            --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
    done
    iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/icon.icns"
    rm -rf "$ICONSET"
    echo "    icon generated from assets/icon.png"
else
    # Said out loud: an app with no icon is a Finder generic document, which
    # looks broken enough that people assume the build failed.
    echo "!!  no icon: assets/icon.png is missing" >&2
fi

echo "==> codesign"
if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
    codesign --force --deep --options runtime --timestamp \
        --entitlements build/darwin/entitlements.plist \
        --sign "$APPLE_SIGNING_IDENTITY" "$APP"
else
    # Ad-hoc, which is what the current Tauri releases already ship. Gatekeeper
    # still refuses first launch; see docs/SIGNING.md.
    echo "    APPLE_SIGNING_IDENTITY unset - signing ad-hoc"
    codesign --force --deep --options runtime \
        --entitlements build/darwin/entitlements.plist \
        --sign - "$APP"
fi
codesign --verify --verbose=2 "$APP" 2>&1 | tail -2

echo "==> dmg"
STAGE="$DIST/stage"
mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "dodb" -srcfolder "$STAGE" -ov -format UDZO -fs HFS+ "$DMG" >/dev/null
rm -rf "$STAGE"

if [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; then
    echo "==> notarize"
    xcrun notarytool submit "$DMG" --apple-id "$APPLE_ID" \
        --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" --wait
    xcrun stapler staple "$DMG"
else
    echo "    notarization skipped (APPLE_ID / APPLE_PASSWORD / APPLE_TEAM_ID not all set)"
fi

echo
echo "built:"
echo "  $APP"
echo "  $DMG  ($(du -h "$DMG" | cut -f1))"
shasum -a 256 "$DMG"
