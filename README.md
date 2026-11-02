<br/>
<p align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/logo-inverse.svg">
  <source media="(prefers-color-scheme: light)" srcset="./docs/logo.svg">
  <img width="132px" alt="claude-tui logo" src="./docs/logo.svg">
</picture>
</p>

<h3 align="center">claude-tui</h3>
<p align="center">A full-screen terminal workspace for coding agents.<br/>Run <b>Claude Code</b>, <b>Codex</b> and <b>Antigravity</b> side by side.</p>

<br/>

<p align="center">
  <img alt="Claude Code" src="https://img.shields.io/badge/Claude_Code-Agent_SDK-d97757?style=for-the-badge&labelColor=3b2219&logo=anthropic&logoColor=d97757"> &nbsp;<img alt="Codex" src="https://img.shields.io/badge/Codex-app--server-f5f5f5?style=for-the-badge&labelColor=111111&logo=gnubash&logoColor=ffffff"> &nbsp;<img alt="Antigravity" src="https://img.shields.io/badge/Antigravity-agy-4c8df6?style=for-the-badge&labelColor=17264a&logo=google&logoColor=4c8df6">
</p>
<p align="center">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-Ink_8-3178c6?style=for-the-badge&labelColor=0f2a4a&logo=typescript&logoColor=ffffff"> &nbsp;<img alt="macOS" src="https://img.shields.io/badge/macOS-Terminal-333333?style=for-the-badge&labelColor=111111&logo=apple&logoColor=ffffff"> &nbsp;<a href="./LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/License-MIT-15803d?style=for-the-badge&labelColor=14532d"></a>
</p>

<h1 aria-hidden="true"></h1>

<br/>

<p align="center">
  <img alt="claude-tui running Claude Code, Codex and Antigravity in a bento grid" src="./docs/demo.gif" width="100%">
</p>

<p align="center"><sub>Recorded from the real UI in demo mode: the projects, chats and GitHub activity are made up.</sub></p>

<br/>

## ✨ Features

- **Three agents, one screen.** Every pane runs its own agent: Claude Code (through the Agent SDK, with your settings, CLAUDE.md, hooks and plugins), Codex (`codex app-server`) or Antigravity (`agy`). <kbd>Ctrl</kbd> <kbd>N</kbd> asks which one.
- **Bento grid.** Panes fill the screen in rows of two; an odd one out spans the row. Move a pane up or down, resize the columns together, never scroll sideways.
- **Workspaces sidebar.** Your projects in `~/Claude Workspaces`, with each folder's sessions from all three agents (◦ Claude · ◆ Codex · ▲ Antigravity) and nested subfolders. Click a session to resume it in the right CLI.
- **Usage that follows focus.** Click a pane and the Usage card shows that agent's 5-hour and weekly limits.
- **Permission prompts that stay out of the way.** <kbd>y</kbd> / <kbd>a</kbd> / <kbd>n</kbd> for Claude and Codex approvals; <kbd>Shift</kbd> <kbd>Tab</kbd> changes the mode and the status line updates instantly.
- **GitHub in reach.** <kbd>Ctrl</kbd> <kbd>T</kbd> opens your GitHub activity, PRs, issues and CI beside the panes; <kbd>Ctrl</kbd> <kbd>G</kbd> drives your real Chrome through Browser MCP.
- **Made for the terminal.** Brand-colored pane tags, pixel agent icons, 12 themes (`/theme`), rebindable keys (`/keys`), mouse support and voice typing (<kbd>Ctrl</kbd> <kbd>V</kbd>, macOS speech recognition).

## 📥 Install

One line, on an Apple Silicon Mac. No Node or npm needed: the release carries its own runtime and the Claude engine.

```bash
curl -fsSL https://github.com/romeet9/claude-tui/releases/latest/download/install.sh | bash
```

Then run `claude-tui` in any project folder, or `claude-tui demo` for a tour with made-up data.
It installs to `~/.claude-tui` and links `~/.local/bin/claude-tui`; to uninstall, delete both.

