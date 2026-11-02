// A pane's title row: the agent tag (CLAUDE / CODEX / AGY, in the agent's brand
// color), the session's name, then quieter details. The ✕ / ▶ sits at the end
// (app.tsx finds it on the last inner columns of this row).
import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "./theme.js";
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
          {t.flat && active && <Text bold color={accent}>● </Text>}
          {/* The tag: filled with the accent when focused, outlined (colored text) when not. */}
          <Text bold backgroundColor={active ? accent : undefined} color={active ? t.bg ?? t.black : accent}>{` ${tag} `}</Text>
          <Text bold color={active ? t.white : t.gray}>{" " + name}</Text>
          {status && <Text color={status.color}>{" · " + status.text}</Text>}
          {details && <Text color={t.gray}>{"   " + details}</Text>}
        </Text>
      </Box>
      <Text bold color={icon.color}> {icon.text}</Text>
    </Box>
  );
}
