#!/usr/bin/env node
// The Figma workflow hub: a tiny MCP server (stdio, no dependencies) every workflow
// session gets as "workflow". Sessions report status, record design iterations, mark
// annotations handled and hand work to each other; everything lands as files in
// WF_STATE, which workflow.mjs watches to update the panes and deliver handoffs.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const STATE = process.env.WF_STATE;
const ROLE = process.env.WF_ROLE ?? "unknown";
const ROLES = ["design", "publish", "annotations"];
fs.mkdirSync(path.join(STATE, "inbox"), { recursive: true });

const file = (n) => path.join(STATE, n);
const readJson = (n, d) => { try { return JSON.parse(fs.readFileSync(file(n), "utf8")); } catch { return d; } };
const writeJson = (n, v) => { fs.writeFileSync(file(n) + ".tmp", JSON.stringify(v, null, 2)); fs.renameSync(file(n) + ".tmp", file(n)); };
const append = (n, v) => fs.appendFileSync(file(n), JSON.stringify({ at: new Date().toISOString(), ...v }) + "\n");

const TOOLS = [
  {
    name: "status",
    description: "Show what this session is doing on its pane in claude-tui. Call it whenever your state changes (start/finish of a step). state: idle | working | waiting | pushing | building | published | error. text: a few words, e.g. 'Pushing feat/card-c3', 'Storybook building', 'Implementing 2 annotations'.",
    inputSchema: { type: "object", properties: { state: { type: "string" }, text: { type: "string" } }, required: ["state", "text"] },
  },
  {
    name: "event",
    description: "Log something notable to the workflow feed (a decision, a finished step, a problem).",
    inputSchema: { type: "object", properties: { text: { type: "string" }, level: { type: "string", enum: ["info", "success", "warning", "error"] } }, required: ["text"] },
  },
  {
    name: "iteration",
    description: "Design iterations tracker. action 'round': you created a new round of variants for a task (variants = their names, e.g. ['C1','C2','C3','C4','C5']; basedOn = the variant this round refines, if any; figmaNode = the section's node id). action 'select': the user picked a variant. action 'working': you're now refining a variant (e.g. 'C3.2'). action 'done': the task is finished.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["round", "select", "working", "done"] },
        task: { type: "string", description: "e.g. 'Card component'" },
        variants: { type: "array", items: { type: "string" } },
        basedOn: { type: "string" },
        variant: { type: "string" },
        figmaNode: { type: "string" },
      },
      required: ["action", "task"],
    },
  },
  {
    name: "handoff",
    description: "Send work to another workflow session: 'design' (Figma design), 'publish' (code, Storybook, GitHub PRs) or 'annotations' (developer annotations). It's delivered as a prompt as soon as that session is idle. Include file/node ids and what 'done' means.",
    inputSchema: { type: "object", properties: { to: { type: "string", enum: ROLES }, message: { type: "string" } }, required: ["to", "message"] },
  },
  {
    name: "annotation_done",
    description: "Mark a developer annotation or Figma comment as handled (id from the message you were given; for Dev Mode annotations use the node id), with a one-line summary of what changed.",
    inputSchema: { type: "object", properties: { id: { type: "string" }, summary: { type: "string" } }, required: ["id", "summary"] },
  },
  {
    name: "publish_track",
    description: "Publish session: after pushing a branch / opening a PR, register it so claude-tui shows its CI and Chromatic status live.",
    inputSchema: { type: "object", properties: { branch: { type: "string" }, pr: { type: "number" } }, required: ["branch"] },
  },
];

function call(name, a) {
  switch (name) {
    case "status":
      writeJson(`status-${ROLE}.json`, { state: a.state, text: a.text, at: new Date().toISOString() });
      return `Status shown: ${a.text}`;
    case "event":
      append("events.jsonl", { role: ROLE, level: a.level ?? "info", text: a.text });
      return "Logged.";
    case "iteration": {
      const it = readJson("iterations.json", { active: null, tasks: {} });
      const t = (it.tasks[a.task] ??= { rounds: [], selected: null, working: null, done: false });
      if (a.action === "round") t.rounds.push({ variants: a.variants ?? [], basedOn: a.basedOn ?? t.selected ?? null, figmaNode: a.figmaNode ?? null, at: new Date().toISOString() });
      if (a.action === "select") { t.selected = a.variant; t.working = null; }
      if (a.action === "working") t.working = a.variant;
      if (a.action === "done") t.done = true;
      it.active = a.action === "done" ? null : a.task;
      writeJson("iterations.json", it);
      append("events.jsonl", { role: ROLE, level: "info", text: `${a.task}: ${a.action}${a.variant ? " " + a.variant : ""}${a.variants ? ` (${a.variants.length} variants)` : ""}` });
      return `Recorded. ${a.task}: round ${t.rounds.length}, selected ${t.selected ?? "none"}, working on ${t.working ?? "none"}.`;
    }
    case "handoff":
      if (!ROLES.includes(a.to) || a.to === ROLE) throw new Error(`Hand off to one of: ${ROLES.filter((r) => r !== ROLE).join(", ")}`);
      append(`inbox/${a.to}.jsonl`, { from: ROLE, message: a.message });
      append("events.jsonl", { role: ROLE, level: "info", text: `→ ${a.to}: ${a.message.slice(0, 80)}` });
      return `Handed to ${a.to}; it runs as soon as that session is idle.`;
    case "annotation_done": {
      const an = readJson("annotations.json", { pending: [], handled: [] });
      const item = an.pending.find((p) => p.id === a.id) ?? { id: a.id };
      an.pending = an.pending.filter((p) => p.id !== a.id);
      an.handled.push({ ...item, summary: a.summary, at: new Date().toISOString() });
      writeJson("annotations.json", an);
      append("events.jsonl", { role: ROLE, level: "success", text: `Annotation handled: ${a.summary}` });
      return `Marked handled. ${an.pending.length} still pending.`;
    }
    case "publish_track":
      writeJson("publish.json", { branch: a.branch, pr: a.pr ?? null, at: new Date().toISOString() });
      return `Tracking ${a.pr ? "PR #" + a.pr : a.branch}; its checks show on the Publish pane.`;
  }
  throw new Error(`Unknown tool ${name}`);
}

const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (m.id === undefined) return; // notifications
  const reply = (result) => send({ jsonrpc: "2.0", id: m.id, result });
  try {
    if (m.method === "initialize") {
      return reply({ protocolVersion: m.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "claude-tui-figma-workflow", version: "1.0.0" } });
    }
    if (m.method === "tools/list") return reply({ tools: TOOLS });
    if (m.method === "tools/call") {
      try {
        return reply({ content: [{ type: "text", text: call(m.params.name, m.params.arguments ?? {}) }] });
      } catch (e) {
        return reply({ content: [{ type: "text", text: String(e?.message ?? e) }], isError: true });
      }
    }
    if (m.method === "ping") return reply({});
    send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: `Unknown method ${m.method}` } });
  } catch (e) {
    send({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: String(e?.message ?? e) } });
  }
});
