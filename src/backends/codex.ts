// Codex through `codex app-server`: JSON-RPC over stdio (one JSON object per line).
// A thread is the conversation; each prompt is a turn. Approvals arrive as requests
// from the server and are answered from the same y / a / n prompt Claude uses.
import { spawn, type ChildProcess } from "node:child_process";
import readline from "node:readline";
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { toMs, type Limits } from "../Usage.js";
import { EventQueue, msg, type AgentEvent, type AgentSession, type StartOptions, type ModelChoice } from "./types.js";

type Waiter = { res: (v: any) => void; rej: (e: any) => void };

/** A connection to one `codex app-server` process. */
export class CodexRpc {
  private proc: ChildProcess;
  private seq = 0;
  private waits = new Map<number, Waiter>();
  private ready: Promise<void>;
  onNotify: (method: string, params: any) => void = () => {};
  onRequest: (id: number | string, method: string, params: any) => void = (id) => this.fail(id, "Not supported by claude-tui");
  onExit: (why: string) => void = () => {};
  stderr = "";

  constructor() {
    this.proc = spawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "pipe"] });
    this.proc.stderr!.on("data", (d) => (this.stderr = (this.stderr + d).slice(-2000)));
    this.proc.on("error", (e) => this.die(`couldn't start codex: ${e.message}`));
    this.proc.on("exit", (code) => this.die(`codex app-server exited (${code})${this.stderr ? ": " + this.stderr.trim().split("\n").pop() : ""}`));
    readline.createInterface({ input: this.proc.stdout! }).on("line", (line) => {
      let m: any;
      try { m = JSON.parse(line); } catch { return; }
      if (m.id != null && !m.method) {
        const w = this.waits.get(m.id);
        if (!w) return;
        this.waits.delete(m.id);
        m.error ? w.rej(new Error(m.error.message ?? JSON.stringify(m.error))) : w.res(m.result);
      } else if (m.id != null && m.method) this.onRequest(m.id, m.method, m.params);
      else if (m.method) this.onNotify(m.method, m.params);
    });
    this.ready = this.call("initialize", {
      clientInfo: { name: "claude-tui", title: "claude-tui", version: "1.0.0" },
      capabilities: { experimentalApi: false, requestAttestation: false },
    }).then(() => this.write({ method: "initialized" }));
  }

  private dead = false;
  private die(why: string) {
    if (this.dead) return;
    this.dead = true;
    for (const w of this.waits.values()) w.rej(new Error(why));
    this.waits.clear();
    this.onExit(why);
  }

  private write(o: object) {
    if (!this.dead) this.proc.stdin!.write(JSON.stringify(o) + "\n");
  }

  private call(method: string, params?: unknown): Promise<any> {
    if (this.dead) return Promise.reject(new Error("codex app-server isn't running"));
    const id = ++this.seq;
    return new Promise((res, rej) => {
      this.waits.set(id, { res, rej });
      this.write({ id, method, params });
    });
  }

  async request(method: string, params?: unknown): Promise<any> {
    await this.ready;
    return this.call(method, params);
  }

  reply(id: number | string, result: unknown) { this.write({ id, result }); }
  fail(id: number | string, message: string) { this.write({ id, error: { code: -32601, message } }); }
  close() {
    this.dead = true;
    try { this.proc.kill(); } catch {}
  }
}

/** Claude-style permission modes, as Codex approval policy + sandbox. */
function policy(mode: PermissionMode, cwd: string) {
  switch (mode) {
    case "plan":
      return { approvalPolicy: "on-request", sandbox: "read-only", sandboxPolicy: { type: "readOnly", networkAccess: false } };
    case "acceptEdits":
      return { approvalPolicy: "on-request", sandbox: "workspace-write", sandboxPolicy: ws(cwd) };
    case "auto":
    case "bypassPermissions":
    case "dontAsk":
      return { approvalPolicy: "never", sandbox: "workspace-write", sandboxPolicy: ws(cwd) };
    default:
      return { approvalPolicy: "untrusted", sandbox: "workspace-write", sandboxPolicy: ws(cwd) };
  }
}
const ws = (cwd: string) => ({ type: "workspaceWrite", writableRoots: [cwd], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false });

function limitsOf(snap: any): Limits | null {
  if (!snap) return null;
  const pick = (w: any) => (w ? { pct: Math.max(0, Math.min(100, w.usedPercent ?? 0)), resetsAt: toMs(w.resetsAt) } : "none" as const);
  // primary = the 5-hour window, secondary = the weekly one (by their durations when given).
  const wins = [snap.primary, snap.secondary].filter(Boolean);
  const five = wins.find((w: any) => w.windowDurationMins && w.windowDurationMins <= 600) ?? snap.primary;
  const week = wins.find((w: any) => w !== five) ?? (snap.secondary ?? null);
  return { source: "CODEX", fiveHour: pick(five), weekly: pick(week) };
}

const textOf = (content: any[]): string =>
  (content ?? []).map((c: any) => (c?.type === "text" ? c.text : typeof c === "string" ? c : "")).filter(Boolean).join("\n");

