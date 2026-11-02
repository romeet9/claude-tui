// Rebindable shortcuts. Bindings are strings like "ctrl+t", "meta+v" or "f5",
// stored under "keys" in ~/.config/claude-tui/config.json and edited with /keys.
import { createContext, useContext } from "react";
import type { Key } from "ink";
import { readConfig, updateConfig } from "./config.js";

export const ACTIONS = {
  focusSidebar: "Focus sidebar / back to chat",
  newSession: "New session (pick an agent)",
  prevPane: "Previous pane",
  nextPane: "Next pane",
  paneAbove: "Pane above",
  paneBelow: "Pane below",
  movePaneUp: "Move this pane up (earlier in the grid)",
  movePaneDown: "Move this pane down (later in the grid)",
  closePane: "Close this pane",
  pausePane: "Pause / resume this chat",
  narrowPane: "Narrow the left column of the grid",
  widenPane: "Widen the left column of the grid",
  toggleSidebar: "Hide / show sidebar",
  timeline: "GitHub + timeline panel",
  browser: "Browser panel",
  expandTools: "Expand / collapse tool calls",
  voice: "Voice typing (start / stop)",
  mouse: "Mouse capture on / off",
  quit: "Quit",
} as const;

export type Action = keyof typeof ACTIONS;
export type Keymap = Record<Action, string>;

export const DEFAULT_KEYS: Keymap = {
  focusSidebar: "ctrl+w",
  newSession: "ctrl+n",
  prevPane: "shift+left",
  nextPane: "shift+right",
  paneAbove: "shift+up",
  paneBelow: "shift+down",
  movePaneUp: "ctrl+y",
  movePaneDown: "ctrl+d",
  closePane: "ctrl+x",
  pausePane: "ctrl+p",
  narrowPane: "ctrl+k",
  widenPane: "ctrl+l",
  toggleSidebar: "ctrl+b",
  timeline: "ctrl+t",
  browser: "ctrl+g",
  expandTools: "ctrl+e",
  voice: "ctrl+v",
  mouse: "ctrl+o",
  quit: "ctrl+q",
};

/** Keys that must keep their meaning (typing, sending, quitting a turn). */
export const RESERVED = new Set(["return", "backspace", "delete", "escape", "ctrl+c", "shift+tab", "tab"]);

const NAMED: [keyof Key, string][] = [
  ["upArrow", "up"], ["downArrow", "down"], ["leftArrow", "left"], ["rightArrow", "right"],
  ["pageUp", "pageup"], ["pageDown", "pagedown"], ["home", "home"], ["end", "end"],
  ["return", "return"], ["escape", "escape"], ["tab", "tab"], ["backspace", "backspace"], ["delete", "delete"],
];

/** Canonical name of a key event: "ctrl+t", "meta+x", "shift+tab", "f5", "a". */
export function describe(ch: string, key: Key): string {
  const mods = [key.ctrl && "ctrl", key.meta && "meta", key.shift && "shift"].filter(Boolean) as string[];
  let name = NAMED.find(([k]) => (key as any)[k])?.[1];
  if (!name) {
    const fn = ch.match(/^\x1b\[(\d+)~$/);
    name = ch === " " ? "space" : ch ? ch.toLowerCase() : "";
    if (fn) name = "f" + fn[1];
  }
  // A shifted letter arrives as an uppercase character; keep "shift" for named keys only.
  const keepShift = name.length > 1;
  return [...mods.filter((m) => m !== "shift" || keepShift), name].join("+");
}

/** "ctrl+t" → "^T", "meta+v" → "⌥V", "shift+tab" → "⇧tab". */
export const pretty = (binding: string) =>
  binding
    .split("+")
    .map((p) => (p === "ctrl" ? "^" : p === "meta" ? "⌥" : p === "shift" ? "⇧" : p.length === 1 ? p.toUpperCase() : p))
    .join("");

export function loadKeymap(): Keymap {
  const saved = (readConfig().keys ?? {}) as Partial<Keymap>;
  return { ...DEFAULT_KEYS, ...saved };
}

export function saveKeymap(map: Keymap) {
  const changed: Partial<Keymap> = {};
  for (const a of Object.keys(DEFAULT_KEYS) as Action[]) if (map[a] !== DEFAULT_KEYS[a]) changed[a] = map[a];
  updateConfig({ keys: changed });
}

export type KeysApi = {
  keys: Keymap;
  /** True if this key event is bound to the action. */
  is: (action: Action, ch: string, key: Key) => boolean;
  setKey: (action: Action, binding: string) => void;
  resetKeys: () => void;
  /** While /keys waits for a new key, global shortcuts are paused. */
  capturing: boolean;
  setCapturing: (on: boolean) => void;
};

export const KeysContext = createContext<KeysApi>({
  keys: DEFAULT_KEYS, is: () => false, setKey: () => {}, resetKeys: () => {}, capturing: false, setCapturing: () => {},
});
export const useKeys = () => useContext(KeysContext);
