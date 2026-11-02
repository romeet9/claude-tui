#!/usr/bin/env python3
"""Records the README demo: runs `scripts/demo.mjs` (made-up data) in a virtual
terminal, clicks and types through the real UI, and renders every frame in a macOS
style window with a visible pointer and key badges.

    pip install pyte pillow        # plus ffmpeg on PATH
    python3 scripts/record-demo.py # writes docs/demo.gif and docs/screenshot.png
"""
import fcntl, json, math, os, pty, re, select, shutil, struct, subprocess, sys, tempfile, termios, time

import pyte
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs")
COLS, ROWS = 170, 46

# ---------------------------------------------------------------- terminal
pid, fd = pty.fork()
if pid == 0:
    os.environ.update(TERM="xterm-256color", COLORTERM="truecolor")
    os.execvp("node", ["node", os.path.join(ROOT, "scripts", "demo.mjs")])
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))
screen = pyte.Screen(COLS, ROWS)
stream = pyte.ByteStream(screen)

frames = []          # (time, cells, pointer, click_age, badge)
pointer = None       # (col, row) in cells, float
click_at = -10.0
badge = None         # (label, until)
t0 = time.time()

def snapshot():
    cells = tuple(
        tuple((c.data, c.fg, c.bg, c.bold, c.reverse) for c in (screen.buffer[y][x] for x in range(COLS)))
        for y in range(ROWS))
    now = time.time() - t0
    b = badge[0] if badge and badge[1] > now else None
    state = (cells, pointer, now - click_at < 0.35, b)
    if not frames or frames[-1][1:] != state:
        frames.append((now,) + state)

def pump(secs):
    end = time.time() + secs
    while True:
        left = end - time.time()
        if left <= 0:
            break
        r, _, _ = select.select([fd], [], [], min(0.06, left))
        if r:
            try:
                stream.feed(os.read(fd, 1 << 16))
            except OSError:
                break
        snapshot()
    snapshot()

def text():
    return "\n".join(screen.display)

def until(pattern, timeout=30):
    end = time.time() + timeout
    while time.time() < end:
        pump(0.1)
        if re.search(pattern, text()):
            return True
    print("timeout waiting for", pattern, file=sys.stderr)
    return False

def find(s, after_row=0, min_col=0):
    for y, line in enumerate(screen.display):
        if y < after_row:
            continue
        x = line.find(s, min_col)
        if x != -1:
            return x, y
    with open(os.path.join(tempfile.gettempdir(), "record-demo-screen.txt"), "w") as fh:
        fh.write(text())
    raise SystemExit(f"not on screen: {s!r} (screen saved to {tempfile.gettempdir()}/record-demo-screen.txt)")

def send(s):
    os.write(fd, s.encode())

def move(col, row, secs=0.5):
    global pointer
    start = pointer or (COLS * 0.6, ROWS * 0.6)
    steps = max(1, int(secs / 0.03))
    for i in range(1, steps + 1):
        k = i / steps
        k = 1 - (1 - k) ** 3  # ease out
        pointer = (start[0] + (col - start[0]) * k, start[1] + (row - start[1]) * k)
        pump(0.03)

def click(col, row):
    global click_at
    move(col, row)
    pump(0.15)
    click_at = time.time() - t0
    send(f"\x1b[<0;{int(col) + 1};{int(row) + 1}M\x1b[<0;{int(col) + 1};{int(row) + 1}m")
    pump(0.4)

def key(seq, label, hold=0.9):
    global badge
    badge = (label, time.time() - t0 + hold)
    send(seq)
    pump(hold)

def type_text(s, cps=22):
    for ch in s:
        send(ch)
        pump(1 / cps)

# ---------------------------------------------------------------- script
pump(3.0)
until(r"Claude Code", 20)
pump(1.0)

c, r = find("Acme · Web App")
click(c + 4, r)                                   # expand the workspace: sessions of all agents
pump(1.6)

