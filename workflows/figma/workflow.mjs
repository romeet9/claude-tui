// The Figma workflow: three linked Claude sessions for design engineering.
//   claude-tui --workflow figma          (--fresh starts new sessions instead of resuming)
//
//   Design       designs and iterates in Figma with you, round by round
//   Annotations  implements the Figma comments and Dev Mode annotations developers leave
//   Publish      turns finished designs into code and opens pull requests (never pushes to main)
//
// The sessions share the "workflow" hub (hub-mcp.mjs). This file turns the hub's state
// into pane status, delivers handoffs between sessions, checks Figma for new comments and
// annotations, and follows the Publish pull request's checks.
//
// Settings: ~/.config/claude-tui/workflows/figma/config.json (written on first run).
// State:    ~/.config/claude-tui/workflows/figma/state/ (safe to delete to start over).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scanAnnotations } from "./scan-annotations.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const HOME = os.homedir();
const USER_DIR = path.join(HOME, ".config", "claude-tui", "workflows", "figma");
const CONFIG_FILE = path.join(USER_DIR, "config.json");
const STATE = path.join(USER_DIR, "state");
/** Keychain item holding a Figma personal access token (optional; see the README). */
const KEYCHAIN = { service: "claude-tui-figma", account: "figma" };
const CI_EVERY = 60_000;

// ---- settings ----
const EXAMPLE = {
  figmaFile: "https://www.figma.com/design/<file-key>/<name>",
  library: "",
  designFolder: "",
  codeFolder: "",
  checkEveryMinutes: 15,
};
if (!fs.existsSync(CONFIG_FILE)) {
  fs.mkdirSync(USER_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(EXAMPLE, null, 2) + "\n");
}
let config;
try { config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); } catch (e) {
  throw new Error(`Couldn't read ${CONFIG_FILE}: ${e.message}`);
}
/** A file key, from a key or any figma.com link. */
const fileKey = (v) => String(v ?? "").match(/figma\.com\/(?:design|file|board|proto)\/([A-Za-z0-9]+)/)?.[1]
  ?? (/^[A-Za-z0-9]{10,}$/.test(String(v ?? "").trim()) ? String(v).trim() : null);
const FIGMA_FILE = fileKey(config.figmaFile);
if (!FIGMA_FILE) {
  throw new Error([
    "The Figma workflow needs your Figma file.",
    `Open ${CONFIG_FILE.replace(HOME, "~")} and set "figmaFile" to its link,`,
    'e.g. "figmaFile": "https://www.figma.com/design/AbC123xyz/My-App". Then run claude-tui --workflow figma again.',
  ].join("\n"));
}
const LIBRARY = config.library ? (fileKey(config.library) ?? String(config.library)) : null;
const folder = (v) => {
  if (!v) return process.cwd();
  const p = path.resolve(String(v).replace(/^~(?=$|\/)/, HOME));
  if (!fs.existsSync(p)) throw new Error(`Folder not found: ${v} (check ${CONFIG_FILE.replace(HOME, "~")})`);
  return p;
};
const DESIGN_DIR = folder(config.designFolder);
const CODE_DIR = folder(config.codeFolder);
const CHECK_EVERY = Math.max(1, Number(config.checkEveryMinutes) || 15) * 60_000;

fs.mkdirSync(path.join(STATE, "inbox"), { recursive: true });
const file = (n) => path.join(STATE, n);
const readJson = (n, d) => { try { return JSON.parse(fs.readFileSync(file(n), "utf8")); } catch { return d; } };
const writeJson = (n, v) => { fs.writeFileSync(file(n) + ".tmp", JSON.stringify(v, null, 2)); fs.renameSync(file(n) + ".tmp", file(n)); };
const appendEvent = (role, level, text) =>
  fs.appendFileSync(file("events.jsonl"), JSON.stringify({ at: new Date().toISOString(), role, level, text }) + "\n");
