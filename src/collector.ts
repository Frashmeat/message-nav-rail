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
  const messages = [...state.messages, msg];
  return { ...state, messages, selectedIndex: messages.length - 1 };
}
