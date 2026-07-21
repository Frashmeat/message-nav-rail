export interface RailMessage {
  id: string;
  type: "user";
  preview: string;
  timestamp: number;
  anchorable?: boolean;
}

export interface RailState {
  messages: RailMessage[];
  selectedIndex: number; // -1 = 无选中
}

export const INITIAL_STATE: RailState = {
  messages: [],
  selectedIndex: -1,
};
