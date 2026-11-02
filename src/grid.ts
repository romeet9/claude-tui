// The bento grid: chat panes fill the space between the sidebar and the right column,
// in rows of two (three on very short windows). An odd last pane spans the whole row,
// so three panes are two on top and one wide one underneath. Order = the pane list;
// moving a pane earlier/later moves it up/down the grid.

export type Rect = { x: number; y: number; w: number; h: number; row: number; col: number };

export const MIN_PANE_W = 40;
export const MIN_PANE_H = 12;

/**
 * Rects (0-based, relative to the grid's top-left) for n panes in a W×H area.
 * `split` is the left pane's share of a two-pane row (the same for every row).
 */
export function gridRects(n: number, W: number, H: number, gap: number, vgap: number, split: number): Rect[] {
  if (n <= 0) return [];
  const maxCols = Math.max(1, Math.min(3, Math.floor((W + gap) / (MIN_PANE_W + gap))));
  let cols = n === 1 ? 1 : Math.min(2, maxCols);
  const fits = (c: number) => {
    const rows = Math.ceil(n / c);
    return rows * MIN_PANE_H + (rows - 1) * vgap <= H;
  };
  if (!fits(cols) && maxCols >= 3) cols = 3;
  const rows = Math.ceil(n / cols);

  const usableH = H - (rows - 1) * vgap;
  const heights = Array.from({ length: rows }, (_, r) => Math.floor(usableH / rows) + (r < usableH % rows ? 1 : 0));

  const out: Rect[] = [];
  let y = 0;
  for (let r = 0; r < rows; r++) {
    const count = Math.min(cols, n - r * cols);
    const usableW = W - (count - 1) * gap;
    let widths: number[];
    if (count === 2) {
      const left = Math.max(MIN_PANE_W, Math.min(usableW - MIN_PANE_W, Math.round(usableW * split)));
      widths = [left, usableW - left];
    } else {
      widths = Array.from({ length: count }, (_, c) => Math.floor(usableW / count) + (c < usableW % count ? 1 : 0));
    }
    let x = 0;
    for (let c = 0; c < count; c++) {
      out.push({ x, y, w: widths[c], h: heights[r], row: r, col: c });
      x += widths[c] + gap;
    }
    y += heights[r] + vgap;
  }
  return out;
}

/** The pane above / below `from`: the one in the next row whose middle is nearest. */
export function neighbor(rects: Rect[], from: number, dir: -1 | 1): number {
  const a = rects[from];
  if (!a) return from;
  const mid = a.x + a.w / 2;
  let best = from, bestD = Infinity;
  rects.forEach((r, i) => {
    if (r.row !== a.row + dir) return;
    const d = Math.abs(r.x + r.w / 2 - mid);
    if (d < bestD) { best = i; bestD = d; }
  });
  return best;
}

/** Which rect a 0-based point falls in, or -1. */
export function hit(rects: Rect[], x: number, y: number): number {
  return rects.findIndex((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
}
