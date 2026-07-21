import type { RailMessage } from "./types";
import { visibleRange } from "./state";

const SYMBOLS = {
  user: "●",
  selected: "◉",
} as const;

export function renderRail(
  messages: RailMessage[],
  selectedIndex: number,
  width: number
): string[] {
  if (messages.length === 0) return [""];

  const { start, end } = visibleRange(messages.length, selectedIndex, width);
  const visible = messages.slice(start, end);

  let line = "";
  for (let i = 0; i < visible.length; i++) {
    const idx = start + i;
    const sym = idx === selectedIndex ? SYMBOLS.selected : SYMBOLS.user;
    line += sym + (i < visible.length - 1 ? " " : "");
  }
  return [line];
}
