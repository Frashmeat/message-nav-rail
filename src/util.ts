export const PREVIEW_LEN = 80;
export const SLOT_WIDTH = 2;

export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function maxVisibleFor(width: number): number {
  return Math.max(1, Math.floor(width / SLOT_WIDTH));
}
