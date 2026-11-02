#!/usr/bin/env node
// Runs claude-tui in demo mode inside a throwaway home folder: made-up workspaces,
// sessions, replies, GitHub activity and memories. Your real settings, chats and
// layout are never read or written.  Usage: node scripts/demo.mjs [extra args]
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "claude-tui-demo-")));
const ws = path.join(home, "Claude Workspaces");
const tree = {
  "Acme · Web App": ["src", "tests", "public"],
  "Acme · Design System": ["tokens", "components"],
  "Personal · Blog": ["posts"],
  "Research · Agents": [],
};
for (const [name, subs] of Object.entries(tree)) {
  for (const sub of ["", ...subs]) fs.mkdirSync(path.join(ws, name, sub), { recursive: true });
}
const app = path.join(ws, "Acme · Web App");
try {
  execFileSync("git", ["init", "-q", "-b", "feat/dark-mode"], { cwd: app });
} catch {}

// A release build runs dist/app.mjs on the bundled Node; a checkout runs the sources through tsx.
const built = path.join(root, "dist", "app.mjs");
const [cmd, entry] = fs.existsSync(built)
  ? [process.execPath, built]
  : [path.join(root, "node_modules", ".bin", "tsx"), path.join(root, "src", "app.tsx")];
const extra = process.argv.slice(2);
const theme = extra.includes("--theme") ? [] : ["--theme", "figma"];
const child = spawn(cmd, [entry, "--demo", ...theme, ...extra],
  { cwd: app, stdio: "inherit", env: { ...process.env, HOME: home, CLAUDE_TUI_DEMO: "1" } });
child.on("exit", (code) => {
  fs.rmSync(home, { recursive: true, force: true });
  process.exit(code ?? 0);
});
