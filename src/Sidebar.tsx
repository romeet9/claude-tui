// Left column: a tree of workspaces → subfolders, with "new session" and
// recent-session rows under every expanded folder, then create/add actions.
import React from "react";
import fs from "node:fs";
import { Box, Text } from "ink";
import { ago, listSubfolders, type Workspace, type SessionInfo } from "./workspaces.js";
import { agentInfo } from "./backends/types.js";
import { clip } from "./transcript.js";
import { useTheme , bc, ruleOf } from "./theme.js";
import { useKeys, pretty } from "./keys.js";

/**
 * One sidebar line. `id` is the row's place in the tree (unique even when the same
 * folder shows up twice, e.g. as its own workspace and inside another one): it keys
 * the rendered line and the expanded state. `parent` is the folder row it sits under.
 */
export type Row =
  | { kind: "dir"; id: string; parent?: string; path: string; name: string; depth: number; isWorkspace: boolean }
  | { kind: "new"; id: string; parent: string; path: string; depth: number }
  | { kind: "session"; id: string; parent: string; path: string; depth: number; info: SessionInfo }
  | { kind: "create"; id: string }
  | { kind: "link"; id: string };

/** The folder a row belongs to (where "new session" would start), if any. */
export const rowPath = (r: Row | undefined) => (r && "path" in r ? r.path : undefined);

export function buildRows(
  workspaces: Workspace[],
  expanded: Set<string>,
  sessions: Record<string, SessionInfo[]>,
): Row[] {
  const rows: Row[] = [];
  const real = (p: string) => { try { return fs.realpathSync(p); } catch { return p; } };
  const walk = (dirPath: string, name: string, depth: number, isWorkspace: boolean, parent: string | undefined, ancestors: Set<string>) => {
    // A workspace's id is its path, so code that expands "this folder" by path still works.
    const id = parent === undefined ? dirPath : `${parent}>${name}`;
    rows.push({ kind: "dir", id, parent, path: dirPath, name, depth, isWorkspace });
    if (!expanded.has(id) || depth > 6) return;
    rows.push({ kind: "new", id: id + "#new", parent: id, path: dirPath, depth: depth + 1 });
    for (const info of sessions[dirPath] ?? []) {
      rows.push({ kind: "session", id: `${id}#${info.agent}:${info.sessionId}`, parent: id, path: dirPath, depth: depth + 1, info });
    }
    const here = new Set(ancestors).add(real(dirPath));
    for (const sub of listSubfolders(dirPath)) {
      // A shortcut back to a folder above this one would nest forever: skip it.
      if (here.has(real(sub.path))) continue;
      walk(sub.path, sub.name, depth + 1, false, id, here);
    }
  };
  for (const ws of workspaces) walk(ws.path, ws.name, 0, true, undefined, new Set());
  rows.push({ kind: "create", id: "#create" }, { kind: "link", id: "#link" });
  return rows;
}

/** A session's name: its custom title, the agent's summary, or the first prompt. */
export const sessionTitle = (s: SessionInfo) =>
  (s.customTitle || s.summary || s.firstPrompt || s.sessionId.slice(0, 8)).replace(/\s+/g, " ");

/** Pads a row to the full inner width so the selection highlight is a solid bar. */
const pad = (s: string, w: number) => (s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length));

export const SIDEBAR_KEYS = [
  ["^W", "focus sidebar / chat"],
  ["↑↓ / jk", "move"],
  ["⏎ / →", "open · expand"],
  ["←", "collapse"],
  ["n", "new session (pick agent)"],
  ["c", "new workspace"],
  ["a", "add folder"],
  ["r", "refresh"],
  ["Esc", "back to chat"],
  ["click", "select · open"],
];

/**
 * Which rows are on screen. Shared with the root so a mouse click at a screen
 * row maps to the same item the sidebar drew there. Rows start at screen row 4:
 * top border, title, divider.
 */
export const LIST_TOP = 4;
export function sidebarWindow(o: {
  rowCount: number; cursor: number; focused: boolean; height: number; hasField: boolean; hasMessage: boolean;
}) {
  // The same layout focused or not: the key list is always there.
  const help = SIDEBAR_KEYS.length + 1;
  const listHeight = Math.max(3, o.height - 4 - help - (o.hasField ? 4 : 0) - (o.hasMessage ? 1 : 0));
  const start = Math.min(Math.max(0, o.cursor - listHeight + 3), Math.max(0, o.rowCount - listHeight));
  return { start, listHeight };
}

