// Color themes. The UI only ever asks for a handful of named roles (the names
// it was first written with: gray = muted, white = text, cyan = accent, …), so a
// theme is just those names mapped to colors, plus an optional window background.
import React, { createContext, useContext } from "react";
import { readConfig, updateConfig } from "./config.js";

export type Palette = {
  /** Window background; undefined keeps the terminal's own. */
  bg?: string;
  /** Main text. */
  white: string;
  /** Secondary text, hints, idle borders. */
  gray: string;
  /** Accent: focus, selection, headings, links. */
  cyan: string;
  green: string;
  yellow: string;
  red: string;
  magenta: string;
  /** Text drawn on the accent color (selected sidebar row). */
  black: string;
  /** Box borders. */
  border: string;
};

/**
 * The shape of the UI, not its colors: frames, titles, dividers, tags, glyphs and the
 * status line. A theme can set any of these; the rest come from DEFAULT_SKIN.
 * Geometry never changes (every frame is one cell wide), so layout and mouse math hold.
 */
export type Skin = {
  /** Panel frames. "none" keeps the space but draws nothing. */
  frame: FrameName;
  /** Chat panes: each its own frame style ("cycle") or the panel frame ("same"). */
  paneFrames: "cycle" | "same";
  /** How section titles are written. */
  title: "plain" | "caps" | "bracket" | "slash" | "hash" | "arrow" | "diamond" | "section";
  /** Divider character under titles and around the prompt (" " hides them). */
  divider: string;
  /** Agent tags on pane titles. */
  tag: "pill" | "bracket" | "dot" | "slash" | "caps";
  /** The prompt marker. */
  prompt: string;
  /** How your prompts appear in the transcript. */
  you: "band" | "quote" | "echo" | "bubble" | "card";
  /** Tool lines: finished and running markers. */
  tool: [done: string, running: string];
  /** Sidebar folders: open and closed markers. */
  tree: [open: string, closed: string];
  /** Status line: how segments are separated. */
  status: "pipes" | "dots" | "slashes" | "brackets" | "blocks";
  spinner: string[];
  /** How a focused panel shows it, beyond its border color. */
  focus: "border" | "dot" | "invert" | "arrow";
  /** Columns between side-by-side sections (rows between stacked ones = gap > 1 ? 1 : 0). */
  gap: number;
};

export type FrameName = "round" | "single" | "double" | "bold" | "classic" | "dashed" | "dotted" | "blocks" | "none";

export const DEFAULT_SKIN: Skin = {
  frame: "round", paneFrames: "cycle", title: "plain", divider: "─", tag: "pill", prompt: "›", you: "band",
  tool: ["◦", "◌"], tree: ["▾", "▸"], status: "pipes",
  spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], focus: "border", gap: 1,
};

export type Theme = Palette & {
  id: string;
  name: string;
  light?: boolean;
  /** The UI's shape (see Skin); unset parts use DEFAULT_SKIN. */
  skin?: Partial<Skin>;
  /** Per-panel focus colors; panels fall back to the accent (cyan). */
  focus?: { sidebar?: string; chat?: string; timeline?: string; browser?: string };
  /**
   * Block themes: each section is filled with its own color and drawn in dark ink
   * (see surfaceTheme). Chats cycle through chatBlocks as panes are added.
   */
  blocks?: Partial<Record<Section, string>> & { ink: string };
  chatBlocks?: string[];
  /** Inside a block: no lines (borders and dividers vanish into the fill). */
  flat?: boolean;
  /** Inside a block: the slightly darker fill used for cards and menus. */
  card?: string;
};

/** A border color, or the block's own fill in flat blocks (so the line disappears). */
export const bc = (t: Theme, color: string) => (t.flat && t.bg ? t.bg : color);
/** The theme's skin, with defaults filled in. */
export const skinOf = (t: Theme): Skin => ({ ...DEFAULT_SKIN, ...(t.skin ?? {}) });
/** A divider row in the theme's divider character, or blank space in flat blocks. */
export const ruleOf = (t: Theme, width: number) => (t.flat ? " " : skinOf(t).divider || " ").repeat(Math.max(0, width));

