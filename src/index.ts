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

interface ScrollToEntryCapableUI {
  scrollToEntryId?: (
    entryId: string,
    options?: {
      align?: "start" | "center" | "end" | "nearest";
    }
  ) => boolean;
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

export default function messageNavRail(pi: ExtensionAPI) {
  pi.setLabel("消息导航栏");

  let state: RailState = { ...INITIAL_STATE };
  let currentCtx: ExtensionContext | null = null;
  let terminalInputUI: ExtensionContext["ui"] | null = null;
  let unsubscribeTerminalInput: (() => void) | undefined;
  let startedUserMessageText: string | null = null;
  const seenEntryIds = new Set<string>();
  const seenEventIds = new Set<string>();
  const refreshTimers = new Set<ReturnType<typeof setTimeout>>();

  function currentWidth(): number {
    const columns = process.stdout.columns;
    return Number.isFinite(columns) && columns > 0 ? columns : DEFAULT_WIDTH;
  }

  function rememberMessages(messages: RailMessage[]) {
    for (const message of messages) {
      seenEntryIds.add(message.id);
    }
  }

  function rerender() {
    try {
      const lines = renderRail(
        state.messages,
        state.selectedIndex,
        currentWidth()
      );
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
    if (terminalInputUI === ctx.ui) return;
    unsubscribeTerminalInput?.();
    unsubscribeTerminalInput = undefined;
    terminalInputUI = ctx.ui;

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
      terminalInputUI = null;
    }
  }

  function clearRefreshTimers() {
    for (const timer of refreshTimers) clearTimeout(timer);
    refreshTimers.clear();
  }

  function resetContextResources() {
    clearRefreshTimers();
    startedUserMessageText = null;
    seenEventIds.clear();
    unsubscribeTerminalInput?.();
    unsubscribeTerminalInput = undefined;
    terminalInputUI = null;
  }

  function replaceStateFromEntries(branch: SessionEntryLike[]): RailMessage[] {
    const previousIds = new Set(seenEntryIds);
    const previousSelected = state.selectedIndex >= 0 ? state.messages[state.selectedIndex] : undefined;
    const previousSelectedId = previousSelected?.id;
    const previousSelectedIndex = state.selectedIndex;
    const previousStreaming = state.streamingAssistantId
      ? state.messages.find((message) => message.id === state.streamingAssistantId)
      : undefined;
    const rebuilt = rebuildFromEntries(branch);
    const addedMessages = rebuilt.messages.filter(
      (message) => !previousIds.has(message.id)
    );
    const next =
      previousStreaming &&
      !rebuilt.messages.some((message) => message.id === previousStreaming.id)
        ? {
            ...rebuilt,
            messages: [...rebuilt.messages, previousStreaming],
            streamingAssistantId: previousStreaming.id,
          }
        : rebuilt;

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
    rememberMessages(rebuilt.messages);
    return addedMessages;
  }

  function replaceStateFromBranch(ctx: ExtensionContext): RailMessage[] {
    return replaceStateFromEntries(ctx.sessionManager.getBranch());
  }

  function refreshFromBranch(
    ctx: ExtensionContext,
    shouldRender = true
  ): { refreshed: boolean; addedMessages: RailMessage[] } {
    try {
      const branch = ctx.sessionManager.getBranch();
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

  function appendUserMessageIfMissing(
    text: string,
    eventId?: string,
    source: "message_start" | "message_end" = "message_end"
  ) {
    if (text.trim().length === 0) return;
    if (eventId && seenEventIds.has(eventId)) {
      if (source === "message_end" && startedUserMessageText === text) {
        startedUserMessageText = null;
      }
      return;
    }
    if (eventId) seenEventIds.add(eventId);

    if (source === "message_end") {
      const matchesStartedMessage = startedUserMessageText === text;
      startedUserMessageText = null;
      if (matchesStartedMessage) return;
    }

    if (source === "message_start") startedUserMessageText = text;
    const preview = truncate(text, PREVIEW_LEN);
    const last = state.messages.at(-1);
    if (
      source === "message_end" &&
      text.length <= PREVIEW_LEN &&
      last?.type === "user" &&
      last.preview === preview
    ) return;
    state = onInput(state, text);
  }

  async function rebuildForSession(ctx: ExtensionContext, logLabel: string) {
    resetContextResources();
    currentCtx = ctx;
    ensureTerminalInputListener(ctx);
    try {
      replaceStateFromBranch(ctx);
      rerender();
      scheduleBranchRefresh(ctx);
    } catch (e) {
      pi.logger?.error(`${logLabel} rebuild failed`, e);
    }
  }

  function makeShortcutCtx(): ShortcutContext {
    return {
      state,
      width: currentWidth(),
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
    if (tryRefreshFromBranch(ctx, true)) {
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
        });
        if (!result) ctx.ui.notify("当前消息暂时无法跳转", "warning");
        return result;
      } catch (e) {
        pi.logger?.error("scrollToEntryId failed", e);
        return false;
      }
    }

    ctx.ui.notify("当前消息暂时无法跳转", "warning");
    return false;
  }

  pi.on("input", async (_event, ctx) => {
    currentCtx = ctx;
    ensureTerminalInputListener(ctx);
    try {
      tryRefreshFromBranch(ctx, false);
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
      if (role !== "user" && role !== "assistant") return;
      const refresh = refreshFromBranch(ctx, false);
      if (role === "user") {
        const text = eventContentText(event);
        const eventId = optionalEventMessageId(event);
        const preview = truncate(text, PREVIEW_LEN);
        const alreadyAnchored =
          (eventId !== undefined && state.messages.some((message) => message.id === eventId)) ||
          refresh.addedMessages.some(
            (message) => message.type === "user" && message.preview === preview
          );
        if (text.trim().length > 0) startedUserMessageText = text;
        if (alreadyAnchored) {
          if (eventId) seenEventIds.add(eventId);
        } else {
          appendUserMessageIfMissing(text, eventId, "message_start");
        }
        rerender();
        scheduleBranchRefresh(ctx);
        return;
      }
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
      const role = eventRole(event);
      if (role === "user") {
        const text = eventContentText(event);
        if (startedUserMessageText !== text) {
          tryRefreshFromBranch(ctx, false);
        }
        appendUserMessageIfMissing(
          text,
          optionalEventMessageId(event),
          "message_end"
        );
        rerender();
        scheduleBranchRefresh(ctx);
        return;
      }
      if (role !== "assistant") return;
      tryRefreshFromBranch(ctx, false);
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
    await rebuildForSession(ctx, "session_start");
  });

  pi.on("session_switch", async (_event, ctx) => {
    await rebuildForSession(ctx, "session_switch");
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
