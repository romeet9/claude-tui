// Antigravity through `agy` print mode with stream-json in and out: one process per
// conversation, one NDJSON line per prompt. Headless agy can't ask for permission —
// a tool that needs it is auto-denied — so the permission mode picks agy's --mode,
// and changing mode (or model) restarts agy on the same conversation.
import { spawn, execFile, type ChildProcess } from "node:child_process";
import readline from "node:readline";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { toMs, type Limits } from "../Usage.js";
import { EventQueue, msg, type AgentEvent, type AgentSession, type StartOptions, type ModelChoice } from "./types.js";

const AGY_HOME = path.join(os.homedir(), ".gemini", "antigravity-cli");

/** Claude-style mode → agy --mode (agy's default is "request-review"). */
const AGY_MODE: Partial<Record<PermissionMode, string>> = { acceptEdits: "accept-edits", plan: "plan", auto: "auto" };

/** agy's tool names and Capitalized parameters → the names the transcript knows. */
function tool(name: string, params: Record<string, any> = {}): { name: string; input: Record<string, unknown> } {
  const p = params ?? {};
  const file = p.AbsolutePath ?? p.TargetFile ?? p.Path ?? p.File ?? p.FilePath;
  switch (name) {
    case "run_command": return { name: "Bash", input: { command: p.CommandLine ?? p.Command ?? "" } };
    case "view_file": return { name: "Read", input: { file_path: file ?? "" } };
    case "write_to_file": case "write_file": return { name: "Write", input: { file_path: file ?? "" } };
    case "replace_file_content": case "multi_replace_file_content": case "sed_file": return { name: "Edit", input: { file_path: file ?? "" } };
    case "list_dir": return { name: "LS", input: { path: p.DirectoryPath ?? file ?? "" } };
    case "grep_search": return { name: "Grep", input: { pattern: p.Query ?? p.Pattern ?? "" } };
    case "find_by_name": return { name: "Glob", input: { pattern: p.Pattern ?? p.SearchDirectory ?? "" } };
    case "search_web": return { name: "WebSearch", input: { query: p.query ?? p.Query ?? "" } };
    case "read_url_content": return { name: "WebFetch", input: { url: p.Url ?? p.url ?? "" } };
    case "call_mcp_tool": return { name: `mcp__${p.ServerName ?? p.server ?? "mcp"}__${p.ToolName ?? p.tool ?? "tool"}`, input: p.Arguments ?? p };
  }
  // Anything else: keep agy's name, lower-case the first letter of each key so describeTool finds them.
  const input: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) input[k.charAt(0).toLowerCase() + k.slice(1)] = v;
  return { name, input };
}

export class AgySession implements AgentSession {
  readonly kind = "agy" as const;
  private q = new EventQueue<AgentEvent>();
  private proc: ChildProcess | null = null;
  private conversation: string | undefined;
  private mode: PermissionMode;
  private model: string | undefined;
  private busy = false;
  /** Text streamed so far, per agent_response step. */
  private texts = new Map<number, string>();
  private toolsSeen = new Set<number>();
  private closed = false;

  constructor(private opts: StartOptions) {
    this.mode = opts.mode;
    this.conversation = opts.resume;
    // Say hello right away so the status line has a model and the pane its session id.
    setTimeout(() => this.q.push(msg.init(this.conversation ?? "", this.model ?? "default model", this.mode)), 0);
  }

  [Symbol.asyncIterator]() { return this.q[Symbol.asyncIterator](); }

  private start() {
    const args = ["--input-format", "stream-json", "--output-format", "stream-json"];
    if (this.conversation) args.push("--conversation", this.conversation);
    const m = AGY_MODE[this.mode];
    if (m) args.push("--mode", m);
    if (this.model) args.push("--model", this.model);
    args.push("-p=");
    const proc = spawn("agy", args, { cwd: this.opts.cwd, stdio: ["pipe", "pipe", "pipe"] });
    this.proc = proc;
    let err = "";
    proc.stderr!.on("data", (d) => {
      const s = String(d);
      err = (err + s).slice(-2000);
      // Warnings (e.g. a mode this account can't use) go to the transcript once.
      for (const line of s.split("\n")) if (/^warning:/i.test(line.trim())) this.q.push(msg.info(`Antigravity: ${line.trim().replace(/^warning:\s*/i, "")}`));
    });
    proc.on("error", (e) => {
      this.q.push(msg.error(`Couldn't start agy: ${e.message}`));
      this.finishTurn(false);
    });
    proc.on("exit", (code, signal) => {
      if (this.proc === proc) this.proc = null;
      if (this.busy) {
        if (!signal && code) this.q.push(msg.error(`agy exited (${code})${err ? ": " + err.trim().split("\n").pop() : ""}`));
        this.finishTurn(false);
      }
    });
    readline.createInterface({ input: proc.stdout! }).on("line", (line) => {
      let ev: any;
      try { ev = JSON.parse(line); } catch { return; }
      this.handle(ev);
    });
  }

