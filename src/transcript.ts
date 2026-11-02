// Turning SDK messages (live or from a resumed session's history) into transcript rows.

export type Item = {
  id: number;
  kind: "user" | "text" | "tool" | "toolResult" | "info" | "error";
  text: string;
  isError?: boolean;
  /** Pairs a tool call with its result (tool_use id). */
  toolId?: string;
  /** Tool calls: the tool's name and raw input (for the workflow cards). */
  toolName?: string;
  toolInput?: Record<string, any>;
  /** Tool results: more of the output than the one-line summary. */
  full?: string;
};

/**
 * Drops the emoji-presentation selector (U+FE0F): "⚠️" is ⚠ + FE0F, and layout
 * and terminals disagree on that pair's width, which corrupts the line around it.
 */
export const tidy = (s: string) => s.replace(/\uFE0F/g, "");

let nextId = 0;
export const item = (kind: Item["kind"], text: string, isError?: boolean): Item => ({
  id: nextId++,
  kind,
  text: tidy(text),
  isError,
});

export const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** One-line summary of a tool call: the input field a person cares about. */
export function describeTool(name: string, input: Record<string, unknown>): string {
  const pick =
    input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.url ??
    input.query ?? input.description ?? input.prompt ?? input.commands ?? input.nodeId ?? input.url ?? "";
  return `${name}(${clip(String(pick).replace(/\s+/g, " "), 90)})`;
}

export function resultText(content: unknown): string {
  return typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((b: any) => (b?.type === "text" ? b.text : "")).join("\n")
      : "";
}

export function describeResult(content: unknown): string {
  const text = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((b: any) => (b?.type === "text" ? b.text : `[${b?.type}]`)).join("\n")
      : "";
  const lines = text.trim().split("\n").filter(Boolean);
  if (!lines.length) return "(no output)";
  const more = lines.length > 1 ? `  … +${lines.length - 1} lines` : "";
  return clip(lines[0], 100) + more;
}

/**
 * Rows for one assistant or user message. `history` is true for a resumed
 * session's past messages, where the user's own prompts are shown too.
 */
export function messageToItems(
  m: { type: string; message: any; parent_tool_use_id: string | null },
  history = false,
): Item[] {
  const sub = m.parent_tool_use_id !== null;
  const content = m.message?.content;
  const blocks: any[] = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
  const out: Item[] = [];

  if (m.type === "assistant") {
    for (const b of blocks) {
      if (b.type === "text" && !sub && b.text?.trim()) out.push(item("text", b.text.trim()));
      if (b.type === "tool_use") {
        out.push({ ...item("tool", (sub ? "  ↳ " : "") + describeTool(b.name, b.input ?? {})), toolId: b.id, toolName: b.name, toolInput: b.input ?? {} });
      }
    }
  } else if (m.type === "user" && !sub) {
    for (const b of blocks) {
      if (b.type === "tool_result") {
        out.push({ ...item("toolResult", describeResult(b.content), !!b.is_error), toolId: b.tool_use_id, full: resultText(b.content).slice(0, 4000) });
      }
      // Past prompts; skip injected system/command wrappers.
      if (history && b.type === "text" && b.text?.trim() && !b.text.trimStart().startsWith("<")) {
        out.push(item("user", b.text.trim()));
      }
    }
  }
  return out;
}
