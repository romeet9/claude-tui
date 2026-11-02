// A paused chat: its Claude process is shut down (no memory, no work) but the pane
// keeps its place. ▶ (or Enter / the pause key) resumes the same conversation.
import React from "react";
import path from "node:path";
import { Box, Text } from "ink";
import { useTheme , bc, ruleOf } from "./theme.js";
import { PaneTitle } from "./PaneTitle.js";
import { agentInfo, type AgentKind } from "./backends/types.js";

export function PausedPane(props: {
  cwd: string; width: number; height: number; active: boolean; agent: AgentKind; title: string;
  index: number; count: number; hasSession: boolean;
  paneColor: string; paneBorder: "round" | "bold" | "double" | "single"; resumeKey: string;
}) {
  const { cwd, width, height, active, hasSession, paneColor, paneBorder, resumeKey, agent, title } = props;
  const t = useTheme();
  const inner = Math.max(10, width - 4);
  return (
    <Box flexDirection="column" width={width} height={height} flexShrink={0} backgroundColor={t.bg} borderStyle={paneBorder}
      borderBackgroundColor={t.bg} borderColor={bc(t, paneColor)} borderDimColor={!active} paddingX={1}>
      {/* ▶ sits where the ✕ was: the same spot resumes (see app.tsx). */}
      <PaneTitle agent={agent} name={title} active={active} accent={paneColor}
        status={{ text: "paused", color: t.yellow }} details={path.basename(cwd)} icon={{ text: "▶", color: t.green }} />
      <Text color={t.border}>{ruleOf(t, inner)}</Text>
      <Box flexDirection="column" flexGrow={1} justifyContent="center" alignItems="center">
        <Text color={t.yellow}>⏸  Paused</Text>
        <Text color={t.gray}>{agentInfo(agent).name} isn't running in this pane.</Text>
        <Text color={t.gray}>
          {hasSession ? "Resume picks the conversation up where it stopped." : "Nothing was sent here yet."}
        </Text>
        <Text color={t.gray}> </Text>
        <Text color={t.white}>
          Click <Text bold color={t.green}>▶</Text>, or press <Text bold color={paneColor}>Enter</Text> / <Text bold color={paneColor}>{resumeKey}</Text>
        </Text>
      </Box>
    </Box>
  );
}
