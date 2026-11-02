# claude-tui: plain `claude`, `claude -c` and `claude -r [id]` open the custom UI (~/claude-tui).
# Anything else (claude -p, claude mcp, claude update, …) goes to Claude Code.
# `claude-code` always opens the original Claude Code interface.
# Enable by adding to ~/.zshrc:   source ~/claude-tui/shell/claude.zsh
claude() {
  case "$1" in
    "")             command claude-tui ;;
    -c|--continue)  if [[ $# -eq 1 ]]; then command claude-tui "$@"; else command claude "$@"; fi ;;
    -r|--resume)    if [[ $# -le 2 ]]; then command claude-tui "$@"; else command claude "$@"; fi ;;
    --mode)         command claude-tui "$@" ;;
    *)              command claude "$@" ;;
  esac
}
claude-code() { command claude "$@"; }