type BoxChars = { topLeft: string; top: string; topRight: string; right: string; bottomRight: string; bottom: string; bottomLeft: string; left: string };
const CUSTOM_FRAMES: Partial<Record<FrameName, BoxChars>> = {
  dashed: { topLeft: "┌", top: "╌", topRight: "┐", right: "╎", bottomRight: "┘", bottom: "╌", bottomLeft: "└", left: "╎" },
  dotted: { topLeft: "·", top: "·", topRight: "·", right: "·", bottomRight: "·", bottom: "·", bottomLeft: "·", left: "·" },
  blocks: { topLeft: "▛", top: "▀", topRight: "▜", right: "▐", bottomRight: "▟", bottom: "▄", bottomLeft: "▙", left: "▌" },
  none: { topLeft: " ", top: " ", topRight: " ", right: " ", bottomRight: " ", bottom: " ", bottomLeft: " ", left: " " },
};
/** An Ink borderStyle for a frame name (built-in names pass through). */
export const frameStyle = (name: FrameName): any => CUSTOM_FRAMES[name] ?? name;
/** A panel's frame. */
export const frameOf = (t: Theme) => frameStyle(skinOf(t).frame);
const PANE_CYCLE: FrameName[] = ["round", "bold", "double", "single"];
/** A chat pane's frame: its own style per pane, or the theme's panel frame. */
export const paneFrameOf = (t: Theme, paneId: number) =>
  skinOf(t).paneFrames === "same" ? frameOf(t) : frameStyle(PANE_CYCLE[paneId % PANE_CYCLE.length]);

/** A section title in the theme's style ("Workspaces" → "[ WORKSPACES ]", "// workspaces"…). */
export function titleOf(t: Theme, text: string): string {
  switch (skinOf(t).title) {
    case "caps": return text.toUpperCase();
    case "bracket": return `[ ${text.toUpperCase()} ]`;
    case "slash": return `// ${text.toLowerCase()}`;
    case "hash": return `# ${text}`;
    case "arrow": return `▸ ${text}`;
    case "diamond": return `◆ ${text}`;
    case "section": return `§ ${text}`;
    default: return text;
  }
}
/** Marker before a focused panel's title ("● ", "▶ "…), or "". */
export const focusMark = (t: Theme, focused: boolean) => {
  if (!focused) return t.flat ? "" : "";
  const f = skinOf(t).focus;
  return f === "dot" || t.flat ? "● " : f === "arrow" ? "▶ " : "";
};
/** Whether a focused panel's title is drawn inverted (accent background). */
export const focusInvert = (t: Theme, focused: boolean) => focused && skinOf(t).focus === "invert";

export type Section = "sidebar" | "usage" | "github" | "timeline" | "browser";

