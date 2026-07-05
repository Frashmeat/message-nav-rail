import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { INITIAL_STATE, type RailState } from "./types";
import { renderRail } from "./renderer";
import {
  onInput,
  onMessageStart,
  onMessageUpdate,
  onMessageEnd,
} from "./collector";
import { rebuildFromEntries } from "./state";
import {
  handleAltArrow,
  handleAltNumber,
  handleAltSlash,
  type ShortcutContext,
} from "./shortcuts";

export default function messageNavRail(pi: ExtensionAPI) {
  pi.setLabel("消息导航栏");

  let state: RailState = { ...INITIAL_STATE };
  let width = 80;

  function rerender() {
    try {
      const lines = renderRail(state.messages, state.selectedIndex, width);
      // ctx 在事件/命令中获取；此处用 pi 上挂载的当前 ctx
      const ui = (pi as any).__ctx?.ui;
      ui?.setWidget?.(lines, { placement: "aboveEditor" });
    } catch (e) {
      pi.logger?.error?.("message-nav-rail rerender failed", e);
    }
  }

  function setState(s: RailState) {
    state = s;
    rerender();
  }

  function makeShortcutCtx(): ShortcutContext {
    const ui = (pi as any).__ctx?.ui;
    return {
      state,
      width,
      notify: (m, l) => ui?.notify?.(m, l),
      setState,
    };
  }

  // 事件监听
  pi.on("input", async (event, ctx) => {
    (pi as any).__ctx = ctx;
    try {
      state = onInput(state, event.text ?? "");
      rerender();
    } catch (e) {
      pi.logger?.error?.("input handler failed", e);
    }
  });

  pi.on("message_start", async (event, ctx) => {
    (pi as any).__ctx = ctx;
    try {
      if (event.role === "assistant") {
        state = onMessageStart(
          state,
          event.messageId ?? String(Date.now())
        );
        rerender();
      }
    } catch (e) {
      pi.logger?.error?.("message_start handler failed", e);
    }
  });

  pi.on("message_update", async (event, ctx) => {
    (pi as any).__ctx = ctx;
    try {
      if (event.role === "assistant" && state.streamingAssistantId) {
        state = onMessageUpdate(
          state,
          state.streamingAssistantId,
          event.text ?? ""
        );
        rerender();
      }
    } catch (e) {
      pi.logger?.error?.("message_update handler failed", e);
    }
  });

  pi.on("message_end", async (event, ctx) => {
    (pi as any).__ctx = ctx;
    try {
      if (event.role === "assistant" && state.streamingAssistantId) {
        state = onMessageEnd(
          state,
          state.streamingAssistantId,
          event.text ?? ""
        );
        rerender();
      }
    } catch (e) {
      pi.logger?.error?.("message_end handler failed", e);
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    (pi as any).__ctx = ctx;
    try {
      const branch = ctx.sessionManager?.getBranch?.() ?? [];
      const entries = branch.map((e: any) => ({
        type: e.type,
        content: extractText(e),
      }));
      state = rebuildFromEntries(entries);
      rerender();
    } catch (e) {
      pi.logger?.error?.("session_start rebuild failed", e);
    }
  });

  // 快捷键
  try {
    pi.registerShortcut("alt+arrowright", () =>
      handleAltArrow(makeShortcutCtx(), 1)
    );
    pi.registerShortcut("alt+arrowleft", () =>
      handleAltArrow(makeShortcutCtx(), -1)
    );
    for (let n = 1; n <= 9; n++) {
      pi.registerShortcut(`alt+${n}`, () =>
        handleAltNumber(makeShortcutCtx(), n)
      );
    }
    pi.registerShortcut("alt+/", () => handleAltSlash(makeShortcutCtx()));
  } catch (e) {
    pi.logger?.error?.("shortcut registration failed", e);
  }
}

function extractText(entry: any): string {
  if (typeof entry.content === "string") return entry.content;
  if (Array.isArray(entry.content)) {
    return entry.content
      .filter((c: any) => c?.type === "text")
      .map((c: any) => c.text ?? "")
      .join("");
  }
  return "";
}