  private finishTurn(ok: boolean) {
    if (!this.busy) return;
    this.busy = false;
    this.texts.clear();
    this.toolsSeen.clear();
    this.q.push(msg.result(ok));
  }

  private handle(ev: any) {
    if (ev.event === "init") {
      if (ev.conversation_id && ev.conversation_id !== this.conversation) {
        this.conversation = ev.conversation_id;
        this.q.push(msg.init(ev.conversation_id, this.model ?? "default model", this.mode));
      }
      return;
    }
    if (ev.event === "step_update") {
      const s = ev.step_update;
      if (s.step_type === "agent_response") {
        if (s.text_delta) {
          this.texts.set(s.step_index, (this.texts.get(s.step_index) ?? "") + s.text_delta);
          this.q.push(msg.delta(s.text_delta));
        }
        if (s.state === "DONE") {
          const text = this.texts.get(s.step_index)?.trim();
          if (text) this.q.push(msg.text(text));
          this.texts.delete(s.step_index);
        }
        return;
      }
      if (s.step_type === "tool") {
        const id = `agy-${s.step_index}`;
        const info = s.tool_info ?? {};
        if (!this.toolsSeen.has(s.step_index)) {
          this.toolsSeen.add(s.step_index);
          const t = tool(info.name ?? s.tool_name ?? "tool", info.parameters);
          this.q.push(msg.toolUse(id, t.name, t.input));
        }
        if (s.state === "DONE") this.q.push(msg.toolResult(id, String(info.output ?? "").trim() || "(no output)"));
        if (s.state === "ERROR") this.q.push(msg.toolResult(id, info.error?.message?.split("\n")[0] ?? "failed", true));
      }
      return;
    }
    if (ev.event === "result") {
      const r = ev.result ?? {};
      if (r.conversation_id) this.conversation = r.conversation_id;
      if (r.status === "ERROR" && r.error) this.q.push(msg.error(`Antigravity: ${r.error}`));
      const denied: any[] = r.denied_actions ?? [];
      if (denied.length) {
        this.q.push(msg.info(
          `Antigravity can't ask for permission here, so it denied: ${denied.map((d) => d.display_name ?? d.action).join(", ")}. ` +
          `Shift+Tab to "accept edits" lets it edit files; anything else needs an allow rule in ~/.gemini/antigravity-cli/settings.json.`,
        ));
      }
      this.finishTurn(r.status !== "ERROR");
    }
  }

  send(text: string) {
    if (this.closed) return;
    if (!this.proc) this.start();
    this.busy = true;
    this.proc!.stdin!.write(JSON.stringify({ event: "user", message: { content: text } }) + "\n");
  }

  /** agy has no interrupt message: stop the process; the next prompt resumes the conversation. */
  async interrupt() {
    if (!this.proc || !this.busy) return;
    const p = this.proc;
    this.proc = null;
    p.kill("SIGINT");
    setTimeout(() => p.kill("SIGKILL"), 2000).unref();
    this.q.push(msg.info("Stopped."));
    this.finishTurn(false);
  }

  private restart() {
    if (!this.proc || this.busy) {
      // Busy: the current process finishes its turn; the next prompt starts a fresh one.
      if (this.proc) { const p = this.proc; this.proc = null; p.stdin!.end(); }
      return;
    }
    const p = this.proc;
    this.proc = null;
    p.stdin!.end();
    setTimeout(() => p.kill(), 3000).unref();
  }

  close() {
    this.closed = true;
    this.q.end();
    if (this.proc) {
      this.proc.stdin!.end();
      this.proc.kill();
    }
  }

