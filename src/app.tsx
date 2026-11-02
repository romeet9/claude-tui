// Root: a full-screen layout with the workspace sidebar on the left and the
// current chat on the right. Starting or resuming a session remounts <Chat>.
import React, { useEffect, useMemo, useState } from "react";
import { render, Box, useApp, useInput, useWindowSize } from "ink";
import fs from "node:fs";
import { Chat } from "./Chat.js";
import { PausedPane } from "./PausedPane.js";
import { AgentPicker, PICKER_FIRST_ROW, PICKER_ROW_STEP } from "./AgentPicker.js";
import { AGENTS, agentInfo, type AgentKind } from "./backends/types.js";
import { gridRects, neighbor, hit, MIN_PANE_W } from "./grid.js";
import { loadWorkflow, workflowArg, type Chip, type WorkflowApi } from "./workflow.js";
import { loadLayout, saveLayout, flushLayout, type SavedLayout } from "./layout.js";
import { KeysContext, loadKeymap, saveKeymap, describe, pretty, DEFAULT_KEYS, type KeysApi, type Keymap } from "./keys.js";
import type { Theme } from "./theme.js";
import { Timeline } from "./Timeline.js";
import { hasTimeline } from "./mcp.js";
/** The memory timeline under GitHub, only when its plugin is installed. */
const TIMELINE = hasTimeline();
import { GitHubPanel } from "./GitHub.js";
import { Usage, USAGE_HEIGHT, REFRESH_LABEL, type Limits } from "./Usage.js";
import { Browser, BROWSER_BODY_TOP } from "./Browser.js";
import { ThemeContext, themeById, savedThemeId, saveThemeId, Surface, sectionTheme, chatTheme, type ThemeApi } from "./theme.js";
import { Sidebar, buildRows, rowPath, sidebarWindow, LIST_TOP, sessionTitle } from "./Sidebar.js";
import { mouse, installMouseFilter, setMouseReporting, isMouseReporting, type MouseEvent } from "./mouse.js";
import {
  listWorkspaces, createWorkspace, linkFolder, recentSessions, isInstalled, type Workspace, type SessionInfo,
} from "./workspaces.js";

/**
 * One chat pane: its own agent session in a folder. `choosing` panes show the agent
 * picker until one is chosen.
 */
type Pane = {
  id: number; cwd: string; resume?: string; sessionId: string | null; width?: number; paused?: boolean;
  agent: AgentKind; choosing?: boolean;
  /** The session's name when the agent hasn't listed one yet (first prompt, or the sidebar row). */
  title?: string;
  /** Workflow panes: the role the workflow addresses them by. */
  role?: string;
};

// Every new pane gets its own border: line styles and theme colors cycle with the pane's number.
const BORDERS = ["round", "bold", "double", "single"] as const;
const paneBorder = (id: number) => BORDERS[id % BORDERS.length];
/** Each pane's accent is its agent's brand color (Claude orange, Codex white, Antigravity blue). */
function paneColor(t: Theme, p: { id: number; agent: AgentKind; choosing?: boolean }) {
  if (t.chatBlocks && t.blocks) return t.blocks.ink; // block themes: dark ink borders on each chat's block
  if (p.choosing) return t.gray;
  const b = agentInfo(p.agent).brand;
  return t.light ? b.light : b.dark;
}
const NO_SCROLL = { n: 0, delta: 0 };

/** --resume <id> / -r <id>, --continue / -c, as in Claude Code. */
function startupArgs(argv: string[]) {
  const i = argv.findIndex((a) => a === "--resume" || a === "-r");
  const id = i !== -1 ? argv[i + 1] : undefined;
  return {
    resume: id && !id.startsWith("-") ? id : undefined,
    pickResume: i !== -1 && (!id || id.startsWith("-")),
    continueLast: argv.includes("--continue") || argv.includes("-c"),
    fresh: argv.includes("--fresh"),
    agent: agentArg(argv),
  };
}
/** --agent claude|codex|agy (also --codex / --agy): the agent of the first pane. */
function agentArg(argv: string[]): AgentKind | undefined {
  if (argv.includes("--codex")) return "codex";
  if (argv.includes("--agy") || argv.includes("--antigravity")) return "agy";
  const i = argv.indexOf("--agent");
  const v = i !== -1 ? argv[i + 1]?.toLowerCase() : undefined;
  if (v === "codex") return "codex";
  if (v === "agy" || v === "antigravity") return "agy";
  if (v === "claude") return "claude";
  return undefined;
}
const ARGS = startupArgs(process.argv.slice(2));
/** The layout from last time, unless --fresh. */
/** --workflow <name>: a private module's linked panes (see workflow.ts). */
const WF_NAME = workflowArg(process.argv.slice(2));
const WORKFLOW = WF_NAME ? await loadWorkflow(WF_NAME).catch((e) => {
  console.error(String(e?.message ?? e));
  process.exit(1);
}) : null;
/** A workflow brings its own panes, so the saved layout is neither read nor written. */
const SAVED: SavedLayout | null = ARGS.fresh || WORKFLOW ? null : loadLayout();
process.on("exit", flushLayout);
type Field = { purpose: "create" | "link"; label: string; value: string };

