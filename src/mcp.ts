// Direct MCP connections owned by the UI (not the model): the Supermemory
// plugin's proxy for the timeline, and Browser MCP for the browser pane.
// Each connects lazily on first use and reconnects after a failure.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEMO } from "./demo.js";

type Spawn = { command: string; args: string[]; env?: Record<string, string>; cwd?: string };

export class McpConnection {
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;

  constructor(private readonly name: string, private readonly spawn: () => Spawn) {}

  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    if (!this.connecting) {
      this.connecting = (async () => {
        const s = this.spawn();
        const c = new Client({ name: `claude-tui-${this.name}`, version: "0.1.0" });
        await c.connect(new StdioClientTransport({
          command: s.command, args: s.args, cwd: s.cwd,
          env: { ...(process.env as Record<string, string>), ...(s.env ?? {}) },
          stderr: "ignore",
        }));
        c.onclose = () => { this.client = null; };
        this.client = c;
        return c;
      })().finally(() => { this.connecting = null; });
    }
    return this.connecting;
  }

  async call(tool: string, args: Record<string, unknown>): Promise<{ text: string; structured?: any; isError: boolean }> {
    try {
      const c = await this.connect();
      const r: any = await c.callTool({ name: tool, arguments: args });
      const text = (r.content ?? [])
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n");
      return { text, structured: r.structuredContent, isError: !!r.isError };
    } catch (e: any) {
      this.client = null;
      return { text: `${this.name}: ${e?.message ?? e}`, isError: true };
    }
  }

  async close() {
    const c = this.client;
    this.client = null;
    await c?.close().catch(() => {});
  }
}

// ---------- Supermemory ----------

/** The installed Supermemory plugin's folder (newest version in the plugin cache). */
/** The optional memory timeline only shows when its plugin is installed (never in the demo). */
export const hasTimeline = () => !DEMO && supermemoryRoot() !== null;

function supermemoryRoot(): string | null {
  const base = path.join(os.homedir(), ".claude", "plugins", "cache", "supermemory-plugins", "supermemory");
  try {
    const versions = fs.readdirSync(base).filter((v) => fs.existsSync(path.join(base, v, "hooks", "mcp-proxy.js")));
    versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    return versions[0] ? path.join(base, versions[0]) : null;
  } catch {
    return null;
  }
}

/** The plugin proxy scopes memories to the project of its working directory. */
export function supermemoryFor(cwd: string): McpConnection | null {
  const root = supermemoryRoot();
  if (!root) return null;
  return new McpConnection("supermemory", () => ({
    command: process.execPath,
    args: [path.join(root, "hooks", "mcp-proxy.js")],
    env: { CLAUDE_PLUGIN_ROOT: root },
    cwd,
  }));
}

export type Memory = { id: string; memory: string; createdAt: string; updatedAt: string; isStatic?: boolean };

export async function listMemories(conn: McpConnection, page: number, limit = 30) {
  const r = await conn.call("list_memories", { page, limit });
  if (r.isError) throw new Error(r.text);
  const entries: Memory[] = r.structured?.memoryEntries ?? [];
  const more = /More available/i.test(r.text);
  const total = Number(r.text.match(/(\d+) memory entries total/)?.[1] ?? NaN);
  return { entries, more, total: isNaN(total) ? undefined : total };
}

// ---------- Browser MCP (drives the user's Chrome through its extension) ----------

export const browser = new McpConnection("browser", () => ({
  command: "npx",
  args: ["-y", "@browsermcp/mcp@latest"],
}));

export const runBrowser = (commands: string) => browser.call("browser", { commands });
