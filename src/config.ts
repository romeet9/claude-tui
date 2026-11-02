// ~/.config/claude-tui/config.json: theme, key bindings, font.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CONFIG_PATH = path.join(os.homedir(), ".config", "claude-tui", "config.json");

export function readConfig(): Record<string, any> {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

export function updateConfig(patch: Record<string, unknown>) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...readConfig(), ...patch }, null, 2) + "\n");
}
