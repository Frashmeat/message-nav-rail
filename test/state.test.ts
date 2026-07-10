import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  moveSelection,
  rebuildFromEntries,
  selectByVisibleIndex,
  visibleRange,
} from "../src/state.ts";
import { INITIAL_STATE, type RailState } from "../src/types.ts";

const mkState = (messages: RailState["messages"]): RailState => ({
  ...INITIAL_STATE,
  messages,
});

describe("state", () => {
  it("moveSelection 右移", () => {
    const s = mkState([
      { id: "1", type: "user", preview: "", timestamp: 0 },
    ]);
    assert.equal(moveSelection(s, 1).selectedIndex, 0);
  });

  it("moveSelection 左移 clamp 到 0", () => {
    const s = mkState([
      { id: "1", type: "user", preview: "", timestamp: 0 },
    ]);
    assert.equal(moveSelection(s, -1).selectedIndex, 0);
  });

  it("moveSelection 右移 clamp 到末位", () => {
    const s = mkState([
      { id: "1", type: "user", preview: "", timestamp: 0 },
    ]);
    assert.equal(moveSelection(s, 1).selectedIndex, 0);
  });

  it("moveSelection 空消息不移动", () => {
    assert.equal(moveSelection(INITIAL_STATE, 1).selectedIndex, -1);
  });

  it("rebuildFromEntries 重建用户和模型消息", () => {
    const entries = [
      { type: "message", message: { role: "user", content: "你好" } },
      { type: "message", message: { role: "assistant", content: [{ type: "text", text: "你好，有什么可以帮你？" }] } },
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
    const entries = [{ type: "message", message: { role: "user", content: long } }];
    const s = rebuildFromEntries(entries);
    assert.equal(s.messages[0].preview.length, 80);
  });

  it("rebuildFromEntries 忽略非 message 类型", () => {
    const entries = [
      { type: "mode_change", mode: "plan" },
      { type: "message", message: { role: "user", content: "用户" } },
    ];
    const s = rebuildFromEntries(entries);
    assert.equal(s.messages.length, 1);
  });

  it("rebuildFromEntries 兼容扁平 user/assistant entry", () => {
    const entries = [
      { id: "u1", type: "user", content: "扁平问题" },
      { id: "a1", type: "assistant", text: "扁平回答" },
    ];
    const s = rebuildFromEntries(entries);
    assert.equal(s.messages.length, 2);
    assert.equal(s.messages[0].id, "u1");
    assert.equal(s.messages[0].preview, "扁平问题");
    assert.equal(s.messages[1].id, "a1");
    assert.equal(s.messages[1].preview, "扁平回答");
  });

  it("selectByVisibleIndex 选中可见窗口内第 N 个", () => {
    const msgs = Array.from({ length: 50 }, (_, i) => ({
      id: String(i),
      type: "user" as const,
      preview: "",
      timestamp: 0,
    }));
    const s = mkState(msgs);
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
    const s = mkState(msgs);
    assert.equal(selectByVisibleIndex(s, 9, 10).selectedIndex, 49);
  });

  it("visibleRange 始终包含选中项", () => {
    assert.deepEqual(visibleRange(50, -1, 10), { start: 45, end: 50 });
    assert.deepEqual(visibleRange(50, 0, 10), { start: 0, end: 5 });
    assert.deepEqual(visibleRange(50, 25, 10), { start: 23, end: 28 });
    assert.deepEqual(visibleRange(50, 49, 10), { start: 45, end: 50 });
  });
});
