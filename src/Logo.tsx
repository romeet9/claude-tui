// Pixel-art agent icons for a new session's empty pane. Each bitmap row is one pixel
// row; two pixel rows share a terminal line through half blocks (▀ ▄ █), so pixels
// come out square (terminal cells are about twice as tall as they are wide).
import React from "react";
import { Box, Text } from "ink";
import type { AgentKind } from "./backends/types.js";

const BITMAPS: Record<AgentKind, string[]> = {
  // A starburst: chunky rays around a solid core.
  claude: [
    "......##......",
    ".##...##...##.",
    ".###..##..###.",
    "..###.##.###..",
    "...########...",
    "....######....",
    "##############",
    "##############",
    "....######....",
    "...########...",
    "..###.##.###..",
    ".###..##..###.",
    ".##...##...##.",
    "......##......",
  ],
  // A terminal window with a prompt.
  codex: [
    ".##############.",
    "################",
    "##............##",
    "#..............#",
    "#..##..........#",
    "#...##.........#",
    "#....##........#",
    "#...##.........#",
    "#..##..#####...#",
    "#..............#",
    "##............##",
    ".##############.",
  ],
  // An arch lifting off: Antigravity's rising "A".
  agy: [
    ".......##.......",
    "......####......",
    ".....######.....",
    ".....######.....",
    "....###..###....",
    "....###..###....",
    "...###....###...",
    "...###....###...",
    "..###......###..",
    "..###......###..",
    ".###........###.",
    ".###........###.",
    "###..........###",
    "##............##",
  ],
};

/** The bitmap as text lines of half blocks. */
export function logoLines(agent: AgentKind): string[] {
  const rows = BITMAPS[agent];
  const out: string[] = [];
  for (let y = 0; y < rows.length; y += 2) {
    const top = rows[y], bot = rows[y + 1] ?? "";
    let line = "";
    for (let x = 0; x < top.length; x++) {
      const a = top[x] === "#", b = bot[x] === "#";
      line += a && b ? "█" : a ? "▀" : b ? "▄" : " ";
    }
    out.push(line);
  }
  return out;
}

export function AgentLogo({ agent, color }: { agent: AgentKind; color: string }) {
  return (
    <Box flexDirection="column" alignItems="center" flexShrink={0}>
      {logoLines(agent).map((l, i) => (
        <Text key={i} color={color}>{l}</Text>
      ))}
    </Box>
  );
}
