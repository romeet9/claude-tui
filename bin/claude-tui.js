#!/usr/bin/env node
// Launcher: runs the TypeScript entry through tsx from this package's own node_modules,
// keeping the caller's working directory so the agent works where you started it.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tsx = path.join(root, "node_modules", ".bin", "tsx");
const child = spawn(tsx, [path.join(root, "src", "app.tsx"), ...process.argv.slice(2)], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
