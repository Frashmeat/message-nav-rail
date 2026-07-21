import type { RailState } from "./types";
import { moveSelection, selectByVisibleIndex } from "./state";

export interface ShortcutContext {
  state: RailState;
  width: number;
  notify: (msg: string, level: "info" | "warning" | "error") => void;
  setState: (s: RailState) => void;
  /** 跳转到第 idx 条消息对应的会话 entry；返回是否已发起跳转 */
  navigateTo: (idx: number) => Promise<boolean> | boolean;
}

export function handleAltArrow(
  ctx: ShortcutContext,
  direction: 1 | -1
): void {
  const next = moveSelection(ctx.state, direction);
  ctx.setState(next);
  if (next.selectedIndex >= 0) {
    void ctx.navigateTo(next.selectedIndex);
  }
}

export function handleAltNumber(ctx: ShortcutContext, n: number): void {
  const next = selectByVisibleIndex(ctx.state, n, ctx.width);
  ctx.setState(next);
  if (next.selectedIndex >= 0) {
    void ctx.navigateTo(next.selectedIndex);
  }
}

export function handleAltSlash(ctx: ShortcutContext): void {
  const idx = ctx.state.selectedIndex;
  if (idx < 0 || idx >= ctx.state.messages.length) {
    ctx.notify("未选中任何消息", "warning");
    return;
  }
  const m = ctx.state.messages[idx];
  ctx.notify(`[用户] ${m.preview}`, "info");
}