const fill = (s) => s
  .replaceAll("{{figmaFile}}", FIGMA_FILE)
  .replaceAll("{{library}}", LIBRARY ? `the library \`${LIBRARY}\`` : "the libraries enabled in the file")
  .replaceAll("{{codeFolder}}", CODE_DIR);
const prompt = (n) => fill(fs.readFileSync(path.join(DIR, "prompts", n), "utf8"));
const hhmm = (d) => new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

const fresh = process.argv.includes("--fresh");
const sessions = fresh ? {} : readJson("sessions.json", {});

const pane = (role, title, cwd) => ({
  role, title, cwd, agent: "claude",
  resume: sessions[role],
  appendSystemPrompt: prompt("common.md") + "\n" + prompt(`${role}.md`),
  mcpServers: {
    workflow: { type: "stdio", command: process.execPath, args: [path.join(DIR, "hub-mcp.mjs")], env: { WF_STATE: STATE, WF_ROLE: role } },
  },
  // The workflow's own bookkeeping tools never ask; real work (edits, pushes) still does.
  allowedTools: ["mcp__workflow__status", "mcp__workflow__event", "mcp__workflow__iteration", "mcp__workflow__handoff",
    "mcp__workflow__annotation_done", "mcp__workflow__publish_track"],
});

// Grid order: two on top, the main Design session full width underneath.
const panes = [
  pane("annotations", "Annotations", DESIGN_DIR),
  pane("publish", "Publish", CODE_DIR),
  pane("design", "Design", DESIGN_DIR),
];

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => execFile(cmd, args, { timeout: 30_000, ...opts }, (err, out) => resolve(err ? null : String(out))));
}

