// Workflows: a module that opens a fixed set of linked panes and drives them.
// `claude-tui --workflow <name>` loads ~/.config/claude-tui/workflows/<name>/workflow.mjs
// (your own), or else the one that ships with claude-tui in workflows/<name>/.
// The module lists the panes (role, agent, folder, extra instructions, extra MCP tools)
// and gets a small API to show status on each pane and hand it messages.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AgentKind } from "./backends/types.js";

export type WorkflowPane = {
  /** A short id the workflow uses to address the pane ("design", "publish"…). */
  role: string;
  agent?: AgentKind;
  cwd: string;
  /** Shown as the pane's name in its title bar. */
  title: string;
  /** Session to resume (the workflow keeps these between runs). */
  resume?: string;
  /** Claude only: appended to Claude Code's system prompt. */
  appendSystemPrompt?: string;
  /** Claude only: extra MCP servers for this pane (Agent SDK format). */
  mcpServers?: Record<string, unknown>;
  /** Claude only: tools that run without asking (e.g. "mcp__workflow__status"). */
  allowedTools?: string[];
};

export type Chip = { text: string; color?: string } | null;

export type WorkflowApi = {
  /** The line under a pane's title (null clears it). */
  setBanner(role: string, banner: Chip): void;
  /** The short status after the pane's name in its title (null clears it). */
  setStatus(role: string, chip: Chip): void;
  /** Send the pane a prompt as soon as it's idle (queued while it works). */
  send(role: string, text: string): void;
  /** Called with each pane's session id once its session starts. */
  onSession(cb: (role: string, sessionId: string) => void): void;
  /** Called whenever a pane finishes a turn. */
  onTurnDone(cb: (role: string) => void): void;
};

export type Workflow = {
  name: string;
  panes: WorkflowPane[];
  /** Runs once the panes are on screen; may return a cleanup function. */
  start?(api: WorkflowApi): void | (() => void);
};

export const WORKFLOWS_DIR = path.join(os.homedir(), ".config", "claude-tui", "workflows");
/** Workflows that ship with claude-tui: <app>/workflows (src/ and dist/ both sit one level down). */
const BUNDLED_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "workflows");

const names = (dir: string) => {
  try { return fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, "workflow.mjs"))); } catch { return []; }
};

/** --workflow <name> from the command line, if any. */
export function workflowArg(argv: string[]): string | undefined {
  const i = argv.indexOf("--workflow");
  const v = i !== -1 ? argv[i + 1] : undefined;
  return v && !v.startsWith("-") ? v : undefined;
}

export async function loadWorkflow(name: string): Promise<Workflow> {
  const file = [WORKFLOWS_DIR, BUNDLED_DIR].map((d) => path.join(d, name, "workflow.mjs")).find((f) => fs.existsSync(f));
  if (!file) {
    const all = [...new Set([...names(BUNDLED_DIR), ...names(WORKFLOWS_DIR)])];
    throw new Error(`No workflow "${name}".${all.length ? ` Available: ${all.join(", ")}` : ""}`);
  }
  const mod = await import(pathToFileURL(file).href);
  const wf = (mod.default ?? mod) as Workflow;
  if (!wf?.panes?.length) throw new Error(`Workflow "${name}" has no panes`);
  return wf;
}