export const THEMES: Theme[] = [
  {
    id: "terminal", name: "Terminal (your terminal's colors)",
    white: "white", gray: "gray", cyan: "cyan", green: "green", yellow: "yellow",
    red: "red", magenta: "magenta", black: "black", border: "gray",
  },
  {
    id: "dracula", name: "Dracula", bg: "#282a36",
    white: "#f8f8f2", gray: "#7b88b8", cyan: "#8be9fd", green: "#50fa7b", yellow: "#f1fa8c",
    red: "#ff5555", magenta: "#ff79c6", black: "#282a36", border: "#44475a",
  },
  {
    id: "tokyo-night", name: "Tokyo Night", bg: "#1a1b26",
    white: "#c0caf5", gray: "#6b7394", cyan: "#7dcfff", green: "#9ece6a", yellow: "#e0af68",
    red: "#f7768e", magenta: "#bb9af7", black: "#1a1b26", border: "#3b4261",
  },
  {
    id: "catppuccin-mocha", name: "Catppuccin Mocha", bg: "#1e1e2e",
    white: "#cdd6f4", gray: "#7f849c", cyan: "#89dceb", green: "#a6e3a1", yellow: "#f9e2af",
    red: "#f38ba8", magenta: "#cba6f7", black: "#1e1e2e", border: "#45475a",
  },
  {
    id: "nord", name: "Nord", bg: "#2e3440",
    white: "#d8dee9", gray: "#7b88a1", cyan: "#88c0d0", green: "#a3be8c", yellow: "#ebcb8b",
    red: "#bf616a", magenta: "#b48ead", black: "#2e3440", border: "#4c566a",
  },
  {
    id: "gruvbox", name: "Gruvbox Dark", bg: "#282828",
    white: "#ebdbb2", gray: "#928374", cyan: "#8ec07c", green: "#b8bb26", yellow: "#fabd2f",
    red: "#fb4934", magenta: "#d3869b", black: "#282828", border: "#504945",
  },
  {
    id: "one-dark", name: "One Dark", bg: "#282c34",
    white: "#abb2bf", gray: "#6b717d", cyan: "#56b6c2", green: "#98c379", yellow: "#e5c07b",
    red: "#e06c75", magenta: "#c678dd", black: "#282c34", border: "#3e4451",
  },
  {
    id: "rose-pine", name: "Rosé Pine", bg: "#191724",
    white: "#e0def4", gray: "#6e6a86", cyan: "#9ccfd8", green: "#3e8fb0", yellow: "#f6c177",
    red: "#eb6f92", magenta: "#c4a7e7", black: "#191724", border: "#26233a",
  },
  {
    id: "solarized-dark", name: "Solarized Dark", bg: "#002b36",
    white: "#93a1a1", gray: "#657b83", cyan: "#2aa198", green: "#859900", yellow: "#b58900",
    red: "#dc322f", magenta: "#d33682", black: "#002b36", border: "#073642",
  },
  {
    id: "monochrome", name: "Monochrome (matches status line #27)", bg: "#111111",
    white: "#e8e8e8", gray: "#6a6a6a", cyan: "#ffffff", green: "#9a9a9a", yellow: "#c8c8c8",
    red: "#c03030", magenta: "#b0b0b0", black: "#111111", border: "#333333",
  },
  {
    // Figma's brand colors: the logo's red-orange, coral, purple, blue and green on
    // Figma's dark canvas. Each panel lights up in a different logo color when focused.
    id: "figma", name: "Figma", bg: "#1e1e1e",
    white: "#f5f5f5", gray: "#8c8c8c", cyan: "#1abcfe", green: "#0acf83", yellow: "#ffc700",
    red: "#f24e1e", magenta: "#a259ff", black: "#1e1e1e", border: "#3a3a3a",
    focus: { sidebar: "#a259ff", chat: "#1abcfe", timeline: "#0acf83", browser: "#ff7262" },
  },
  {
    // Figma's brand colors as solid blocks with dark ink, on Figma's dark canvas.
    id: "figma-blocks", name: "Figma Blocks", bg: "#1e1e1e",
    white: "#f5f5f5", gray: "#8c8c8c", cyan: "#1abcfe", green: "#0acf83", yellow: "#ffc700",
    red: "#f24e1e", magenta: "#a259ff", black: "#1e1e1e", border: "#3a3a3a",
    blocks: { ink: "#1e1e1e", sidebar: "#a259ff", usage: "#ffc700", github: "#0acf83", timeline: "#ff7262", browser: "#1abcfe" },
    chatBlocks: ["#1abcfe", "#ffffff", "#f24e1e", "#ff7262", "#0acf83"],
  },
  {
    id: "figma-light", name: "Figma Light", bg: "#ffffff", light: true,
    white: "#1e1e1e", gray: "#8c8c8c", cyan: "#0d99ff", green: "#14ae5c", yellow: "#e5a000",
    red: "#f24e1e", magenta: "#9747ff", black: "#ffffff", border: "#e6e6e6",
    focus: { sidebar: "#9747ff", chat: "#0d99ff", timeline: "#14ae5c", browser: "#f24e1e" },
  },
  {
    id: "catppuccin-latte", name: "Catppuccin Latte (light)", bg: "#eff1f5", light: true,
    white: "#4c4f69", gray: "#8c8fa1", cyan: "#1e66f5", green: "#40a02b", yellow: "#df8e1d",
    red: "#d20f39", magenta: "#8839ef", black: "#eff1f5", border: "#bcc0cc",
  },
  {
    id: "solarized-light", name: "Solarized Light", bg: "#fdf6e3", light: true,
    white: "#586e75", gray: "#93a1a1", cyan: "#268bd2", green: "#859900", yellow: "#b58900",
    red: "#dc322f", magenta: "#d33682", black: "#fdf6e3", border: "#eee8d5",
  },
  // ---------- styled themes: each one a palette plus its own UI shape (see Skin) ----------
  {
    id: "retro-dos", name: "Retro DOS", bg: "#0000a8",
    white: "#ffffff", gray: "#a8a8a8", cyan: "#ffff55", green: "#55ff55", yellow: "#ffff55",
    red: "#ff5555", magenta: "#ff55ff", black: "#0000a8", border: "#a8a8a8",
    skin: { frame: "double", paneFrames: "same", title: "bracket", divider: "═", tag: "bracket", prompt: ">", you: "echo",
      tool: ["■", "□"], tree: ["-", "+"], status: "brackets", spinner: ["|", "/", "-", "\\"], focus: "invert" },
  },
  {
    id: "matrix", name: "Matrix", bg: "#000000",
    white: "#9cff9c", gray: "#2e7d32", cyan: "#00ff41", green: "#00ff41", yellow: "#c6ff00",
    red: "#ff3d3d", magenta: "#76ff03", black: "#000000", border: "#0b3d0b",
    skin: { frame: "dashed", paneFrames: "same", title: "slash", divider: "╌", tag: "slash", prompt: "λ", you: "echo",
      tool: ["▪", "▫"], tree: ["▼", "▶"], status: "slashes", spinner: ["⡀", "⠄", "⠂", "⠁", "⠈", "⠐", "⠠", "⢀"], focus: "arrow" },
  },
  {
    id: "brutalist", name: "Brutalist (light)", bg: "#ffffff", light: true,
    white: "#000000", gray: "#555555", cyan: "#ff3b00", green: "#00a651", yellow: "#c79a00",
    red: "#ff3b00", magenta: "#0047ff", black: "#ffffff", border: "#000000",
    skin: { frame: "blocks", paneFrames: "same", title: "caps", divider: "━", tag: "caps", prompt: "→", you: "card",
      tool: ["■", "▢"], tree: ["−", "+"], status: "blocks", spinner: ["▖", "▘", "▝", "▗"], focus: "invert", gap: 2 },
  },
  {
    id: "paper", name: "Paper (light)", bg: "#f8f4e8", light: true,
    white: "#2b2621", gray: "#8a8172", cyan: "#b5501b", green: "#4f7d35", yellow: "#a87a00",
    red: "#b3261e", magenta: "#7a4f9a", black: "#f8f4e8", border: "#d8cfbd",
    skin: { frame: "none", paneFrames: "same", title: "section", divider: "·", tag: "dot", prompt: "✎", you: "quote",
      tool: ["·", "∘"], status: "dots", spinner: ["◜", "◝", "◞", "◟"], focus: "dot", gap: 2 },
  },
  {
    id: "synthwave", name: "Synthwave", bg: "#1a1033",
    white: "#f8e9ff", gray: "#8b6fb3", cyan: "#ff2a6d", green: "#05d9e8", yellow: "#ffd319",
    red: "#ff2a6d", magenta: "#d300c5", black: "#1a1033", border: "#4b2d7f",
    skin: { frame: "double", paneFrames: "cycle", title: "diamond", divider: "═", tag: "pill", prompt: "▶", you: "bubble",
      tool: ["◆", "◇"], tree: ["▼", "▶"], status: "blocks", spinner: ["◐", "◓", "◑", "◒"], focus: "border", gap: 2 },
  },
  {
    id: "nord-frost", name: "Nord Frost", bg: "#242933",
    white: "#eceff4", gray: "#7b88a1", cyan: "#88c0d0", green: "#a3be8c", yellow: "#ebcb8b",
    red: "#bf616a", magenta: "#b48ead", black: "#242933", border: "#3b4252",
    skin: { frame: "round", paneFrames: "same", title: "plain", divider: "─", tag: "dot", prompt: "❯", you: "quote",
      tool: ["✓", "…"], tree: ["⌄", "›"], status: "dots", spinner: ["·  ", "·· ", "···", " ··", "  ·"], focus: "dot", gap: 2 },
  },
  {
    id: "amber-crt", name: "Amber CRT", bg: "#0c0800",
    white: "#ffb000", gray: "#8a5f00", cyan: "#ffcc33", green: "#ffb000", yellow: "#ffd966",
    red: "#ff6a00", magenta: "#ffcc66", black: "#0c0800", border: "#4d3500",
    skin: { frame: "classic", paneFrames: "same", title: "caps", divider: "-", tag: "bracket", prompt: "$", you: "echo",
      tool: ["*", "~"], tree: ["v", ">"], status: "brackets", spinner: ["|", "/", "-", "\\"], focus: "arrow" },
  },
  {
    id: "glass", name: "Glass", bg: "#10141c",
    white: "#e6edf7", gray: "#6b7a90", cyan: "#7dd3fc", green: "#86efac", yellow: "#fde68a",
    red: "#fca5a5", magenta: "#c4b5fd", black: "#10141c", border: "#263043",
    skin: { frame: "round", paneFrames: "same", title: "plain", divider: "┈", tag: "pill", prompt: "›", you: "card",
      tool: ["○", "◌"], status: "dots", focus: "dot", gap: 2 },
  },
  {
    id: "blueprint", name: "Blueprint", bg: "#0b3a6e",
    white: "#e6f0ff", gray: "#8fb3e0", cyan: "#ffffff", green: "#9ef0c0", yellow: "#ffe28a",
    red: "#ff9a8a", magenta: "#c9b6ff", black: "#0b3a6e", border: "#4f7fbf",
    skin: { frame: "dashed", paneFrames: "same", title: "section", divider: "┄", tag: "bracket", prompt: "▸", you: "quote",
      tool: ["✓", "⋯"], tree: ["▿", "▹"], status: "slashes", spinner: ["┤", "┘", "┴", "└", "├", "┌", "┬", "┐"], focus: "arrow" },
  },
  {
    id: "zen", name: "Zen (no frames)", bg: "#121212",
    white: "#dedede", gray: "#6e6e6e", cyan: "#9ecbff", green: "#8fd694", yellow: "#e5c07b",
    red: "#ef7b7b", magenta: "#c49bdb", black: "#121212", border: "#2a2a2a",
    skin: { frame: "none", paneFrames: "same", title: "plain", divider: " ", tag: "dot", prompt: "❯", you: "echo",
      tool: ["·", "…"], status: "dots", spinner: ["◡", "⊙", "◠"], focus: "dot", gap: 3 },
  },
  {
    id: "forest", name: "Forest", bg: "#14201a",
    white: "#e3ecd9", gray: "#7c8f7a", cyan: "#8bc34a", green: "#8bc34a", yellow: "#e0c068",
    red: "#e07a5f", magenta: "#b39ddb", black: "#14201a", border: "#2c3e33",
    skin: { frame: "round", paneFrames: "cycle", title: "arrow", divider: "─", tag: "dot", prompt: "»", you: "band",
      tool: ["•", "◦"], status: "pipes", spinner: ["◴", "◷", "◶", "◵"], focus: "border" },
  },
  {
    id: "solar-flare", name: "Solar Flare", bg: "#1c1410",
    white: "#fff1e6", gray: "#a08670", cyan: "#ff7a1a", green: "#9ccc65", yellow: "#ffc233",
    red: "#ff4d2e", magenta: "#ff6fa3", black: "#1c1410", border: "#4a3426",
    skin: { frame: "bold", paneFrames: "same", title: "caps", divider: "━", tag: "pill", prompt: "»", you: "band",
      tool: ["▶", "▷"], tree: ["▼", "▶"], status: "blocks", spinner: ["▁", "▃", "▄", "▅", "▆", "▇", "▆", "▅", "▄", "▃"], focus: "invert" },
  },
  {
    id: "rose-bubble", name: "Rosé Bubble", bg: "#2a1f2d",
    white: "#fbe7f0", gray: "#a3889b", cyan: "#ff8fb7", green: "#a6e3b8", yellow: "#ffd59e",
    red: "#ff7a90", magenta: "#d0a6ff", black: "#2a1f2d", border: "#4b3650",
    skin: { frame: "round", paneFrames: "cycle", title: "plain", divider: "┈", tag: "dot", prompt: "♡", you: "bubble",
      tool: ["✿", "❀"], status: "dots", spinner: ["♡", "♥"], focus: "dot", gap: 2 },
  },
  {
    id: "mono-ink", name: "Mono Ink (light)", bg: "#ffffff", light: true,
    white: "#111111", gray: "#8a8a8a", cyan: "#111111", green: "#2e7d32", yellow: "#8d6e00",
    red: "#c62828", magenta: "#555555", black: "#ffffff", border: "#d0d0d0",
    skin: { frame: "single", paneFrames: "same", title: "caps", divider: "─", tag: "caps", prompt: ">", you: "card",
      tool: ["—", "…"], tree: ["−", "+"], status: "slashes", spinner: ["-", "\\", "|", "/"], focus: "invert" },
  },
  {
    id: "newsprint", name: "Newsprint (light)", bg: "#f6f6ef", light: true,
    white: "#222222", gray: "#828282", cyan: "#ff6600", green: "#3c8d2f", yellow: "#b07a00",
    red: "#d93a00", magenta: "#7a5195", black: "#f6f6ef", border: "#e0dccd",
    skin: { frame: "none", paneFrames: "same", title: "hash", divider: "─", tag: "bracket", prompt: ">", you: "quote",
      tool: ["•", "◦"], tree: ["[-]", "[+]"], status: "pipes", focus: "arrow" },
  },
  {
    id: "cyberpunk", name: "Cyberpunk", bg: "#0d0d0d",
    white: "#f0f0f0", gray: "#7a7a7a", cyan: "#fcee0a", green: "#00f0ff", yellow: "#fcee0a",
    red: "#ff003c", magenta: "#ff00a0", black: "#0d0d0d", border: "#333333",
    skin: { frame: "bold", paneFrames: "cycle", title: "slash", divider: "━", tag: "slash", prompt: ">>", you: "band",
      tool: ["▰", "▱"], tree: ["▼", "▶"], status: "slashes", spinner: ["▰▱▱", "▰▰▱", "▰▰▰", "▱▰▰", "▱▱▰"], focus: "invert" },
  },
  {
    id: "ocean-deep", name: "Ocean Deep", bg: "#0a1a2f",
    white: "#dbe9f6", gray: "#6c87a3", cyan: "#2ec4b6", green: "#7ae582", yellow: "#f6c85f",
    red: "#ef6f6c", magenta: "#9b8cff", black: "#0a1a2f", border: "#1f3a5a",
    skin: { frame: "round", paneFrames: "same", title: "plain", divider: "─", tag: "pill", prompt: "≫", you: "band",
      tool: ["○", "◌"], status: "dots", spinner: ["◜", "◠", "◝", "◞", "◡", "◟"], focus: "border", gap: 2 },
  },
  {
    id: "lavender", name: "Lavender (light)", bg: "#f3f0fa", light: true,
    white: "#2e2540", gray: "#8e86a3", cyan: "#7c5cff", green: "#3f9c6b", yellow: "#a57600",
    red: "#d14d72", magenta: "#a259ff", black: "#f3f0fa", border: "#ddd5f0",
    skin: { frame: "round", paneFrames: "same", title: "plain", divider: "·", tag: "pill", prompt: "›", you: "quote",
      status: "dots", focus: "dot", gap: 2 },
  },
  {
    id: "espresso", name: "Espresso", bg: "#1e1714",
    white: "#f3e9dc", gray: "#9c8573", cyan: "#d4a373", green: "#a3b18a", yellow: "#e9c46a",
    red: "#e76f51", magenta: "#c08497", black: "#1e1714", border: "#3d2e26",
    skin: { frame: "double", paneFrames: "same", title: "bracket", divider: "═", tag: "bracket", prompt: "»", you: "card",
      tool: ["•", "∘"], status: "brackets", focus: "arrow" },
  },
  {
    id: "high-contrast", name: "High Contrast", bg: "#000000",
    white: "#ffffff", gray: "#c0c0c0", cyan: "#ffff00", green: "#00ff00", yellow: "#ffff00",
    red: "#ff3030", magenta: "#ff66ff", black: "#000000", border: "#ffffff",
    skin: { frame: "bold", paneFrames: "same", title: "caps", divider: "━", tag: "caps", prompt: "▶", you: "card",
      tool: ["✓", "…"], tree: ["▼", "▶"], status: "brackets", spinner: ["◐", "◓", "◑", "◒"], focus: "invert" },
  },
];

