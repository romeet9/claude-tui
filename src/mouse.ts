// Mouse support. Turns on the terminal's SGR mouse reporting and strips the
// mouse sequences out of stdin before Ink's keyboard parser sees them (they
// would otherwise land in the prompt as text), emitting them as events instead.
import { EventEmitter } from "node:events";
import fs from "node:fs";

export type MouseEvent = {
  kind: "press" | "release" | "drag" | "wheelUp" | "wheelDown" | "wheelLeft" | "wheelRight";
  button: number;
  /** 1-based terminal column and row. */
  x: number;
  y: number;
};

export const mouse = new EventEmitter();

// Button events, motion while a button is held (dragging), SGR encoding.
const ON = "\x1b[?1000h\x1b[?1002h\x1b[?1006h";
const OFF = "\x1b[?1002l\x1b[?1000l\x1b[?1006l";
const SGR = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
const PARTIAL = /\x1b(\[(<[\d;]*)?)?$/;  // a sequence cut off at the end of a chunk

let enabled = false;

export function setMouseReporting(on: boolean) {
  if (!process.stdout.isTTY || on === enabled) return;
  enabled = on;
  process.stdout.write(on ? ON : OFF);
}

export const isMouseReporting = () => enabled;

export function installMouseFilter(stdin: NodeJS.ReadStream = process.stdin) {
  const read = stdin.read.bind(stdin);
  let carry = "";

  const filter = (chunk: string): string => {
    let text = carry + chunk;
    carry = "";
    const partial = text.match(PARTIAL);
    if (partial && partial[0].startsWith("\x1b[<")) {
      carry = partial[0];
      text = text.slice(0, -carry.length);
    }
    return text.replace(SGR, (_, b, x, y, end) => {
      const button = Number(b);
      const ev: MouseEvent = {
        // 66/67: sideways scroll (two-finger swipe left/right); 68/69: shift + scroll;
        // 72/73: option + scroll. All three scroll the dashboard sideways.
        kind: button === 64 ? "wheelUp" : button === 65 ? "wheelDown"
          : button === 66 || button === 68 || button === 72 ? "wheelLeft"
          : button === 67 || button === 69 || button === 73 ? "wheelRight"
          : button >= 32 && button < 64 ? "drag"
          : end === "M" ? "press" : "release",
        button,
        x: Number(x),
        y: Number(y),
      };
      if (process.env.CLAUDE_TUI_DEBUG_MOUSE) {
        try { fs.appendFileSync(process.env.CLAUDE_TUI_DEBUG_MOUSE, `${b};${x};${y}${end} → ${ev.kind}\n`); } catch {}
      }
      setImmediate(() => mouse.emit("event", ev));
      return "";
    });
  };

  (stdin as any).read = (size?: number) => {
    // Keep reading until there's keyboard input left after filtering, so a
    // chunk that was only mouse events doesn't look like the end of the stream.
    for (;;) {
      const chunk = read(size);
      if (chunk === null) return null;
      const text = filter(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      if (text) return text;
    }
  };

  process.on("exit", () => {
    if (enabled) process.stdout.write(OFF);
  });
}
