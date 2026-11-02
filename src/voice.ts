// Voice typing through voice/claude-tui-voice, a small Swift helper using macOS's
// own speech recognizer (on-device where the language supports it). It's compiled
// on first use. macOS asks once for Microphone and Speech Recognition access.
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "voice");
const BIN = path.join(DIR, "claude-tui-voice");

function ensureBuilt(): string | null {
  const src = path.join(DIR, "main.swift");
  try {
    if (fs.existsSync(BIN) && fs.statSync(BIN).mtimeMs >= fs.statSync(src).mtimeMs) return null;
    execFileSync("swiftc", [
      "-O", src, "-o", BIN,
      "-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", path.join(DIR, "Info.plist"),
    ], { stdio: ["ignore", "ignore", "pipe"] });
    return null;
  } catch (e: any) {
    return `Couldn't build the voice helper (needs Xcode Command Line Tools): ${String(e?.stderr ?? e?.message ?? e).split("\n")[0]}`;
  }
}

export type VoiceEvents = {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
};

export class Dictation {
  private child: ChildProcess | null = null;
  private cancelled = false;

  get active() {
    return this.child !== null;
  }

  start(ev: VoiceEvents) {
    if (this.child) return;
    const err = ensureBuilt();
    if (err) return ev.onError(err);
    this.cancelled = false;
    const child = spawn(BIN, [], { stdio: ["pipe", "pipe", "ignore"] });
    this.child = child;
    let buf = "";
    child.stdout!.on("data", (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        try {
          const msg = JSON.parse(line);
          if (msg.partial !== undefined && !this.cancelled) ev.onPartial(msg.partial);
          if (msg.final !== undefined && !this.cancelled) ev.onFinal(msg.final);
          if (msg.error !== undefined) ev.onError(msg.error);
        } catch {}
      }
    });
    child.on("exit", () => {
      if (this.child === child) this.child = null;
    });
    child.on("error", (e) => {
      this.child = null;
      ev.onError(String(e.message));
    });
  }

  /** Stop listening; the final text arrives through onFinal. */
  stop() {
    this.child?.kill("SIGTERM");
  }

  /** Stop and throw the words away. */
  cancel() {
    this.cancelled = true;
    this.child?.kill("SIGTERM");
  }
}
