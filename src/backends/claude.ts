// Claude Code through the Agent SDK: one long-lived streaming-input session.
import {
  query,
  getSessionMessages,
  type Query,
  type PermissionMode,
  type PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";
import { Inbox } from "../agent.js";
import { toPct, toMs, type Limits } from "../Usage.js";
import type { AgentEvent, AgentSession, StartOptions } from "./types.js";

export class ClaudeSession implements AgentSession {
  readonly kind = "claude" as const;
  private inbox = new Inbox();
  private q: Query;

  constructor(private opts: StartOptions) {
    this.q = query({
      prompt: this.inbox,
      options: {
        cwd: opts.cwd,
        ...(opts.resume ? { resume: opts.resume } : {}),
        // Stated explicitly so the status line and the session agree from the first frame.
        permissionMode: opts.mode,
        // Behave like Claude Code: its system prompt, CLAUDE.md files, settings, hooks, plugins.
        systemPrompt: { type: "preset", preset: "claude_code" },
        settingSources: ["user", "project", "local"],
        includePartialMessages: true,
        // This UI has no multiple-choice dialog; the model asks in plain text instead.
        disallowedTools: ["AskUserQuestion"],
        canUseTool: (toolName, input, { suggestions, decisionReason, signal }) =>
          new Promise<PermissionResult>((resolve) => {
            signal.addEventListener("abort", () =>
              resolve({ behavior: "deny", message: "Interrupted by user" }),
            );
            opts.onPermission({ toolName, input, reason: decisionReason, suggestions, canAlways: true, resolve });
          }),
      },
    });
  }

  [Symbol.asyncIterator]() {
    return (this.q as AsyncIterable<AgentEvent>)[Symbol.asyncIterator]();
  }

  send(text: string) { this.inbox.push(text); }
  async interrupt() { await this.q.interrupt(); }
  close() {
    this.inbox.close();
    this.q.interrupt().catch(() => {});
    try { this.q.close(); } catch {}
  }
  setPermissionMode(m: PermissionMode) { return this.q.setPermissionMode(m); }
  history() { return this.opts.resume ? getSessionMessages(this.opts.resume, { dir: this.opts.cwd }) : Promise.resolve([]); }
  supportedCommands() { return this.q.supportedCommands(); }
  supportedModels() { return this.q.supportedModels(); }
  setModel(m: string) { return this.q.setModel(m); }
  mcpServerStatus() { return this.q.mcpServerStatus() as any; }
  reconnectMcpServer(n: string) { return this.q.reconnectMcpServer(n); }
  toggleMcpServer(n: string, on: boolean) { return this.q.toggleMcpServer(n, on); }
  getContextUsage() { return this.q.getContextUsage(); }

  async readLimits(): Promise<Limits | null> {
    const u: any = await this.q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
    const rl = u?.rate_limits;
    if (!rl) return null;
    // A window with no usage yet comes back without a utilization: that's 0%.
    const pick = (w: any) => (w ? { pct: w.utilization != null ? toPct(w.utilization) : 0, resetsAt: toMs(w.resets_at) } : undefined);
    // A window reported as null doesn't exist on this plan (Claude Ultra has no 5-hour limit).
    return {
      fiveHour: rl.five_hour === null ? "none" : pick(rl.five_hour),
      weekly: rl.seven_day === null ? "none" : pick(rl.seven_day),
    };
  }
}
