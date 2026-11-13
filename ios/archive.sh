#!/bin/sh
# Release archive for App Store Connect, numbered by the UTC time so every archive goes up.
# Built unsigned, then signed ad hoc with each target's entitlements: automatic signing
# wants a development profile first, which Apple refuses to a team with no registered
# devices, and the export (ios:upload) re-signs for distribution with the entitlements
# it finds in the archive's signature, so an unsigned archive would lose the App Group.
set -eu
cd "$(dirname "$0")"
ARCHIVE=App/build/Unsettled.xcarchive
rm -rf "$ARCHIVE"
xcodebuild -project App/App.xcodeproj -scheme App -configuration Release \
  -destination generic/platform=iOS -archivePath "$ARCHIVE" \
  CODE_SIGNING_ALLOWED=NO CURRENT_PROJECT_VERSION="$(date -u +%Y%m%d.%H%M)" archive
APP="$ARCHIVE/Products/Applications/App.app"
codesign -f -s - --entitlements App/ShareExtension/ShareExtension.entitlements "$APP/PlugIns/ShareExtension.appex"
codesign -f -s - --entitlements App/App/App.entitlements "$APP"
