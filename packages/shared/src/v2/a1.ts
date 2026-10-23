// A1 cell-address helpers for the v2 template engine. Pure.

export interface CellPos {
  row: number; // 1-based
  col: number; // 1-based
}

export interface RangePos {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** 1 -> "A", 27 -> "AA". */
export function colToLetters(col: number): string {
  let n = Math.floor(col);
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** "A" -> 1, "aa" -> 27. */
export function lettersToCol(letters: string): number {
  let col = 0;
  for (const ch of letters.toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return col;
}

const A1_RE = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/;

export function parseA1(address: string): CellPos | null {
  const m = A1_RE.exec(address.trim());
  if (!m) return null;
  const row = Number.parseInt(m[2], 10);
  if (row < 1) return null;
  return { row, col: lettersToCol(m[1]) };
}

export function toA1(row: number, col: number): string {
  return `${colToLetters(col)}${row}`;
}

/** "B2:D4" (or a single "B2") -> normalised range. */
export function parseRange(range: string): RangePos | null {
  const [a, b] = range.split(':');
  const p = parseA1(a ?? '');
  const q = b === undefined ? p : parseA1(b);
  if (!p || !q) return null;
  return {
    top: Math.min(p.row, q.row),
    left: Math.min(p.col, q.col),
    bottom: Math.max(p.row, q.row),
    right: Math.max(p.col, q.col),
  };
}

export function rangeToA1(r: RangePos): string {
  const a = toA1(r.top, r.left);
  const b = toA1(r.bottom, r.right);
  return a === b ? a : `${a}:${b}`;
}

export function inRange(pos: CellPos, r: RangePos): boolean {
  return pos.row >= r.top && pos.row <= r.bottom && pos.col >= r.left && pos.col <= r.right;
}

/**
 * The merge master (top-left) of the merged range containing `address`, or
 * the address itself (normalised) when it is not inside a merge (R4.8).
 */
export function mergeMaster(
  address: string,
  mergedRanges: readonly string[],
): { address: string; redirected: boolean } {
  const pos = parseA1(address);
  if (!pos) return { address, redirected: false };
  for (const range of mergedRanges) {
    const r = parseRange(range);
    if (r && inRange(pos, r)) {
      const master = toA1(r.top, r.left);
      return { address: master, redirected: master !== toA1(pos.row, pos.col) };
    }
  }
  return { address: toA1(pos.row, pos.col), redirected: false };
}