c, r = find("Claude Code")
click(c + 5, r - 3)                               # focus the Claude pane
type_text("Add a dark mode toggle to Settings")
send("\r")
until(r"Allow Edit", 20)
pump(1.4)
key("y", "y  allow", 0.6)
until(r"settings tests pass", 30)
pump(1.6)

key("\x0e", "⌃N  new pane")                      # picker
c, r = find("CODEX  Codex")
click(c + 2, r)
pump(0.8)
type_text("Why is the cart test flaky?")
send("\r")
pump(0.4)

key("\x0e", "⌃N  new pane")
key("3", "3  Antigravity", 0.7)
type_text("Audit the landing page")
send("\r")
until(r"20/20 runs pass", 30)
until(r"Preload the display font", 30)
pump(1.2)

c, r = find(" CODEX ")
click(c + 12, r + 8)                              # usage follows the clicked pane
pump(1.4)
c, r = find(" AGY ")
click(c + 12, r + 8)
pump(1.4)

key("\x14", "⌃T  GitHub", 1.2)
pump(3.5)
send("\x11")
pump(0.5)
try:
    os.kill(pid, 9)
except OSError:
    pass

# ---------------------------------------------------------------- render
PALETTE = {
    "default": None, "black": "#1e1e1e", "red": "#ff7262", "green": "#0acf83", "brown": "#ffc700",
    "yellow": "#ffc700", "blue": "#1abcfe", "magenta": "#a259ff", "cyan": "#1abcfe", "white": "#e6e6e6",
    "brightblack": "#8a8a8a", "brightred": "#ff8a7a", "brightgreen": "#3ee0a0", "brightbrown": "#ffd84d",
    "brightyellow": "#ffd84d", "brightblue": "#5ccfff", "brightmagenta": "#bf8cff", "brightcyan": "#5ccfff",
    "brightwhite": "#ffffff",
}
FG, BG = "#e6e6e6", "#1e1e1e"

def color(c, default):
    if c in (None, "default"):
        return default
    if re.fullmatch(r"[0-9a-fA-F]{6}", c):
        return "#" + c
    return PALETTE.get(c) or default

LIGHT = {"─": "ew", "│": "ns", "┌": "es", "┐": "sw", "└": "ne", "┘": "nw", "├": "nes", "┤": "nsw",
         "┬": "esw", "┴": "new", "┼": "nesw", "╭": "es", "╮": "sw", "╰": "ne", "╯": "nw"}
HEAVY = {"━": "ew", "┃": "ns", "┏": "es", "┓": "sw", "┗": "ne", "┛": "nw"}
DOUBLE = {"═": "ew", "║": "ns", "╔": "es", "╗": "sw", "╚": "ne", "╝": "nw"}
ROUND = set("╭╮╰╯")

