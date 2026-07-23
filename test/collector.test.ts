import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { onInput } from "../src/collector.ts";
import { INITIAL_STATE } from "../src/types.ts";

describe("collector", () => {
  it("onInput 添加用户消息", () => {
    const s = onInput(INITIAL_STATE, "你好");
    assert.equal(s.messages.length, 1);
    assert.equal(s.messages[0].type, "user");
    assert.equal(s.messages[0].preview, "你好");
    assert.equal(s.selectedIndex, 0);
  });

  it("onInput 新增消息后选中最新项", () => {
    const first = onInput(INITIAL_STATE, "第一条");
    const second = onInput(first, "第二条");

    assert.equal(second.selectedIndex, 1);
  });

  it("onInput preview 截断到 80 字符", () => {
    const s = onInput(INITIAL_STATE, "x".repeat(200));
    assert.equal(s.messages[0].preview.length, 80);
  });
});
