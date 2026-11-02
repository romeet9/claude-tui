// Demo mode (--demo or CLAUDE_TUI_DEMO=1): the real UI with made-up projects,
// sessions, agent replies, GitHub activity and memories. Nothing is sent to any
// agent and no real data is read. scripts/demo.mjs runs it in a throwaway home
// folder; scripts/record-demo.py records it for the README.
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type { Limits } from "./Usage.js";
import { EventQueue, msg, type AgentEvent, type AgentKind, type AgentSession, type StartOptions } from "./backends/types.js";
import type { Entry, Detail } from "./githubData.js";

export const DEMO = process.env.CLAUDE_TUI_DEMO === "1" || process.argv.includes("--demo");

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const agoMs = (min: number) => Date.now() - min * 60_000;

// ---------- sessions in the sidebar ----------

type DemoSessionRow = { id: string; agent: AgentKind; title: string; minutesAgo: number; tag?: string };

/** Past sessions per workspace folder name. */
const SESSIONS: Record<string, DemoSessionRow[]> = {
  "Acme · Web App": [
    { id: "demo-c1", agent: "claude", title: "Checkout · Apple Pay button", minutesAgo: 42 },
    { id: "demo-x1", agent: "codex", title: "Fix flaky cart test", minutesAgo: 95 },
    { id: "demo-a1", agent: "agy", title: "Lighthouse audit, landing page", minutesAgo: 60 * 5 },
    { id: "demo-c2", agent: "claude", title: "Auth · Magic link emails", minutesAgo: 60 * 26 },
    { id: "demo-c3", agent: "claude", title: "[test] hello", minutesAgo: 60 * 30, tag: "test" },
  ],
  "Acme · Design System": [
    { id: "demo-c4", agent: "claude", title: "Tokens · Dark mode palette", minutesAgo: 60 * 3 },
    { id: "demo-a2", agent: "agy", title: "Button docs in Storybook", minutesAgo: 60 * 28 },
  ],
  "Personal · Blog": [
    { id: "demo-x2", agent: "codex", title: "RSS feed + sitemap", minutesAgo: 60 * 50 },
    { id: "demo-c5", agent: "claude", title: "Draft · Terminal UIs in 2026", minutesAgo: 60 * 75 },
  ],
  "Research · Agents": [
    { id: "demo-c6", agent: "claude", title: "Compare agent CLIs", minutesAgo: 60 * 8 },
  ],
};

export function demoSessions(dir: string): any[] {
  const name = dir.split("/").pop() ?? "";
  return (SESSIONS[name] ?? []).map((s) => ({
    sessionId: s.id, agent: s.agent, customTitle: s.title, summary: s.title,
    lastModified: agoMs(s.minutesAgo), tag: s.tag,
  }));
}

// ---------- scripted agent replies ----------

type Step =
  | { text: string }
  | { tool: string; input: Record<string, unknown>; result: string; error?: boolean; ask?: boolean }
  | { pause: number };

const MODELS: Record<AgentKind, string> = { claude: "claude-opus-5-5", codex: "gpt-6.1-sol", agy: "gemini-3.8-flash" };

