// Picks the backend for a pane, and lists every agent's past sessions for a folder.
import { listSessions, type SDKSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeSession } from "./claude.js";
import { CodexSession, listCodexThreads } from "./codex.js";
import { AgySession, listAgyConversations } from "./agy.js";
import type { AgentKind, AgentSession, StartOptions } from "./types.js";
import { DEMO, DemoSession, demoSessions } from "../demo.js";

export * from "./types.js";

export function startAgent(kind: AgentKind, opts: StartOptions): AgentSession {
  if (DEMO) return new DemoSession(kind, opts);
  if (kind === "codex") return new CodexSession(opts);
  if (kind === "agy") return new AgySession(opts);
  return new ClaudeSession(opts);
}

/** A sidebar session row: the SDK's shape, plus which agent it belongs to. */
export type SessionInfo = SDKSessionInfo & { agent: AgentKind };

/** Recent sessions of all three agents in this folder, newest first. */
export async function recentSessions(dir: string, limit = 6): Promise<SessionInfo[]> {
  if (DEMO) return demoSessions(dir);
  const [claude, codex, agy] = await Promise.all([
    // Extra rows so test chats (tagged "test") can sink without crowding out real ones.
    listSessions({ dir, limit: limit * 2 }).catch(() => [] as SDKSessionInfo[]),
    listCodexThreads(dir, limit),
    listAgyConversations(dir, limit),
  ]);
  const all: SessionInfo[] = [
    ...claude.map((s) => ({ ...s, agent: "claude" as const })),
    ...codex.map((t) => ({ sessionId: t.id, summary: t.name || t.preview, firstPrompt: t.preview, lastModified: t.updatedAt, agent: "codex" as const }) as SessionInfo),
    ...agy.map((c) => ({ sessionId: c.id, summary: c.title, lastModified: c.updatedAt, agent: "agy" as const }) as SessionInfo),
  ];
  const isTest = (x: SessionInfo) => (x as any).tag === "test";
  return all
    .sort((a, b) => Number(isTest(a)) - Number(isTest(b)) || b.lastModified - a.lastModified)
    .slice(0, limit + 2);
}
