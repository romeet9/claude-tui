#!/usr/bin/env bash
# Builds a self-contained macOS release: the app bundled with esbuild, production
# dependencies, the official Node runtime and the prebuilt voice helper.
# Users need nothing else: install.sh downloads and links it.
#
#   scripts/build-release.sh        → release/claude-tui-<version>-macos-arm64.tar.gz (+ .sha256)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('$ROOT/package.json').version")"
NODE_VERSION="v26.7.0"
ARCH="arm64"
NAME="claude-tui-$VERSION-macos-$ARCH"
OUT="$ROOT/release"
WORK="$(mktemp -d)"
STAGE="$WORK/claude-tui"
trap 'rm -rf "$WORK"' EXIT

[ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = "$ARCH" ] || { echo "Build on an Apple Silicon Mac."; exit 1; }
echo "▸ claude-tui $VERSION for macOS $ARCH (Node $NODE_VERSION)"

echo "▸ typecheck + bundle"
cd "$ROOT"
npx tsc --noEmit
mkdir -p "$STAGE/app/dist"
# Everything is bundled except the Agent SDK, which carries the Claude engine binary.
# terminal-image (image previews, never used here, 88 MB of jimp) and React DevTools are stubbed.
npx esbuild src/app.tsx --bundle --platform=node --format=esm --target=node20 --jsx=automatic --log-level=warning \
  --external:@anthropic-ai/claude-agent-sdk \
  --alias:terminal-image=./scripts/stubs/terminal-image.mjs \
  --alias:react-devtools-core=./scripts/stubs/react-devtools-core.mjs \
  --banner:js="import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" \
  --outfile="$STAGE/app/dist/app.mjs"

echo "▸ app files"
cp LICENSE README.md "$STAGE/app/"
SDK_VERSION="$(node -p "require('$ROOT/node_modules/@anthropic-ai/claude-agent-sdk/package.json').version")"
cat > "$STAGE/app/package.json" <<EOF
{ "name": "claude-tui", "version": "$VERSION", "type": "module", "private": true,
  "dependencies": { "@anthropic-ai/claude-agent-sdk": "$SDK_VERSION" } }
EOF
mkdir -p "$STAGE/app/scripts" "$STAGE/app/voice"
cp scripts/demo.mjs "$STAGE/app/scripts/"
cp voice/main.swift voice/Info.plist "$STAGE/app/voice/"
cp -R workflows "$STAGE/app/workflows"

echo "▸ voice helper"
swiftc -O voice/main.swift -o "$STAGE/app/voice/claude-tui-voice" \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker voice/Info.plist 2>/dev/null
touch "$STAGE/app/voice/claude-tui-voice"   # newer than main.swift, so it's never rebuilt

echo "▸ production dependencies"
(cd "$STAGE/app" && npm install --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error)

echo "▸ Node runtime"
TARBALL="node-$NODE_VERSION-darwin-$ARCH.tar.gz"
curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/$TARBALL" -o "$WORK/$TARBALL"
EXPECTED="$(curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" | awk -v f="$TARBALL" '$2 == f { print $1 }')"
ACTUAL="$(shasum -a 256 "$WORK/$TARBALL" | awk '{ print $1 }')"
[ -n "$EXPECTED" ] && [ "$EXPECTED" = "$ACTUAL" ] || { echo "Node checksum mismatch"; exit 1; }
mkdir -p "$STAGE/runtime"
tar -xzf "$WORK/$TARBALL" -C "$WORK"
cp "$WORK/node-$NODE_VERSION-darwin-$ARCH/bin/node" "$STAGE/runtime/node"
cp "$WORK/node-$NODE_VERSION-darwin-$ARCH/LICENSE" "$STAGE/runtime/NODE-LICENSE"

echo "▸ launcher"
mkdir -p "$STAGE/bin"
cat > "$STAGE/bin/claude-tui" <<'EOF'
#!/bin/sh
# claude-tui launcher: the bundled Node runs the bundled app. `claude-tui demo` opens the demo.
SELF="$0"
while [ -L "$SELF" ]; do
  LINK="$(readlink "$SELF")"
  case "$LINK" in /*) SELF="$LINK" ;; *) SELF="$(dirname "$SELF")/$LINK" ;; esac
done
DIR="$(cd "$(dirname "$SELF")/.." && pwd)"
if [ "$1" = "demo" ]; then
  shift
  exec "$DIR/runtime/node" "$DIR/app/scripts/demo.mjs" "$@"
fi
if [ "$1" = "--version" ] || [ "$1" = "-v" ]; then
  echo "claude-tui $(cat "$DIR/VERSION")"
  exit 0
fi
exec "$DIR/runtime/node" "$DIR/app/dist/app.mjs" "$@"
EOF
chmod +x "$STAGE/bin/claude-tui"
echo "$VERSION" > "$STAGE/VERSION"

echo "▸ package"
mkdir -p "$OUT"
tar -czf "$OUT/$NAME.tar.gz" -C "$WORK" claude-tui
(cd "$OUT" && shasum -a 256 "$NAME.tar.gz" > "$NAME.tar.gz.sha256")
cp "$ROOT/scripts/install.sh" "$OUT/install.sh"
echo "✓ $OUT/$NAME.tar.gz ($(du -h "$OUT/$NAME.tar.gz" | cut -f1))"