/** One Codex thread item as transcript messages: the call when it starts, its result when done. */
export function itemStart(it: any): any[] {
  switch (it.type) {
    case "commandExecution":
      return [msg.toolUse(it.id, "Bash", { command: it.command })];
    case "fileChange": {
      const files = (it.changes ?? []).map((c: any) => c.path).join(", ");
      return [msg.toolUse(it.id, "Edit", { file_path: files || "(files)" })];
    }
    case "mcpToolCall":
      return [msg.toolUse(it.id, `mcp__${it.server}__${it.tool}`, (it.arguments as any) ?? {})];
    case "dynamicToolCall":
      return [msg.toolUse(it.id, it.tool, (it.arguments as any) ?? {})];
    case "webSearch":
      return [msg.toolUse(it.id, "WebSearch", { query: it.query ?? "" })];
    default:
      return [];
  }
}

export function itemDone(it: any): any[] {
  switch (it.type) {
    case "agentMessage":
      return it.text?.trim() ? [msg.text(it.text)] : [];
    case "plan":
      return it.text?.trim() ? [msg.text(it.text)] : [];
    case "commandExecution": {
      const bad = it.status === "failed" || it.status === "declined" || (it.exitCode != null && it.exitCode !== 0);
      const out = it.status === "declined" ? "declined" : (it.aggregatedOutput ?? "").trim() || `exit ${it.exitCode ?? "?"}`;
      return [msg.toolResult(it.id, out, bad)];
    }
    case "fileChange": {
      const bad = it.status === "failed" || it.status === "declined";
      const diff = (it.changes ?? []).map((c: any) => `${c.kind?.type ?? c.kind ?? "edit"} ${c.path}`).join("\n");
      return [msg.toolResult(it.id, it.status === "declined" ? "declined" : diff || it.status, bad)];
    }
    case "mcpToolCall": {
      if (it.error) return [msg.toolResult(it.id, it.error.message ?? "failed", true)];
      const content = (it.result?.content ?? []).map((c: any) => (c?.type === "text" ? c.text : `[${c?.type}]`)).join("\n");
      return [msg.toolResult(it.id, content || "(no output)")];
    }
    case "dynamicToolCall":
      return [msg.toolResult(it.id, textOf(it.contentItems ?? []) || (it.success === false ? "failed" : "done"), it.success === false)];
    case "webSearch":
      return [msg.toolResult(it.id, "done")];
    default:
      return [];
  }
}

export class CodexSession implements AgentSession {
  readonly kind = "codex" as const;
  private rpc = new CodexRpc();
  private q = new EventQueue<AgentEvent>();
  private threadId: Promise<string>;
  private turnId: string | null = null;
  private mode: PermissionMode;
  private model: string | null = null;
  private contextWindow: number | null = null;
  /** Items started this turn, for approvals that only carry an item id. */
  private items = new Map<string, any>();
  private past: any[] = [];

  constructor(private opts: StartOptions) {
    this.mode = opts.mode;
    this.rpc.onNotify = (m, p) => this.notify(m, p);
    this.rpc.onRequest = (id, m, p) => this.serverRequest(id, m, p);
    this.rpc.onExit = (why) => {
      this.q.push(msg.error(why));
      if (this.turnId) this.q.push(msg.result(false));
      this.q.end();
    };
    const pol = policy(this.mode, opts.cwd);
    const params = { cwd: opts.cwd, approvalPolicy: pol.approvalPolicy, sandbox: pol.sandbox };
    this.threadId = (opts.resume
      ? this.rpc.request("thread/resume", { threadId: opts.resume, ...params })
      : this.rpc.request("thread/start", params)
    ).then((r: any) => {
      this.model = r.model;
      this.past = (r.thread?.turns ?? []).flatMap((t: any) => (t.items ?? []).flatMap((it: any) =>
        it.type === "userMessage" ? [msg.user(textOf(it.content))] : [...itemStart(it), ...itemDone(it)],
      ));
      this.q.push(msg.init(r.thread.id, r.model, this.mode));
      return r.thread.id as string;
    });
    this.threadId.catch((e) => {
      this.q.push(msg.error(`Codex: ${e?.message ?? e}`));
    });
    this.readLimits().then((l) => l && this.q.push({ type: "tui", kind: "limits", limits: l })).catch(() => {});
  }

  [Symbol.asyncIterator]() { return this.q[Symbol.asyncIterator](); }

