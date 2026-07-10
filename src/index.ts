import type {
  ExtensionAPI,
  ExtensionContext,
} from "@oh-my-pi/pi-coding-agent";
import { INITIAL_STATE, type RailMessage, type RailState } from "./types";
import { renderRail } from "./renderer";
import {
  onInput,
  onMessageStart,
  onMessageUpdate,
  onMessageEnd,
} from "./collector";
import {
  rebuildFromEntries,
  type SessionEntryLike,
} from "./state";
import {
  handleAltArrow,
  handleAltNumber,
  handleAltSlash,
  type ShortcutContext,
} from "./shortcuts";
import { PREVIEW_LEN, truncate } from "./util";

const DEFAULT_WIDTH = 80;

interface NavigableContext extends ExtensionContext {
  navigateTree(id: string, opts?: { summarize?: boolean }): Promise<unknown>;
}

interface ScrollToEntryCapableUI {
  scrollToEntryId?: (
    entryId: string,
    options?: {
      align?: "start" | "center" | "end" | "nearest";
      highlight?: boolean;
    }
  ) => boolean | Promise<boolean>;
}

interface TerminalInputCapableUI {
  onTerminalInput?: (
    handler: (data: string) => { consume?: boolean } | undefined
  ) => () => void;
}

const ALT_RIGHT_INPUTS = new Set([
  "\x1b[1;3C",
  "\x1b[3C",
  "\x1b\x1b[C",
  "\x1bO3C",
]);

const ALT_LEFT_INPUTS = new Set([
  "\x1b[1;3D",
  "\x1b[3D",
  "\x1b\x1b[D",
  "\x1bO3D",
]);

function extractContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (c): c is Record<string, unknown> =>
        typeof c === "object" && c !== null
    )
    .filter((c): c is { type: string; text?: string } => {
      const t = c["type"];
      return typeof t === "string" && t === "text";
    })
    .map((c) => {
      const t = c["text"];
      return typeof t === "string" ? t : "";
    })
    .join("");
}

function prop(obj: unknown, key: string): unknown {
  if (typeof obj !== "object" || obj === null) return undefined;
  return (obj as Record<string, unknown>)[key];
}

function inputText(event: unknown): string {
  const text = prop(event, "text") ?? prop(event, "content");
  if (typeof text === "string") return text;
  const message = prop(event, "message");
  const messageText = prop(message, "text") ?? prop(message, "content");
  return typeof messageText === "string" ? messageText : extractContentText(messageText);
}

function eventRole(event: unknown): string {
  const role = prop(prop(event, "message"), "role") ?? prop(event, "role");
  return typeof role === "string" ? role : "";
}

function eventMessageId(event: unknown, fallback: string): string {
  return optionalEventMessageId(event) ?? fallback;
}

