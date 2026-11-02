// Cards for the user's main workflows inside the transcript: Figma work, the
// browser (Browser MCP / Chrome), and GitHub (git push/commit, gh pr …).
import React from "react";
import { Box, Text } from "ink";
import type { ToolCall, Workflow } from "./blocks.js";
import { useTheme, type Theme , bc, ruleOf } from "./theme.js";
import { clip } from "./transcript.js";

const shortTool = (name: string) => name.replace(/^mcp__.+?__/, "");

function colorOf(t: Theme, w: Workflow) {
  if (w === "figma") return t.focus?.sidebar ?? t.magenta;       // Figma purple
  if (w === "browser") return t.focus?.browser ?? t.yellow;     // coral in the Figma theme
  return t.focus?.timeline ?? t.green;                           // GitHub green
}

const TITLE: Record<Workflow, string> = { figma: "◆ Figma", browser: "◎ Browser", github: "⎇ GitHub" };

/** Lines of detail for each workflow, newest last. */
function details(w: Workflow, calls: ToolCall[], width: number): { text: string; error?: boolean }[] {
  if (w === "figma") {
    const counts = new Map<string, number>();
    for (const c of calls) counts.set(shortTool(c.name), (counts.get(shortTool(c.name)) ?? 0) + 1);
    const lines: { text: string; error?: boolean }[] = [{ text: [...counts].map(([k, v]) => (v > 1 ? `${k} ×${v}` : k)).join(" · ") }];
    const last = calls[calls.length - 1];
    const what = last.input?.description ?? last.input?.nodeId ?? String(last.input?.code ?? "").split("\n")[0];
    if (what) lines.push({ text: `last: ${clip(String(what), width - 6)}` });
    for (const c of calls.filter((c) => c.isError).slice(-2)) lines.push({ text: `✗ ${shortTool(c.name)}: ${c.result ?? ""}`, error: true });
    return lines;
  }
  if (w === "browser") {
    const out: { text: string; error?: boolean }[] = [];
    const visited: string[] = [];
    let actions = 0;
    for (const c of calls) {
      const cmds = String(c.input?.commands ?? c.input?.url ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
      for (const l of cmds) {
        const go = l.match(/^(?:goto|tab new)\s+(\S+)/);
        if (go) {
          try { visited.push(new URL(go[1]).host + new URL(go[1]).pathname.replace(/\/$/, "")); } catch { visited.push(go[1]); }
        } else if (/^(click|fill|type|press|select|check|uncheck|drag|upload|hover)\b/.test(l)) actions++;
      }
    }
    if (visited.length) out.push({ text: `→ ${[...new Set(visited)].slice(-3).join("  →  ")}` });
    out.push({ text: `${calls.length} ${calls.length === 1 ? "call" : "calls"}${actions ? ` · ${actions} ${actions === 1 ? "action" : "actions"}` : ""}` });
    for (const c of calls.filter((c) => c.isError).slice(-1)) out.push({ text: `✗ ${c.result ?? ""}`, error: true });
    return out;
  }
  // GitHub: each git/gh command with its outcome, plus the push target or PR link it printed.
  const out: { text: string; error?: boolean }[] = [];
  for (const c of calls.slice(-4)) {
    const cmd = String(c.input?.command ?? shortTool(c.name)).replace(/\s+/g, " ");
    out.push({ text: `${c.result === undefined ? "◌" : c.isError ? "✗" : "✓"} ${clip(cmd, width - 4)}`, error: c.isError });
    const full = c.full ?? "";
    const pr = full.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/)?.[0];
    const pushed = full.match(/^\s*([0-9a-f]{7,}\.\.[0-9a-f]{7,}|\* \[new branch\])\s+(\S+\s*->\s*\S+)/m);
    const remote = full.match(/^To\s+(\S+)/m)?.[1];
    if (pr) out.push({ text: `  ${pr}` });
    else if (pushed) out.push({ text: `  ${pushed[2]}${remote ? "  ·  " + remote.replace(/^(git@)?github\.com[:\/]|^https:\/\/github\.com\//, "").replace(/\.git$/, "") : ""}` });
  }
  return out;
}

export function WorkflowCard({ workflow, calls, running, width }: {
  workflow: Workflow; calls: ToolCall[]; running: boolean; width: number;
}) {
  const t = useTheme();
  const color = colorOf(t, workflow);
  const failed = calls.filter((c) => c.isError).length;
  const lines = details(workflow, calls, width - 4);
  return (
    <Box flexDirection="column" flexShrink={0} width={width} borderStyle="round" backgroundColor={t.card} borderBackgroundColor={t.card ?? t.bg}
      borderColor={t.card ?? (failed ? t.red : color)} paddingX={1}>
      <Text wrap="truncate" color={t.white}>
        <Text bold color={color}>{TITLE[workflow]}</Text>
        <Text color={t.gray}>{running ? "  working…" : failed ? `  ${failed} failed` : "  done"}</Text>
      </Text>
      {lines.map((l, i) => (
        <Text key={i} wrap="truncate" color={l.error ? t.red : t.gray}>{l.text}</Text>
      ))}
    </Box>
  );
}