  private notify(method: string, p: any) {
    switch (method) {
      case "turn/started":
        this.turnId = p.turn?.id ?? null;
        return;
      case "item/agentMessage/delta":
        return this.q.push(msg.delta(p.delta ?? ""));
      case "item/started":
        this.items.set(p.item.id, p.item);
        for (const m of itemStart(p.item)) this.q.push(m);
        return;
      case "item/completed":
        for (const m of itemDone(p.item)) this.q.push(m);
        return;
      case "thread/tokenUsage/updated": {
        const u = p.tokenUsage;
        this.contextWindow = u?.modelContextWindow ?? this.contextWindow;
        if (u?.last && this.contextWindow) this.q.push({ type: "tui", kind: "ctx", pct: (100 * u.last.inputTokens) / this.contextWindow });
        return;
      }
      case "account/rateLimits/updated": {
        // These updates can be partial (credits only); re-read the full picture.
        this.readLimits().then((l) => l && this.q.push({ type: "tui", kind: "limits", limits: l })).catch(() => {});
        return;
      }
      case "model/rerouted":
        if (p?.toModel ?? p?.model) this.q.push({ type: "tui", kind: "model", model: p.toModel ?? p.model });
        return;
      case "error":
        if (!p?.willRetry) this.q.push(msg.error(`Codex: ${p?.error?.message ?? "error"}`));
        return;
      case "turn/completed": {
        const t = p.turn;
        this.turnId = null;
        this.items.clear();
        if (t?.status === "interrupted") this.q.push(msg.info("Stopped."));
        this.q.push(msg.result(t?.status === "completed"));
        return;
      }
    }
  }

  private serverRequest(id: number | string, method: string, p: any) {
    if (method === "item/commandExecution/requestApproval" || method === "execCommandApproval") {
      const command = p.command ?? (Array.isArray(p.command) ? p.command.join(" ") : this.items.get(p.itemId)?.command ?? "");
      this.opts.onPermission({
        toolName: "Bash", input: { command }, reason: p.reason ?? undefined, canAlways: true,
        resolve: (r) => this.rpc.reply(id, {
          decision: method === "execCommandApproval"
            ? (r.behavior === "allow" ? (r.updatedPermissions ? "approved_for_session" : "approved") : "denied")
            : (r.behavior === "allow" ? (r.updatedPermissions ? "acceptForSession" : "accept") : "decline"),
        }),
      });
      return;
    }
    if (method === "item/fileChange/requestApproval" || method === "applyPatchApproval") {
      const it = this.items.get(p.itemId);
      const files = it?.changes?.map((c: any) => c.path).join(", ") || p.grantRoot || "files";
      this.opts.onPermission({
        toolName: "Edit", input: { file_path: files }, reason: p.reason ?? undefined, canAlways: true,
        resolve: (r) => this.rpc.reply(id, {
          decision: method === "applyPatchApproval"
            ? (r.behavior === "allow" ? (r.updatedPermissions ? "approved_for_session" : "approved") : "denied")
            : (r.behavior === "allow" ? (r.updatedPermissions ? "acceptForSession" : "accept") : "decline"),
        }),
      });
      return;
    }
    this.q.push(msg.info(`Codex asked for "${method}", which claude-tui can't answer; declined.`));
    this.rpc.fail(id, "Not supported by claude-tui");
  }

  send(text: string) {
    const pol = policy(this.mode, this.opts.cwd);
    this.threadId.then((threadId) =>
      this.rpc.request("turn/start", {
        threadId,
        input: [{ type: "text", text, text_elements: [] }],
        approvalPolicy: pol.approvalPolicy,
        sandboxPolicy: pol.sandboxPolicy,
        ...(this.model ? { model: this.model } : {}),
      }),
    ).catch((e) => {
      this.q.push(msg.error(`Codex: ${e?.message ?? e}`));
      this.q.push(msg.result(false));
    });
  }

  async interrupt() {
    if (!this.turnId) return;
    const threadId = await this.threadId;
    await this.rpc.request("turn/interrupt", { threadId, turnId: this.turnId });
  }

  close() {
    this.q.end();
    this.rpc.close();
  }

  /** Applies from the next turn (turn/start carries the policy). */
  async setPermissionMode(m: PermissionMode) { this.mode = m; }

  async history() {
    try { await this.threadId; } catch {}
    return this.past;
  }

  async supportedModels(): Promise<ModelChoice[]> {
    const r = await this.rpc.request("model/list", {});
    return (r.data ?? []).filter((m: any) => !m.hidden).map((m: any) => ({
      value: m.model, displayName: m.displayName, description: m.description ?? "", resolvedModel: m.model,
    }));
  }

  async setModel(m: string) { this.model = m; }

  async getContextUsage() { return { percentage: 0 }; }

  async readLimits(): Promise<Limits | null> {
    const r = await this.rpc.request("account/rateLimits/read");
    return limitsOf(r?.rateLimitsByLimitId?.codex ?? r?.rateLimits);
  }
}

// ---- Listing threads for the sidebar: one shared app-server, started on first use. ----
let lister: CodexRpc | null = null;
export type CodexThread = { id: string; preview: string; name: string | null; updatedAt: number };

export async function listCodexThreads(cwd: string, limit = 6): Promise<CodexThread[]> {
  try {
    if (!lister) {
      lister = new CodexRpc();
      lister.onExit = () => (lister = null);
      process.on("exit", () => lister?.close());
    }
    const r = await lister.request("thread/list", { cwd, limit, sortKey: "updated_at" });
    return (r.data ?? []).map((t: any) => ({ id: t.id, preview: t.preview ?? "", name: t.name ?? null, updatedAt: (t.updatedAt ?? 0) * 1000 }));
  } catch {
    return [];
  }
}
