// GitHub panel: your account (activity, inbox, PRs, issues, repos) or one repo
// (activity, PRs, issues, CI, commits), with details for any item. Read-only:
// "o" opens an item in the browser panel, "a" hands it to Claude in the chat.
import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import * as RealG from "./githubData.js";
import { DEMO, demoGitHub } from "./demo.js";

const G = DEMO ? demoGitHub : RealG;
import type { Entry, Detail } from "./githubData.js";
import { useTheme, type Theme , bc, ruleOf, frameOf, titleOf, focusMark, focusInvert } from "./theme.js";
import { clip } from "./transcript.js";

type Scope = { kind: "account" } | { kind: "repo"; repo: string };
const ACCOUNT_TABS = ["Activity", "Inbox", "PRs", "Issues", "Repos"] as const;
const REPO_TABS = ["Activity", "PRs", "Issues", "CI", "Commits"] as const;

const ICON: Record<Entry["kind"], string> = {
  push: "↑", pr: "⇄", issue: "◉", run: "▶", commit: "•", release: "◆", branch: "⎇", star: "★", notification: "✉", repo: "▣", other: "·",
};

function stateColor(t: Theme, s?: Entry["state"]) {
  switch (s) {
    case "open": case "success": return t.green;
    case "merged": return t.magenta;
    case "failure": return t.red;
    case "pending": return t.yellow;
    case "closed": case "draft": return t.gray;
    case "unread": return t.cyan;
    default: return t.white;
  }
}

const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  return s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
};
const day = (iso: string) => {
  const d = new Date(iso), today = new Date();
  const y = new Date(today); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
};

async function load(scope: Scope, tab: string): Promise<Entry[]> {
  if (scope.kind === "account") {
    if (tab === "Activity") return G.activity();
    if (tab === "Inbox") return G.inbox();
    if (tab === "PRs") return G.myPrs();
    if (tab === "Issues") return G.myIssues();
    return G.repos();
  }
  if (tab === "Activity") return G.repoActivity(scope.repo);
  if (tab === "PRs") return G.repoPrs(scope.repo);
  if (tab === "Issues") return G.repoIssues(scope.repo);
  if (tab === "CI") return G.repoRuns(scope.repo);
  return G.repoCommits(scope.repo);
}

type Row = { kind: "day"; text: string } | { kind: "entry"; e: Entry; index: number };

/**
 * Word-wraps to `width` columns (long words are split), so the panel knows exactly
 * how many lines each card takes and nothing runs past the border.
 */