def renderer(scale):
    size = 14 * scale
    reg = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", size, index=0)
    bold = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", size, index=1)
    cw = reg.getlength("M")
    ch = round(18 * scale)
    base = round(13.5 * scale)
    pad, bar = 22 * scale, 34 * scale
    W = math.ceil(COLS * cw) + 2 * pad
    H = ROWS * ch + bar + pad
    margin = 36 * scale

    def lines(d, x0, y0, x1, y1, dirs, glyph, fg):
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        w = max(1, round(scale * (2 if glyph in HEAVY else 1)))
        offs = [-1.5 * scale, 1.5 * scale] if glyph in DOUBLE else [0]
        for o in offs:
            if glyph in ROUND:
                r = (x1 - x0) / 2
                # quarter arc joining the two half-lines
                box = {"╭": (cx, cy, cx + 2 * r, cy + 2 * r, 180, 270), "╮": (cx - 2 * r, cy, cx, cy + 2 * r, 270, 360),
                       "╰": (cx, cy - 2 * r, cx + 2 * r, cy, 90, 180), "╯": (cx - 2 * r, cy - 2 * r, cx, cy, 0, 90)}[glyph]
                d.arc(box[:4], box[4], box[5], fill=fg, width=w)
                if "s" in dirs: d.line([(cx, cy + r), (cx, y1)], fill=fg, width=w)
                if "n" in dirs: d.line([(cx, y0), (cx, cy - r)], fill=fg, width=w)
                continue
            if "e" in dirs: d.line([(cx - (w / 2 if "n" in dirs or "s" in dirs else 0), cy + o), (x1, cy + o)], fill=fg, width=w)
            if "w" in dirs: d.line([(x0, cy + o), (cx + (w / 2 if "n" in dirs or "s" in dirs else 0), cy + o)], fill=fg, width=w)
            if "n" in dirs: d.line([(cx + o, y0), (cx + o, cy)], fill=fg, width=w)
            if "s" in dirs: d.line([(cx + o, cy), (cx + o, y1)], fill=fg, width=w)

    def mix(a, b, k):
        a, b = a.lstrip("#"), b.lstrip("#")
        return "#" + "".join(f"{round(int(a[i:i+2], 16) * k + int(b[i:i+2], 16) * (1 - k)):02x}" for i in (0, 2, 4))

    def draw(cells, ptr, clicking, badge_label):
        img = Image.new("RGB", (W + 2 * margin, H + 2 * margin), "#0d1117")
        d = ImageDraw.Draw(img)
        # window: shadow, body, title bar with traffic lights
        for i in range(10, 0, -1):
            d.rounded_rectangle([margin - i * scale, margin - i * scale + 6 * scale, margin + W + i * scale, margin + H + i * scale + 6 * scale],
                                radius=14 * scale, fill=mix("#000000", "#0d1117", 0.05 * (11 - i) / 10 + 0.02))
        d.rounded_rectangle([margin, margin, margin + W, margin + H], radius=12 * scale, fill=BG, outline="#3a3a3a", width=max(1, scale))
        for i, col in enumerate(["#ff5f57", "#febc2e", "#28c840"]):
            x = margin + (18 + i * 20) * scale
            d.ellipse([x - 6 * scale, margin + bar / 2 - 6 * scale, x + 6 * scale, margin + bar / 2 + 6 * scale], fill=col)
        title = "claude-tui — ~/Claude Workspaces/Acme · Web App"
        tf = ImageFont.truetype("/System/Library/Fonts/SFNS.ttf", 13 * scale)
        d.text((margin + W / 2, margin + bar / 2), title, font=tf, fill="#9a9a9a", anchor="mm")
        ox, oy = margin + pad, margin + bar
        for y, row in enumerate(cells):
            for x, (g, fgc, bgc, b, rev) in enumerate(row):
                fg, bg = color(fgc, FG), color(bgc, BG)
                if rev:
                    fg, bg = bg, fg
                x0, y0 = ox + round(x * cw), oy + y * ch
                x1, y1 = ox + round((x + 1) * cw), y0 + ch
                if bg != BG:
                    d.rectangle([x0, y0, x1 - 1, y1 - 1], fill=bg)
                if g in (" ", ""):
                    continue
                if g == "█": d.rectangle([x0, y0, x1 - 1, y1 - 1], fill=fg)
                elif g == "▀": d.rectangle([x0, y0, x1 - 1, y0 + ch // 2 - 1], fill=fg)
                elif g == "▄": d.rectangle([x0, y0 + ch // 2, x1 - 1, y1 - 1], fill=fg)
                elif g == "▌": d.rectangle([x0, y0, (x0 + x1) // 2 - 1, y1 - 1], fill=fg)
                elif g == "▐": d.rectangle([(x0 + x1) // 2, y0, x1 - 1, y1 - 1], fill=fg)
                elif g == "░": d.rectangle([x0, y0 + 2 * scale, x1 - 1, y1 - 2 * scale], fill=mix(fg, bg, 0.28))
                elif 0x2800 <= ord(g[0]) <= 0x28FF:
                    # Braille (the spinner): Menlo has no glyphs for it, so draw the dots.
                    bits = ord(g[0]) - 0x2800
                    dots = [(0, 0), (0, 1), (0, 2), (1, 0), (1, 1), (1, 2), (0, 3), (1, 3)]
                    r = 1.3 * scale
                    for i, (dx, dy) in enumerate(dots):
                        if bits & (1 << i):
                            px = x0 + (x1 - x0) * (0.32 + 0.36 * dx)
                            py = y0 + ch * (0.2 + 0.2 * dy)
                            d.ellipse([px - r, py - r, px + r, py + r], fill=fg)
                elif g in LIGHT or g in HEAVY or g in DOUBLE:
                    lines(d, x0, y0, x1, y1, LIGHT.get(g) or HEAVY.get(g) or DOUBLE.get(g), g, fg)
                else:
                    d.text((x0, y0 + base), g, font=bold if b else reg, fill=fg, anchor="ls")
        if badge_label:
            bf = ImageFont.truetype("/System/Library/Fonts/SFNS.ttf", 15 * scale)
            tw = d.textlength(badge_label, font=bf)
            bx, by = margin + W / 2, margin + H - 46 * scale
            d.rounded_rectangle([bx - tw / 2 - 16 * scale, by - 17 * scale, bx + tw / 2 + 16 * scale, by + 17 * scale],
                                radius=17 * scale, fill="#2c2c2e", outline="#5a5a5e", width=max(1, scale))
            d.text((bx, by), badge_label, font=bf, fill="#ffffff", anchor="mm")
        if ptr:
            px, py = ox + ptr[0] * cw + cw / 2, oy + ptr[1] * ch + ch / 2
            if clicking:
                d.ellipse([px - 14 * scale, py - 14 * scale, px + 14 * scale, py + 14 * scale], outline="#ffffff", width=2 * scale)
            s = scale
            arrow = [(0, 0), (0, 17), (4, 13), (7, 20), (10, 19), (7, 12), (12, 12)]
            pts = [(px + ax * s, py + ay * s) for ax, ay in arrow]
            d.polygon(pts, fill="#ffffff", outline="#000000")
        return img
    return draw

os.makedirs(OUT, exist_ok=True)
tmp = tempfile.mkdtemp()
draw = renderer(1)
listing = []
for i, f in enumerate(frames):
    dur = (frames[i + 1][0] if i + 1 < len(frames) else f[0] + 2.5) - f[0]
    if dur < 0.03 and i + 1 < len(frames):
        continue  # too short to see; the next frame covers it
    name = os.path.join(tmp, f"f{i:05d}.png")
    draw(f[1], f[2], f[3], f[4]).save(name)
    listing.append((name, max(dur, 0.03)))
with open(os.path.join(tmp, "list.txt"), "w") as fh:
    for name, dur in listing:
        fh.write(f"file '{name}'\nduration {dur:.3f}\n")
    fh.write(f"file '{listing[-1][0]}'\n")
gif = os.path.join(OUT, "demo.gif")
palette = os.path.join(tmp, "palette.png")
common = ["-f", "concat", "-safe", "0", "-i", os.path.join(tmp, "list.txt")]
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *common, "-vf", "fps=15,scale=1280:-1:flags=lanczos,palettegen=stats_mode=diff:max_colors=192", palette], check=True)
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *common, "-i", palette, "-lavfi",
                "fps=15,scale=1280:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle", gif], check=True)

# Screenshot: the busiest frame (all three panes + GitHub column), drawn at 2x.
best = max(frames, key=lambda f: sum(1 for row in f[1] for c in row if c[0] not in (" ", "")))
draw2 = renderer(2)
draw2(best[1], None, False, None).save(os.path.join(OUT, "screenshot.png"), optimize=True)
shutil.rmtree(tmp, ignore_errors=True)
print(f"{len(frames)} frames → {gif} ({os.path.getsize(gif) // 1024} KB), docs/screenshot.png")
