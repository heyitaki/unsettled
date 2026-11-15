#!/bin/sh
# Release archive for App Store Connect, built from origin/main in a clean temporary
# worktree so the store tag's commit is exactly what the binary was built from (the OTA
# publish script fingerprints that commit's ios/App/, config, key, epoch and plugin
# versions to decide which store builds may take a bundle). Numbered by the UTC time so
# every archive goes up; the same number names the store/ios/<build> tag.
# Built unsigned, then signed ad hoc with each target's entitlements: automatic signing
# wants a development profile first, which Apple refuses to a team with no registered
# devices, and the export (ios:upload) re-signs for distribution with the entitlements
# it finds in the archive's signature, so an unsigned archive would lose the App Group.
set -eu
REPO=$(cd "$(dirname "$0")/.." && git rev-parse --show-toplevel)
cd "$REPO"

# The OTA label counts commits, and fetching into a shallow clone keeps it shallow.
if [ "$(git rev-parse --is-shallow-repository)" = true ]; then
  echo "archive.sh: refusing to archive from a shallow clone (git fetch --unshallow first)" >&2
  exit 1
fi

BUILD=$(date -u +%Y%m%d.%H%M)
TAG="store/ios/$BUILD"
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "archive.sh: tag $TAG already exists; wait a minute and rerun" >&2
  exit 1
fi

git fetch origin main
SHA=$(git rev-parse 'origin/main^{commit}')

TMP=$(mktemp -d "${TMPDIR:-/tmp}/unsettled-archive.XXXXXX")
WT="$TMP/main"
cleanup() {
  git -C "$REPO" worktree remove --force "$WT" 2>/dev/null || true
  git -C "$REPO" worktree prune
  rm -rf "$TMP"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
git worktree add --detach "$WT" "$SHA"

# A store build never carries harness or override settings.
for v in $(env | grep -E '^(UNSETTLED_OTA|VITE_OTA)_[A-Za-z0-9_]*=' | cut -d= -f1); do
  unset "$v"
done

(cd "$WT" && npm ci && npm run ios:build)

# cap sync rewriting a tracked file (Package.swift, say) means the committed ios/App/
# does not describe this binary, so its fingerprint would be wrong.
DIRTY=$(git -C "$WT" status --porcelain --untracked-files=no)
if [ -n "$DIRTY" ]; then
  echo "archive.sh: ios:build changed tracked files on origin/main; commit them first:" >&2
  echo "$DIRTY" >&2
  exit 1
fi

ARCHIVE="$REPO/ios/App/build/Unsettled.xcarchive"
rm -rf "$ARCHIVE"
xcodebuild -project "$WT/ios/App/App.xcodeproj" -scheme App -configuration Release \
  -destination generic/platform=iOS -archivePath "$ARCHIVE" \
  CODE_SIGNING_ALLOWED=NO CURRENT_PROJECT_VERSION="$BUILD" archive
APP="$ARCHIVE/Products/Applications/App.app"
codesign -f -s - --entitlements "$WT/ios/App/ShareExtension/ShareExtension.entitlements" "$APP/PlugIns/ShareExtension.appex"
codesign -f -s - --entitlements "$WT/ios/App/App/App.entitlements" "$APP"

git tag "$TAG" "$SHA"
echo "Archived $SHA as build $BUILD at $ARCHIVE"
echo "After npm run ios:upload succeeds, run: git push origin $TAG"