const SCRIPTS: Record<AgentKind, Step[][]> = {
  claude: [[
    { text: "I'll check how theming works before touching the settings page." },
    { tool: "Read", input: { file_path: "src/theme/tokens.ts" }, result: "export const tokens = { light: {...}, dark: {...} }" },
    { tool: "Grep", input: { pattern: "prefers-color-scheme" }, result: "src/theme/useTheme.ts:14" },
    { tool: "Edit", input: { file_path: "src/pages/Settings.tsx" }, result: "Updated src/pages/Settings.tsx (+24 −2)", ask: true },
    { tool: "Bash", input: { command: "npm test -- settings" }, result: "✓ 12 tests passed" },
    { text: "Added a **Dark mode** switch to Settings → Appearance.\n\n- Follows the system setting until you pick one\n- Saved per user in `localStorage`\n- All 12 settings tests pass" },
  ]],
  codex: [[
    { text: "Running the cart test 20 times to catch the flake." },
    { tool: "Bash", input: { command: "npm test cart -- --repeat 20" }, result: "3 of 20 failed: timeout waiting for #checkout", error: true },
    { tool: "Read", input: { file_path: "tests/cart.spec.ts" }, result: "await page.click('#checkout')" },
    { tool: "Edit", input: { file_path: "tests/cart.spec.ts" }, result: "await expect(checkout).toBeEnabled()" },
    { tool: "Bash", input: { command: "npm test cart -- --repeat 20" }, result: "20 of 20 passed" },
    { text: "The test clicked **Checkout** before the cart total loaded. It now waits for the button to be enabled: 20/20 runs pass." },
  ]],
  agy: [[
    { text: "Auditing the landing page." },
    { tool: "Bash", input: { command: "npx lighthouse localhost:3000 --quiet" }, result: "Performance 71 · Accessibility 96 · SEO 100" },
    { tool: "Read", input: { file_path: "public/hero.png" }, result: "2.4 MB, 3840×2160" },
    { text: "| Fix | Gain |\n|---|---|\n| Serve hero as AVIF, 1920px | ~2.1 MB |\n| Lazy-load the logo wall | ~180 KB |\n| Preload the display font | LCP −0.4s |" },
  ]],
};

/** A finished conversation for sessions opened from the sidebar. */
const HISTORY: Step[] = [
  { text: "Done. The Apple Pay button shows on Safari and supported devices only, and falls back to the card form everywhere else." },
];

export class DemoSession implements AgentSession {
  private q = new EventQueue<AgentEvent>();
  private turn = 0;
  private stopped = false;
  private timers: NodeJS.Timeout[] = [];

  constructor(readonly kind: AgentKind, private opts: StartOptions) {
    setTimeout(() => this.q.push(msg.init(opts.resume ?? `demo-${kind}-${Date.now()}`, MODELS[kind], opts.mode)), 0);
  }

  [Symbol.asyncIterator]() { return this.q[Symbol.asyncIterator](); }

  async history() {
    if (!this.opts.resume) return [];
    const title = Object.values(SESSIONS).flat().find((s) => s.id === this.opts.resume)?.title ?? "this";
    return [msg.user(`Pick up "${title}"`), ...HISTORY.map((s) => ("text" in s ? msg.text(s.text) : null)).filter(Boolean)];
  }

  send(_text: string) {
    const script = SCRIPTS[this.kind][this.turn++ % SCRIPTS[this.kind].length];
    this.stopped = false;
    void this.play(script);
  }

  private wait(ms: number) {
    return new Promise<void>((r) => this.timers.push(setTimeout(r, ms)));
  }

  private async play(script: Step[]) {
    let n = 0;
    await this.wait(700);
    for (const step of script) {
      if (this.stopped) return;
      if ("pause" in step) { await this.wait(step.pause); continue; }
      if ("text" in step) {
        // Stream the words, then commit the paragraph like a real reply.
        for (const word of step.text.split(/(?<=\s)/)) {
          if (this.stopped) return;
          this.q.push(msg.delta(word));
          await this.wait(28);
        }
        this.q.push(msg.text(step.text));
        await this.wait(350);
        continue;
      }
      const id = `demo-tool-${++n}`;
      if (step.ask && this.kind === "claude") {
        const ok = await new Promise<boolean>((resolve) =>
          this.opts.onPermission({ toolName: step.tool, input: step.input, canAlways: true, resolve: (r) => resolve(r.behavior === "allow") }));
        if (!ok) { this.q.push(msg.info(`✗ declined ${step.tool}`)); continue; }
      }
      this.q.push(msg.toolUse(id, step.tool, step.input));
      await this.wait(650);
      this.q.push(msg.toolResult(id, step.result, !!step.error));
      await this.wait(250);
    }
    this.q.push(msg.result(true, this.kind === "claude" ? 0.14 * this.turn : 0));
  }

  async interrupt() {
    this.stopped = true;
    this.timers.forEach(clearTimeout);
    this.q.push(msg.result(false));
  }
  close() { this.stopped = true; this.timers.forEach(clearTimeout); this.q.end(); }
  async setPermissionMode(_m: PermissionMode) {}
  async getContextUsage() { return { percentage: 12 + this.turn * 7 }; }