function start(api) {
  const ci = { text: null };
  const figma = { last: null, next: null, error: null };

  // ---- pane status from the hub's files ----
  function render() {
    const st = (role) => readJson(`status-${role}.json`, null);
    const chip = (s, color) => (s && s.state !== "idle" ? { text: s.text, color } : null);
    const STATE_COLOR = { working: "cyan", pushing: "magenta", building: "yellow", waiting: "gray", published: "green", error: "red" };

    // Design: the iteration tracker.
    const it = readJson("iterations.json", { active: null, tasks: {} });
    const t = it.active ? it.tasks[it.active] : null;
    if (t) {
      const round = t.rounds[t.rounds.length - 1];
      const parts = [`◆ ${it.active}`, `round ${t.rounds.length}`];
      if (round) parts.push(`${round.variants.length} variants${round.basedOn ? ` from ${round.basedOn}` : ""}`);
      if (t.selected) parts.push(`✓ picked ${t.selected}`);
      if (t.working) parts.push(`✎ working on ${t.working}`);
      api.setBanner("design", { text: parts.join("  ·  "), color: "magenta" });
    } else {
      api.setBanner("design", { text: "No active design task · ask for variants to start a round", color: "gray" });
    }
    const ds = st("design");
    api.setStatus("design", chip(ds, STATE_COLOR[ds?.state] ?? "cyan"));

    // Annotations: what's pending, and when Figma is checked.
    const an = readJson("annotations.json", { pending: [], handled: [] });
    const n = an.pending.length;
    const times = figma.error ? `⚠ ${figma.error}` : `checked ${figma.last ? hhmm(figma.last) : "–"} · next ${figma.next ? hhmm(figma.next) : "–"}`;
    api.setBanner("annotations", { text: `${n ? `● ${n} new` : "No new annotations"}  ·  ${an.handled.length} handled  ·  ${times}`, color: n ? "yellow" : "gray" });
    const as = st("annotations");
    api.setStatus("annotations", n && (!as || as.state === "idle") ? { text: `● ${n} new annotation${n > 1 ? "s" : ""}`, color: "yellow" } : chip(as, STATE_COLOR[as?.state] ?? "cyan"));

    // Publish: the tracked PR and its checks.
    const pub = readJson("publish.json", null);
    api.setBanner("publish", pub
      ? { text: `⎇ ${pub.branch}${pub.pr ? `  ·  PR #${pub.pr}` : ""}${ci.text ? `  ·  ${ci.text}` : ""}`, color: "cyan" }
      : { text: "Nothing in flight · hand it a change to publish", color: "gray" });
    const ps = st("publish");
    api.setStatus("publish", chip(ps, STATE_COLOR[ps?.state] ?? "cyan"));
  }

  // ---- handoffs: deliver new inbox lines to their session ----
  const delivered = readJson("delivered.json", {});
  function deliver() {
    for (const role of ["design", "publish", "annotations"]) {
      let lines = [];
      try { lines = fs.readFileSync(file(`inbox/${role}.jsonl`), "utf8").split("\n").filter(Boolean); } catch {}
      const from = delivered[role] ?? 0;
      for (const line of lines.slice(from)) {
        try {
          const h = JSON.parse(line);
          api.send(role, `[workflow] Handoff from ${h.from}:\n\n${h.message}`);
        } catch {}
      }
      delivered[role] = lines.length;
    }
    writeJson("delivered.json", delivered);
  }

  let timer = null;
  const watcher = fs.watch(STATE, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      // state/check-now: run the Figma check immediately (then it's removed).
      if (fs.existsSync(file("check-now"))) { fs.rmSync(file("check-now"), { force: true }); checkFigma(); }
      deliver();
      render();
    }, 150);
  });

  // ---- Figma: new comments and Dev Mode annotations ----
  async function token() {
    if (process.env.FIGMA_TOKEN) return process.env.FIGMA_TOKEN;
    const out = await run("/usr/bin/security", ["find-generic-password", "-s", KEYCHAIN.service, "-a", KEYCHAIN.account, "-w"]);
    return out?.trim() || null;
  }
  async function figmaGet(tok, p) {
    const r = await fetch(`https://api.figma.com/v1/${p}`, { headers: { "X-Figma-Token": tok } });
    if (!r.ok) throw new Error(`Figma ${r.status}`);
    return r.json();
  }
  let checking = false;
  async function checkFigma() {
    if (checking) return;
    checking = true;
    try { await checkFigmaOnce(); } finally { checking = false; }
  }
  async function checkFigmaOnce() {
    figma.next = Date.now() + CHECK_EVERY;
    const tok = await token();
    if (!tok) {
      figma.error = "no Figma token: comment checks are off (see README)";
      return render();
    }
    try {
      const me = await figmaGet(tok, "me");
      // First check ever: record what's already there as the baseline, so only
      // comments and edits that arrive after setup count as new.
      const baseline = !fs.existsSync(file("figma-seen.json"));
      const seen = readJson("figma-seen.json", { comments: [], versions: {} });
      const an = readJson("annotations.json", { pending: [], handled: [] });
      const found = [];
      // state/test-own.json {"until": <ms>}: your own comments and edits count too,
      // so you can try the flow yourself. Normally only other people's count.
      const testing = Date.now() < readJson("test-own.json", { until: 0 }).until;
      const isMe = (id) => !testing && id === me.id;
      const key = FIGMA_FILE;
      const { comments = [] } = await figmaGet(tok, `files/${key}/comments`);
      for (const c of comments) {
        if (c.resolved_at || isMe(c.user?.id) || seen.comments.includes(c.id)) continue;
        seen.comments.push(c.id);
        const node = c.client_meta?.node_id;
        found.push({
          id: c.id, kind: "comment", file: key, author: c.user?.handle ?? "someone", text: c.message,
          link: `https://www.figma.com/design/${key}${node ? `?node-id=${node.replace(":", "-")}` : ""}`,
        });
      }
      // Dev Mode annotations: when the file changed since the last check, list them
      // inside Figma (through Claude Code's Figma plugin) and keep only new ones.
      const head = await figmaGet(tok, `files/${key}?depth=1`);
      const known = seen.annotations?.[key];
      if (head.lastModified && (head.lastModified !== seen.versions[key] || !known)) {
        const scan = await scanAnnotations(key, DESIGN_DIR, known ?? []);
        if (known) {
          for (const a of scan.fresh) {
            found.push({
              id: a.key, kind: "annotation", file: key, author: "Dev Mode", text: a.label, page: a.page, layer: a.name,
              link: `https://www.figma.com/design/${key}?node-id=${a.id.replace(":", "-")}`,
            });
          }
        }
        (seen.annotations ??= {})[key] = scan.keys;
        seen.versions[key] = head.lastModified;
      }
      seen.comments = seen.comments.slice(-2000);
      writeJson("figma-seen.json", seen);
      if (baseline) {
        appendEvent("annotations", "info", `Figma baseline: ${found.length} open comments already there (not sent)`);
        found.length = 0;
      }
      if (found.length) {
        an.pending.push(...found);
        writeJson("annotations.json", an);
        const parts = [];
        const cs = found.filter((c) => c.kind === "comment");
        const notes = found.filter((c) => c.kind === "annotation");
        if (cs.length) {
          parts.push(`${cs.length} new Figma comment${cs.length > 1 ? "s" : ""}:\n` +
            cs.map((c) => `- [${c.id}] ${c.author}: "${c.text}" (${c.link})`).join("\n"));
        }
        if (notes.length) {
          parts.push(`${notes.length} new Dev Mode annotation${notes.length > 1 ? "s" : ""}:\n` +
            notes.map((c) => `- [${c.id}] ${c.page} › ${c.layer}: "${c.text}" (${c.link})`).join("\n"));
        }
        appendEvent("annotations", "info", `Figma: ${found.length} new (comments + Dev Mode annotations)`);
        api.send("annotations", `[workflow] ${parts.join("\n\n")}`);
      }
      figma.error = null;
    } catch (e) {
      figma.error = String(e?.message ?? e);
    }
    figma.last = Date.now();
    render();
  }

  // ---- Publish: the tracked PR's checks, every minute ----
  async function checkCi() {
    const pub = readJson("publish.json", null);
    if (!pub?.pr) { ci.text = null; return; }
    const out = await run("gh", ["pr", "view", String(pub.pr), "--json", "state,statusCheckRollup,url"], { cwd: CODE_DIR });
    if (!out) return;
    try {
      const pr = JSON.parse(out);
      if (pr.state === "MERGED") { ci.text = "✓ merged"; return render(); }
      if (pr.state === "CLOSED") { ci.text = "closed"; return render(); }
      const checks = (pr.statusCheckRollup ?? []).map((c) => {
        const name = /chromatic/i.test(c.name ?? c.context ?? "") ? "Storybook" : (c.workflowName || c.name || c.context || "check");
        const st = c.conclusion || c.state || c.status;
        const mark = /SUCCESS/i.test(st) ? "✓" : /FAIL|ERROR|CANCEL/i.test(st) ? "✗" : "●";
        return `${name} ${mark}`;
      });
      ci.text = checks.length ? [...new Set(checks)].join("  ") : "checks pending";
    } catch {}
    render();
  }

  // Keep each role's session id so the next run resumes it.
  api.onSession((role, id) => {
    const s = readJson("sessions.json", {});
    if (s[role] !== id) { s[role] = id; writeJson("sessions.json", s); }
  });
  api.onTurnDone(() => render());

  render();
  setTimeout(deliver, 1500);
  const first = setTimeout(checkFigma, 10_000);
  const figmaTimer = setInterval(checkFigma, CHECK_EVERY);
  const ciTimer = setInterval(checkCi, CI_EVERY);
  checkCi();
  return () => {
    watcher.close();
    clearTimeout(first);
    clearInterval(figmaTimer);
    clearInterval(ciTimer);
  };
}

export default { name: "figma", panes, start };
