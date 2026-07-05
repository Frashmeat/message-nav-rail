import type { RailState, RailMessage } from "./types";
import { INITIAL_STATE } from "./types";

const PREVIEW_LEN = 80;

export function moveSelection(state: RailState, delta: number): RailState {
  if (state.messages.length === 0) return state;
  const next = state.selectedIndex + delta;
  return { ...state, selectedIndex: clamp(next, 0, state.messages.length - 1) };
}

export function clampSelection(state: RailState): RailState {
  if (state.messages.length === 0) return { ...state, selectedIndex: -1 };
  return {
    ...state,
    selectedIndex: clamp(state.selectedIndex, 0, state.messages.length - 1),
  };
}

export function selectByVisibleIndex(
  state: RailState,
  n: number,
  width: number
): RailState {
  if (state.messages.length === 0) return state;
  const maxVisible = Math.max(1, Math.floor(width / 2));
  const start = Math.max(0, state.messages.length - maxVisible);
  const idx = clamp(start + (n - 1), start, state.messages.length - 1);
  return { ...state, selectedIndex: idx };
}

export function rebuildFromEntries(
  entries: Array<{ type: string; content: string }>
): RailState {
  const messages: RailMessage[] = [];
  for (const e of entries) {
    if (e.type !== "user" && e.type !== "assistant") continue;
    messages.push({
      id: `${e.type}-${messages.length}`,
      type: e.type,
      preview: truncate(e.content ?? "", PREVIEW_LEN),
      timestamp: 0,
      streaming: false,
    });
  }
  return { ...INITIAL_STATE, messages };
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
