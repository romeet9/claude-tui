#!/usr/bin/env node
// Shows what your terminal sends for each mouse/trackpad gesture. Press q to quit.
const ON = "\x1b[?1000h\x1b[?1002h\x1b[?1006h", OFF = "\x1b[?1002l\x1b[?1000l\x1b[?1006l";
const name = (b) => ({ 64: "scroll up", 65: "scroll down", 66: "scroll LEFT", 67: "scroll RIGHT",
  68: "shift+scroll up", 69: "shift+scroll down", 72: "option+scroll up", 73: "option+scroll down",
  80: "ctrl+scroll up", 81: "ctrl+scroll down" })[b] ?? (b >= 32 && b < 64 ? "drag" : `button ${b}`);
process.stdout.write(ON + "\nTry: two fingers up/down, two fingers LEFT/RIGHT, shift+scroll, option+scroll.\nPress q to quit.\n\n");
process.stdin.setRawMode(true);
process.stdin.on("data", (d) => {
  const s = d.toString();
  if (s === "q" || s === "\x03") { process.stdout.write(OFF + "\n"); process.exit(0); }
  for (const m of s.matchAll(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/g)) console.log(`${name(Number(m[1])).padEnd(20)} (code ${m[1]})`);
});
