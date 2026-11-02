# Figma workflow

`claude-tui --workflow figma` opens three linked Claude sessions (Design, Annotations, Publish) on one Figma file.

Setup and usage: see [Figma workflow](../../README.md#-figma-workflow) in the main README.

## Files
- `workflow.mjs`: settings, panes, pane status, handoffs, the Figma comment/annotation check and PR checks
- `hub-mcp.mjs`: the `workflow` tools each session gets (`status`, `event`, `iteration`, `handoff`, `annotation_done`, `publish_track`)
- `scan-annotations.mjs`: lists Dev Mode annotations by running small scripts inside Figma through Claude Code's Figma plugin
- `prompts/`: each role's instructions

Settings live in `~/.config/claude-tui/workflows/figma/config.json`, state in `.../figma/state/` (delete it to start over).
To make your own workflow, copy this folder to `~/.config/claude-tui/workflows/<name>/` and edit it: a workflow there wins over one with the same name that ships with claude-tui.
