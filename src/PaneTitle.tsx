// A pane's title row: the agent tag (CLAUDE / CODEX / AGY, in the agent's brand
// color), the session's name, then quieter details. The ✕ / ▶ sits at the end
// (app.tsx finds it on the last inner columns of this row).
import React from "react";
import { Box, Text } from "ink";
import { useTheme, skinOf, focusMark, focusInvert } from "./theme.js";
import { agentInfo, type AgentKind } from "./backends/types.js";

export function PaneTitle(props: {
  agent: AgentKind | null;
  name: string;
  active: boolean;
  accent: string;
  /** Short state after the name: "needs approval", "working", "paused"… */
  status?: { text: string; color: string };
  details?: string;
  icon: { text: string; color: string };
}) {
  const t = useTheme();
  const { agent, name, active, accent, status, details, icon } = props;
  const tag = agent ? agentInfo(agent).tag : "NEW";
  return (
    // One row, always: a long name is cut off rather than wrapping onto a second line.
    <Box flexShrink={0} height={1} overflow="hidden">
      <Box flexGrow={1} flexShrink={1} height={1} overflow="hidden">
        <Text wrap="truncate" color={t.white}>
          {focusMark(t, active) && <Text bold color={accent}>{focusMark(t, active)}</Text>}
          {/* The tag, in the theme's style: a pill (filled when focused), [claude], ● claude, /claude, CLAUDE. */}
          {(() => {
            const k = skinOf(t).tag;
            const word = tag.toLowerCase();
            if (k === "bracket") return <Text bold color={accent}>{`[${word}]`}</Text>;
            if (k === "dot") return <Text color={accent}>{"● "}<Text bold>{word}</Text></Text>;
            if (k === "slash") return <Text bold color={accent}>{`/${word}`}</Text>;
            if (k === "caps") return <Text bold color={accent}>{tag}</Text>;
            return <Text bold backgroundColor={active ? accent : undefined} color={active ? t.bg ?? t.black : accent}>{` ${tag} `}</Text>;
          })()}
          <Text bold color={focusInvert(t, active) ? t.bg ?? t.black : active ? t.white : t.gray} backgroundColor={focusInvert(t, active) ? accent : undefined}>{" " + name + (focusInvert(t, active) ? " " : "")}</Text>
          {status && <Text color={status.color}>{" · " + status.text}</Text>}
          {details && <Text color={t.gray}>{"   " + details}</Text>}
        </Text>
      </Box>
      <Text bold color={icon.color}> {icon.text}</Text>
    </Box>
  );
}