const SIDEBAR_WIDTH = 34;

function App() {
  const { exit } = useApp();
  const { columns, rows: height } = useWindowSize();

  const [theme, setThemeState] = useState(() => themeById(savedThemeId(process.argv)));
  const themeApi = useMemo<ThemeApi>(() => ({
    theme,
    setTheme: (id, persist = true) => {
      setThemeState(themeById(id));
      if (persist) {
        try { saveThemeId(id); } catch {}
      }
    },
  }), [theme]);

  const [keymap, setKeymap] = useState<Keymap>(() => loadKeymap());
  const [capturing, setCapturing] = useState(false);
  const keysApi = useMemo<KeysApi>(() => ({
    keys: keymap,
    is: (action, ch, key) => describe(ch, key) === keymap[action],
    setKey: (action, binding) => {
      const next = { ...keymap, [action]: binding };
      setKeymap(next);
      try { saveKeymap(next); } catch {}
    },
    resetKeys: () => {
      setKeymap({ ...DEFAULT_KEYS });
      try { saveKeymap({ ...DEFAULT_KEYS }); } catch {}
    },
    capturing,
    setCapturing,
  }), [keymap, capturing]);
  const is = keysApi.is;

  const launchCwd = useMemo(() => fs.realpathSync(process.cwd()), []);
  // Chat panes, left to right. New sessions open to the right of the active one.
  // Restore last time's panes (their sessions resume); otherwise one pane where we started.
  // A launch folder without a pane gets one, added at the end and focused.
  const [initial] = useState(() => {
    if (WORKFLOW) {
      return {
        panes: WORKFLOW.panes.map((w, i) => ({
          id: i, cwd: w.cwd, resume: w.resume, sessionId: null, agent: w.agent ?? "claude", role: w.role, title: w.title,
        })) as Pane[],
        active: 0,
      };
    }
    if (!SAVED) return { panes: [{ id: 0, cwd: launchCwd, resume: ARGS.resume, sessionId: null, agent: ARGS.agent ?? "claude" }] as Pane[], active: 0 };
    const list: Pane[] = SAVED.panes.map((s, i) => ({
      id: i, cwd: s.cwd, sessionId: s.sessionId, resume: s.sessionId ?? undefined, width: s.width, paused: s.paused,
      agent: s.agent ?? "claude", choosing: s.choosing && !s.sessionId, title: s.title,
    }));
    let active = SAVED.active;
    // Keep last time's focus if it's in this folder; else focus a pane that is.
    const here = list[active]?.cwd === launchCwd ? active : list.findIndex((p) => p.cwd === launchCwd);
    if (here !== -1) active = here;
    else {
      list.push({ id: list.length, cwd: launchCwd, sessionId: null, agent: ARGS.agent ?? "claude" });
      active = list.length - 1;
    }
    return { panes: list, active };
  });
  const [panes, setPanes] = useState<Pane[]>(initial.panes);
  const [activeIdx, setActiveIdx] = useState(initial.active);
  const paneSeq = React.useRef(initial.panes.length);
  const ai = Math.min(activeIdx, panes.length - 1);
  const active = panes[ai];
  /** The left pane's share of each two-pane row in the grid (^K / ^L, or drag the edge). */
  const [split, setSplit] = useState(SAVED?.split ?? 0.5);

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [sessions, setSessions] = useState<Record<string, SessionInfo[]>>({});
  /** The agent picker's highlighted row (shared: only the focused picker pane uses it). */
  const [pickCursor, setPickCursor] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [cursor, setCursor] = useState(0);
  const [focus, setFocus] = useState<"chat" | "sidebar" | "right">("chat");
  /** Right-hand panel: GitHub (with the optional memory timeline) or the browser. */
  const [right, setRight] = useState<null | "timeline" | "browser">(SAVED?.right ?? null);
  const [rightScroll, setRightScroll] = useState({ n: 0, delta: 0 });
  /** In the GitHub column (and the optional timeline under it), which has the keyboard. */
  const [rightPane, setRightPane] = useState<"github" | "timeline">(SAVED?.rightPane ?? "github");
  const [githubScroll, setGithubScroll] = useState({ n: 0, delta: 0 });
  const [browserOpen, setBrowserOpen] = useState({ n: 0, url: "" });
  const [chatPrefill, setChatPrefill] = useState({ n: 0, text: "" });
  const [browserClick, setBrowserClick] = useState({ n: 0, row: 0 });
  const [limits, setLimits] = useState<Limits>({});
  /** The ⟳ on the Usage card: bump to make the focused chat re-read the plan usage. */
  const [limitsRequest, setLimitsRequest] = useState({ n: 0 });
  const [limitsRefreshing, setLimitsRefreshing] = useState(false);
  useEffect(() => setLimitsRefreshing(false), [limits]);
  const [showSidebar, setShowSidebar] = useState(SAVED?.showSidebar ?? true);
  const [field, setField] = useState<Field | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [mouseOn, setMouseOn] = useState(true);
  /** Wheel scrolls for a chat transcript (pane id): a counter so repeated equal deltas still fire. */
  const [chatScroll, setChatScroll] = useState({ n: 0, delta: 0, pane: 0 });

  // The folder claude-tui was started in is listed first when it isn't a workspace already.
  const allWorkspaces = useMemo<Workspace[]>(() => {
    const list = workspaces.slice();
    if (!list.some((w) => w.path === launchCwd)) {
      list.unshift({ name: `${launchCwd.split("/").pop() || launchCwd} (here)`, path: launchCwd, linked: false });
    }
    return list;
  }, [workspaces, launchCwd]);

  const rowList = useMemo(() => buildRows(allWorkspaces, expanded, sessions), [allWorkspaces, expanded, sessions]);

  const reloadWorkspaces = () => setWorkspaces(listWorkspaces());
  const reloadSessions = (dir: string) =>
    recentSessions(dir).then((list) => setSessions((prev) => ({ ...prev, [dir]: list })));

  // claude -c: continue the most recent session here. claude -r (no id): pick one in the sidebar.
  useEffect(() => {
    if (SAVED && ARGS.resume) openSession(launchCwd, ARGS.resume, { agent: ARGS.agent ?? "claude" });
    if (ARGS.continueLast) {
      recentSessions(launchCwd, 1).then((all) => {
        const last = all.find((x) => x.agent === (ARGS.agent ?? "claude"));
        if (last) openSession(launchCwd, last.sessionId, { agent: last.agent });
        else setMessage({ text: "No earlier session here; started a new one" });
      });
    } else if (ARGS.pickResume) {
      expand(launchCwd, true);
      setFocus("sidebar");
      setCursor(1);
    }
  }, []);

  // Session names for the title bars: every open pane's folder gets its list loaded.
  const paneDirs = Array.from(new Set(panes.map((p) => p.cwd))).join("\n");
  useEffect(() => {
    for (const dir of paneDirs.split("\n")) if (dir && !sessions[dir]) reloadSessions(dir);
  }, [paneDirs]);

  useEffect(() => {
    reloadWorkspaces();
  }, []);

  /**
   * Opens or closes a folder row. `id` is the row's tree id (a workspace's id is its
   * path); `dir` is the folder whose sessions to load (defaults to the id).
   */
  const expand = (id: string, open: boolean, dir: string = id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      open ? next.add(id) : next.delete(id);
      return next;
    });
    if (open) reloadSessions(dir);
  };


  useEffect(() => {
    if (message && !message.error) {
      const t = setTimeout(() => setMessage(null), 4000);
      return () => clearTimeout(t);
    }
  }, [message]);

  useEffect(() => {
    setCursor((c) => Math.min(c, rowList.length - 1));
  }, [rowList.length]);

  useEffect(() => {
    setMouseReporting(mouseOn);
  }, [mouseOn]);

  // Layout: sidebar | bento grid of chat panes | right panel. The grid fills the space
  // (no sideways scrolling); the sidebar gives way first when the window is narrow.
  const rightWidth = right === "browser"
    ? Math.max(52, Math.floor(columns * 0.42))
    : right === "timeline" ? Math.max(44, Math.min(52, Math.floor(columns * 0.28))) : 0;
  const sidebarVisibleNow = showSidebar && columns - rightWidth - SIDEBAR_WIDTH >= 50;
  // Spacing between sections: block themes get real gaps of canvas (2 columns side by
  // side, 1 row between stacked sections); line themes sit their borders 1 column apart.
  const GAP = theme.blocks ? 2 : 1;
  const VGAP = theme.blocks ? 1 : 0;
  const leftW = sidebarVisibleNow ? SIDEBAR_WIDTH + GAP : 0;
  const gridW = Math.max(MIN_PANE_W, columns - leftW - (right ? rightWidth + GAP : 0));
  const rects = gridRects(panes.length, gridW, height, GAP, VGAP, split);

  /** ^K / ^L and dragging: move the split of every two-pane row together. */
  function setSplitCols(leftCols: number) {
    const usable = gridW - GAP;
    setSplit(Math.max(MIN_PANE_W / usable, Math.min(1 - MIN_PANE_W / usable, leftCols / usable)));
  }
  const setSplitRef = React.useRef((c: number) => {});
  setSplitRef.current = setSplitCols;
  // Left column: workspaces over usage. Right column: GitHub over the timeline.
  const usageH = USAGE_HEIGHT;
  const sidebarH = height - usageH - VGAP;
  const githubH = Math.floor(height * 0.58);

  // Mouse: click sidebar rows, click a pane to focus it, wheel scrolls whatever is under it.
  const mouseState = { rowList, cursor, focus, field, message, sidebarVisibleNow, height: sidebarH, rightWidth, columns, right, githubH,
    VGAP, GAP, gridW,
    pausedIdx: panes.flatMap((p, i) => (p.paused ? [i] : [])),
    choosingIdx: panes.flatMap((p, i) => (p.choosing ? [i] : [])),
    leftW, rects, paneCount: panes.length, paneIds: panes.map((p) => p.id) };
  /** A drag in progress: moving the split between the two panes of a row. */
  const dragRef = React.useRef<null | { kind: "split"; startX: number; startLeft: number }>(null);
  const mouseRef = React.useRef(mouseState);
  mouseRef.current = mouseState;
  useEffect(() => {
    const onEvent = (ev: MouseEvent) => {
      const st = mouseRef.current;
      const inSidebar = st.sidebarVisibleNow && ev.x <= SIDEBAR_WIDTH;
      if (ev.kind === "wheelLeft" || ev.kind === "wheelRight") return;
      // Position inside the grid (0-based), and which pane that is.
      const gx = ev.x - 1 - st.leftW;
      const gy = ev.y - 1;
      const inRight = !inSidebar && st.right !== null && gx >= st.gridW + st.GAP;
      const paneAt = inSidebar || inRight ? -1 : hit(st.rects, gx, gy);
      const rect = paneAt >= 0 ? st.rects[paneAt] : undefined;

      // ✕ / ▶ on the last inner columns of a pane's title row: ✕ closes the chat, ▶ resumes a paused one.
      if (ev.kind === "press" && ev.button === 0 && rect && gy === rect.y + 1) {
        const iconCol = rect.x + rect.w - 3;
        if (gx >= iconCol - 1 && gx <= iconCol + 1) {
          if (st.pausedIdx.includes(paneAt)) togglePauseRef.current(paneAt);
          else closePaneRef.current(paneAt);
          return;
        }
      }
      // ⟳ on the Usage card (its title row, right end).
      if (ev.kind === "press" && ev.button === 0 && inSidebar && ev.y === st.height + st.VGAP + 2 && ev.x >= SIDEBAR_WIDTH - 2 - REFRESH_LABEL.length) {
        setLimitsRefreshing(true);
        setLimitsRequest((r) => ({ n: r.n + 1 }));
        return;
      }
      // Dragging the edge between the two panes of a row moves the split for every row.
      const d = dragRef.current;
      if (ev.kind === "drag" && d) {
        setSplitRef.current(d.startLeft + (ev.x - d.startX));
        return;
      }
      if (ev.kind === "release") {
        dragRef.current = null;
        return;
      }
      if (ev.kind === "press" && ev.button === 0 && rect && rect.col === 0 && gx === rect.x + rect.w - 1 &&
          st.rects.some((r) => r.row === rect.row && r.col === 1) && !st.rects.some((r) => r.row === rect.row && r.col === 2)) {
        dragRef.current = { kind: "split", startX: ev.x, startLeft: rect.w };
        return;
      }
      if (inRight) {
        const onGitHub = st.right === "timeline" && (!TIMELINE || ev.y <= st.githubH);
        if (ev.kind === "wheelUp" || ev.kind === "wheelDown") {
          const bump = (s: { n: number; delta: number }) => ({ n: s.n + 1, delta: ev.kind === "wheelUp" ? 3 : -3 });
          if (onGitHub) setGithubScroll(bump);
          else setRightScroll(bump);
          return;
        }
        if (ev.kind === "press" && ev.button === 0) {
          setFocus("right");
          if (st.right === "timeline") setRightPane(onGitHub ? "github" : "timeline");
          if (st.right === "browser") setBrowserClick((c) => ({ n: c.n + 1, row: ev.y - BROWSER_BODY_TOP }));
        }
        return;
      }
      if (ev.kind === "wheelUp" || ev.kind === "wheelDown") {
        const delta = ev.kind === "wheelUp" ? 3 : -3;
        if (inSidebar) setCursor((c) => Math.max(0, Math.min(st.rowList.length - 1, c - Math.sign(delta))));
        else if (st.paneIds[paneAt] !== undefined) setChatScroll((s) => ({ n: s.n + 1, delta, pane: st.paneIds[paneAt] }));
        return;
      }
      if (ev.kind !== "press" || ev.button !== 0) return;
      if (!inSidebar) {
        if (!st.field && paneAt >= 0 && paneAt < st.paneCount) {
          setActiveIdx(paneAt);
          setFocus("chat");
          // A click on one of the agent picker's options starts that agent.
          if (st.choosingIdx.includes(paneAt) && rect) {
            const y = gy - rect.y + 1; // row inside the pane, 1 = its top border
            const opt = Math.floor((y - PICKER_FIRST_ROW) / PICKER_ROW_STEP);
            if (y >= PICKER_FIRST_ROW && opt >= 0 && opt < AGENTS.length && (y - PICKER_FIRST_ROW) % PICKER_ROW_STEP < 2) {
              chooseAgentRef.current(paneAt, AGENTS[opt].kind);
            }
          }
        }
        return;
      }
      // Map the clicked screen row to the list row the sidebar drew there.
      const { start, listHeight } = sidebarWindow({
        rowCount: st.rowList.length, cursor: st.cursor, focused: st.focus === "sidebar", height: st.height,
        hasField: !!st.field, hasMessage: !!st.message,
      });
      const offset = ev.y - LIST_TOP;
      if (offset < 0 || offset >= listHeight) return;
      const idx = start + offset;
      if (idx >= st.rowList.length) return;
      setFocus("sidebar");
      setCursor(idx);
      activateRow(idx);
    };
    mouse.on("event", onEvent);
    return () => {
      mouse.off("event", onEvent);
    };
  }, []);

  /**
   * Open a session in a pane to the right of the active one. A session that's already
   * open just gets focus; a pane nobody has typed in yet is reused instead of adding one.
   */
  function openSession(cwd: string, resume?: string, opts: { alwaysNew?: boolean; agent?: AgentKind; title?: string } = {}) {
    const st = panesRef.current;
    const open = resume ? st.panes.findIndex((p) => p.sessionId === resume || p.resume === resume) : -1;
    if (open !== -1) {
      setActiveIdx(open);
    } else {
      const cur = st.panes[st.ai];
      // No agent given (and nothing to resume): the new pane asks which agent to run.
      const pane: Pane = {
        id: paneSeq.current++, cwd, resume, sessionId: null,
        agent: opts.agent ?? "claude", choosing: !resume && !opts.agent, title: opts.title,
      };
      if (pane.choosing) setPickCursor(0);
      const reuse = !opts.alwaysNew && cur && !cur.sessionId && !cur.resume;
      setPanes((list) => (reuse ? list.map((p, i) => (i === st.ai ? pane : p)) : [...list.slice(0, st.ai + 1), pane, ...list.slice(st.ai + 1)]));
      setActiveIdx(reuse ? st.ai : st.ai + 1);
    }
    expand(cwd, true);
    setFocus("chat");
  }

  /** Pause shuts the pane's Claude process down; resume reopens the same conversation. */
  function togglePause(index?: number) {
    const { panes: list, ai: cur } = panesRef.current;
    const i = index ?? cur;
    const p = list[i];
    if (!p) return;
    setPanes((all) => all.map((q, k) => (k !== i ? q : q.paused
      ? { ...q, paused: false, resume: q.sessionId ?? q.resume }
      : { ...q, paused: true })));
    setActiveIdx(i);
    setFocus("chat");
  }

  /** The picker's choice: the pane starts that agent. */
  // ---- workflow: per-role chips/banners, prompts to send, and callbacks ----
  const [wfUi, setWfUi] = useState<Record<string, { status?: Chip; banner?: Chip }>>({});
  const [wfInject, setWfInject] = useState<Record<string, string[]>>({});
  const wfCallbacks = React.useRef({ session: [] as ((r: string, id: string) => void)[], turn: [] as ((r: string) => void)[] });
  useEffect(() => {
    if (!WORKFLOW?.start) return;
    const api: WorkflowApi = {
      setStatus: (role, chip) => setWfUi((u) => ({ ...u, [role]: { ...u[role], status: chip } })),
      setBanner: (role, banner) => setWfUi((u) => ({ ...u, [role]: { ...u[role], banner } })),
      send: (role, text) => setWfInject((q) => ({ ...q, [role]: [...(q[role] ?? []), text] })),
      onSession: (cb) => { wfCallbacks.current.session.push(cb); },
      onTurnDone: (cb) => { wfCallbacks.current.turn.push(cb); },
    };
    const stop = WORKFLOW.start(api);
    return () => { if (typeof stop === "function") stop(); };
  }, []);
  const wfPane = (p: Pane) => (p.role ? WORKFLOW?.panes.find((w) => w.role === p.role) : undefined);

  /** The title bar's name: the agent's own title from the session list, else the first prompt. */
  function paneTitle(p: Pane): string {
    if (p.role && p.title) return p.title;
    const id = p.sessionId || p.resume;
    const listed = id ? sessions[p.cwd]?.find((x) => x.sessionId === id) : undefined;
    const name = (listed ? sessionTitle(listed) : "") || p.title;
    // A session started in this pane is "New session" until its first prompt names it.
    return name ? name.trim() : p.resume ? `Session ${p.resume.slice(0, 8)}` : "New session";
  }

  function chooseAgent(index: number, agent: AgentKind) {
    setPanes((list) => list.map((p, i) => (i === index ? { ...p, agent, choosing: false } : p)));
    setActiveIdx(index);
    setFocus("chat");
  }
  const chooseAgentRef = React.useRef((i: number, a: AgentKind) => {});
  chooseAgentRef.current = (i, a) => chooseAgent(i, a);

  function closePane(index?: number) {
    const st = { ...panesRef.current, ai: index ?? panesRef.current.ai };
    if (st.panes.length === 1) {
      // Always keep one pane: closing the last one starts fresh where claude-tui began.
      setPanes([{ id: paneSeq.current++, cwd: launchCwd, sessionId: null, agent: "claude" }]);
      setActiveIdx(0);
      return;
    }
    // Focus stays on the pane you were in; closing the focused one moves to its left neighbor.
    const cur = panesRef.current.ai;
    setPanes((list) => list.filter((_, i) => i !== st.ai));
    setActiveIdx(st.ai < cur ? cur - 1 : st.ai === cur ? Math.max(0, cur - 1) : cur);
    setFocus("chat");
  }

  const closePaneRef = React.useRef((i?: number) => {});
  closePaneRef.current = (i) => closePane(i);
  const togglePauseRef = React.useRef((i?: number) => {});
  togglePauseRef.current = (i) => togglePause(i);

  // Pane actions run from mouse and keyboard listeners: read panes through a ref.
  const panesRef = React.useRef({ panes, ai });
  panesRef.current = { panes, ai };

  function activate() {
    activateRow(cursor);
  }

  function activateRow(index: number) {
    const row = activateRef.current.rowList[index];
    if (!row) return;
    switch (row.kind) {
      case "dir":
        return expand(row.id, !activateRef.current.expanded.has(row.id), row.path);
      case "new":
        return openSession(row.path);
      case "session":
        return openSession(row.path, row.info.sessionId, { agent: row.info.agent ?? "claude", title: sessionTitle(row.info) });
      case "create":
        return setField({ purpose: "create", label: "New workspace name:", value: "" });
      case "link":
        return setField({ purpose: "link", label: "Folder path (~ ok):", value: "" });
    }
  }

  // activateRow runs from the mouse listener too, so it reads current state through a ref.
  const activateRef = React.useRef({ rowList, expanded });
  activateRef.current = { rowList, expanded };

  function submitField() {
    if (!field) return;
    try {
      const folder = field.purpose === "create" ? createWorkspace(field.value) : linkFolder(field.value);
      setField(null);
      reloadWorkspaces();
      setMessage({ text: `${field.purpose === "create" ? "Created" : "Added"} ${folder.split("/").pop()}` });
      openSession(folder);
    } catch (e: any) {
      setMessage({ text: String(e?.message ?? e).split("\n").pop()!, error: true });
    }
  }

  // Keep the layout for next time: written shortly after each change, and on quit.
  useEffect(() => {
    if (WORKFLOW) return;
    saveLayout({
      version: 1,
      panes: panes.map((p) => ({
        cwd: p.cwd, sessionId: p.sessionId ?? p.resume ?? null, width: p.width, paused: p.paused,
        agent: p.agent, ...(p.choosing ? { choosing: true } : {}), ...(p.title ? { title: p.title } : {}),
      })),
      active: ai,
      right,
      rightPane,
      showSidebar,
      scrollX: 0,
      split,
    });
  }, [panes, ai, right, rightPane, showSidebar, split]);

  function quit() {
    flushLayout();
    exit();
    setTimeout(() => process.exit(0), 300);
  }

  // Keys the root owns: focus switching, sidebar toggle, quitting, and sidebar navigation.
  useInput((ch, key) => {
    if (capturing) return; // /keys is waiting for a new key
    if (is("toggleSidebar", ch, key)) {
      setShowSidebar((s) => !s);
      if (showSidebar) setFocus("chat");
      return;
    }
    if (is("quit", ch, key)) return quit();
    // Focus sidebar (or Tab from the sidebar) moves focus between sidebar and chat.
    if (is("focusSidebar", ch, key) || (key.tab && !key.shift && focus === "sidebar" && !field)) {
      if (!showSidebar) setShowSidebar(true);
      setFocus((f) => (f === "chat" ? "sidebar" : "chat"));
      return;
    }
    if (is("newSession", ch, key)) return openSession(active.cwd, undefined, { alwaysNew: true });
    if (is("closePane", ch, key)) return closePane();
    if (is("pausePane", ch, key)) return togglePause();
    // The agent picker (a new pane): 1/2/3, ↑↓ and Enter.
    const cur = panesRef.current.panes[panesRef.current.ai];
    if (focus === "chat" && cur?.choosing) {
      const byKey = AGENTS.findIndex((a) => a.key === ch);
      if (byKey !== -1) return chooseAgent(panesRef.current.ai, AGENTS[byKey].kind);
      if (key.upArrow) return setPickCursor((c) => Math.max(0, c - 1));
      if (key.downArrow) return setPickCursor((c) => Math.min(AGENTS.length - 1, c + 1));
      if (key.return) return chooseAgent(panesRef.current.ai, AGENTS[pickCursor].kind);
      if (key.escape) return closePane();
      if (key.tab) { setShowSidebar(true); return setFocus("sidebar"); }
    }
    // Enter on a paused pane resumes it (the chat itself isn't running to hear it).
    if (focus === "chat" && key.return && panesRef.current.panes[panesRef.current.ai]?.paused) return togglePause();
    if (is("narrowPane", ch, key) || is("widenPane", ch, key)) {
      // The grid's left column: every two-pane row moves together, so panes stay matched.
      const left = rects.find((r) => r.col === 0 && rects.some((q) => q.row === r.row && q.col === 1));
      if (left) setSplitCols(left.w + (is("widenPane", ch, key) ? 4 : -4));
      return;
    }
    // Shift+↑/↓: the pane above / below in the grid.
    if (focus === "chat" && (is("paneAbove", ch, key) || is("paneBelow", ch, key))) {
      const to = neighbor(rects, panesRef.current.ai, is("paneAbove", ch, key) ? -1 : 1);
      panesRef.current = { ...panesRef.current, ai: to };
      return setActiveIdx(to);
    }
    // Move the focused pane up / down the grid (swap with its neighbor in the order).
    const moveUp = is("movePaneUp", ch, key) || (key.meta && key.upArrow);
    const moveDown = is("movePaneDown", ch, key) || (key.meta && key.downArrow);
    if (focus === "chat" && (moveUp || moveDown)) {
      const { ai: at, panes: list } = panesRef.current;
      const to = at + (moveUp ? -1 : 1);
      if (to < 0 || to >= list.length) return;
      const next = list.slice();
      [next[at], next[to]] = [next[to], next[at]];
      panesRef.current = { panes: next, ai: to };
      setPanes(next);
      return setActiveIdx(to);
    }
    if (is("prevPane", ch, key) || is("nextPane", ch, key)) {
      const next = is("nextPane", ch, key);
      if (focus === "right") {
        // From the right column, "previous" goes back to the last pane.
        if (!next) { setActiveIdx(panes.length - 1); setFocus("chat"); }
        return;
      }
      // Keys can arrive faster than renders: use the live pane index, not this render's.
      const { ai: cur, panes: list } = panesRef.current;
      if (next && cur === list.length - 1 && right) return setFocus("right");
      const to = Math.max(0, Math.min(list.length - 1, cur + (next ? 1 : -1)));
      panesRef.current = { ...panesRef.current, ai: to };
      setActiveIdx(to);
      return setFocus("chat");
    }
    // Mouse capture off (select text with the mouse) / on (click).
    if (is("mouse", ch, key)) {
      setMouseOn((m) => !m);
      setMessage({ text: mouseOn ? "Mouse off: drag to select text" : "Mouse on" });
      return;
    }
    // Timeline / browser: open and focus; pressing again while focused closes it.
    for (const panel of ["timeline", "browser"] as const) {
      if (is(panel, ch, key)) {
        if (right === panel && focus === "right") {
          setRight(null);
          setFocus("chat");
        } else {
          setRight(panel);
          setFocus("right");
        }
        return;
      }
    }
    if (focus === "right") {
      // Tab moves between GitHub and the timeline; Esc in GitHub's list returns to the chat.
      if (TIMELINE && right === "timeline" && key.tab && !key.shift) return setRightPane((p) => (p === "github" ? "timeline" : "github"));
      if (key.escape && (right !== "timeline" || !TIMELINE || rightPane === "timeline")) setFocus("chat");
      return;
    }
    if (focus !== "sidebar") return;

    if (field) {
      if (key.escape) return setField(null);
      if (key.return) return submitField();
      if (key.backspace || key.delete) return setField({ ...field, value: field.value.slice(0, -1) });
      if (ch && !key.ctrl && !key.meta && !key.tab) setField({ ...field, value: field.value + ch.replace(/[\r\n]/g, "") });
      return;
    }
    if (key.upArrow || ch === "k") return setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow || ch === "j") return setCursor((c) => Math.min(rowList.length - 1, c + 1));
    const row = rowList[cursor];
    if (key.return) return activate();
    if (key.rightArrow || ch === "l") {
      if (row?.kind === "dir") return expand(row.id, true, row.path);
      return activate();
    }
    if (key.leftArrow || ch === "h") {
      // Collapse this folder, or jump to its parent row.
      if (row?.kind === "dir" && expanded.has(row.id)) return expand(row.id, false, row.path);
      // Rows know the folder row they sit under.
      const parent = row && "parent" in row ? row.parent : undefined;
      if (parent) {
        const idx = rowList.findIndex((r) => r.id === parent);
        if (idx !== -1) setCursor(idx);
      }
      return;
    }
    if (key.escape) return setFocus("chat");
    if (ch === "n") {
      const dir = rowPath(row);
      if (dir) return openSession(dir);
    }
    if (ch === "c") return setField({ purpose: "create", label: "New workspace name:", value: "" });
    if (ch === "a") return setField({ purpose: "link", label: "Folder path (~ ok):", value: "" });
    if (ch === "r") {
      reloadWorkspaces();
      for (const r of rowList) if (r.kind === "dir" && expanded.has(r.id)) reloadSessions(r.path);
      setMessage({ text: "Refreshed" });
    }
    if (key.ctrl && ch === "c") return quit();
  });

  const sidebarVisible = sidebarVisibleNow;

  return (
    <ThemeContext.Provider value={themeApi}>
    <KeysContext.Provider value={keysApi}>
    <Box flexDirection="row" width={columns} height={height} backgroundColor={theme.bg} columnGap={GAP}>
      {sidebarVisible && (
        <Box flexDirection="column" width={SIDEBAR_WIDTH} height={height} flexShrink={0} rowGap={VGAP}>
        <Surface api={themeApi} theme={sectionTheme(theme, "sidebar")}>
        <Sidebar
          rows={rowList}
          cursor={cursor}
          focused={focus === "sidebar"}
          width={SIDEBAR_WIDTH}
          height={sidebarH}
          expanded={expanded}
          activeCwd={active.cwd}
          activeSessionId={active.sessionId}
          field={field ? { label: field.label, value: field.value } : null}
          message={message}
        />
        </Surface>
        <Surface api={themeApi} theme={sectionTheme(theme, "usage")}>
        <Usage limits={limits} width={SIDEBAR_WIDTH} refreshing={limitsRefreshing} sourceColor={paneColor(theme, active)} />
        </Surface>
        </Box>
      )}
      {/* The bento grid of chat panes (see grid.ts), then the right column. */}
      {/* One wrapping container, every pane a direct child keyed by its id: a pane that moves
          to another row (e.g. after closing others) keeps its session. Per-row containers
          made React remount it, which dropped the transcript and started a new session.
          Each row's widths plus gaps add up to gridW exactly, so rows break where grid.ts says. */}
      <Box width={gridW} height={height} flexShrink={0} flexDirection="row" flexWrap="wrap" columnGap={GAP} rowGap={VGAP} alignContent="flex-start">
      {panes.map((p, i) => ({ p, i })).map(({ p, i }) => (
        <Surface key={"s" + p.id} api={themeApi} theme={chatTheme(theme, p.id)}>
        {p.choosing ? (
        <AgentPicker key={"pick-" + p.id} cwd={p.cwd} width={rects[i].w} height={rects[i].h}
          active={focus === "chat" && i === ai} cursor={i === ai ? pickCursor : -1} index={i} count={panes.length}
          paneColor={paneColor(theme, p)} paneBorder={paneBorder(p.id)} />
      ) : p.paused ? (
        <PausedPane key={"paused-" + p.id} cwd={p.cwd} width={rects[i].w} height={rects[i].h} agent={p.agent} title={paneTitle(p)}
          active={focus === "chat" && i === ai} index={i} count={panes.length} hasSession={!!(p.sessionId ?? p.resume)}
          paneColor={paneColor(theme, p)} paneBorder={paneBorder(p.id)} resumeKey={pretty(keymap.pausePane)} />
      ) : (
        <Chat
          agent={p.agent}
          title={paneTitle(p)}
          onTitle={(text) => setPanes((list) => list.map((q) => (q.id === p.id && !q.title ? { ...q, title: text } : q)))}
          paneColor={paneColor(theme, p)}
          paneBorder={paneBorder(p.id)}
          limitsRequest={i === ai ? limitsRequest : undefined}
          key={p.id}
          cwd={p.cwd}
          // A pane that ever gets rebuilt picks its own conversation back up.
          resume={p.resume ?? p.sessionId ?? undefined}
          width={rects[i].w}
          index={i}
          count={panes.length}
          active={focus === "chat" && i === ai}
          height={rects[i].h}
          onSessionId={(id) => {
            setPanes((list) => list.map((q) => (q.id === p.id ? { ...q, sessionId: id } : q)));
            if (p.role) for (const cb of wfCallbacks.current.session) cb(p.role, id);
          }}
          onTurnDone={() => {
            reloadSessions(p.cwd);
            if (p.role) for (const cb of wfCallbacks.current.turn) cb(p.role);
          }}
          extra={wfPane(p) ? { appendSystemPrompt: wfPane(p)!.appendSystemPrompt, mcpServers: wfPane(p)!.mcpServers, allowedTools: wfPane(p)!.allowedTools } : undefined}
          chip={p.role ? wfUi[p.role]?.status : undefined}
          banner={p.role ? wfUi[p.role]?.banner : undefined}
          inject={p.role ? wfInject[p.role] : undefined}
          onQuit={quit}
          onLimits={setLimits}
          prefill={i === ai ? chatPrefill : undefined}
          scrollRequest={chatScroll.pane === p.id ? chatScroll : NO_SCROLL}
          mouseOn={mouseOn}
          onNewSession={() => openSession(p.cwd, undefined, { alwaysNew: true, agent: p.agent })}
          onFocusSidebar={() => {
            setShowSidebar(true);
            setFocus("sidebar");
          }}
        />
        )}
        </Surface>
      ))}
      </Box>
      {right === "timeline" && (
          <Box flexDirection="column" width={rightWidth} height={height} flexShrink={0} rowGap={VGAP}>
            <Surface api={themeApi} theme={sectionTheme(theme, "github")}>
            <GitHubPanel cwd={active.cwd} width={rightWidth} height={TIMELINE ? githubH : height}
              focused={focus === "right" && rightPane === "github"} scrollRequest={githubScroll}
              onOpenUrl={(url) => {
                setRight("browser");
                setFocus("right");
                setBrowserOpen((b) => ({ n: b.n + 1, url }));
              }}
              onExit={() => setFocus("chat")}
              onAsk={(text) => {
                setChatPrefill((p) => ({ n: p.n + 1, text }));
                setFocus("chat");
              }} />
            </Surface>
            {TIMELINE && <Surface api={themeApi} theme={sectionTheme(theme, "timeline")}>
            <Timeline cwd={active.cwd} width={rightWidth} height={height - githubH - VGAP}
              focused={focus === "right" && rightPane === "timeline"} scrollRequest={rightScroll} />
            </Surface>}
          </Box>
        )}
        {right === "browser" && (
          <Surface api={themeApi} theme={sectionTheme(theme, "browser")}>
          <Browser width={rightWidth} height={height} focused={focus === "right"}
            scrollRequest={rightScroll} clickRequest={browserClick} openRequest={browserOpen} />
          </Surface>
        )}
    </Box>
    </KeysContext.Provider>
    </ThemeContext.Provider>
  );
}

// Ink switches to the alternate screen but leaves the cursor where the shell prompt was,
// so it would draw from mid-screen and run off the bottom. Switch and home the cursor first.
installMouseFilter();
if (process.stdout.isTTY) {
  process.stdout.write("\x1b[?1049h\x1b[H\x1b[2J");
  process.on("exit", () => process.stdout.write("\x1b[?25h\x1b[?1049l"));
}
render(<App />, { exitOnCtrlC: false, alternateScreen: true });
