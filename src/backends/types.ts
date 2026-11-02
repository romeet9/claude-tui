// One chat pane talks to one agent: Claude Code (Agent SDK), Codex (app-server) or
// Antigravity (agy print mode). Every backend turns its own protocol into the same
// stream of SDK-shaped messages, so the transcript, tool cards and status line work
// the same for all three. Things only one agent has are optional methods.
import type {
  PermissionMode,
  PermissionResult,
  PermissionUpdate,
  SDKMessage,
  SlashCommand,
} from "@anthropic-ai/claude-agent-sdk";
import type { Limits } from "../Usage.js";

export type AgentKind = "claude" | "codex" | "agy";

export type AgentMeta = {
  kind: AgentKind; name: string; short: string; glyph: string; key: string; blurb: string;
  /** The tag on each pane's title bar. */
  tag: string;
  /** Brand accent on dark and on light backgrounds. */
  brand: { dark: string; light: string };
};
export const AGENTS: AgentMeta[] = [
  { kind: "claude", name: "Claude Code", short: "claude", glyph: "✻", key: "1", blurb: "Agent SDK · your Claude Code setup",
    tag: "CLAUDE", brand: { dark: "#d97757", light: "#c15f3c" } },
  { kind: "codex", name: "Codex", short: "codex", glyph: "◆", key: "2", blurb: "OpenAI Codex CLI (codex app-server)",
    tag: "CODEX", brand: { dark: "#f5f5f5", light: "#1f1f1f" } },
  { kind: "agy", name: "Antigravity", short: "agy", glyph: "▲", key: "3", blurb: "Antigravity CLI (agy, headless)",
    tag: "AGY", brand: { dark: "#4c8df6", light: "#1a63d8" } },
];
export const agentInfo = (k: AgentKind | undefined) => AGENTS.find((a) => a.kind === (k ?? "claude"))!;

/** A tool call waiting on the user's yes/no, surfaced to the UI. */
export type PendingPermission = {
  toolName: string;
  input: Record<string, unknown>;
  reason?: string;
  suggestions?: PermissionUpdate[];
  /** Whether "a" (allow for the rest of the session) means anything for this agent. */
  canAlways?: boolean;
  resolve: (result: PermissionResult) => void;
};

/**
 * Extra events the non-Claude backends emit next to the SDK message types:
 * transcript notes, context %, and plan usage.
 */
export type TuiEvent =
  | { type: "tui"; kind: "info" | "error"; text: string }
  | { type: "tui"; kind: "ctx"; pct: number }
  | { type: "tui"; kind: "limits"; limits: Limits }
  | { type: "tui"; kind: "model"; model: string };

export type AgentEvent = SDKMessage | TuiEvent;

export type ModelChoice = { value: string; displayName: string; description: string; resolvedModel?: string };
export type McpStatus = { name: string; status: string; tools?: unknown[]; error?: string };

export interface AgentSession extends AsyncIterable<AgentEvent> {
  readonly kind: AgentKind;
  send(text: string): void;
  interrupt(): Promise<void>;
  close(): void;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  /** Past messages of a resumed session, SDK-shaped (fed to messageToItems with history=true). */
  history?(): Promise<any[]>;
  supportedCommands?(): Promise<SlashCommand[]>;
  supportedModels?(): Promise<ModelChoice[]>;
  setModel?(model: string): Promise<void>;
  mcpServerStatus?(): Promise<McpStatus[]>;
  reconnectMcpServer?(name: string): Promise<void>;
  toggleMcpServer?(name: string, enable: boolean): Promise<void>;
  getContextUsage?(): Promise<{ percentage: number }>;
  /** Plan usage (5-hour / weekly), read on demand. */
  readLimits?(): Promise<Limits | null>;
}

export type StartOptions = {
  cwd: string;
  mode: PermissionMode;
  resume?: string;
  onPermission: (p: PendingPermission) => void;
  /** Claude only (workflows): extra instructions and MCP servers for this pane. */
  extra?: { appendSystemPrompt?: string; mcpServers?: Record<string, unknown>; allowedTools?: string[] };
};

/** An async queue: producers push, the UI's for-await reads. */
export class EventQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private wake?: () => void;
  private done = false;
  push(x: T) {
    this.items.push(x);
    this.wake?.();
  }
  end() {
    this.done = true;
    this.wake?.();
  }
  async *[Symbol.asyncIterator]() {
    while (true) {
      while (this.items.length) yield this.items.shift()!;
      if (this.done) return;
      await new Promise<void>((r) => (this.wake = r));
      this.wake = undefined;
    }
  }
}

/** Builders for the SDK-shaped messages the transcript understands. */
export const msg = {
  init: (session_id: string, model: string, permissionMode: PermissionMode): any => ({
    type: "system", subtype: "init", session_id, model, permissionMode,
  }),
  delta: (text: string): any => ({
    type: "stream_event", parent_tool_use_id: null,
    event: { type: "content_block_delta", delta: { type: "text_delta", text } },
  }),
  text: (text: string): any => ({
    type: "assistant", parent_tool_use_id: null, message: { role: "assistant", content: [{ type: "text", text }] },
  }),
  toolUse: (id: string, name: string, input: Record<string, unknown>): any => ({
    type: "assistant", parent_tool_use_id: null, message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] },
  }),
  toolResult: (id: string, content: string, isError = false): any => ({
    type: "user", parent_tool_use_id: null,
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] },
  }),
  user: (text: string): any => ({
    type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "text", text }] },
  }),
  /** A failed turn's reason is already in the transcript, so the UI doesn't add "Turn ended". */
  result: (ok: boolean, cost = 0): any => ({
    type: "result", subtype: ok ? "success" : "tui_failed", total_cost_usd: cost,
  }),
  info: (text: string): TuiEvent => ({ type: "tui", kind: "info", text }),
  error: (text: string): TuiEvent => ({ type: "tui", kind: "error", text }),
};
