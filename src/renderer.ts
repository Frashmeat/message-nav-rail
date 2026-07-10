import type { RailMessage } from "./types";
import { maxVisibleFor } from "./util";

const SYMBOLS = {
  user: "●",
  assistant: "○",
  streaming: "◐",
  selected: "◉",
} as const;

export function renderRail(
  messages: RailMessage[],
  selectedIndex: number,
  width: number
): string[] {
  if (messages.length === 0) return [""];

  const maxVisible = maxVisibleFor(width);
  const start = Math.max(0, messages.length - maxVisible);
  const visible = messages.slice(start);

  let line = "";
  for (let i = 0; i < visible.length; i++) {
    const idx = start + i;
    const m = visible[i];
    const base = m.streaming
      ? SYMBOLS.streaming
      : m.type === "user"
        ? SYMBOLS.user
        : SYMBOLS.assistant;
    const sym = idx === selectedIndex ? SYMBOLS.selected : base;
    line += sym + (i < visible.length - 1 ? " " : "");
  }
  return [line];
}
