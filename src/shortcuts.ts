import type { RailState } from "./types";
import { moveSelection, selectByVisibleIndex } from "./state";

export interface ShortcutContext {
  state: RailState;
  width: number;
  notify: (msg: string, level: "info" | "warn" | "error") => void;
  setState: (s: RailState) => void;
}

export function handleAltArrow(
  ctx: ShortcutContext,
  direction: 1 | -1
): void {
  ctx.setState(moveSelection(ctx.state, direction));
}

export function handleAltNumber(ctx: ShortcutContext, n: number): void {
  ctx.setState(selectByVisibleIndex(ctx.state, n, ctx.width));
}

export function handleAltSlash(ctx: ShortcutContext): void {
  const idx = ctx.state.selectedIndex;
  if (idx < 0 || idx >= ctx.state.messages.length) {
    ctx.notify("未选中任何消息", "warn");
    return;
  }
  const m = ctx.state.messages[idx];
  ctx.notify(
    `[${m.type === "user" ? "用户" : "模型"}] ${m.preview}`,
    "info"
  );
}
