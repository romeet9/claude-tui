// One Agent SDK session: transcript, permission box, prompt, and status line.
// The root remounts this (new React key) to start or resume a different session.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput, useBoxMetrics, type DOMElement } from "ink";
import type { PermissionMode, SlashCommand } from "@anthropic-ai/claude-agent-sdk";
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { nextMode, initialMode } from "./agent.js";
import { startAgent, agentInfo, type AgentEvent, type AgentKind, type PendingPermission } from "./backends/index.js";
import { item, describeTool, messageToItems, tidy, type Item } from "./transcript.js";
import { renderMarkdown } from "./markdown.js";
import { toBlocks, summarize, workflowOf, type Workflow, type ToolCall } from "./blocks.js";
import { WorkflowCard } from "./Cards.js";
import { PaneTitle } from "./PaneTitle.js";
import { AgentLogo } from "./Logo.js";
import os from "node:os";
import { monoFonts, currentFont, setFont, canChangeFont } from "./font.js";
import { Dictation } from "./voice.js";
import { toPct, toMs, type Limits } from "./Usage.js";
import { useTheme, useThemeApi, paint, THEMES , bc, ruleOf } from "./theme.js";
import { useKeys, ACTIONS, RESERVED, describe, pretty, type Action } from "./keys.js";

const MODE_LABEL: Record<PermissionMode, { text: string; color: string }> = {
  default: { text: "default", color: "gray" },
  acceptEdits: { text: "⏵⏵ accept edits", color: "magenta" },
  plan: { text: "⏸ plan", color: "cyan" },
  auto: { text: "⏵⏵ auto", color: "yellow" },
  bypassPermissions: { text: "⏵⏵ bypass", color: "red" },
  dontAsk: { text: "don't ask", color: "red" },
};

