// Right panel: Supermemory memories for the current folder, newest first, grouped by day.
import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { supermemoryFor, listMemories, type Memory } from "./mcp.js";
import { useTheme , bc, ruleOf } from "./theme.js";

const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  if (same(d, y)) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
};
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** Word-wraps plain text to a width (memories are short; no ANSI). */
function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      if ((line + " " + word).trim().length > width) {
        if (line) out.push(line);
        line = word.length > width ? word.slice(0, width) : word;
      } else line = (line + " " + word).trim();
    }
    if (line) out.push(line);
  }
  return out.length ? out : [""];
}

type Line = { text: string; kind: "day" | "time" | "body" | "gap" };

export function Timeline(props: {
  cwd: string; width: number; height: number; focused: boolean; scrollRequest: { n: number; delta: number };
}) {
  const { cwd, width, height, focused, scrollRequest } = props;
  const t = useTheme();
  const accent = t.focus?.timeline ?? t.cyan;
  const conn = useMemo(() => supermemoryFor(cwd), [cwd]);
  const [entries, setEntries] = useState<Memory[]>([]);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(true);
  const [total, setTotal] = useState<number | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [top, setTop] = useState(0);

  async function load(next: number, replace = false) {
    if (!conn || loading) return;
    setLoading(true);
    setError(null);
    try {
      const r = await listMemories(conn, next);
      setEntries((prev) => {
        const all = replace ? r.entries : [...prev, ...r.entries];
        const seen = new Set<string>();
        return all.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
      });
      setPage(next);
      setMore(r.more);
      setTotal(r.total);
    } catch (e: any) {
      setError(String(e?.message ?? e).split("\n")[0]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setEntries([]);
    setTop(0);
    load(1, true);
    return () => { conn?.close(); };
  }, [conn]);

  const inner = width - 4;
  const lines = useMemo<Line[]>(() => {
    const out: Line[] = [];
    let day = "";
    const sorted = [...entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    for (const m of sorted) {
      const d = dayLabel(m.updatedAt);
      if (d !== day) {
        if (out.length) out.push({ text: "", kind: "gap" });
        out.push({ text: d, kind: "day" });
        day = d;
      }
      out.push({ text: `● ${time(m.updatedAt)}${m.isStatic ? "  · fact" : ""}`, kind: "time" });
      for (const l of wrap(m.memory, inner - 2)) out.push({ text: "│ " + l, kind: "body" });
    }
    return out;
  }, [entries, inner]);

  const view = Math.max(3, height - 4); // border ×2, title, divider
  const maxTop = Math.max(0, lines.length - view);
  const scroll = (d: number) => {
    setTop((n) => {
      const v = Math.max(0, Math.min(maxTop, n + d));
      // Near the end: fetch the next page.
      if (v >= maxTop - 2 && more && !loading) load(page + 1);
      return v;
    });
  };

  useEffect(() => {
    if (scrollRequest.n) scroll(-scrollRequest.delta);
  }, [scrollRequest.n]);

  useInput(
    (ch, key) => {
      if (key.upArrow || ch === "k") return scroll(-1);
      if (key.downArrow || ch === "j") return scroll(1);
      if (key.pageUp) return scroll(-(view - 2));
      if (key.pageDown) return scroll(view - 2);
      if (ch === "r") {
        setTop(0);
        return load(1, true);
      }
    },
    { isActive: focused },
  );

  const shown = lines.slice(top, top + view);
  const count = total != null ? `${entries.length}/${total}` : `${entries.length}`;

  return (
    <Box flexDirection="column" width={width} height={height} flexShrink={0} backgroundColor={t.bg} borderStyle="round"
      borderBackgroundColor={t.bg} borderColor={bc(t, focused ? accent : t.border)} paddingX={1}>
      <Text bold color={focused ? accent : t.white} wrap="truncate">
        {t.flat && focused ? "● " : ""}Timeline <Text color={t.gray}>· supermemory · {count}</Text>
        {loading && entries.length ? <Text color={t.gray}>  · loading…</Text> : null}
        {focused && <Text color={t.gray}>   ↑↓ scroll · r refresh</Text>}
      </Text>
      <Text color={t.border}>{ruleOf(t, inner)}</Text>
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {!conn && <Text color={t.red}>Supermemory plugin not found in ~/.claude/plugins.</Text>}
        {error && <Text color={t.red} wrap="wrap">{error}</Text>}
        {!error && !entries.length && <Text color={t.gray}>{loading ? "Loading…" : "No memories for this folder yet."}</Text>}
        {shown.map((l, i) => (
          <Text key={top + i} wrap="truncate"
            color={l.kind === "day" ? t.yellow : l.kind === "time" ? t.cyan : t.white}
            bold={l.kind === "day"}>
            {l.text || " "}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
