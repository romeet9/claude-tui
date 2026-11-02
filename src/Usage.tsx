// Left column, under the workspaces: the plan's two usage limits as bars,
// colored by how much is used, with the time until each resets.
import React from "react";
import { Box, Text } from "ink";
import { useTheme , bc, ruleOf, frameOf, titleOf } from "./theme.js";

export type Limit = { pct: number; resetsAt?: number };
/** "none": the plan has no such limit (Claude Ultra has no 5-hour window). */
export type Limits = {
  fiveHour?: Limit | "none"; weekly?: Limit | "none";
  /** Whose plan this is (the focused pane's agent), shown in the title. */
  source?: string;
  /** Shown instead of the bars when the agent reports no usage. */
  note?: string;
};
/** The refresh button at the right end of the title row (app.tsx handles the click). */
export const REFRESH_LABEL = "↻ refresh";

/** Border ×2, title, divider, and two lines per bar. */
export const USAGE_HEIGHT = 8;

/** Utilization arrives as 0–1 or 0–100 depending on the source. */
export const toPct = (u: number) => Math.max(0, Math.min(100, u <= 1 ? u * 100 : u));
/** Reset times arrive as epoch seconds, epoch ms or ISO strings. */
export const toMs = (v: unknown): number | undefined => {
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  if (typeof v === "string" && v) return Date.parse(v) || undefined;
  return undefined;
};

function resets(at?: number): string {
  if (!at) return "";
  const ms = at - Date.now();
  if (ms <= 0) return "resets now";
  const m = Math.round(ms / 60000);
  if (m < 60) return `resets in ${m}m`;
  if (m < 24 * 60) return `resets in ${Math.floor(m / 60)}h ${m % 60}m`;
  return "resets " + new Date(at).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

export function Usage({ limits, width, refreshing, sourceColor }: { limits: Limits; width: number; refreshing?: boolean; sourceColor?: string }) {
  const t = useTheme();
  const inner = width - 4;
  // Whose plan: the focused pane's agent (CLAUDE, CODEX, AGY Gemini…), clipped to the title row.
  const label = titleOf(t, "Usage");
  const room = Math.max(0, inner - label.length - 3 - 1 - REFRESH_LABEL.length);
  const source = limits.source ? (limits.source.length > room ? limits.source.slice(0, Math.max(0, room - 1)) + "…" : limits.source) : "";
  const barW = Math.max(6, inner - 13);
  const color = (p: number) => (p >= 80 ? t.red : p >= 50 ? t.yellow : t.green);

  const row = (label: string, lim?: Limit | "none") => {
    if (lim === "none") {
      return (
        <Box flexDirection="column" flexShrink={0}>
          <Text wrap="truncate" color={t.gray}>{label.padEnd(7)}no limit on your plan</Text>
          <Text color={t.gray}> </Text>
        </Box>
      );
    }
    const l = lim;
    const p = l ? Math.round(l.pct) : null;
    const filled = p == null ? 0 : Math.min(barW, Math.max(p > 0 ? 1 : 0, Math.round((p / 100) * barW)));
    return (
      <Box flexDirection="column" flexShrink={0}>
        <Text wrap="truncate" color={t.white}>
          <Text color={t.gray}>{label.padEnd(7)}</Text>
          <Text color={p == null ? t.border : color(p)}>{"█".repeat(filled)}</Text>
          <Text color={t.border}>{"░".repeat(barW - filled)}</Text>
          <Text bold color={p == null ? t.gray : color(p)}>{p == null ? "    –" : `${String(p).padStart(5)}%`}</Text>
        </Text>
        <Text wrap="truncate" color={t.gray}>
          {" ".repeat(7)}{!l ? "waiting for data…" : resets(l.resetsAt)}
        </Text>
      </Box>
    );
  };

  return (
    <Box flexDirection="column" width={width} height={USAGE_HEIGHT} flexShrink={0} backgroundColor={t.bg} borderStyle={frameOf(t)}
      borderBackgroundColor={t.bg} borderColor={bc(t, t.border)} paddingX={1}>
      <Box flexShrink={0} flexDirection="column">
        <Text wrap="truncate" color={t.white}>
          <Text bold color={t.white}>{label}</Text>
          {source && <Text color={t.gray}>{" · "}</Text>}
          {source && <Text bold color={sourceColor ?? t.white}>{source}</Text>}
          {/* The ⟳ sits on the last column of the title row; clicking it refreshes (see app.tsx). */}
          <Text color={t.gray}>{" ".repeat(Math.max(1, inner - label.length - (source ? 3 + source.length : 0) - REFRESH_LABEL.length))}</Text>
          <Text bold color={refreshing ? t.cyan : t.white}>{refreshing ? "↻ …".padEnd(REFRESH_LABEL.length) : REFRESH_LABEL}</Text>
        </Text>
        <Text color={t.border}>{ruleOf(t, inner)}</Text>
      </Box>
      {limits.note ? (
        <Text wrap="wrap" color={t.gray}>{limits.note}</Text>
      ) : (
        <>
          {row("5-hour", limits.fiveHour)}
          {row("Weekly", limits.weekly)}
        </>
      )}
    </Box>
  );
}
