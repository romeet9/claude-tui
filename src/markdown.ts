// Claude's replies are Markdown; render them for the terminal (bold, headings,
// lists, code, aligned tables) at the chat column's width, in the theme's colors.
// Cached per theme+width+text, since the chat redraws often (spinner, streaming).
import { Marked } from "marked";
import { markedTerminal } from "marked-terminal";
import chalk, { type ChalkInstance } from "chalk";
import { tidy } from "./transcript.js";
import type { Theme } from "./theme.js";

const ink = (color: string): ChalkInstance =>
  color.startsWith("#") ? chalk.hex(color) : ((chalk as any)[color] as ChalkInstance) ?? chalk;

const renderers = new Map<string, Marked>();
const cache = new Map<string, string>();
const BOX = /[─│┌┐└┘├┤┬┴┼]+/g;

function renderer(t: Theme, width: number): Marked {
  const key = t.id + ":" + width;
  let m = renderers.get(key);
  if (!m) {
    const same = (s: string) => s;
    m = new Marked(
      markedTerminal({
        width,
        reflowText: true,
        tab: 2,
        showSectionPrefix: false,
        heading: ink(t.cyan).bold,
        firstHeading: ink(t.cyan).bold,
        strong: ink(t.white).bold,
        em: ink(t.white).italic,
        codespan: ink(t.yellow),
        code: ink(t.yellow),
        blockquote: ink(t.gray).italic,
        link: ink(t.cyan),
        href: ink(t.cyan).underline,
        hr: ink(t.border),
        del: ink(t.gray).strikethrough,
        listitem: same,
        paragraph: same,
        table: same,
        text: same,
        tableOptions: { style: { head: [], border: [] } },
      } as any) as any,
    );
    renderers.set(key, m);
  }
  return m;
}

export function renderMarkdown(raw: string, width: number, t: Theme): string {
  const text = tidy(raw);
  const w = Math.max(20, Math.floor(width));
  const key = t.id + "\u0000" + w + "\u0000" + text;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let out: string;
  try {
    out = (renderer(t, w).parse(text) as string).replace(/\n+$/, "");
    // Table borders in the theme's border color; everything else defaults to its text color.
    out = out.replace(BOX, (m) => ink(t.border)(m));
    out = ink(t.white)(out);
  } catch {
    out = text;
  }
  if (cache.size > 500) cache.clear();
  cache.set(key, out);
  return out;
}
