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

export type Theme = Palette & {
  id: string;
  name: string;
  light?: boolean;
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
/** A divider row: a line, or blank space in flat blocks. */
export const ruleOf = (t: Theme, width: number) => (t.flat ? " " : "─").repeat(Math.max(0, width));

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
