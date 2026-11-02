// Lists Dev Mode annotations in a Figma file by running small scripts inside Figma
// (through Claude Code's Figma plugin) instead of downloading the file over the REST
// API (hundreds of MB for a big file).
//
// Kept cheap (measured ≈ $0.01 a scan): Haiku, a one-line system prompt, no built-in
// tools, skills or hooks, no claude.ai connectors, every MCP server but Figma blocked,
// run from an empty folder (no CLAUDE.md). Two steps so the model never retypes long
// lists: (1) fingerprints of every annotation; (2) only if some are new, their text.
//   node scan-annotations.mjs <fileKey>     → { keys, fresh } (fresh = all, for testing)
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = os.homedir();
/** Claude Code's CLI: on PATH, or where its installer puts it. */
const CLAUDE = (() => {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const f = path.join(dir, "claude");
    try { fs.accessSync(f, fs.constants.X_OK); return f; } catch {}
  }
  return path.join(HOME, ".local", "bin", "claude");
})();
const FIGMA = "plugin:figma:figma";
const EMPTY = fs.mkdtempSync(path.join(os.tmpdir(), "claude-tui-figma-scan-"));

/** Every MCP server Claude would load except Figma (read fresh each run). */
function otherServers() {
  const names = new Set();
  try { for (const n of Object.keys(JSON.parse(fs.readFileSync(path.join(HOME, ".claude.json"), "utf8")).mcpServers ?? {})) names.add(n); } catch {}
  try {
    const enabled = JSON.parse(fs.readFileSync(path.join(HOME, ".claude", "settings.json"), "utf8")).enabledPlugins ?? {};
    const cache = path.join(HOME, ".claude", "plugins", "cache");
    for (const [id, on] of Object.entries(enabled)) {
      if (!on) continue;
      const [plugin, market] = id.split("@");
      const dir = path.join(cache, market, plugin);
      for (const v of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
        try {
          for (const s of Object.keys(JSON.parse(fs.readFileSync(path.join(dir, v, ".mcp.json"), "utf8")).mcpServers ?? {})) names.add(`plugin:${plugin}:${s}`);
        } catch {}
      }
    }
  } catch {}
  names.delete(FIGMA);
  return [...names];
}

/** Runs one use_figma script and returns its result text (straight from the tool). */
function runInFigma(fileKey, code) {
  const settings = { disableAllHooks: true, deniedMcpServers: otherServers().map((serverName) => ({ serverName })) };
  return new Promise((resolve, reject) => {
    const p = spawn(CLAUDE, [
      "-p", "--model", "haiku", "--output-format", "stream-json", "--verbose",
      "--system-prompt", "Make exactly the Figma tool call you are asked for, with the code unchanged, then reply done.",
      "--tools", "", "--disable-slash-commands", "--settings", JSON.stringify(settings),
      "--permission-mode", "dontAsk",
      "--allowedTools", "mcp__plugin_figma_figma__use_figma", "mcp__plugin_figma_figma__create_session",
      "--max-turns", "5",
      `Call use_figma once with fileKey "${fileKey}" and this code:\n\n${code}`,
    ], { cwd: EMPTY, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ENABLE_CLAUDEAI_MCP_SERVERS: "false" } });
    let buf = "", out = null, err = "";
    p.stderr.on("data", (d) => (err = (err + d).slice(-1000)));
    p.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        try {
          const m = JSON.parse(line);
          for (const b of m.message?.content ?? []) {
            if (b.type !== "tool_result") continue;
            const text = Array.isArray(b.content) ? b.content.map((c) => c.text ?? "").join("") : String(b.content ?? "");
            if (text.trim().startsWith("{")) out = text;
          }
        } catch {}
      }
    });
    p.on("error", (e) => reject(new Error(`Couldn't run Claude Code (${CLAUDE}): ${e.message}`)));
    const timer = setTimeout(() => p.kill(), 180_000);
    p.on("close", () => {
      clearTimeout(timer);
      out ? resolve(JSON.parse(out)) : reject(new Error("Figma scan failed" + (err ? ": " + err.trim().split("\n").pop() : "")));
    });
  });
}

const HASH = `const h = (s) => { let x = 5381; for (let i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) | 0; return (x >>> 0).toString(36); };`;

// Step 1: a fingerprint per annotation ("nodeId|hash"), about 22 bytes each.
const KEYS_CODE = `${HASH}
const keys = [];
for (const page of figma.root.children) {
  await page.loadAsync();
  for (const n of page.findAll((n) => "annotations" in n && n.annotations && n.annotations.length > 0))
    for (const a of n.annotations) { const l = (a.label || a.labelMarkdown || "").trim(); if (l) keys.push(n.id + "|" + h(l)); }
}
return JSON.stringify({ keys });`;

// Step 2: the text of specific annotations (only the new ones).
const detailsCode = (ids) => `${HASH}
const out = [];
for (const id of ${JSON.stringify(ids)}) {
  const n = await figma.getNodeByIdAsync(id);
  if (!n || !("annotations" in n)) continue;
  let page = n; while (page && page.type !== "PAGE") page = page.parent;
  for (const a of n.annotations || []) { const l = (a.label || a.labelMarkdown || "").trim(); if (l) out.push({ key: n.id + "|" + h(l), page: page ? page.name : "", id: n.id, name: n.name, label: l.slice(0, 500) }); }
}
return JSON.stringify({ items: out });`;

/** Resolves { keys, fresh: [{ key, page, id, name, label }] } — fresh = not in `seen`. */
export async function scanAnnotations(fileKey, _cwd, seen = []) {
  const { keys } = await runInFigma(fileKey, KEYS_CODE);
  const known = new Set(seen);
  const newKeys = keys.filter((k) => !known.has(k));
  if (!newKeys.length) return { keys, fresh: [] };
  const ids = [...new Set(newKeys.map((k) => k.split("|")[0]))].slice(0, 40);
  const { items } = await runInFigma(fileKey, detailsCode(ids));
  const wanted = new Set(newKeys);
  return { keys, fresh: items.filter((i) => wanted.has(i.key)) };
}

if (process.argv[1]?.endsWith("scan-annotations.mjs") && process.argv[2]) {
  const seenFile = process.argv[3];
  const seen = seenFile ? JSON.parse(fs.readFileSync(seenFile, "utf8")) : [];
  scanAnnotations(process.argv[2], null, seen)
    .then((r) => console.log(JSON.stringify({ count: r.keys.length, fresh: r.fresh })))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
