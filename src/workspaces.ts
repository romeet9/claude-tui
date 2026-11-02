// Bridge to the ~/Claude Workspaces system (shared with ClaudeDesk and SessionBar).
// Creating and linking go through its own workspace.py, so new workspaces get
// context.md, the CLAUDE.md import and the context-saving hooks like every other one.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
export { recentSessions, type SessionInfo } from "./backends/index.js";

export const ROOT = path.join(os.homedir(), "Claude Workspaces");
const SCRIPT = path.join(ROOT, "_system", "workspace.py");

export type Workspace = {
  name: string;
  /** The real folder sessions run in (symlinks resolved). */
  path: string;
  linked: boolean;
};

import { DEMO } from "./demo.js";

export const isInstalled = () => DEMO || fs.existsSync(SCRIPT);

function run(args: string[]): string {
  try {
    return execFileSync("/usr/bin/python3", ["-I", SCRIPT, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    }).toString().trim();
  } catch (e: any) {
    const msg = e?.stderr?.toString().trim() || e?.message || String(e);
    throw new Error(msg);
  }
}

export function listWorkspaces(): Workspace[] {
  // Without the workspace script (or in the demo): every folder in ~/Claude Workspaces.
  if (DEMO || !fs.existsSync(SCRIPT)) {
    try {
      return fs.readdirSync(ROOT, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith("_") && !d.name.startsWith("."))
        .map((d) => ({ name: d.name, path: fs.realpathSync(path.join(ROOT, d.name)), linked: false }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  }
  try {
    const rows = JSON.parse(run(["list"])) as { name: string; real: string; linked: boolean }[];
    return rows.map((r) => ({ name: r.name, path: r.real, linked: r.linked }));
  } catch {
    return [];
  }
}

/** A new folder inside ~/Claude Workspaces. Returns its path. */
export function createWorkspace(name: string): string {
  const clean = name.trim();
  if (!clean) throw new Error("Give the workspace a name.");
  if (/[\/\\]/.test(clean) || clean.startsWith(".") || clean.startsWith("_")) {
    throw new Error("Names can't contain / or start with . or _");
  }
  if (!fs.existsSync(SCRIPT)) {
    // No workspace script: a plain folder in ~/Claude Workspaces.
    const dir = path.join(ROOT, clean);
    if (fs.existsSync(dir)) throw new Error(`'${clean}' already exists`);
    fs.mkdirSync(dir, { recursive: true });
    return fs.realpathSync(dir);
  }
  return fs.realpathSync(run(["create", clean]));
}

/** Adopts an existing folder in place (symlinked into ~/Claude Workspaces). Returns its real path. */
export function linkFolder(folder: string): string {
  const expanded = folder.trim().replace(/^~(?=$|\/)/, os.homedir());
  if (!expanded) throw new Error("Type a folder path.");
  const real = fs.realpathSync(path.resolve(expanded));
  if (!fs.existsSync(SCRIPT)) {
    // No workspace script: a symlink in ~/Claude Workspaces (the folder stays where it is).
    fs.mkdirSync(ROOT, { recursive: true });
    const entry = path.join(ROOT, path.basename(real));
    if (fs.existsSync(entry)) throw new Error(`'${path.basename(real)}' already exists in ~/Claude Workspaces`);
    fs.symlinkSync(real, entry);
    return real;
  }
  run(["link", real]);
  return real;
}

export function ago(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const SKIP = new Set(["node_modules", "__pycache__", "dist", "build", ".next", "venv", ".venv"]);

/** Visible subfolders of a folder (symlinks followed), sorted by name. */
export function listSubfolders(dir: string, limit = 60): { name: string; path: string }[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => !d.name.startsWith(".") && !SKIP.has(d.name))
      .filter((d) => {
        if (d.isDirectory()) return true;
        if (!d.isSymbolicLink()) return false;
        try { return fs.statSync(path.join(dir, d.name)).isDirectory(); } catch { return false; }
      })
      .map((d) => ({ name: d.name, path: path.join(dir, d.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
      .slice(0, limit);
  } catch {
    return [];
  }
}
