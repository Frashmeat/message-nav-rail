import type { RailState, RailMessage } from "./types";
import { INITIAL_STATE } from "./types";
import { truncate, clamp, maxVisibleFor, PREVIEW_LEN } from "./util";

export interface MessageLike {
  id?: unknown;
  role?: unknown;
  content?: unknown;
  text?: unknown;
}

export interface SessionEntryLike {
  id?: unknown;
  type?: unknown;
  message?: MessageLike;
  role?: unknown;
  content?: unknown;
  text?: unknown;
}

export function moveSelection(state: RailState, delta: number): RailState {
  if (state.messages.length === 0) return state;
  const next = state.selectedIndex + delta;
  return { ...state, selectedIndex: clamp(next, 0, state.messages.length - 1) };
}

export interface VisibleRange {
  start: number;
  end: number;
}

export function visibleRange(
  messageCount: number,
  selectedIndex: number,
  width: number
): VisibleRange {
  const maxVisible = maxVisibleFor(width);
  const maxStart = Math.max(0, messageCount - maxVisible);
  if (selectedIndex < 0 || selectedIndex >= messageCount) {
    return { start: maxStart, end: messageCount };
  }

  const centeredStart = selectedIndex - Math.floor(maxVisible / 2);
  const start = clamp(centeredStart, 0, maxStart);
  return { start, end: Math.min(messageCount, start + maxVisible) };
}

export function selectByVisibleIndex(
  state: RailState,
  n: number,
  width: number
): RailState {
  if (state.messages.length === 0) return state;
  const { start, end } = visibleRange(
    state.messages.length,
    state.selectedIndex,
    width
  );
  const idx = clamp(start + (n - 1), start, end - 1);
  return { ...state, selectedIndex: idx };
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (x): x is Record<string, unknown> =>
        typeof x === "object" && x !== null
    )
    .filter((x): x is { type: string; text?: string } => {
      const t = x["type"];
      return typeof t === "string" && t === "text";
    })
    .map((x) => {
      const t = x["text"];
      return typeof t === "string" ? t : "";
    })
    .join("");
}

function textFromEntry(entry: SessionEntryLike): string {
  const messageContent = entry.message?.content;
  if (messageContent !== undefined) return messageText(messageContent);
  if (entry.content !== undefined) return messageText(entry.content);
  if (typeof entry.message?.text === "string") return entry.message.text;
  return typeof entry.text === "string" ? entry.text : "";
}

export function railMessageFromEntry(
  entry: SessionEntryLike,
  fallbackIndex: number
): RailMessage | null {
  const role =
    entry.type === "message"
      ? entry.message?.role ?? entry.role
      : entry.type;
  if (role !== "user") return null;
  return {
    id:
      typeof entry.id === "string"
        ? entry.id
        : typeof entry.message?.id === "string"
          ? entry.message.id
          : `user-${fallbackIndex}`,
    type: "user",
    preview: truncate(textFromEntry(entry), PREVIEW_LEN),
    timestamp: 0,
    anchorable: true,
  };
}

export function rebuildFromEntries(entries: SessionEntryLike[]): RailState {
  const messages: RailMessage[] = [];
  for (const entry of entries) {
    const msg = railMessageFromEntry(entry, messages.length);
    if (msg) messages.push(msg);
  }
  return { ...INITIAL_STATE, messages };
}