function gitBranch(cwd: string): string {
  try {
    return execFileSync("git", ["--no-optional-locks", "-C", cwd, "symbolic-ref", "--short", "HEAD"], {
      stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
  } catch {
    return "";
  }
}

const shortModel = (id: string) => {
  const m = id.match(/(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?/i);
  return m ? `${m[1][0].toUpperCase()}${m[2]}${m[3] ? "." + m[3] : ""}` : id;
};

const pctColor = (p: number) => (p >= 80 ? "red" : p >= 50 ? "yellow" : "gray");
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const MAX_ITEMS = 400;

/** Commands this app answers itself (Claude Code's own menus aren't available through the SDK). */
const LOCAL_COMMANDS: SlashCommand[] = [
  { name: "mcp", description: "MCP servers: status, reconnect, enable/disable", argumentHint: "" },
  { name: "model", description: "Switch the model for this session", argumentHint: "" },
  { name: "theme", description: "Change the color theme (previews as you move)", argumentHint: "" },
  { name: "keys", description: "Change keyboard shortcuts", argumentHint: "" },
  { name: "font", description: "Change the terminal font and size (previews as you move)", argumentHint: "" },
  { name: "new", description: "Start a new session in this folder", argumentHint: "" },
  { name: "exit", description: "Quit claude-tui", argumentHint: "" },
];

type MenuRow = { id: string; label: string; detail: string; color: string; swatch?: string[] };
type Menu = {
  kind: "mcp" | "model" | "theme" | "keys" | "font"; title: string; hint: string; rows: MenuRow[]; cursor: number; note?: string;
  /** Theme to go back to when the theme picker is cancelled. */
  original?: string;
  /** Font picker: the font to restore on cancel, and the size being previewed. */
  originalFont?: { name: string; size: number };
  size?: number;
};

const MCP_COLOR: Record<string, string> = {
  connected: "green", failed: "red", "needs-auth": "yellow", pending: "gray", disabled: "gray",
};

export type ChatProps = {
  cwd: string;
  /** Which CLI this pane talks to. */
  agent: AgentKind;
  /** The session's name for the title bar ("New session" until there is one). */
  title: string;
  /** The first prompt of a new session, to name it until the agent's own title arrives. */
  onTitle: (text: string) => void;
  /** Workflows: extra instructions/tools, a status chip, a banner line, and prompts to send. */
  extra?: { appendSystemPrompt?: string; mcpServers?: Record<string, unknown>; allowedTools?: string[] };
  chip?: { text: string; color?: string } | null;
  banner?: { text: string; color?: string } | null;
  /** Every prompt the workflow sent this pane, in order (append-only). */
  inject?: string[];
  resume?: string;
  /** Keyboard goes to the chat (false while the sidebar has focus). */
  active: boolean;
  /** Pane width, and its place among the panes (for the title). */
  width: number;
  /** Each pane's own border: color and line style. */
  paneColor: string;
  paneBorder: "round" | "bold" | "double" | "single";
  /** Bump n to re-read the plan usage now (the ⟳ on the Usage card). */
  limitsRequest?: { n: number };
  index: number;
  count: number;
  height: number;
  onSessionId: (id: string) => void;
  onTurnDone: () => void;
  onQuit: () => void;
  onNewSession: () => void;
  onFocusSidebar: () => void;
  /** Session usage for the Usage panel, after every change. */
  /** The plan's 5-hour and weekly usage, for the Usage bars. */
  onLimits: (l: Limits) => void;
  /** Text to put in the input (e.g. "About <PR>: " from the GitHub panel). */
  prefill?: { n: number; text: string };
  /** Mouse wheel over the transcript; `n` changes on every wheel tick. */
  scrollRequest: { n: number; delta: number };
  mouseOn: boolean;
};

export function Chat({ cwd, agent, title, onTitle, extra, chip, banner, inject, resume, active, width, paneColor, paneBorder, limitsRequest, index, count, height, onSessionId, onTurnDone, onQuit, onNewSession, onFocusSidebar, scrollRequest, mouseOn, onLimits, prefill }: ChatProps) {
  const t = useTheme();
  const themeApi = useThemeApi();
  const keysApi = useKeys();
  const [items, setItems] = useState<Item[]>([]);
  /** Ctrl+E: show every tool call instead of one summary line per group. */
  const [verbose, setVerbose] = useState(false);
  useEffect(() => {
    if (prefill?.n) setInput(prefill.text);
  }, [prefill?.n]);
  const [live, setLive] = useState("");
  const [input, setInput] = useState("");
  /** The input as of the last render, for key chunks handled before the next one. */
  const inputRef = useRef("");
  inputRef.current = input;
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<PermissionMode>(() => initialMode(cwd, process.argv));
  const [model, setModel] = useState("");
  const [cost, setCost] = useState(0);
  const [ctxPct, setCtxPct] = useState<number | null>(null);
  const [limits, setLimits] = useState<Limits>({});
  // The Usage card shows the focused pane's agent (panes may be different agents).
  useEffect(() => {
    if (active) onLimits(limits);
  }, [limits, active]);
  const [branch, setBranch] = useState(() => gitBranch(cwd));
  const [pending, setPending] = useState<PendingPermission | null>(null);
  const [tick, setTick] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [commands, setCommands] = useState<SlashCommand[]>(LOCAL_COMMANDS);
  const [sugCursor, setSugCursor] = useState(0);
  const [menu, setMenu] = useState<Menu | null>(null);
  /** Rows scrolled up from the bottom of the transcript; 0 follows new output. */
  const [scrollUp, setScrollUp] = useState(0);
  const viewRef = useRef<DOMElement>(null);
  const contentRef = useRef<DOMElement>(null);
  const view = useBoxMetrics(viewRef);
  const content = useBoxMetrics(contentRef);
  const maxScroll = Math.max(0, content.height - view.height);
  const scrollBy = (rows: number) => setScrollUp((n) => Math.max(0, Math.min(maxScroll, n + rows)));
  useEffect(() => {
    if (scrollRequest.n) scrollBy(scrollRequest.delta);
  }, [scrollRequest.n]);

  const push = (...xs: Item[]) => setItems((prev) => [...prev, ...xs].slice(-MAX_ITEMS));

  const modeRef = useRef(mode);
  modeRef.current = mode;

  const info = agentInfo(agent);
  const isClaude = agent === "claude";
  const session = useMemo(
    () => startAgent(agent, { cwd, resume, mode: modeRef.current, onPermission: (p) => setPending(p), extra }),
    [],
  );

  // Plan usage (5-hour / weekly) for the Usage bars: at start, after each turn, every minute.
  function refreshLimits() {
    if (!session.readLimits) {
      setLimits({ source: info.tag, note: `${info.name} doesn't report plan usage to claude-tui.` });
      return;
    }
    session.readLimits()
      .then((l) => {
        if (!l) return;
        setLimits((prev) => ({
          source: l.source ?? info.tag,
          fiveHour: l.fiveHour ?? prev.fiveHour,
          weekly: l.weekly ?? prev.weekly,
        }));
      })
      .catch(() => {});
  }
  useEffect(() => {
    if (limitsRequest?.n) { lastLimits.current = Date.now(); refreshLimits(); }
  }, [limitsRequest?.n]);
  // Only the focused pane's usage is on screen: read it on focus (at most every 20s) and
  // every minute while focused. Background panes don't spawn usage checks.
  const activeRef = useRef(active);
  activeRef.current = active;
  const lastLimits = useRef(0);
  const refreshIfDue = (minGap: number) => {
    if (Date.now() - lastLimits.current < minGap) return;
    lastLimits.current = Date.now();
    refreshLimits();
  };
  useEffect(() => {
    if (active) refreshIfDue(20_000);
  }, [active]);
  useEffect(() => {
    const timer = setInterval(() => activeRef.current && refreshIfDue(55_000), 60_000);
    return () => clearInterval(timer);
  }, [session]);

  // Slash commands for the "/" popup (the CLI answers this before the first prompt).
  const loadCommands = () =>
    session.supportedCommands?.().then((list) => {
      const local = new Set(LOCAL_COMMANDS.map((c) => c.name));
      setCommands([...LOCAL_COMMANDS, ...list.filter((c) => !local.has(c.name))]);
    }).catch(() => {});
  useEffect(() => {
    if (!isClaude) setCommands(LOCAL_COMMANDS.filter((c) => c.name !== "mcp" && (c.name !== "model" || !!session.setModel)));
    loadCommands();
  }, [session]);

  // Past messages of a resumed session.
  useEffect(() => {
    if (!resume) return;
    session.history?.()
      .then((msgs) => {
        const past = msgs.flatMap((m) => messageToItems(m as any, true));
        setItems((prev) => [...prev, ...past.slice(-MAX_ITEMS), item("info", "─── resumed ───")]);
      })
      .catch(() => {});
  }, []);

  // The SDK's message stream, for the life of this session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        for await (const m of session) {
          if (cancelled) break;
          handle(m);
        }
      } catch (e: any) {
        if (!cancelled) push(item("error", `Session ended: ${e?.message ?? e}`));
        setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
      try { session.close(); } catch {}
    };
  }, [session]);

  function handle(m: AgentEvent) {
    if (process.env.CLAUDE_TUI_DEBUG && m.type !== "stream_event") {
      appendFileSync(process.env.CLAUDE_TUI_DEBUG, JSON.stringify(m) + "\n");
    }
    switch (m.type) {
      case "tui":
        if (m.kind === "info" || m.kind === "error") push(item(m.kind, m.text));
        else if (m.kind === "ctx") setCtxPct(m.pct);
        else if (m.kind === "limits") setLimits(m.limits);
        else if (m.kind === "model") setModel(m.model);
        return;
      case "system":
        if (m.subtype === "init") {
          setModel(m.model);
          setMode(m.permissionMode);
          if (m.session_id) onSessionId(m.session_id);
          loadCommands();
        }
        return;
      case "stream_event": {
        const ev: any = m.event;
        if (m.parent_tool_use_id === null && ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
          setLive((s) => s + ev.delta.text);
        }
        return;
      }
      case "assistant":
      case "user": {
        const rows = messageToItems(m as any);
        if (m.type === "assistant" && m.parent_tool_use_id === null) setLive("");
        if (rows.length) push(...rows);
        return;
      }
      case "rate_limit_event": {
        const r = m.rate_limit_info;
        const slot = r.rateLimitType === "five_hour" ? "fiveHour" : r.rateLimitType === "seven_day" ? "weekly" : null;
        if (slot && r.utilization != null) {
          setLimits((prev) => ({ ...prev, [slot]: { pct: toPct(r.utilization!), resetsAt: toMs(r.resetsAt) ?? (prev[slot] !== "none" ? prev[slot]?.resetsAt : undefined) } }));
        }
        return;
      }
      case "result": {
        setLive("");
        setBusy(false);
        setCost((c) => m.total_cost_usd || c);
        lastLimits.current = Date.now();
        refreshLimits();
        if (m.subtype !== "success" && (m.subtype as string) !== "tui_failed") push(item("error", `Turn ended: ${m.subtype}`));
        setBranch(gitBranch(cwd));
        if (isClaude) session.getContextUsage?.().then((u) => setCtxPct(u.percentage)).catch(() => {});
        onTurnDone();
        return;
      }
    }
  }

  // Workflow prompts: sent when the pane is idle, queued while it works.
  const injectQueue = useRef<string[]>([]);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const injected = useRef(0);
  useEffect(() => {
    if (!inject || inject.length <= injected.current) return;
    injectQueue.current.push(...inject.slice(injected.current));
    injected.current = inject.length;
    if (!busyRef.current && !pending) submit(injectQueue.current.shift(), true);
  }, [inject?.length]);
  useEffect(() => {
    if (!busy && !pending && injectQueue.current.length) submit(injectQueue.current.shift(), true);
  }, [busy, pending]);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setTick((n) => n + 1), 100);
    return () => clearInterval(t);
  }, [busy]);

  function cycleMode() {
    const m = nextMode(modeRef.current);
    setMode(m); // the status line changes now, not after the next prompt
    session.setPermissionMode(m).catch((e) => push(item("error", `Mode change failed: ${e?.message ?? e}`)));
  }

  function answer(allow: boolean, always = false) {
    if (!pending) return;
    const p = pending;
    setPending(null);
    if (!allow) {
      p.resolve({ behavior: "deny", message: "The user declined this tool call." });
      push(item("info", `✗ declined ${p.toolName}`));
      return;
    }
    p.resolve({
      behavior: "allow",
      updatedInput: p.input,
      ...(always ? { updatedPermissions: p.suggestions ?? [] } : {}),
    });
    if (p.toolName === "ExitPlanMode") setMode("default");
  }

  async function openMcpMenu(note?: string) {
    setMenu({ kind: "mcp", title: "MCP servers", hint: "⏎ reconnect · t enable/disable · esc close", rows: [], cursor: 0, note: "Loading…" });
    try {
      if (!session.mcpServerStatus) throw new Error(`not available for ${info.name}`);
      const list = await session.mcpServerStatus();
      const rows = list.map((sv) => ({
        id: sv.name,
        label: sv.name,
        detail: sv.status + (sv.tools?.length ? ` · ${sv.tools.length} tools` : "") + (sv.error ? ` · ${sv.error}` : ""),
        color: MCP_COLOR[sv.status] ?? t.gray,
      }));
      setMenu((m) => (m && m.kind === "mcp" ? { ...m, rows, cursor: Math.min(m.cursor, Math.max(0, rows.length - 1)), note } : m));
    } catch (e: any) {
      setMenu((m) => (m ? { ...m, note: `Failed: ${e?.message ?? e}` } : m));
    }
  }

  async function openModelMenu() {
    setMenu({ kind: "model", title: "Model", hint: "⏎ switch · esc close", rows: [], cursor: 0, note: "Loading…" });
    try {
      if (!session.supportedModels) throw new Error(`not available for ${info.name}`);
      const list = await session.supportedModels();
      const rows = list.map((mo) => ({ id: mo.value, label: mo.displayName, detail: mo.description, color: t.white }));
      const cur = Math.max(0, list.findIndex((mo) => (mo.resolvedModel ?? mo.value) === model));
      setMenu((m) => (m ? { ...m, rows, cursor: cur, note: undefined } : m));
    } catch (e: any) {
      setMenu((m) => (m ? { ...m, note: `Failed: ${e?.message ?? e}` } : m));
    }
  }

  // Voice typing: live words while listening, appended to the input when it stops.
  const dictation = useMemo(() => new Dictation(), []);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  useEffect(() => () => dictation.cancel(), []);
  function toggleVoice() {
    if (dictation.active) {
      dictation.stop();
      return;
    }
    setHeard("");
    setListening(true);
    dictation.start({
      onPartial: (text) => setHeard(text),
      onFinal: (text) => {
        setListening(false);
        setHeard("");
        if (text.trim()) setInput((s) => (s && !s.endsWith(" ") ? s + " " : s) + text.trim());
      },
      onError: (msg) => {
        setListening(false);
        setHeard("");
        push(item("error", `Voice: ${msg}`));
      },
    });
  }

  /** Which action /keys is waiting to rebind. */
  const [capture, setCapture] = useState<Action | null>(null);

  // The /keys rows are rebuilt from the live keymap so a change shows at once.
  const rowsOf = (m: Menu): MenuRow[] =>
    m.kind === "keys"
      ? (Object.keys(ACTIONS) as Action[]).map((a) => ({
          id: a, label: ACTIONS[a], detail: capture === a ? "press a key…" : pretty(keysApi.keys[a]),
          color: capture === a ? "yellow" : "cyan",
        }))
      : m.rows;

  function openFontMenu() {
    if (!canChangeFont()) {
      push(item("info", "Fonts belong to the terminal: /font can change them in macOS Terminal. In other terminals, use their font settings."));
      return;
    }
    const cur = currentFont() ?? { name: "SFMonoTerminal-Regular", size: 12 };
    const fonts = monoFonts();
    const rows = fonts.map((f) => ({ id: f.postscript, label: f.family, detail: f.postscript === cur.name ? "current" : "", color: "gray" }));
    setMenu({
      kind: "font", title: "Terminal font", hint: "↑↓ preview · + − size · ⏎ keep · esc cancel",
      rows, cursor: Math.max(0, fonts.findIndex((f) => f.postscript === cur.name)),
      originalFont: cur, size: cur.size,
      note: `${cur.size}pt · More fonts: brew install --cask font-jetbrains-mono font-geist-mono font-fira-code`,
    });
  }

  function openKeysMenu() {
    setMenu({ kind: "keys", title: "Keyboard shortcuts", hint: "⏎ change · d defaults · esc close", rows: [], cursor: 0 });
  }

  function openThemeMenu() {
    const rows = THEMES.map((th) => ({
      id: th.id,
      label: th.name,
      detail: th.bg ? "" : "uses your terminal's background",
      color: "gray",
      swatch: [th.bg ?? th.black, th.white, th.cyan, th.green, th.yellow, th.red, th.magenta],
    }));
    setMenu({
      kind: "theme", title: "Theme", hint: "↑↓ preview · ⏎ keep · esc cancel",
      rows, cursor: Math.max(0, THEMES.findIndex((th) => th.id === (themeApi.base ?? t).id)), original: (themeApi.base ?? t).id,
    });
  }

  function moveMenu(delta: number) {
    if (!menu) return;
    const rows = rowsOf(menu);
    const cursor = Math.max(0, Math.min(rows.length - 1, menu.cursor + delta));
    setMenu({ ...menu, cursor });
    if (menu.kind === "theme") themeApi.setTheme(rows[cursor].id, false); // live preview
    if (menu.kind === "font") setFont(rows[cursor].id, menu.size ?? 12);
  }

  function closeMenu() {
    if (menu?.kind === "theme" && menu.original) themeApi.setTheme(menu.original, false);
    if (menu?.kind === "font" && menu.originalFont) setFont(menu.originalFont.name, menu.originalFont.size);
    setMenu(null);
  }

  async function menuAction(kind: "enter" | "toggle") {
    if (!menu) return;
    const row = rowsOf(menu)[menu.cursor];
    if (!row) return;
    if (menu.kind === "font") {
      if (kind === "enter") {
        const err = setFont(row.id, menu.size ?? 12);
        setMenu(null);
        push(item(err ? "error" : "info", err ?? `Font: ${row.label} ${menu.size}pt`));
      }
      return;
    }
    if (menu.kind === "keys") {
      if (kind === "enter") {
        setCapture(row.id as Action);
        keysApi.setCapturing(true);
        setMenu({ ...menu, note: `Press the new key for "${row.label}" (esc cancels)` });
      }
      return;
    }
    try {
      if (menu.kind === "mcp") {
        if (kind === "enter") {
          setMenu({ ...menu, note: `Reconnecting ${row.id}…` });
          await session.reconnectMcpServer?.(row.id);
          return openMcpMenu(`Reconnected ${row.id}`);
        }
        const enable = row.detail.startsWith("disabled");
        await session.toggleMcpServer?.(row.id, enable);
        return openMcpMenu(`${enable ? "Enabled" : "Disabled"} ${row.id}`);
      }
      if (menu.kind === "theme" && kind === "enter") {
        themeApi.setTheme(row.id, true);
        setMenu(null);
        push(item("info", `Theme: ${row.label}`));
        return;
      }
      if (menu.kind === "model" && kind === "enter") {
        await session.setModel?.(row.id);
        setModel(row.label);
        setMenu(null);
        push(item("info", `Model set to ${row.label}`));
      }
    } catch (e: any) {
      setMenu({ ...menu, note: `Failed: ${e?.message ?? e}` });
    }
  }

  /** keepDraft: a workflow message is sent without touching what you're typing. */
  function submit(override?: string, keepDraft = false) {
    const text = (override ?? input).trim();
    if (!keepDraft) {
      setInput("");
      setSugCursor(0);
    }
    if (!text) return;
    if (text === "/exit" || text === "/quit") return onQuit();
    if (text === "/new" || text === "/clear") return onNewSession();
    if (text === "/mcp" && isClaude) return void openMcpMenu();
    if (text === "/model") return void openModelMenu();
    if (text === "/theme") return openThemeMenu();
    if (text === "/keys") return openKeysMenu();
    if (text === "/font") return openFontMenu();
    push(item("user", text));
    if (title === "New session") onTitle(text.replace(/\s+/g, " ").slice(0, 80));
    setScrollUp(0);
    setBusy(true);
    setStartedAt(Date.now());
    session.send(text);
  }

  const query = input.startsWith("/") && !/\s/.test(input) ? input.slice(1).toLowerCase() : null;
  const suggestions = query === null ? [] : [
    ...commands.filter((c) => c.name.toLowerCase().startsWith(query)),
    ...commands.filter((c) => !c.name.toLowerCase().startsWith(query) && c.name.toLowerCase().includes(query)),
  ].slice(0, 8);
  const sug = suggestions[Math.min(sugCursor, suggestions.length - 1)];

  useInput(
    (ch, key) => {
      if (capture) {
        const done = (note?: string) => {
          setCapture(null);
          keysApi.setCapturing(false);
          setMenu((m) => (m ? { ...m, note } : m));
        };
        if (key.escape) return done("Cancelled");
        const binding = describe(ch, key);
        if (!binding || RESERVED.has(binding) || !/^(ctrl|meta)\+|^f\d+$/.test(binding)) {
          return setMenu((m) => (m ? { ...m, note: `${pretty(binding) || "That key"} can't be a shortcut: use Ctrl, Option or an F-key (esc cancels)` } : m));
        }
        const clash = (Object.keys(ACTIONS) as Action[]).find((a) => a !== capture && keysApi.keys[a] === binding);
        if (clash) return setMenu((m) => (m ? { ...m, note: `${pretty(binding)} is already "${ACTIONS[clash]}" (esc cancels)` } : m));
        keysApi.setKey(capture, binding);
        return done(`Saved: ${ACTIONS[capture]} = ${pretty(binding)}`);
      }
      if (key.tab && key.shift) return cycleMode();

      if (menu) {
        if (key.escape) return closeMenu();
        if (key.upArrow) return moveMenu(-1);
        if (key.downArrow) return moveMenu(1);
        if (key.return) return void menuAction("enter");
        if (ch === "t" && menu.kind === "mcp") return void menuAction("toggle");
        if ((ch === "+" || ch === "=" || ch === "-") && menu.kind === "font") {
          const size = Math.max(8, Math.min(32, (menu.size ?? 12) + (ch === "-" ? -1 : 1)));
          const row = rowsOf(menu)[menu.cursor];
          if (row) setFont(row.id, size);
          return setMenu({ ...menu, size, note: `${size}pt` });
        }
        if (ch === "d" && menu.kind === "keys") {
          keysApi.resetKeys();
          return setMenu({ ...menu, note: "Restored the default shortcuts" });
        }
        return;
      }

      if (suggestions.length && !pending) {
        if (key.upArrow) return setSugCursor((c) => Math.max(0, c - 1));
        if (key.downArrow) return setSugCursor((c) => Math.min(suggestions.length - 1, c + 1));
        if (key.tab) return setInput("/" + sug.name + " ");
        if (key.return) return submit("/" + sug.name);
        if (key.escape) return setInput("");
      }
      // Shift+↑/↓ move between panes (the root handles them).
      if (key.shift && (key.upArrow || key.downArrow)) return;
      // Scrolling. macOS Terminal turns the mouse wheel into ↑/↓ in full-screen apps.
      if (key.pageUp) return scrollBy(Math.max(1, view.height - 2));
      if (key.pageDown) return scrollBy(-Math.max(1, view.height - 2));
      if (!pending && key.upArrow) return scrollBy(1);
      if (!pending && key.downArrow) return scrollBy(-1);
      if (keysApi.is("expandTools", ch, key)) return setVerbose((v) => !v);
      if (keysApi.is("voice", ch, key)) return toggleVoice();
      if (listening && key.escape) {
        dictation.cancel();
        setListening(false);
        return setHeard("");
      }
      if (key.home) return setScrollUp(maxScroll);
      if (key.end) return setScrollUp(0);

      if (pending) {
        if (ch === "y" || key.return) return answer(true);
        if (ch === "a") return answer(true, true);
        if (ch === "n" || key.escape) return answer(false);
        return;
      }
      if (key.escape) {
        if (busy) session.interrupt().catch(() => {});
        return;
      }
      if (key.ctrl && ch === "c") {
        if (busy) session.interrupt().catch(() => {});
        else if (input) setInput("");
        else onQuit();
        return;
      }
      if (key.tab) return onFocusSidebar();
      if (key.return) return submit();
      if (key.backspace || key.delete) {
        setSugCursor(0);
        return setInput((s) => s.slice(0, -1));
      }
      if (key.ctrl && ch === "u") return setInput("");
      if (ch && !key.ctrl && !key.meta && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow) {
        setSugCursor(0);
        // While the screen is busy, the last typed letters and Enter can arrive as one
        // chunk ("sky?\r"). A single trailing Enter means "send", not a pasted newline.
        if (/^[^\r\n]+\r$/.test(ch)) {
          const text = inputRef.current + tidy(ch.slice(0, -1));
          inputRef.current = "";
          return submit(text);
        }
        setInput((s) => s + tidy(ch).replace(/\r\n?/g, "\n"));
      }
    },
    { isActive: active },
  );

  // ---------- render ----------
  // (suggestions are computed before useInput below reads them)

  const modeInfo = MODE_LABEL[mode] ?? { text: mode, color: t.gray };
  const elapsed = busy ? Math.floor((Date.now() - startedAt) / 1000) : 0;
  const sep = <Text color={t.gray}> │ </Text>;
  const up = Math.min(scrollUp, maxScroll);
  // Inner width of the panel (the transcript fills it), and room for a reply after the "⏺ " marker.
  const inner = Math.max(20, view.width || 80);
  const accent = paneColor;
  const rule = <Text color={t.border}>{ruleOf(t, inner)}</Text>;

  return (
    <Box flexDirection="column" height={height} width={width} flexShrink={0} backgroundColor={t.bg} borderStyle={paneBorder} borderBackgroundColor={t.bg}
      borderColor={bc(t, pending && !active ? t.yellow : accent)} borderDimColor={!active && !pending} paddingX={1}>
      {/* Header, like the sidebar and right panels: title, then a divider. */}
      <Box flexShrink={0} flexDirection="column">
        <PaneTitle agent={agent} name={title} active={active} accent={accent}
          status={pending && !active ? { text: "needs approval", color: t.yellow } : chip ? { text: chip.text, color: chip.color ? paint(t, chip.color) : accent } : busy && !active ? { text: "working", color: t.gray } : undefined}
          details={path.basename(cwd) + (branch ? " ▸ " + branch : "")}
          icon={{ text: "✕", color: busy ? t.red : t.gray }} />
        {banner && (
          <Box flexShrink={0} height={1} overflow="hidden">
            <Text wrap="truncate" color={banner.color ? paint(t, banner.color) : t.gray}>{banner.text}</Text>
          </Box>
        )}
        {rule}
      </Box>

      {/* Transcript: a clipped viewport scrolled with contentOffsetY; the prompt and
          status line below it never move. */}
      <Box ref={viewRef} flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0} overflow="hidden"
        contentOffsetY={maxScroll - up}>
       <Box ref={contentRef} flexDirection="column" flexShrink={0}>
        {!items.length && !live && (
          // A new session: the agent's pixel icon, centered, with its name, model and folder.
          <Box flexDirection="column" alignItems="center" justifyContent="center" flexShrink={0}
            width={inner} height={Math.max(1, view.height)}>
            <AgentLogo agent={agent} color={accent} />
            <Text> </Text>
            <Text bold color={t.white}>{info.name}</Text>
            <Text wrap="truncate" color={t.gray}>
              {(() => {
                // Model · folder; a long folder is cut from the left so its end stays readable.
                const m = model ? shortModel(model) + " · " : "";
                const dir = cwd.replace(os.homedir(), "~");
                const room = Math.max(8, inner - 4 - m.length);
                return m + (dir.length > room ? "…" + dir.slice(dir.length - room + 1) : dir);
              })()}
            </Text>
            {resume && <Text color={t.gray}>Loading conversation…</Text>}
          </Box>
        )}
        {toBlocks(items).map((b, i, all) => {
          if (b.kind === "tools") {
            const errors = b.calls.filter((c) => c.isError).length;
            const running = busy && i === all.length - 1 && b.calls[b.calls.length - 1].result === undefined;
            if (!verbose) {
              // Figma, browser and GitHub work get their own cards; everything else one summary line.
              const flows = new Map<Workflow, ToolCall[]>();
              const rest: ToolCall[] = [];
              for (const call of b.calls) {
                const w = workflowOf(call);
                if (w) flows.set(w, [...(flows.get(w) ?? []), call]);
                else rest.push(call);
              }
              const last = b.calls[b.calls.length - 1];
              const restErrors = rest.filter((c) => c.isError).length;
              return (
                <Box key={"g" + b.id} flexShrink={0} flexDirection="column">
                  {rest.length > 0 && (
                    <Text wrap="truncate" color={t.gray}>
                      <Text color={running && !workflowOf(last) ? t.yellow : restErrors ? t.red : t.gray}>
                        {running && !workflowOf(last) ? "◌ " : "◦ "}
                      </Text>
                      {running && !workflowOf(last) ? last.text : summarize(rest)}
                      {restErrors > 0 && <Text color={t.red}>{"  "}{restErrors} failed</Text>}
                    </Text>
                  )}
                  {[...flows].map(([w, calls]) => (
                    <WorkflowCard key={w} workflow={w} calls={calls} width={Math.min(inner, 72)}
                      running={running && workflowOf(last) === w} />
                  ))}
                </Box>
              );
            }
            return (
              <Box key={"g" + b.id} flexShrink={0} flexDirection="column">
                {b.calls.map((c, k) => (
                  <Box key={k} flexDirection="column">
                    <Text wrap="truncate" color={t.white}><Text color={c.isError ? t.red : t.green}>◦ </Text>{c.text}</Text>
                    {c.result !== undefined && (
                      <Text wrap="truncate" color={c.isError ? t.red : t.gray}>{"  ⎿ "}{c.result}</Text>
                    )}
                  </Box>
                ))}
              </Box>
            );
          }
          const it = b.item;
          const gap = it.kind === "user" && i > 0 ? 1 : it.kind === "text" ? 1 : 0;
          return (
            <Box key={it.id} flexShrink={0} marginTop={gap}>
              {it.kind === "user" && (
                <>
                  <Text color={accent}>▌ </Text>
                  <Box width={inner - 2}><Text bold color={t.white}>{it.text}</Text></Box>
                </>
              )}
              {it.kind === "text" && (
                <Box flexDirection="column" width={inner}>
                  <Text color={t.white}>{renderMarkdown(it.text, inner, t)}</Text>
                </Box>
              )}
              {it.kind === "info" && <Text color={t.gray}>{it.text}</Text>}
              {it.kind === "error" && <Text color={t.red}>{it.text}</Text>}
            </Box>
          );
        })}
        {live && (
          <Box flexShrink={0} marginTop={1} flexDirection="column" width={inner}>
            <Text color={t.white}>{renderMarkdown(live, inner, t)}</Text>
          </Box>
        )}
       </Box>
      </Box>

      {up > 0 && (
        <Box flexShrink={0}>
          <Text color={t.yellow}>↑ {up} lines up · ↓/PgDn/End to return</Text>
        </Box>
      )}
      {busy && !pending && (
        <Box flexShrink={0}>
          <Text color={accent}>{SPINNER[tick % SPINNER.length]} </Text>
          <Text color={t.gray}>working · {elapsed}s · esc to stop</Text>
        </Box>
      )}

      {pending && (
        <Box flexShrink={0} flexDirection="column" borderStyle="round" backgroundColor={t.card} borderBackgroundColor={t.card ?? t.bg} borderColor={t.card ?? bc(t, t.yellow)} paddingX={1}>
          <Text bold color={t.white}>Allow {describeTool(pending.toolName, pending.input)}?</Text>
          {pending.toolName === "ExitPlanMode" && typeof pending.input.plan === "string" && (
            <Text color={t.white}>{pending.input.plan}</Text>
          )}
          {pending.reason && <Text color={t.gray}>{pending.reason}</Text>}
          <Text color={t.white}>
            <Text color={t.green}>y</Text> yes ·{" "}
            {pending.canAlways !== false && <><Text color={t.green}>a</Text> yes, don't ask again this session ·{" "}</>}
            <Text color={t.red}>n</Text> no
          </Text>
        </Box>
      )}

      {menu && (
        <Box flexShrink={0} flexDirection="column" borderStyle="round" backgroundColor={t.card} borderBackgroundColor={t.card ?? t.bg} borderColor={t.card ?? bc(t, t.cyan)} paddingX={1}>
          <Text bold color={t.cyan}>{menu.title}</Text>
          {(() => {
            // Name column fits the longest name; long menus scroll around the selection.
            const mrows = rowsOf(menu);
            const nameW = Math.min(40, Math.max(...mrows.map((r) => r.label.length), 8) + 2);
            const room = Math.max(4, Math.min(12, height - 12));
            const first = Math.min(Math.max(0, menu.cursor - room + 2), Math.max(0, mrows.length - room));
            return (
              <>
                {first > 0 && <Text color={t.gray}>  ↑ {first} more</Text>}
                {mrows.slice(first, first + room).map((r, j) => {
                  const i = first + j;
                  return (
                    <Text key={r.id} wrap="truncate" color={t.white}>
                      <Text color={i === menu.cursor ? t.cyan : t.gray}>{i === menu.cursor ? "› " : "  "}</Text>
                      <Text bold={i === menu.cursor} color={i === menu.cursor ? t.cyan : t.white}>{r.label.padEnd(nameW)}</Text>
                      {r.swatch && r.swatch.map((sw, k) => <Text key={k} color={sw}>{"██"}</Text>)}
                      <Text color={paint(t, r.color)}>{r.swatch ? "  " : ""}{r.detail}</Text>
                    </Text>
                  );
                })}
                {first + room < mrows.length && <Text color={t.gray}>  ↓ {mrows.length - first - room} more</Text>}
              </>
            );
          })()}
          {menu.note && <Text color={t.yellow}>{menu.note}</Text>}
          <Text color={t.gray}>{menu.hint}</Text>
        </Box>
      )}

      {!menu && suggestions.length > 0 && active && (
        <Box flexShrink={0} flexDirection="column">
          {rule}
          {suggestions.map((c, i) => {
            const sel = c === sug;
            return (
              <Text key={c.name} wrap="truncate" color={t.white}>
                <Text color={sel ? t.cyan : t.white} bold={sel}>{("/" + c.name).padEnd(26)}</Text>
                <Text color={sel ? t.white : t.gray}>{c.description}</Text>
              </Text>
            );
          })}
        </Box>
      )}

      {/* Footer: prompt and status line, divided like the other panels' footers. */}
      <Box flexShrink={0} flexDirection="column">
        {rule}
        <Text color={t.white}>
          <Text bold color={listening ? t.red : active && !pending ? accent : t.gray}>{listening ? "● " : "› "}</Text>
          {input}
          {listening && <Text color={accent}>{input && heard ? " " : ""}{heard || (input ? "" : "listening…")}</Text>}
          {active && <Text inverse color={t.white}> </Text>}
          {listening && <Text color={t.gray}>{"  "}{pretty(keysApi.keys.voice)} to stop · esc to cancel</Text>}
          {!active && !input && <Text color={t.gray}>click or {pretty(keysApi.keys.focusSidebar)} to type · {pretty(keysApi.keys.voice)} to dictate</Text>}
        </Text>
        {rule}
        <Text wrap="truncate" color={t.white}>
          {!isClaude && <Text color={accent}>{info.glyph} {info.short} </Text>}
          <Text bold color={t.white}>{model ? shortModel(model) : "…"}</Text>
          {ctxPct != null && (
            <>
              {sep}
              <Text color={t.gray}>ctx </Text>
              <Text color={paint(t, pctColor(ctxPct))}>{Math.round(ctxPct)}%</Text>
            </>
          )}
          {isClaude && (
            <>
              {sep}
              <Text color={t.gray}>${cost.toFixed(2)}</Text>
            </>
          )}
          {sep}
          <Text bold color={paint(t, modeInfo.color)}>{modeInfo.text}</Text>
          <Text color={t.gray}> (shift+tab)</Text>
          {!mouseOn && <Text color={t.yellow}>  mouse off ({pretty(keysApi.keys.mouse)})</Text>}
        </Text>
      </Box>
    </Box>
  );
}
