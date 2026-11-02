// Right panel: drives the user's real Chrome through Browser MCP (its extension),
// so pages open with their own logins. The page shows as Browser MCP's
// accessibility snapshot; refs like e12 can be clicked or typed as commands.
import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { runBrowser } from "./mcp.js";
import { useTheme , bc, ruleOf, frameOf } from "./theme.js";
import { useKeys, pretty } from "./keys.js";
import { tidy } from "./transcript.js";

const COMMANDS = /^(goto|back|forward|reload|click|fill|type|press|select|check|uncheck|wait|tab|snapshot|find|get|screenshot|eval|help|scroll|hover|drag|upload|dialog|console|requests|request)\b/;
const READS = /^(snapshot|find|get|tab list|help|console|requests|request)\b/;
const REFRESH = "get url\nget title\nsnapshot -i";
/** Rows above the page body inside the panel: border, url, title, divider. */
export const BROWSER_BODY_TOP = 5;

/** What the typed line means: a command, a ref to click, a URL, or a search. */
export function toCommand(input: string): string {
  const s = input.trim();
  if (!s) return "";
  if (/^e\d+$/.test(s)) return `click ${s}`;
  if (COMMANDS.test(s)) return s;
  if (/^(https?:\/\/|localhost(:\d+)?)/i.test(s)) return `goto ${s.startsWith("localhost") ? "http://" + s : s}`;
  if (!/\s/.test(s) && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(s)) return `goto https://${s}`;
  return `goto https://www.google.com/search?q=${encodeURIComponent(s)}`;
}

function parse(text: string) {
  const lines = tidy(text).split("\n");
  const status: string[] = [];
  while (lines.length && /^✓/.test(lines[0])) status.push(lines.shift()!);
  let url = "";
  let title = "";
  if (lines.length && /^[a-z][\w+.-]*:\/\//i.test(lines[0].trim())) {
    url = lines.shift()!.trim();
    title = (lines.shift() ?? "").trim();
  }
  return { status: status.join("  "), url, title, body: lines };
}

export function Browser(props: {
  width: number; height: number; focused: boolean;
  scrollRequest: { n: number; delta: number };
  /** A mouse click on a body row (0-based, relative to the body's first row). */
  clickRequest: { n: number; row: number };
  /** Open this URL (from the GitHub panel's "o"). */
  openRequest?: { n: number; url: string };
}) {
  const { width, height, focused, scrollRequest, clickRequest, openRequest } = props;
  const t = useTheme();
  const { keys } = useKeys();
  const accent = t.focus?.browser ?? t.cyan;
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState<string[]>([]);
  const [status, setStatus] = useState("Connecting to your browser…");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [top, setTop] = useState(0);

  async function run(command: string) {
    if (busy) return;
    setBusy(true);
    setStatus(command ? `› ${command.split("\n")[0]}` : "Refreshing…");
    const isRead = READS.test(command);
    // Actions are followed by a fresh snapshot in the same call.
    const script = !command ? REFRESH : isRead ? command : `${command}\nwait 500\n${REFRESH}`;
    let r = await runBrowser(script);
    if (r.isError && command && !isRead && !/No browser is connected/i.test(r.text)) {
      // The action failed; still show where the page is now.
      const after = await runBrowser(REFRESH);
      r = { ...after, text: after.text, isError: true };
      setStatus(`✗ ${command}`);
    }
    const p = parse(r.text);
    if (r.isError && /No browser is connected/i.test(r.text)) {
      setError(true);
      setStatus("Chrome isn't connected");
      setBody([
        "Browser MCP can't reach Chrome. To connect:",
        "1. Open Chrome.",
        "2. Install or update the Browser MCP extension (2.0+):",
        "   chrome://extensions → Developer mode → Update.",
        "3. Click the extension icon and press Connect.",
        "",
        "Then press Enter here (empty line) to retry.",
      ]);
    } else {
      setError(r.isError);
      if (p.url) {
        setUrl(p.url);
        setTitle(p.title);
      }
      setBody(p.body.length ? p.body : r.text.split("\n"));
      if (!r.isError) setStatus(p.status || (isRead ? `› ${command}` : "Ready"));
      setTop(0);
    }
    setBusy(false);
  }

  useEffect(() => {
    if (openRequest?.url) run(`goto ${openRequest.url}`);
    else run("");
  }, []);
  useEffect(() => {
    if (openRequest?.n && openRequest.url) run(`goto ${openRequest.url}`);
  }, [openRequest?.n]);

  const inner = width - 4;
  const view = Math.max(3, height - 8);
  const maxTop = Math.max(0, body.length - view);
  const scroll = (d: number) => setTop((n) => Math.max(0, Math.min(maxTop, n + d)));

  useEffect(() => {
    if (scrollRequest.n) scroll(-scrollRequest.delta);
  }, [scrollRequest.n]);

  // Clicking a page line with a ref (e12) clicks that element in Chrome.
  useEffect(() => {
    if (!clickRequest.n) return;
    const line = body[top + clickRequest.row];
    const ref = line?.match(/\b(e\d+)\b/)?.[1];
    if (ref) run(`click ${ref}`);
  }, [clickRequest.n]);

  useInput(
    (ch, key) => {
      if (key.return) {
        const cmd = toCommand(input);
        setInput("");
        return void run(cmd);
      }
      if (key.upArrow) return scroll(-1);
      if (key.downArrow) return scroll(1);
      if (key.pageUp) return scroll(-(view - 2));
      if (key.pageDown) return scroll(view - 2);
      if (key.backspace || key.delete) return setInput((s) => s.slice(0, -1));
      if (key.ctrl && ch === "u") return setInput("");
      if (key.ctrl && ch === "r") return void run("reload");
      if (ch && !key.ctrl && !key.meta && !key.tab && !key.escape) setInput((s) => s + ch.replace(/[\r\n]/g, ""));
    },
    { isActive: focused },
  );

  return (
    <Box flexDirection="column" width={width} height={height} flexShrink={0} backgroundColor={t.bg} borderStyle={frameOf(t)}
      borderBackgroundColor={t.bg} borderColor={bc(t, focused ? accent : t.border)} paddingX={1}>
      <Text wrap="truncate" color={t.white}>
        <Text color={error ? t.red : t.green}>{error ? "○ " : "● "}</Text>
        <Text color={url ? t.cyan : t.gray}>{url || "no page"}</Text>
      </Text>
      <Text wrap="truncate" bold color={t.white}>{title || " "}</Text>
      <Text color={t.border}>{ruleOf(t, inner)}</Text>
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {body.slice(top, top + view).map((l, i) => {
          const hasRef = /\be\d+\b/.test(l);
          return (
            <Text key={top + i} wrap="truncate" color={hasRef ? t.white : t.gray}>{l || " "}</Text>
          );
        })}
      </Box>
      <Text wrap="truncate" color={error ? t.red : busy ? t.yellow : t.gray}>{busy ? "⠿ " : ""}{status}</Text>
      <Box borderStyle={frameOf(t)} backgroundColor={t.card} borderBackgroundColor={t.card ?? t.bg} borderColor={t.card ?? bc(t, focused ? t.white : t.border)} paddingX={1}>
        <Text wrap="truncate" color={t.white}>
          {"→ "}
          {input}
          {focused ? <Text inverse> </Text> : <Text color={t.gray}>{input ? "" : `${pretty(keys.browser)} to browse`}</Text>}
        </Text>
      </Box>
      <Text color={t.gray} wrap="truncate">
        {focused ? "url/search · e12 click · back · tab list · ^R reload · esc" : ""}
      </Text>
    </Box>
  );
}