export function wrapText(text: string, width: number): string[] {
  const w = Math.max(4, width);
  const out: string[] = [];
  for (const para of text.replace(/\r/g, "").split("\n")) {
    let line = "";
    for (let word of para.split(/\s+/).filter(Boolean)) {
      while ([...word].length > w) {
        const room = line ? w - [...line].length - 1 : w;
        if (room < 4) { out.push(line); line = ""; continue; }
        const head = [...word].slice(0, room).join("");
        out.push(line ? line + " " + head : head);
        line = "";
        word = [...word].slice(room).join("");
      }
      if (!line) line = word;
      else if ([...line].length + 1 + [...word].length <= w) line += " " + word;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

export function GitHubPanel(props: {
  cwd: string; width: number; height: number; focused: boolean;
  scrollRequest: { n: number; delta: number };
  onOpenUrl: (url: string) => void;
  onAsk: (text: string) => void;
  /** Esc in the list: hand the keyboard back to the chat. */
  onExit: () => void;
}) {
  const { cwd, width, height, focused, scrollRequest, onOpenUrl, onAsk, onExit } = props;
  const t = useTheme();
  const accent = t.focus?.chat ?? t.cyan;
  const [scope, setScope] = useState<Scope>({ kind: "account" });
  const [tab, setTab] = useState(0);
  const [cache, setCache] = useState<Record<string, { entries: Entry[]; at: number; error?: string }>>({});
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [detail, setDetail] = useState<(Detail & { entry: Entry }) | null>(null);
  const [detailTop, setDetailTop] = useState(0);
  const [who, setWho] = useState("");

  const tabs = scope.kind === "account" ? ACCOUNT_TABS : REPO_TABS;
  const tabName = tabs[Math.min(tab, tabs.length - 1)];
  const key = `${scope.kind === "repo" ? scope.repo : "@me"}:${tabName}`;
  const current = cache[key];
  const entries = current?.entries ?? [];

  async function refresh(force = false) {
    if (!force && current && Date.now() - current.at < 90_000) return;
    setLoading(true);
    try {
      const list = await load(scope, tabName);
      setCache((c) => ({ ...c, [key]: { entries: list, at: Date.now() } }));
    } catch (e: any) {
      setCache((c) => ({ ...c, [key]: { entries: c[key]?.entries ?? [], at: Date.now(), error: String(e?.message ?? e) } }));
    } finally {
      setLoading(false);
    }
  }

  // The chat folder's repo, if it is one; otherwise the account.
  useEffect(() => {
    G.login().then(setWho).catch(() => setWho(""));
    G.repoOf(cwd).then((repo) => {
      setScope(repo ? { kind: "repo", repo } : { kind: "account" });
      setTab(0);
      setCursor(0);
    });
  }, [cwd]);

  useEffect(() => {
    setCursor(0);
    setDetail(null);
    refresh();
    const timer = setInterval(() => refresh(true), 90_000);
    return () => clearInterval(timer);
  }, [key]);

  // Timeline-style tabs get day headers.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const dated = tabName === "Activity" || tabName === "Inbox" || tabName === "Commits";
    let last = "";
    entries.forEach((e, index) => {
      if (dated && e.at) {
        const d = day(e.at);
        if (d !== last) { out.push({ kind: "day", text: d }); last = d; }
      }
      out.push({ kind: "entry", e, index });
    });
    return out;
  }, [entries, tabName]);

  const inner = width - 4;
  // Keyboard hints live in a footer that wraps, instead of overflowing the title row.
  const hints = !focused
    ? "click or Shift+→ to use"
    : detail
      ? "o open in browser · a ask Claude · ↑↓ scroll · esc back"
      : `⏎ open · o browser · a ask · r refresh${scope.kind === "repo" ? " · h account" : ""} · 1–5 tabs`;
  const hintLines = wrapText(hints, inner);
  // Border ×2, title, tabs, divider; footer = divider + hint lines.
  const bodyHeight = Math.max(3, height - 5 - 1 - hintLines.length);
  // Each card: its wrapped title, its wrapped meta line, and a blank line after.
  const titleW = Math.max(8, inner - 4);
  const cardLines = (e: Entry) => ({
    title: wrapText(e.title, titleW),
    meta: wrapText(e.meta + (e.at ? ` · ${ago(e.at)}` : ""), titleW),
  });
  const heightOf = (r: Row) => {
    if (r.kind === "day") return 1;
    const c = cardLines(r.e);
    return c.title.length + c.meta.length + 1;
  };
  const selectedRow = rows.findIndex((r) => r.kind === "entry" && r.index === cursor);
  // Keep the selection on screen.
  const lineOf = (i: number) => rows.slice(0, i).reduce((n, r) => n + heightOf(r), 0);
  const totalLines = lineOf(rows.length);
  const selLine = lineOf(Math.max(0, selectedRow));
  const top = Math.max(0, Math.min(selLine - Math.floor(bodyHeight / 3), totalLines - bodyHeight));

  async function openDetail(e: Entry) {
    if (e.kind === "repo" && e.repo) {
      setScope({ kind: "repo", repo: e.repo });
      setTab(0);
      return;
    }
    if (e.kind === "notification" && e.repo && e.number) {
      // Notifications are PRs or issues underneath.
      e = { ...e, kind: /pull request/.test(e.meta) ? "pr" : "issue" };
    }
    setDetail({ title: e.title, lines: [{ text: "Loading…", tone: "muted" }], entry: e });
    setDetailTop(0);
    try {
      const d = await G.detail(e);
      setDetail({ ...d, entry: e });
    } catch (err: any) {
      setDetail({ title: e.title, lines: [{ text: String(err?.message ?? err), tone: "bad" }], entry: e, url: e.url });
    }
  }

  const ask = (e: Entry, url?: string) =>
    onAsk(`About ${url ?? e.url ?? e.title} (${e.title}): `);

  useEffect(() => {
    if (!scrollRequest.n) return;
    if (detail) setDetailTop((n) => Math.max(0, n - scrollRequest.delta));
    else setCursor((c) => Math.max(0, Math.min(entries.length - 1, c - Math.sign(scrollRequest.delta))));
  }, [scrollRequest.n]);

  useInput(
    (ch, key) => {
      if (detail) {
        if (/^[1-5]$/.test(ch) || ch === "[" || ch === "]") {
          setDetail(null);
          if (/^[1-5]$/.test(ch)) return setTab(Number(ch) - 1);
          return setTab((i) => (i + (ch === "]" ? 1 : -1) + tabs.length) % tabs.length);
        }
        if (key.escape || key.backspace || key.leftArrow) return setDetail(null);
        if (key.upArrow || ch === "k") return setDetailTop((n) => Math.max(0, n - 1));
        if (key.downArrow || ch === "j") return setDetailTop((n) => n + 1);
        if (key.pageDown) return setDetailTop((n) => n + bodyHeight - 2);
        if (key.pageUp) return setDetailTop((n) => Math.max(0, n - bodyHeight + 2));
        if (ch === "o" && (detail.url ?? detail.entry.url)) return onOpenUrl((detail.url ?? detail.entry.url)!);
        if (ch === "a") return ask(detail.entry, detail.url);
        return;
      }
      if (key.escape) return onExit();
      if (key.shift) return; // shift+←/→ belongs to pane switching
      if (key.leftArrow || ch === "[") return setTab((i) => (i - 1 + tabs.length) % tabs.length);
      if (key.rightArrow || ch === "]") return setTab((i) => (i + 1) % tabs.length);
      if (/^[1-5]$/.test(ch)) return setTab(Number(ch) - 1);
      if (key.upArrow || ch === "k") return setCursor((c) => Math.max(0, c - 1));
      if (key.downArrow || ch === "j") return setCursor((c) => Math.min(entries.length - 1, c + 1));
      if (key.pageDown) return setCursor((c) => Math.min(entries.length - 1, c + 5));
      if (key.pageUp) return setCursor((c) => Math.max(0, c - 5));
      const e = entries[cursor];
      if (key.return && e) return void openDetail(e);
      if (ch === "o" && e?.url) return onOpenUrl(e.url);
      if (ch === "a" && e) return ask(e);
      if (ch === "r") return void refresh(true);
      if ((ch === "h" || key.backspace) && scope.kind === "repo") {
        setScope({ kind: "account" });
        return setTab(0);
      }
    },
    { isActive: focused },
  );

  const title = scope.kind === "repo" ? scope.repo : who ? `@${who}` : "GitHub";
  const toneColor = (tone?: string) =>
    tone === "good" ? t.green : tone === "bad" ? t.red : tone === "warn" ? t.yellow : tone === "muted" ? t.gray : tone === "head" ? accent : t.white;

  return (
    <Box flexDirection="column" width={width} height={height} flexShrink={0} backgroundColor={t.bg} borderStyle={frameOf(t)}
      borderBackgroundColor={t.bg} borderColor={bc(t, focused ? accent : t.border)} paddingX={1}>
      <Box flexShrink={0} flexDirection="column">
      <Text wrap="truncate" color={t.white}>
        <Text bold color={focusInvert(t, focused) ? t.black : focused ? accent : t.white} backgroundColor={focusInvert(t, focused) ? accent : undefined}>{focusMark(t, focused)}{titleOf(t, "GitHub")}</Text>
        <Text color={t.gray}>{" · " + clip(title, Math.max(4, inner - 3 - titleOf(t, "GitHub").length - focusMark(t, focused).length - (loading ? 4 : 0)))}</Text>
        {loading && <Text color={t.yellow}>{" ⟳"}</Text>}
      </Text>
      <Text wrap="truncate" color={t.gray}>
        {tabs.map((name, i) => (
          // The gap sits outside the underlined name: Ink can't switch underline off inside it.
          // Narrow panels close the gaps up so all five tabs still fit.
          <React.Fragment key={name}>
            <Text color={i === tab ? (focused ? accent : t.white) : t.gray} bold={i === tab} underline={i === tab}>{name}</Text>
            {i < tabs.length - 1 && <Text color={t.gray}>{tabs.join("  ").length <= inner ? "  " : " "}</Text>}
          </React.Fragment>
        ))}
      </Text>
      <Text color={t.border}>{ruleOf(t, inner)}</Text>
      </Box>

      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {detail ? (
          <>
            {(() => {
              // Every detail line wraps; scrolling counts wrapped lines.
              const all = [
                ...wrapText(detail.title, inner).map((text) => ({ text, tone: "title" as string | undefined })),
                ...detail.lines.flatMap((l) => wrapText(l.text || " ", inner).map((text) => ({ text, tone: l.tone as string | undefined }))),
              ];
              return all.slice(detailTop, detailTop + bodyHeight).map((l, i) => (
                <Text key={detailTop + i} color={l.tone === "title" ? t.white : toneColor(l.tone)} bold={l.tone === "head" || l.tone === "title"}>
                  {l.text || " "}
                </Text>
              ));
            })()}
          </>
        ) : (
          <>
            {current?.error && <Text color={t.red} wrap="wrap">{current.error}</Text>}
            {!current && <Text color={t.gray}>Loading…</Text>}
            {current && !current.error && !entries.length && <Text color={t.gray}>Nothing here.</Text>}
            {(() => {
              const out: React.ReactNode[] = [];
              let line = 0;
              for (const r of rows) {
                const h = heightOf(r);
                if (line + h <= top) { line += h; continue; }
                if (line >= top + bodyHeight) break;
                line += h;
                if (r.kind === "day") {
                  out.push(<Box key={"d" + r.text} flexShrink={0}><Text bold color={t.yellow}>{r.text}</Text></Box>);
                  continue;
                }
                const sel = focused && r.index === cursor;
                const e = r.e;
                const c = cardLines(e);
                // A card: a bar on the left (accent when selected), the state icon, the
                // full title wrapped, then repo · age under it; nothing is cut off.
                const bar = <Text color={sel ? accent : t.border}>{sel ? "▌ " : "│ "}</Text>;
                out.push(
                  <Box key={e.id + r.index} flexDirection="column" flexShrink={0} marginBottom={1}>
                    {c.title.map((l, k) => (
                      <Text key={"t" + k} color={t.white}>
                        {bar}
                        <Text color={stateColor(t, e.state)}>{k === 0 ? ICON[e.kind] + " " : "  "}</Text>
                        <Text bold={sel} color={sel ? accent : t.white}>{l}</Text>
                      </Text>
                    ))}
                    {c.meta.map((l, k) => (
                      <Text key={"m" + k} color={t.gray}>{bar}{"  "}{l}</Text>
                    ))}
                  </Box>,
                );
              }
              return out;
            })()}
          </>
        )}
      </Box>
      <Box flexShrink={0} flexDirection="column">
        <Text color={t.border}>{ruleOf(t, inner)}</Text>
        {hintLines.map((l, i) => <Text key={i} color={t.gray}>{l}</Text>)}
      </Box>
    </Box>
  );
}