// ---------- block surfaces ----------

const hex = (c: string) => c.replace("#", "").match(/../g)!.map((x) => parseInt(x, 16));
/** Blend a toward b by `amount` (0 = a, 1 = b). */
export function mix(a: string, b: string, amount: number): string {
  const [x, y] = [hex(a), hex(b)];
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * amount).toString(16).padStart(2, "0")).join("");
}

/**
 * The theme a section uses inside its block: the block color as background, dark
 * ink for text, softened ink for secondary text and lines, and deep status colors
 * that stay readable on a bright background. Themes without blocks pass through.
 */
export function surfaceTheme(t: Theme, block: string | undefined): Theme {
  if (!t.blocks || !block) return t;
  const ink = t.blocks.ink;
  return {
    ...t,
    id: `${t.id}@${block}`,
    bg: block,
    white: ink,
    gray: mix(block, ink, 0.62),
    border: mix(block, ink, 0.4),
    cyan: ink,
    black: block,
    green: mix("#006b3c", ink, 0.1),
    yellow: mix("#7a4a00", ink, 0.05),
    red: mix("#b0170a", ink, 0.05),
    magenta: mix("#4b0fa8", ink, 0.05),
    focus: undefined,
    blocks: undefined,
    chatBlocks: undefined,
    flat: true,
    card: mix(block, ink, 0.1),
  };
}

