import type { RailState, RailMessage } from "./types";
import { truncate, PREVIEW_LEN } from "./util";

export function onInput(state: RailState, text: string): RailState {
  const msg: RailMessage = {
    id: `user-${state.messages.length}`,
    type: "user",
    preview: truncate(text, PREVIEW_LEN),
    timestamp: Date.now(),
    anchorable: false,
  };
  return { ...state, messages: [...state.messages, msg] };
}

export function onMessageStart(state: RailState, id: string): RailState {
  const msg: RailMessage = {
    id,
    type: "assistant",
    preview: "",
    timestamp: Date.now(),
    streaming: true,
    anchorable: false,
  };
  return {
    ...state,
    messages: [...state.messages, msg],
    streamingAssistantId: id,
  };
}

export function onMessageUpdate(
  state: RailState,
  id: string,
  text: string
): RailState {
  if (state.streamingAssistantId !== id) return state;
  const messages = state.messages.map((m) =>
    m.id === id ? { ...m, preview: truncate(text, PREVIEW_LEN) } : m
  );
  return { ...state, messages };
}

export function onMessageEnd(
  state: RailState,
  id: string,
  finalText: string
): RailState {
  const messages = state.messages.map((m) =>
    m.id === id
      ? { ...m, preview: truncate(finalText, PREVIEW_LEN), streaming: false }
      : m
  );
  return {
    ...state,
    messages,
    streamingAssistantId:
      state.streamingAssistantId === id ? null : state.streamingAssistantId,
  };
}
