import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  moveSelection,
  clampSelection,
  rebuildFromEntries,
  selectByVisibleIndex,
} from "../src/state.ts";
import { INITIAL_STATE } from "../src/types.ts";

describe("state", () => {
  it("moveSelection 右移", () => {
    const s = {
      ...INITIAL_STATE,
      messages: [{ id: "1", type: "user", preview: "", timestamp: 0 }],
      selectedIndex: -1,
    };
    assert.equal(moveSelection(s, 1).selectedIndex, 0);
  });

  it("moveSelection 左移 clamp 到 0", () => {
    const s = {
      ...INITIAL_STATE,
      messages: [{ id: "1", type: "user", preview: "", timestamp: 0 }],
      selectedIndex: 0,
    };
    assert.equal(moveSelection(s, -1).selectedIndex, 0);
  });

  it("moveSelection 右移 clamp 到末位", () => {
    const s = {
      ...INITIAL_STATE,
      messages: [{ id: "1", type: "user", preview: "", timestamp: 0 }],
      selectedIndex: 0,
    };
    assert.equal(moveSelection(s, 1).selectedIndex, 0);
  });

  it("moveSelection 空消息不移动", () => {
    assert.equal(moveSelection(INITIAL_STATE, 1).selectedIndex, -1);
  });

  it("clampSelection 修正越界", () => {
    const s = {
      ...INITIAL_STATE,
      messages: [{ id: "1", type: "user", preview: "", timestamp: 0 }],
      selectedIndex: 5,
    };
    assert.equal(clampSelection(s).selectedIndex, 0);
  });

  it("rebuildFromEntries 重建用户和模型消息", () => {
    const entries = [
      { type: "user", content: "你好" },
      { type: "assistant", content: "你好，有什么可以帮你？" },
    ];
    const s = rebuildFromEntries(entries);
    assert.equal(s.messages.length, 2);
    assert.equal(s.messages[0].type, "user");
    assert.equal(s.messages[1].type, "assistant");
    assert.equal(s.messages[0].preview, "你好");
    assert.equal(s.messages[1].preview.startsWith("你好"), true);
    assert.equal(s.selectedIndex, -1);
    assert.equal(s.streamingAssistantId, null);
  });

  it("rebuildFromEntries preview 截断到 80 字符", () => {
    const long = "x".repeat(200);
    const entries = [{ type: "user", content: long }];
    const s = rebuildFromEntries(entries);
    assert.equal(s.messages[0].preview.length, 80);
  });

  it("rebuildFromEntries 忽略未知类型", () => {
    const entries = [
      { type: "system", content: "系统消息" },
      { type: "user", content: "用户" },
    ];
    const s = rebuildFromEntries(entries);
    assert.equal(s.messages.length, 1);
  });

  it("selectByVisibleIndex 选中可见窗口内第 N 个", () => {
    const msgs = Array.from({ length: 50 }, (_, i) => ({
      id: String(i),
      type: "user" as const,
      preview: "",
      timestamp: 0,
    }));
    const s = { ...INITIAL_STATE, messages: msgs, selectedIndex: -1 };
    assert.equal(selectByVisibleIndex(s, 1, 10).selectedIndex, 45);
    assert.equal(selectByVisibleIndex(s, 5, 10).selectedIndex, 49);
  });

  it("selectByVisibleIndex 超出可见窗口 clamp 到末位", () => {
    const msgs = Array.from({ length: 50 }, (_, i) => ({
      id: String(i),
      type: "user" as const,
      preview: "",
      timestamp: 0,
    }));
    const s = { ...INITIAL_STATE, messages: msgs, selectedIndex: -1 };
    assert.equal(selectByVisibleIndex(s, 9, 10).selectedIndex, 49);
  });
});
