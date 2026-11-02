// Shared session helpers: the Claude inbox, and the permission-mode cycle every agent uses.
import type { SDKUserMessage, PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** An async-iterable queue of user messages; the SDK reads it for the whole session. */
export class Inbox implements AsyncIterable<SDKUserMessage> {
  private queue: SDKUserMessage[] = [];
  private wake?: () => void;
  private closed = false;

  push(text: string) {
    this.queue.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
    });
    this.wake?.();
  }

  close() {
    this.closed = true;
    this.wake?.();
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      while (this.queue.length) yield this.queue.shift()!;
      if (this.closed) return;
      await new Promise<void>((resolve) => (this.wake = resolve));
      this.wake = undefined;
    }
  }
}

export type { PendingPermission } from "./backends/types.js";

/**
 * The starting mode, resolved the way Claude Code does: --mode flag, then
 * permissions.defaultMode from local, project, then user settings, else default.
 */
export function initialMode(cwd: string, argv: string[]): PermissionMode {
  const flag = argv.indexOf("--mode");
  if (flag !== -1 && argv[flag + 1]) return argv[flag + 1] as PermissionMode;
  const files = [
    path.join(cwd, ".claude", "settings.local.json"),
    path.join(cwd, ".claude", "settings.json"),
    path.join(os.homedir(), ".claude", "settings.json"),
  ];
  for (const f of files) {
    try {
      const mode = JSON.parse(fs.readFileSync(f, "utf8"))?.permissions?.defaultMode;
      if (typeof mode === "string") return mode as PermissionMode;
    } catch {}
  }
  return "default";
}

/** Shift+Tab order, as in Claude Code. Bypass is left out on purpose. */
export const MODE_CYCLE: PermissionMode[] = ["default", "acceptEdits", "plan", "auto"];

export function nextMode(mode: PermissionMode): PermissionMode {
  const i = MODE_CYCLE.indexOf(mode);
  return MODE_CYCLE[(i + 1) % MODE_CYCLE.length];
}
