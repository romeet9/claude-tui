// The dashboard's layout, kept between runs: chat panes (folder, session, width,
// paused), focus, the right-hand column, the sidebar, and the row's scroll.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const LAYOUT_PATH = path.join(os.homedir(), ".config", "claude-tui", "layout.json");

export type SavedPane = {
  cwd: string; sessionId: string | null; width?: number; paused?: boolean;
  /** Which agent the pane runs (older layouts: Claude). */
  agent?: "claude" | "codex" | "agy";
  /** Still showing the agent picker. */
  choosing?: boolean;
  /** The session's name until the agent lists one. */
  title?: string;
};
export type SavedLayout = {
  version: 1;
  panes: SavedPane[];
  active: number;
  right: null | "timeline" | "browser";
  rightPane: "github" | "timeline";
  showSidebar: boolean;
  scrollX: number;
  /** The bento grid's left-pane share of two-pane rows. */
  split?: number;
};

export function loadLayout(): SavedLayout | null {
  try {
    const l = JSON.parse(fs.readFileSync(LAYOUT_PATH, "utf8")) as SavedLayout;
    if (l?.version !== 1 || !Array.isArray(l.panes)) return null;
    // Folders that no longer exist are dropped.
    const panes = l.panes.filter((p) => typeof p.cwd === "string" && fs.existsSync(p.cwd));
    if (!panes.length) return null;
    return { ...l, panes, active: Math.max(0, Math.min(panes.length - 1, l.active ?? 0)) };
  } catch {
    return null;
  }
}

let pending: NodeJS.Timeout | null = null;
let latest: SavedLayout | null = null;

/** Debounced: many changes in a row (dragging a border) write once. */
export function saveLayout(l: SavedLayout) {
  latest = l;
  if (pending) clearTimeout(pending);
  pending = setTimeout(flushLayout, 400);
}

export function flushLayout() {
  if (pending) clearTimeout(pending);
  pending = null;
  if (!latest) return;
  try {
    fs.mkdirSync(path.dirname(LAYOUT_PATH), { recursive: true });
    fs.writeFileSync(LAYOUT_PATH, JSON.stringify(latest, null, 2) + "\n");
  } catch {}
}
