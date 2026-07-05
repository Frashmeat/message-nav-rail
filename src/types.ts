export interface RailMessage {
  id: string;
  type: "user" | "assistant";
  preview: string;
  timestamp: number;
  streaming?: boolean;
}

export interface RailState {
  messages: RailMessage[];
  selectedIndex: number; // -1 = 无选中
  streamingAssistantId: string | null;
}

export const INITIAL_STATE: RailState = {
  messages: [],
  selectedIndex: -1,
  streamingAssistantId: null,
};