  async readLimits(): Promise<Limits> {
    const reset = (h: number) => Date.now() + h * 3_600_000;
    if (this.kind === "codex") return { source: "CODEX", fiveHour: { pct: 34, resetsAt: reset(3.2) }, weekly: { pct: 58, resetsAt: reset(70) } };
    if (this.kind === "agy") return { source: "AGY Gemini", fiveHour: { pct: 8, resetsAt: reset(4.1) }, weekly: { pct: 21, resetsAt: reset(96) } };
    return { fiveHour: { pct: 27, resetsAt: reset(2.5) }, weekly: { pct: 41, resetsAt: reset(80) } };
  }
}

// ---------- GitHub panel ----------

const ACTIVITY: Entry[] = [
  { id: "g1", kind: "pr", title: "Add dark mode toggle to Settings", meta: "acme/web-app · #482 · opened", at: ago(8), state: "open", repo: "acme/web-app", number: 482 },
  { id: "g2", kind: "run", title: "CI · checkout-tests passed", meta: "acme/web-app · main · 4m 12s", at: ago(20), state: "success", repo: "acme/web-app" },
  { id: "g3", kind: "pr", title: "Wait for checkout button before clicking", meta: "acme/web-app · #479 · merged", at: ago(95), state: "merged", repo: "acme/web-app", number: 479 },
  { id: "g4", kind: "issue", title: "Hero image is 2.4 MB on mobile", meta: "acme/web-app · #471 · opened", at: ago(60 * 5), state: "open", repo: "acme/web-app", number: 471 },
  { id: "g5", kind: "push", title: "Pushed 3 commits to tokens/dark", meta: "acme/design-system", at: ago(60 * 7), repo: "acme/design-system" },
  { id: "g6", kind: "release", title: "Released v2.3.0", meta: "acme/design-system", at: ago(60 * 27), repo: "acme/design-system" },
  { id: "g7", kind: "issue", title: "Closed: Button focus ring clipped in Safari", meta: "acme/design-system · #88", at: ago(60 * 29), state: "closed", repo: "acme/design-system", number: 88 },
];

const list = async (kinds?: Entry["kind"][]) => (kinds ? ACTIVITY.filter((e) => kinds.includes(e.kind)) : ACTIVITY);

export const demoGitHub = {
  login: async () => "acme-dev",
  repoOf: async (_cwd: string) => null as string | null,
  activity: () => list(),
  inbox: () => list(["pr", "issue"]),
  myPrs: () => list(["pr"]),
  myIssues: () => list(["issue"]),
  repos: async (): Promise<Entry[]> => [
    { id: "r1", kind: "repo", title: "acme/web-app", meta: "TypeScript · ★ 214", at: ago(8), repo: "acme/web-app" },
    { id: "r2", kind: "repo", title: "acme/design-system", meta: "TypeScript · ★ 1.2k", at: ago(60 * 7), repo: "acme/design-system" },
  ],
  repoPrs: (_r: string) => list(["pr"]),
  repoIssues: (_r: string) => list(["issue"]),
  repoRuns: (_r: string) => list(["run"]),
  repoCommits: (_r: string) => list(["push"]),
  repoActivity: (_r: string) => list(),
  detail: async (e: Entry): Promise<Detail> => ({ title: e.title, lines: [{ text: e.meta, tone: "muted" }, { text: "Demo data." }] }),
};

// ---------- Supermemory timeline ----------

export const demoMemories = () => {
  const m = (id: string, min: number, memory: string, isStatic = false) => ({ id, memory, createdAt: ago(min), updatedAt: ago(min), isStatic });
  return [
    m("m1", 6, "Dark mode follows the system setting until the user picks one; the choice is saved per user."),
    m("m2", 94, "Cart tests must wait for #checkout to be enabled; clicking early caused the flake."),
    m("m3", 300, "Landing page target: Lighthouse performance ≥ 90 on mobile."),
    m("m4", 60 * 26, "Acme web app deploys from main through GitHub Actions.", true),
    m("m5", 60 * 27, "Design tokens live in acme/design-system; the web app pins v2.x."),
  ];
};