export const sectionTheme = (t: Theme, s: Section) => surfaceTheme(t, t.blocks?.[s]);
export const chatTheme = (t: Theme, paneId: number) =>
  surfaceTheme(t, t.chatBlocks ? t.chatBlocks[paneId % t.chatBlocks.length] : undefined);

export const themeById = (id: string | undefined) => THEMES.find((t) => t.id === id) ?? THEMES[0];

/** One line about a theme's shape, for the /theme picker. */
export function describeSkin(t: Theme): string {
  if (!t.skin) return t.blocks ? "color blocks" : t.bg ? "" : "uses your terminal's background";
  const k = skinOf(t);
  const frame = { round: "rounded", single: "thin", double: "double", bold: "heavy", classic: "ASCII", dashed: "dashed", dotted: "dotted", blocks: "block", none: "no" }[k.frame];
  return `${frame} frames · ${k.title} titles · ${k.you} prompts · ${k.prompt}`;
}

/** Resolves a role name ("gray", "cyan", …) or passes a literal color through. */
export const paint = (t: Theme, name: string) => (t as any)[name] ?? name;

// ---------- persistence: "theme" in ~/.config/claude-tui/config.json ----------

export function savedThemeId(argv: string[]): string | undefined {
  const i = argv.indexOf("--theme");
  if (i !== -1 && argv[i + 1]) return argv[i + 1];
  const id = readConfig().theme;
  return typeof id === "string" ? id : undefined;
}

export function saveThemeId(id: string) {
  updateConfig({ theme: id });
}

// ---------- React plumbing ----------

export type ThemeApi = {
  /** The theme this part of the screen draws with (a section's block, in block themes). */
  theme: Theme;
  /** The theme the user picked (what /theme lists and restores). */
  base?: Theme;
  setTheme: (id: string, persist?: boolean) => void;
};
export const ThemeContext = createContext<ThemeApi>({ theme: THEMES[0], setTheme: () => {} });

/** Draw children with a section's own theme (its block, in block themes). */
export function Surface({ api, theme, children }: { api: ThemeApi; theme: Theme; children: React.ReactNode }) {
  return React.createElement(ThemeContext.Provider, { value: { ...api, base: api.base ?? api.theme, theme } }, children);
}
export const useTheme = () => useContext(ThemeContext).theme;
export const useThemeApi = () => useContext(ThemeContext);