| To use | You need |
| --- | --- |
| Claude | Nothing extra; sign in once with [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (or set `ANTHROPIC_API_KEY`) |
| Codex | The [Codex CLI](https://github.com/openai/codex), signed in (`codex login`) |
| Antigravity | The Antigravity CLI (`agy`), signed in |
| GitHub panel | The [GitHub CLI](https://cli.github.com) (`gh auth login`) |

## 🛠️ From source

**Requirements:** macOS, Node 20+, and the agent CLIs you want to use, signed in:
[Claude Code](https://docs.anthropic.com/en/docs/claude-code) · [Codex](https://github.com/openai/codex) · Antigravity (`agy`).
The GitHub panel uses the [GitHub CLI](https://cli.github.com) (`gh auth login`).

```bash
git clone https://github.com/romeet9/claude-tui.git
cd claude-tui
npm install
npm link            # adds the claude-tui command

claude-tui                  # in any project folder
claude-tui --agent codex    # first pane runs Codex (or --agent agy)
claude-tui -c               # continue the last session here
claude-tui --fresh          # ignore the saved layout
```

Try it without any agents or accounts: `npm run demo` opens the UI with made-up projects and scripted replies, in a throwaway home folder.

## ⌨️ Keys

| Keys | Does |
| --- | --- |
| <kbd>Ctrl</kbd> <kbd>N</kbd> | New pane: pick Claude, Codex or Antigravity (<kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd>) |
| <kbd>Shift</kbd> <kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd> | Focus the previous / next pane, or the one above / below |
| <kbd>Ctrl</kbd> <kbd>Y</kbd> / <kbd>Ctrl</kbd> <kbd>D</kbd> | Move the focused pane up / down the grid |
| <kbd>Ctrl</kbd> <kbd>K</kbd> / <kbd>Ctrl</kbd> <kbd>L</kbd> | Narrow / widen the left column (or drag the edge between panes) |
| <kbd>Ctrl</kbd> <kbd>W</kbd> | Focus the sidebar and back |
| <kbd>Ctrl</kbd> <kbd>P</kbd> / <kbd>Ctrl</kbd> <kbd>X</kbd> | Pause / close a pane (it stays resumable from the sidebar) |
| <kbd>Shift</kbd> <kbd>Tab</kbd> | Permission mode: default → accept edits → plan → auto |
| <kbd>Ctrl</kbd> <kbd>T</kbd> / <kbd>Ctrl</kbd> <kbd>G</kbd> | GitHub / browser panel |
| <kbd>Ctrl</kbd> <kbd>E</kbd> | Show every tool call instead of one summary line |
| <kbd>Ctrl</kbd> <kbd>V</kbd> | Voice typing |
| <kbd>/</kbd> | Commands: `/theme` `/model` `/mcp` `/keys` `/font` `/new` |

Every shortcut can be changed with `/keys`.

## 🤖 Agents

| | Claude Code | Codex | Antigravity |
| --- | --- | --- | --- |
| Runs through | Agent SDK | `codex app-server` (JSON-RPC) | `agy` print mode, stream-json |
| Permission prompts | ✅ y / a / n | ✅ commands and file changes | ➖ headless agy can't ask; the pane lists what it denied |
| <kbd>Shift</kbd> <kbd>Tab</kbd> modes | ✅ | ✅ mapped to approval policy + sandbox | ✅ mapped to `--mode` |
| `/model` | ✅ | ✅ | ✅ |
| Plan usage card | ✅ | ✅ | ✅ (from `agy /usage`) |
| Resume from the sidebar | ✅ full history | ✅ full history | ✅ (your prompts shown) |
| `/mcp`, cost | ✅ | ➖ | ➖ |

## 📦 Project structure

| Path | What it is |
| --- | --- |
| [`src/app.tsx`](./src/app.tsx) | Root: layout, bento grid, keys, mouse |
| [`src/Chat.tsx`](./src/Chat.tsx) | One pane: transcript, prompt, permission box, status line |
| [`src/backends/`](./src/backends/) | One adapter per agent; all emit the same message stream |
| [`src/Sidebar.tsx`](./src/Sidebar.tsx) | Workspaces tree with every agent's sessions |
| [`src/GitHub.tsx`](./src/GitHub.tsx) | GitHub panel (account or repo: activity, PRs, issues, CI) |
| [`src/demo.ts`](./src/demo.ts) | Demo mode: made-up data and scripted replies |
| [`voice/main.swift`](./voice/main.swift) | Speech-to-text helper, compiled on first use |
| [`scripts/record-demo.py`](./scripts/record-demo.py) | Records `docs/demo.gif` from the real UI |

## 📦 Building a release

```bash
scripts/build-release.sh    # release/claude-tui-<version>-macos-arm64.tar.gz + install.sh
gh release create v1.0.0 release/*
```

The build bundles the app with esbuild, adds the official Node runtime (checksum-verified) and the prebuilt voice helper.

## 🎬 Re-recording the demo

```bash
pip install pyte pillow     # and ffmpeg
npm run record-demo         # writes docs/demo.gif and docs/screenshot.png
```

The script runs demo mode in a virtual terminal, clicks and types through it, and draws each frame in a macOS window.

## 📝 License

[MIT](./LICENSE). Claude, Codex and Antigravity are trademarks of their owners; claude-tui is an independent project and isn't affiliated with Anthropic, OpenAI or Google.

<h1 aria-hidden="true"></h1>

<p align="center">Built in the terminal, with the agents it runs. 🖥️</p>
