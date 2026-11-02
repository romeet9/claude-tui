// Groups transcript rows for display: consecutive tool calls and their results
// become one compact "tools" block, so a turn reads as prompt → work → answer.
import type { Item } from "./transcript.js";

export type ToolCall = {
  id?: string; name: string; text: string; input?: Record<string, any>;
  result?: string; full?: string; isError?: boolean;
};

export type Workflow = "figma" | "browser" | "github";

const GIT = /\b(git\s+(push|commit|merge|pull|tag|checkout\s+-b|switch\s+-c|rebase)|gh\s+(pr|repo|issue|release|run|workflow))\b/;

/** Which of the user's main workflows a call belongs to, if any. */
export function workflowOf(c: ToolCall): Workflow | null {
  if (/figma/i.test(c.name)) return "figma";
  if (/browser|claude-in-chrome|Claude_Browser/i.test(c.name)) return "browser";
  if (/^mcp__.*github/i.test(c.name)) return "github";
  if (c.name === "Bash" && GIT.test(String(c.input?.command ?? ""))) return "github";
  return null;
}

export type Block =
  | { kind: "item"; item: Item }
  | { kind: "tools"; id: number; calls: ToolCall[] };

const toolName = (text: string) => text.replace(/^\s*↳\s*/, "").split("(")[0].trim();

export function toBlocks(items: Item[]): Block[] {
  const out: Block[] = [];
  let group: Extract<Block, { kind: "tools" }> | null = null;
  for (const it of items) {
    if (it.kind === "tool") {
      if (!group) {
        group = { kind: "tools", id: it.id, calls: [] };
        out.push(group);
      }
      group.calls.push({ id: it.toolId, name: it.toolName ?? toolName(it.text), text: it.text, input: it.toolInput });
      continue;
    }
    if (it.kind === "toolResult" && group) {
      // Parallel calls finish in any order: match on the tool_use id when there is one.
      const call =
        group.calls.find((c) => it.toolId && c.id === it.toolId) ??
        group.calls.find((c) => c.result === undefined) ??
        group.calls[group.calls.length - 1];
      call.result = it.text;
      call.full = it.full;
      call.isError = it.isError;
      continue;
    }
    group = null;
    out.push({ kind: "item", item: it });
  }
  return out;
}

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** "ran 3 commands · read 2 files · edited 1 file" */
export function summarize(calls: ToolCall[]): string {
  const counts = new Map<string, number>();
  for (const c of calls) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  const parts: string[] = [];
  const take = (names: string[], label: (n: number) => string) => {
    const n = names.reduce((s, k) => s + (counts.get(k) ?? 0), 0);
    names.forEach((k) => counts.delete(k));
    if (n) parts.push(label(n));
  };
  take(["Bash"], (n) => `ran ${plural(n, "command")}`);
  take(["Read"], (n) => `read ${plural(n, "file")}`);
  take(["Edit", "MultiEdit", "Write", "NotebookEdit"], (n) => `edited ${plural(n, "file")}`);
  take(["Grep", "Glob"], (n) => plural(n, "search", "searches"));
  take(["WebFetch", "WebSearch"], (n) => plural(n, "web lookup"));
  take(["Task", "Agent"], (n) => plural(n, "agent"));
  const servers = new Map<string, number>();
  for (const [name, n] of [...counts]) {
    const m = name.match(/^mcp__(.+?)__/);
    if (m) {
      const server = m[1].replace(/^plugin_[^_]+_/, "").replace(/^claude_ai_/, "");
      servers.set(server, (servers.get(server) ?? 0) + n);
      counts.delete(name);
    }
  }
  for (const [server, n] of servers) parts.push(`${server} ×${n}`);
  for (const [name, n] of counts) parts.push(n > 1 ? `${name} ×${n}` : name);
  return parts.join(" · ");
}
