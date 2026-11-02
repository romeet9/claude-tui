#!/usr/bin/env bash
# Installs claude-tui from the latest GitHub release. No Node or npm needed:
# the release carries its own runtime.
#
#   curl -fsSL https://github.com/romeet9/claude-tui/releases/latest/download/install.sh | bash
#
# Installs to ~/.claude-tui and links ~/.local/bin/claude-tui.
# Uninstall: rm -rf ~/.claude-tui ~/.local/bin/claude-tui
set -euo pipefail

REPO="romeet9/claude-tui"
DEST="${CLAUDE_TUI_HOME:-$HOME/.claude-tui}"
BIN_DIR="$HOME/.local/bin"
# CLAUDE_TUI_TARBALL=/path/to/file.tar.gz installs a local build instead of downloading.
LOCAL="${CLAUDE_TUI_TARBALL:-}"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
miss() { printf '  \033[33m–\033[0m %s\n' "$*"; }
die() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = Darwin ] || die "claude-tui runs on macOS."
[ "$(uname -m)" = arm64 ] || die "This release is for Apple Silicon Macs (M1 or later)."

bold "Installing claude-tui"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [ -n "$LOCAL" ]; then
  cp "$LOCAL" "$TMP/claude-tui.tar.gz"
else
  # The newest release's macOS asset.
  URL="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
    | grep -o '"browser_download_url": *"[^"]*macos-arm64\.tar\.gz"' | head -1 | sed 's/.*"\(http[^"]*\)"/\1/')"
  [ -n "$URL" ] || die "Couldn't find a macOS release of $REPO."
  echo "  downloading $(basename "$URL")"
  curl -fSL --progress-bar "$URL" -o "$TMP/claude-tui.tar.gz"
  curl -fsSL "$URL.sha256" -o "$TMP/sum" && {
    [ "$(awk '{print $1}' "$TMP/sum")" = "$(shasum -a 256 "$TMP/claude-tui.tar.gz" | awk '{print $1}')" ] || die "Checksum mismatch; try again."
    ok "checksum verified"
  }
fi

tar -xzf "$TMP/claude-tui.tar.gz" -C "$TMP"
rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
mv "$TMP/claude-tui" "$DEST"
# Files from a browser download carry a quarantine flag; the bundled runtime won't start with it.
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true
mkdir -p "$BIN_DIR"
ln -sf "$DEST/bin/claude-tui" "$BIN_DIR/claude-tui"
ok "installed claude-tui $(cat "$DEST/VERSION") in ${DEST/#$HOME/~}"

case ":$PATH:" in
  *":$BIN_DIR:"*) ok "claude-tui is on your PATH" ;;
  *)
    RC="$HOME/.zshrc"; [ "${SHELL##*/}" = bash ] && RC="$HOME/.bash_profile"
    if ! grep -qs 'claude-tui: PATH' "$RC"; then
      printf '\n# claude-tui: PATH\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$RC"
    fi
    ok "added ~/.local/bin to PATH in ${RC/#$HOME/~} (open a new terminal tab)"
    ;;
esac

echo
bold "Agents"
# The Claude engine ships inside claude-tui; it uses Claude Code's sign-in (or ANTHROPIC_API_KEY).
if command -v claude >/dev/null 2>&1 || [ -d "$HOME/.claude" ]; then ok "Claude: built in, uses your Claude Code sign-in"
else miss "Claude: built in; sign in once with Claude Code (https://claude.com/claude-code) or set ANTHROPIC_API_KEY"; fi
if command -v codex >/dev/null 2>&1; then ok "Codex: found"; else miss "Codex: not found (brew install codex, then codex login)"; fi
if command -v agy >/dev/null 2>&1; then ok "Antigravity: found"; else miss "Antigravity: not found (install the Antigravity CLI to use it)"; fi
if command -v gh >/dev/null 2>&1; then ok "GitHub panel: gh found"; else miss "GitHub panel: needs gh (brew install gh, then gh auth login)"; fi

echo
bold "Run it"
echo "  claude-tui           in any project folder"
echo "  claude-tui demo      a tour with made-up data, no accounts needed"
