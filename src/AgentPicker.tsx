// A new pane before it has an agent: pick Claude Code, Codex or Antigravity.
// Keys (1/2/3, ↑↓ + Enter) and clicks are handled by the root (app.tsx).
import React from "react";
import path from "node:path";
import { Box, Text } from "ink";
import { useTheme, bc, ruleOf } from "./theme.js";
import { AGENTS } from "./backends/types.js";
import { PaneTitle } from "./PaneTitle.js";

/** Screen row of the first option (top border, title, divider, blank, prompt, blank). */
export const PICKER_FIRST_ROW = 7;
/** Each option takes two rows (name, description) plus a blank. */
export const PICKER_ROW_STEP = 3;

export function AgentPicker(props: {
  cwd: string; width: number; height: number; active: boolean; cursor: number;
  index: number; count: number; paneColor: string; paneBorder: any;
}) {
  const { cwd, width, height, active, cursor, index, count, paneColor, paneBorder } = props;
  const t = useTheme();
  const inner = Math.max(10, width - 4);
  return (
    <Box flexDirection="column" width={width} height={height} flexShrink={0} backgroundColor={t.bg} borderStyle={paneBorder}
      borderBackgroundColor={t.bg} borderColor={bc(t, paneColor)} borderDimColor={!active} paddingX={1}>
      <PaneTitle agent={null} name="New session" active={active} accent={paneColor}
        details={path.basename(cwd)} icon={{ text: "✕", color: t.gray }} />
      <Text color={t.border}>{ruleOf(t, inner)}</Text>
      <Text> </Text>
      <Text bold color={t.white}>Which agent should this pane run?</Text>
      <Text> </Text>
      {AGENTS.map((a, i) => {
        const sel = i === cursor;
        const brand = t.light ? a.brand.light : a.brand.dark;
        return (
          <Box key={a.kind} flexDirection="column" flexShrink={0} marginBottom={1}>
            <Text wrap="truncate" color={t.white}>
              <Text color={sel ? paneColor : t.gray}>{sel ? "› " : "  "}</Text>
              <Text color={sel ? paneColor : t.gray}>{a.key}  </Text>
              <Text bold backgroundColor={sel ? brand : undefined} color={sel ? t.bg ?? t.black : brand}>{` ${a.tag} `}</Text>
              <Text bold={sel} color={sel ? t.white : t.gray}>{" " + a.name}</Text>
            </Text>
            <Text wrap="truncate" color={t.gray}>{"      "}{a.blurb}</Text>
          </Box>
        );
      })}
      <Box flexGrow={1} />
      <Text color={t.border}>{ruleOf(t, inner)}</Text>
      <Text wrap="truncate" color={t.gray}>
        {active ? "1 2 3 or ↑↓ ⏎ to start · click one · ^X close" : "click to choose an agent"}
      </Text>
    </Box>
  );
}
