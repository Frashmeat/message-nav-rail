import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderRail } from "../src/renderer.ts";
import type { RailMessage } from "../src/types.ts";

const mkMsg = (id: string): RailMessage => ({
  id,
  type: "user",
  preview: "x".repeat(80),
  timestamp: 0,
});

describe("renderRail", () => {
  it("空消息返回空字符串数组", () => {
    assert.deepEqual(renderRail([], -1, 80), [""]);
  });

  it("渲染用户输入小点", () => {
    const msgs = [mkMsg("1"), mkMsg("2")];
    assert.equal(renderRail(msgs, -1, 80)[0], "● ●");
  });

  it("选中索引显示高亮符号", () => {
    const msgs = [mkMsg("1"), mkMsg("2")];
    assert.equal(renderRail(msgs, 0, 80)[0], "◉ ●");
    assert.equal(renderRail(msgs, 1, 80)[0], "● ◉");
  });

  it("超限时只显示最近 N 个", () => {
    const msgs = Array.from({ length: 50 }, (_, i) =>
      mkMsg(String(i))
    );
    const out = renderRail(msgs, -1, 10);
    assert.equal(out[0], "● ● ● ● ●");
    assert.equal(out[0].split(" ").length, 5);
  });

  it("选中索引在默认尾部窗口外时移动窗口显示选中项", () => {
    const msgs = Array.from({ length: 50 }, (_, i) =>
      mkMsg(String(i))
    );
    const out = renderRail(msgs, 0, 10);
    assert.equal(out[0], "◉ ● ● ● ●");
  });
});