  async setPermissionMode(m: PermissionMode) {
    if (m === this.mode) return;
    this.mode = m;
    this.restart();
  }

  async setModel(m: string) {
    this.model = m;
    this.restart();
    this.q.push({ type: "tui", kind: "model", model: m });
  }

  supportedModels(): Promise<ModelChoice[]> {
    return new Promise((resolve, reject) => {
      execFile("agy", ["models"], { timeout: 30_000 }, (err, stdout) => {
        if (err) return reject(err);
        resolve(String(stdout).split("\n").map((l) => l.split("\t")).filter((c) => c.length >= 2 && c[0].trim())
          .map(([value, name]) => ({ value: value.trim(), displayName: name.trim(), description: value.trim() })));
      });
    });
  }

  /**
   * Plan usage from agy's own /usage command. Models share limits by group (Gemini,
   * or Claude and GPT); the card shows the group of the model this pane uses.
   */
  readLimits(): Promise<Limits | null> {
    return new Promise((resolve) => {
      execFile("agy", ["--output-format", "json", "-p=/usage"], { cwd: this.opts.cwd, timeout: 30_000 }, (err, stdout) => {
        if (err) return resolve(null);
        try {
          const groups: any[] = JSON.parse(String(stdout)).command?.data?.groups ?? [];
          const otherFamily = /^(claude|gpt)/i.test(this.model ?? "");
          const g = groups.find((x) => (otherFamily ? /claude|gpt/i : /gemini/i).test(x.name)) ?? groups[0];
          if (!g) return resolve(null);
          const pick = (win: string) => {
            const b = (g.buckets ?? []).find((x: any) => x.window === win);
            return b ? { pct: Math.max(0, Math.min(100, 100 * (1 - (b.remaining_fraction ?? 1)))), resetsAt: toMs(b.reset_time) } : "none" as const;
          };
          resolve({ source: `AGY ${otherFamily ? "Claude/GPT" : "Gemini"}`, fiveHour: pick("5h"), weekly: pick("weekly") });
        } catch {
          resolve(null);
        }
      });
    });
  }

  /** agy keeps the steps in a binary format; the prompts are in history.jsonl. */
  async history() {
    if (!this.opts.resume) return [];
    try {
      const lines = fs.readFileSync(path.join(AGY_HOME, "history.jsonl"), "utf8").split("\n");
      const out: any[] = [];
      for (const l of lines) {
        if (!l.includes(this.opts.resume)) continue;
        try {
          const h = JSON.parse(l);
          if (h.conversationId === this.opts.resume && h.display) out.push(msg.user(h.display));
        } catch {}
      }
      if (out.length) out.push(msg.text("_(Antigravity keeps replies in its own format; only your prompts are shown. The agent still has the full conversation.)_"));
      return out;
    } catch {
      return [];
    }
  }
}

export type AgyConversation = { id: string; title: string; updatedAt: number };

/** Conversations whose workspace is exactly this folder, newest first. */
export function listAgyConversations(cwd: string, limit = 6): Promise<AgyConversation[]> {
  const db = path.join(AGY_HOME, "conversation_summaries.db");
  if (!fs.existsSync(db)) return Promise.resolve([]);
  const uri = JSON.stringify("file://" + cwd).replace(/'/g, "''");
  const sql = `select conversation_id, title, preview, last_modified_time from conversation_summaries ` +
    `where nesting_depth = 0 and instr(workspace_uris, '${uri}') > 0 order by last_modified_time desc limit ${limit}`;
  return new Promise((resolve) => {
    // Not -readonly: that fails to open agy's WAL database whenever its -wal file is empty.
    execFile("/usr/bin/sqlite3", ["-cmd", ".timeout 2000", "-json", db, sql], { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve([]);
      try {
        const rows = JSON.parse(String(stdout) || "[]") as any[];
        resolve(rows.map((r) => ({
          id: r.conversation_id,
          title: r.title || r.preview || r.conversation_id.slice(0, 8),
          updatedAt: Date.parse(String(r.last_modified_time).replace(" ", "T").replace(/(\.\d{3})\d+/, "$1")) || 0,
        })));
      } catch {
        resolve([]);
      }
    });
  });
}
