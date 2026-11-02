// Fonts belong to the terminal, not to the app, so /font changes the font of the
// Terminal.app tab claude-tui runs in (found by its tty) through AppleScript.
// Terminal applies it to that tab's profile, so it also sticks for new windows.
import { execFileSync } from "node:child_process";

export const canChangeFont = () => process.env.TERM_PROGRAM === "Apple_Terminal";

/** This process's terminal device, e.g. /dev/ttys003. */
function myTty(): string | null {
  try {
    const t = execFileSync("ps", ["-o", "tty=", "-p", String(process.pid)]).toString().trim();
    return t && t !== "??" ? `/dev/${t}` : null;
  } catch {
    return null;
  }
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

function tabScript(body: string): string {
  const tty = myTty();
  return `tell application "Terminal"
  repeat with w in windows
    repeat with t in tabs of w
      if tty of t is "${esc(tty ?? "")}" then
        ${body}
      end if
    end repeat
  end repeat
end tell`;
}

export function currentFont(): { name: string; size: number } | null {
  if (!canChangeFont()) return null;
  try {
    const out = execFileSync("osascript", ["-e", tabScript(`return (font name of current settings of t) & "|" & (font size of current settings of t)`)])
      .toString().trim();
    const [name, size] = out.split("|");
    return name ? { name, size: Number(size) || 12 } : null;
  } catch {
    return null;
  }
}

export function setFont(name: string, size: number): string | null {
  if (!canChangeFont()) return "Font changes work in macOS Terminal; change the font in your terminal's settings.";
  try {
    execFileSync("osascript", ["-e", tabScript(
      `set font name of current settings of t to "${esc(name)}"
        set font size of current settings of t to ${Math.round(size)}`,
    )]);
    return null;
  } catch (e: any) {
    return String(e?.stderr ?? e?.message ?? e).trim().split("\n").pop() ?? "Couldn't change the font";
  }
}

let cache: { family: string; postscript: string }[] | null = null;

/** Installed fixed-pitch font families (regular face), via AppKit. */
export function monoFonts(): { family: string; postscript: string }[] {
  if (cache) return cache;
  try {
    const js = `ObjC.import("AppKit");
const fm = $.NSFontManager.sharedFontManager; const out = [];
for (const f of ObjC.deepUnwrap(fm.availableFontFamilies)) {
  const members = ObjC.deepUnwrap(fm.availableMembersOfFontFamily(f)) || [];
  const m = members.find(x => ["Regular", "Book", "Medium", "Roman"].includes(x[2])) || members[0];
  if (!m) continue;
  const font = $.NSFont.fontWithNameSize(m[0], 12);
  if (font && font.isFixedPitch) out.push(f + "\\t" + m[0]);
}
out.join("\\n")`;
    const out = execFileSync("osascript", ["-l", "JavaScript", "-e", js]).toString().trim();
    cache = out.split("\n").filter(Boolean).map((l) => {
      const [family, postscript] = l.split("\t");
      return { family, postscript };
    });
  } catch {
    cache = [];
  }
  // Apple's terminal font is hidden from the font list but always present.
  if (!cache.some((f) => f.postscript.startsWith("SFMono"))) cache.unshift({ family: "SF Mono", postscript: "SFMonoTerminal-Regular" });
  return cache;
}

// ---------- terminal background follows the theme ----------
// The theme paints everything claude-tui draws, but the terminal's own background
// still shows in its padding and the last column/row. So the tab's background is set
// to the theme's (Terminal.app: only this tab, through AppleScript; other terminals:
// OSC 11), and put back when claude-tui quits.
let originalTabBg: string | null = null;
let changed = false;

const toApple = (hex: string) => {
  const n = hex.replace("#", "");
  return `{${[0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) * 257).join(", ")}}`;
};

/** Sets the terminal's background to `hex`, or restores the original with null. */
export function setTerminalBackground(hex: string | null) {
  try {
    if (canChangeFont()) {
      if (hex) {
        if (originalTabBg === null) {
          originalTabBg = execFileSync("osascript", ["-e", tabScript(`set c to background color of t
        return ((item 1 of c) as string) & "," & ((item 2 of c) as string) & "," & ((item 3 of c) as string)`)]).toString().trim() || "";
        }
        execFileSync("osascript", ["-e", tabScript(`set background color of t to ${toApple(hex)}`)]);
        changed = true;
      } else if (changed && originalTabBg) {
        execFileSync("osascript", ["-e", tabScript(`set background color of t to {${originalTabBg}}`)]);
        changed = false;
      }
    } else if (process.stdout.isTTY) {
      process.stdout.write(hex ? `\x1b]11;${hex}\x07` : "\x1b]111\x07");
      changed = !!hex;
    }
  } catch {}
}

/** On quit: the terminal gets its own background back. */
export function restoreTerminalBackground() {
  if (changed) setTerminalBackground(null);
}
