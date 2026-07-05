import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderRail } from "../src/renderer.ts";
import type { RailMessage } from "../src/types.ts";

const mkMsg = (
  type: "user" | "assistant",
  id: string,
  streaming = false
): RailMessage => ({
  id,
  type,
  preview: "x".repeat(80),
  timestamp: 0,
  streaming,
});

describe("renderRail", () => {
  it("空消息返回空字符串数组", () => {
    assert.deepEqual(renderRail([], -1, 80), [""]);
  });

  it("渲染用户和模型小点", () => {
    const msgs = [mkMsg("user", "1"), mkMsg("assistant", "2")];
    assert.equal(renderRail(msgs, -1, 80)[0], "● ○");
  });

  it("streaming 消息显示半填充", () => {
    const msgs = [mkMsg("assistant", "1", true)];
    assert.equal(renderRail(msgs, -1, 80)[0], "◐");
  });

  it("选中索引显示高亮符号", () => {
    const msgs = [mkMsg("user", "1"), mkMsg("assistant", "2")];
    assert.equal(renderRail(msgs, 0, 80)[0], "◉ ○");
    assert.equal(renderRail(msgs, 1, 80)[0], "● ◉");
  });

  it("超限时只显示最近 N 个", () => {
    const msgs = Array.from({ length: 50 }, (_, i) =>
      mkMsg("user", String(i))
    );
    const out = renderRail(msgs, -1, 10);
    assert.equal(out[0], "● ● ● ● ●");
    assert.equal(out[0].split(" ").length, 5);
  });

  it("选中索引在可见窗口外不影响显示", () => {
    const msgs = Array.from({ length: 50 }, (_, i) =>
      mkMsg("user", String(i))
    );
    const out = renderRail(msgs, 0, 10);
    assert.equal(out[0], "● ● ● ● ●");
  });
});
