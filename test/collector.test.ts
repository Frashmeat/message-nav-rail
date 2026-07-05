import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  onInput,
  onMessageStart,
  onMessageUpdate,
  onMessageEnd,
} from "../src/collector.ts";
import { INITIAL_STATE } from "../src/types.ts";

describe("collector", () => {
  it("onInput 添加用户消息", () => {
    const s = onInput(INITIAL_STATE, "你好");
    assert.equal(s.messages.length, 1);
    assert.equal(s.messages[0].type, "user");
    assert.equal(s.messages[0].preview, "你好");
    assert.equal(s.messages[0].streaming, undefined);
  });

  it("onMessageStart 添加 streaming 模型消息", () => {
    const s = onMessageStart(INITIAL_STATE, "msg-1");
    assert.equal(s.messages.length, 1);
    assert.equal(s.messages[0].type, "assistant");
    assert.equal(s.messages[0].streaming, true);
    assert.equal(s.streamingAssistantId, "msg-1");
  });

  it("onMessageUpdate 更新 streaming 消息 preview", () => {
    let s = onMessageStart(INITIAL_STATE, "msg-1");
    s = onMessageUpdate(s, "msg-1", "正在回答");
    assert.equal(s.messages[0].preview, "正在回答");
  });

  it("onMessageEnd 结束 streaming", () => {
    let s = onMessageStart(INITIAL_STATE, "msg-1");
    s = onMessageEnd(s, "msg-1", "最终答案");
    assert.equal(s.messages[0].streaming, false);
    assert.equal(s.messages[0].preview, "最终答案");
    assert.equal(s.streamingAssistantId, null);
  });

  it("onMessageUpdate 忽略不匹配的 id", () => {
    let s = onMessageStart(INITIAL_STATE, "msg-1");
    s = onMessageUpdate(s, "other", "其他");
    assert.equal(s.messages[0].preview, "");
  });

  it("onInput preview 截断到 80 字符", () => {
    const s = onInput(INITIAL_STATE, "x".repeat(200));
    assert.equal(s.messages[0].preview.length, 80);
  });

  it("onMessageEnd 忽略不匹配的 id 不影响 streaming 状态", () => {
    let s = onMessageStart(INITIAL_STATE, "msg-1");
    s = onMessageEnd(s, "other", "其他");
    assert.equal(s.streamingAssistantId, "msg-1");
    assert.equal(s.messages[0].streaming, true);
  });
});