export function Sidebar(props: {
  rows: Row[];
  cursor: number;
  focused: boolean;
  width: number;
  height: number;
  expanded: Set<string>;
  activeCwd: string;
  activeSessionId: string | null;
  field: { label: string; value: string } | null;
  message: { text: string; error?: boolean } | null;
}) {
  const t = useTheme();
  const { keys } = useKeys();
  const accent = t.focus?.sidebar ?? t.cyan;
  const { rows, cursor, focused, width, height, expanded, activeCwd, activeSessionId, field, message } = props;
  const inner = width - 4; // border (2) + padding (2)
  const { start, listHeight } = sidebarWindow({
    rowCount: rows.length, cursor, focused, height, hasField: !!field, hasMessage: !!message,
  });
  const visible = rows.slice(start, start + listHeight);

  const line = (key: string, text: string, selected: boolean, color: string, bold = false, dim = false) =>
    selected ? (
      <Text key={key} backgroundColor={accent} color={t.black} bold wrap="truncate">{pad(text, inner)}</Text>
    ) : (
      <Text key={key} color={color} bold={bold} dimColor={dim} wrap="truncate">{pad(text, inner)}</Text>
    );

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      flexShrink={0}
      backgroundColor={t.bg}
      borderStyle="round" borderBackgroundColor={t.bg}
      borderColor={bc(t, focused ? accent : t.border)}
      paddingX={1}
    >
      <Box flexShrink={0} flexDirection="column">
        <Text bold color={focused ? accent : t.white} wrap="truncate">
          {pad((t.flat && focused ? "● " : "") + "Workspaces", inner)}
        </Text>
        <Text color={t.gray}>{ruleOf(t, inner)}</Text>
      </Box>

      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {visible.map((row, i) => {
          const sel = focused && start + i === cursor;
          switch (row.kind) {
            case "dir": {
              const indent = "  ".repeat(row.depth);
              const arrow = expanded.has(row.id) ? "▾ " : "▸ ";
              const here = row.path === activeCwd;
              const label = `${indent}${arrow}${row.name}${here ? " ●" : ""}`;
              return line(row.id, label, sel, here ? t.green : row.isWorkspace ? t.white : t.gray, row.isWorkspace || here);
            }
            case "new":
              return line(row.id, `${"  ".repeat(row.depth)}+ New session`, sel, t.green);
            case "session": {
              const here = row.info.sessionId === activeSessionId;
              const age = ago(row.info.lastModified);
              // Claude sessions keep the plain dot; Codex ◆ and Antigravity ▲ show their mark.
              const indent = "  ".repeat(row.depth) + (row.info.agent && row.info.agent !== "claude" ? agentInfo(row.info.agent).glyph : "◦") + " ";
              const room = inner - indent.length - age.length - 1;
              const label = `${indent}${clip(sessionTitle(row.info), room)}`;
              // Test chats (tagged "test") sit at the bottom, dimmed.
              const test = (row.info as any).tag === "test";
              return line(row.id, pad(label, inner - age.length) + age, sel, here ? t.green : t.gray, false, test);
            }
            case "create":
              return line(row.id, "+ New workspace", sel, t.yellow);
            case "link":
              return line(row.id, "+ Add existing folder", sel, t.yellow);
          }
        })}
      </Box>

      {message && (
        <Box flexShrink={0}>
          <Text color={message.error ? t.red : t.green} wrap="truncate">{message.text}</Text>
        </Box>
      )}
      {field && (
        <Box flexDirection="column" flexShrink={0} borderStyle="single" backgroundColor={t.card} borderBackgroundColor={t.card ?? t.bg} borderColor={t.card ?? bc(t, t.yellow)}>
          <Text color={t.yellow} wrap="truncate">{field.label}</Text>
          <Text wrap="truncate" color={t.white}>
            {field.value}
            <Text inverse color={t.white}> </Text>
          </Text>
        </Box>
      )}

      <Box flexShrink={0} flexDirection="column">
        <Text color={t.gray}>{ruleOf(t, inner)}</Text>
        {SIDEBAR_KEYS.map(([k, d]) => (
          <Text key={k} wrap="truncate" color={t.white}>
            <Text color={t.cyan}>{k.padEnd(9)}</Text>
            <Text color={t.gray}>{d}</Text>
          </Text>
        ))}
      </Box>
    </Box>
  );
}