function optionalEventMessageId(event: unknown): string | undefined {
  const id =
    prop(prop(event, "message"), "id") ??
    prop(event, "messageId") ??
    prop(event, "id");
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

function eventContentText(event: unknown): string {
  const message = prop(event, "message");
  const content =
    prop(message, "content") ??
    prop(message, "text") ??
    prop(event, "content") ??
    prop(event, "text");
  return typeof content === "string" ? content : extractContentText(content);
}

function hasNavigateTree(ctx: ExtensionContext): ctx is NavigableContext {
  return "navigateTree" in ctx && typeof ctx.navigateTree === "function";
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

export default function messageNavRail(pi: ExtensionAPI) {
  pi.setLabel("消息导航栏");

  let state: RailState = { ...INITIAL_STATE };
  const width = DEFAULT_WIDTH;
  let currentCtx: ExtensionContext | null = null;
  let terminalInputCtx: ExtensionContext | null = null;
  let unsubscribeTerminalInput: (() => void) | undefined;
  const seenEntryIds = new Set<string>();
  const refreshTimers = new Set<ReturnType<typeof setTimeout>>();

  function rememberMessages(messages: RailMessage[]) {
    for (const message of messages) {
      seenEntryIds.add(message.id);
    }
  }

  function rerender() {
    try {
      const lines = renderRail(state.messages, state.selectedIndex, width);
      currentCtx?.ui.setWidget("message-nav-rail", lines, { placement: "aboveEditor" });
    } catch (e) {
      pi.logger?.error("message-nav-rail rerender failed", e);
    }
  }

  function setState(s: RailState) {
    state = s;
    rerender();
  }

  function handleRailDirection(direction: 1 | -1): boolean {
    if (state.messages.length === 0) return false;
    handleAltArrow(makeShortcutCtx(), direction);
    return true;
  }

  function handleRawTerminalInput(data: string): { consume: true } | undefined {
    if (ALT_RIGHT_INPUTS.has(data)) {
      return handleRailDirection(1) ? { consume: true } : undefined;
    }
    if (ALT_LEFT_INPUTS.has(data)) {
      return handleRailDirection(-1) ? { consume: true } : undefined;
    }
    return undefined;
  }

  function ensureTerminalInputListener(ctx: ExtensionContext) {
    if (terminalInputCtx === ctx) return;
    unsubscribeTerminalInput?.();
    unsubscribeTerminalInput = undefined;
    terminalInputCtx = ctx;

    const onTerminalInput = (ctx.ui as ExtensionContext["ui"] & TerminalInputCapableUI)
      .onTerminalInput;
    if (typeof onTerminalInput !== "function") return;

    try {
      unsubscribeTerminalInput = onTerminalInput.call(ctx.ui, (data) => {
        currentCtx = ctx;
        return handleRawTerminalInput(data);
      });
    } catch (e) {
      pi.logger?.warn("message-nav-rail terminal input listener failed", e);
      unsubscribeTerminalInput = undefined;
    }
  }

  function replaceStateFromEntries(branch: SessionEntryLike[]): RailMessage[] {
    const previousIds = new Set(seenEntryIds);
    const previousSelected = state.selectedIndex >= 0 ? state.messages[state.selectedIndex] : undefined;
    const previousSelectedId = previousSelected?.id;
    const previousSelectedIndex = state.selectedIndex;
    const next = rebuildFromEntries(branch);

    if (previousSelectedId) {
      const selectedIndex = next.messages.findIndex((m) => m.id === previousSelectedId);
      if (selectedIndex >= 0) {
        state = { ...next, selectedIndex };
      } else if (next.messages.length > 0 && previousSelectedIndex >= 0) {
        state = {
          ...next,
          selectedIndex: Math.min(previousSelectedIndex, next.messages.length - 1),
        };
      } else {
        state = next;
      }
    } else {
      state = next;
    }

    seenEntryIds.clear();
    rememberMessages(state.messages);
    return state.messages.filter((message) => !previousIds.has(message.id));
  }

  function replaceStateFromBranch(ctx: ExtensionContext): RailMessage[] {
    return replaceStateFromEntries(ctx.sessionManager.getBranch?.() ?? []);
  }

  function refreshFromBranch(
    ctx: ExtensionContext,
    shouldRender = true
  ): { refreshed: boolean; addedMessages: RailMessage[] } {
    try {
      const branch = ctx.sessionManager.getBranch?.() ?? [];
      if (branch.length === 0) return { refreshed: false, addedMessages: [] };
      const addedMessages = replaceStateFromEntries(branch);
      if (shouldRender) rerender();
      return { refreshed: true, addedMessages };
    } catch (e) {
      pi.logger?.error("message-nav-rail branch refresh failed", e);
      return { refreshed: false, addedMessages: [] };
    }
  }

  function tryRefreshFromBranch(ctx: ExtensionContext, shouldRender = true): boolean {
    return refreshFromBranch(ctx, shouldRender).refreshed;
  }

  function scheduleBranchRefresh(ctx: ExtensionContext) {
    for (const delay of [0, 80, 250]) {
      const timer = setTimeout(() => {
        refreshTimers.delete(timer);
        if (currentCtx !== ctx) return;
        tryRefreshFromBranch(ctx);
      }, delay);
      refreshTimers.add(timer);
      timer.unref?.();
    }
  }

  function appendUserMessageIfMissing(text: string) {
    const preview = truncate(text, PREVIEW_LEN);
    const last = state.messages.at(-1);
    if (last?.type === "user" && last.preview === preview) return;
    state = onInput(state, text);
  }

  function makeShortcutCtx(): ShortcutContext {
    return {
      state,
      width,
      notify: (m, l) => currentCtx?.ui.notify(m, l),
      setState,
      navigateTo: (idx) => navigateToMessage(idx),
    };
  }

  function navigateToMessage(idx: number): boolean {
    const ctx = currentCtx;
    if (!ctx) return false;
    let targetMessage = state.messages[idx];
    if (!targetMessage) return false;
    if (ctx.sessionManager.getBranch && tryRefreshFromBranch(ctx, true)) {
      const refreshedIndex = state.selectedIndex >= 0 ? state.selectedIndex : Math.min(idx, state.messages.length - 1);
      targetMessage = state.messages[refreshedIndex];
      if (!targetMessage) return false;
    }

    const scrollToEntryId = (ctx.ui as ExtensionContext["ui"] & ScrollToEntryCapableUI)
      .scrollToEntryId;
    if (typeof scrollToEntryId === "function" && targetMessage.anchorable === true) {
      try {
        const result = scrollToEntryId.call(ctx.ui, targetMessage.id, {
          align: "center",
          highlight: true,
        });
        if (isPromiseLike(result)) {
          void Promise.resolve(result).catch((e) =>
            pi.logger?.error("scrollToEntryId failed", e)
          );
          return true;
        }
        return result;
      } catch (e) {
        pi.logger?.error("scrollToEntryId failed", e);
        return false;
      }
    }

    if (!hasNavigateTree(ctx)) return false;
    const branch = ctx.sessionManager.getBranch?.() ?? [];
    const msgEntries = branch.filter((e) => e.type === "message");
    const target = msgEntries[idx];
    if (!target) return false;
    void ctx.navigateTree(target.id).catch((e) =>
      pi.logger?.error("navigateTree failed", e)
    );
    return true;
  }

  pi.on("input", async (event, ctx) => {
    currentCtx = ctx;
    ensureTerminalInputListener(ctx);
    try {
      tryRefreshFromBranch(ctx, false);
      appendUserMessageIfMissing(inputText(event));
      rerender();
      scheduleBranchRefresh(ctx);
    } catch (e) {
      pi.logger?.error("input handler failed", e);
    }
  });

  pi.on("message_start", async (event, ctx) => {
    currentCtx = ctx;
    ensureTerminalInputListener(ctx);
    try {
      const role = eventRole(event);
      if (role !== "assistant") return;
      const refresh = refreshFromBranch(ctx, false);
      const eventId = optionalEventMessageId(event);
      const alreadyAnchored =
        (eventId !== undefined &&
          state.messages.some((message) => message.id === eventId)) ||
        refresh.addedMessages.some((message) => message.type === "assistant");
      if (refresh.refreshed && alreadyAnchored) {
        rerender();
        scheduleBranchRefresh(ctx);
        return;
      }
      const id = eventMessageId(
        event,
        `assistant-${state.messages.length}-${Date.now()}`
      );
      state = onMessageStart(state, id);
      rerender();
      scheduleBranchRefresh(ctx);
    } catch (e) {
      pi.logger?.error("message_start handler failed", e);
    }
  });

  pi.on("message_update", async (event, ctx) => {
    currentCtx = ctx;
    ensureTerminalInputListener(ctx);
    try {
      if (!state.streamingAssistantId) return;
      if (eventRole(event) !== "assistant") return;
      const text = eventContentText(event);
      state = onMessageUpdate(state, state.streamingAssistantId, text);
      rerender();
    } catch (e) {
      pi.logger?.error("message_update handler failed", e);
    }
  });

  pi.on("message_end", async (event, ctx) => {
    currentCtx = ctx;
    ensureTerminalInputListener(ctx);
    try {
      tryRefreshFromBranch(ctx, false);
      const role = eventRole(event);
      if (role === "user") {
        appendUserMessageIfMissing(eventContentText(event));
        rerender();
        scheduleBranchRefresh(ctx);
        return;
      }
      if (role !== "assistant") return;
      const text = eventContentText(event);
      const last = state.messages.at(-1);
      if (!state.streamingAssistantId && last?.type === "assistant" && last.preview === truncate(text, PREVIEW_LEN)) {
        rerender();
        scheduleBranchRefresh(ctx);
        return;
      }
      let streamingAssistantId = state.streamingAssistantId;
      if (!streamingAssistantId) {
        const id = eventMessageId(
          event,
          `assistant-${state.messages.length}-${Date.now()}`
        );
        state = onMessageStart(state, id);
        streamingAssistantId = id;
      }
      state = onMessageEnd(state, streamingAssistantId, text);
      rerender();
      scheduleBranchRefresh(ctx);
    } catch (e) {
      pi.logger?.error("message_end handler failed", e);
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    currentCtx = ctx;
    ensureTerminalInputListener(ctx);
    try {
      replaceStateFromBranch(ctx);
      rerender();
      scheduleBranchRefresh(ctx);
    } catch (e) {
      pi.logger?.error("session_start rebuild failed", e);
    }
  });

  try {
    const registerDirectionalShortcut = (
      shortcut: string,
      description: string,
      direction: 1 | -1
    ) => {
      pi.registerShortcut(shortcut, {
        description,
        handler: () => { handleRailDirection(direction); },
      });
    };

    registerDirectionalShortcut("alt+right", "消息导航: 右移选中", 1);
    registerDirectionalShortcut("alt+arrowright", "消息导航: 右移选中", 1);
    registerDirectionalShortcut("alt+left", "消息导航: 左移选中", -1);
    registerDirectionalShortcut("alt+arrowleft", "消息导航: 左移选中", -1);
    pi.registerShortcut("alt+shift+right", {
      description: "消息导航: 右移选中",
      handler: () => { handleRailDirection(1); },
    });
    pi.registerShortcut("alt+shift+left", {
      description: "消息导航: 左移选中",
      handler: () => { handleRailDirection(-1); },
    });
    for (let n = 1; n <= 9; n++) {
      pi.registerShortcut(`alt+${n}`, {
        description: `消息导航: 选中第 ${n} 个`,
        handler: () => handleAltNumber(makeShortcutCtx(), n),
      });
    }
    pi.registerShortcut("alt+/", {
      description: "消息导航: 预览选中消息",
      handler: () => handleAltSlash(makeShortcutCtx()),
    });
  } catch (e) {
    pi.logger?.error("shortcut registration failed", e);
  }
}
