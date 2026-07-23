import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import messageNavRail from "../src/index.ts";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionUI,
  ReadonlySessionManager,
} from "@oh-my-pi/pi-coding-agent";

// ── Mock 宿主 ──────────────────────────────────────────

interface RecordedWidget {
  key: string;
  content: string[];
  opts?: { placement?: string };
}

type MockUI = ExtensionUI;

type MockSessionManager = ReadonlySessionManager;

type MockCtx = ExtensionContext;

interface MockPiHandle {
  pi: ExtensionAPI;
  ui: MockUI;
  label: () => string | undefined;
  widgets: RecordedWidget[];
  notifications: Array<{ msg: string; level?: string }>;
  errors: string[];
  emit: (event: string, ev: unknown, ctx: MockCtx) => void | Promise<void>;
  fireTerminalInput: (data: string) => { consume?: boolean } | undefined;
  fireShortcut: (accel: string) => void;
  hasShortcut: (accel: string) => boolean;
  hasHandler: (event: string) => boolean;
  terminalListenerCounts: () => { subscriptions: number; unsubscriptions: number };
}


function createMockPi(): MockPiHandle {
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => void | Promise<void>>();
  const shortcuts = new Map<string, () => void>();
  const widgets: RecordedWidget[] = [];
  const notifications: Array<{ msg: string; level?: string }> = [];
  const terminalInputHandlers = new Set<(data: string) => { consume?: boolean } | undefined>();
  let terminalInputSubscriptions = 0;
  let terminalInputUnsubscriptions = 0;
  const errors: string[] = [];

  const ui: MockUI = {
    setWidget: (key, content, opts) =>
      widgets.push({ key, content: content ?? [], opts }),
    onTerminalInput: (handler) => {
      terminalInputSubscriptions++;
      terminalInputHandlers.add(handler);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        terminalInputUnsubscriptions++;
        terminalInputHandlers.delete(handler);
      };
    },
    notify: (msg, level) => notifications.push({ msg, level }),
  };

  let label: string | undefined;
  const pi: ExtensionAPI = {
    setLabel: (l: string) => { label = l; },
    on(event: string, handler: (event: unknown, ctx: ExtensionContext) => void | Promise<void>) {
      handlers.set(event, handler);
    },
    registerShortcut(accel: string, options: { description?: string; handler: (ctx: ExtensionContext) => void | Promise<void> }) {
      shortcuts.set(accel, () => { void options.handler(makeCtx(ui)); });
    },
    logger: {
      error: (msg: string) => errors.push(msg),
      warn: (msg: string) => errors.push(msg),
      info: (msg: string) => errors.push(msg),
    },
  };

  function emit(event: string, ev: unknown, ctx: MockCtx) {
    const h = handlers.get(event);
    if (!h) throw new Error(`no handler for ${event}`);
    return h(ev, ctx);
  }

  function fireShortcut(accel: string) {
    const fn = shortcuts.get(accel);
    if (!fn) throw new Error(`no shortcut ${accel}`);
    fn();
  }

  function hasShortcut(accel: string) {
    return shortcuts.has(accel);
  }

  function fireTerminalInput(data: string) {
    for (const handler of terminalInputHandlers) {
      const result = handler(data);
      if (result) return result;
    }
    return undefined;
  }

  return {
    pi,
    ui,
    label: () => label,
    widgets,
    notifications,
    errors,
    emit,
    fireTerminalInput,
    fireShortcut,
    hasShortcut,
    hasHandler: (event) => handlers.has(event),
    terminalListenerCounts: () => ({
      subscriptions: terminalInputSubscriptions,
      unsubscriptions: terminalInputUnsubscriptions,
    }),
  };
}

function makeCtx(ui: MockUI): MockCtx {
  return {
    ui,
    sessionManager: { getBranch: () => [] },
  };
}

// 真实事件 payload 构造器
function mkInputEvent(text: string): { type: "input"; text: string } {
  return { type: "input", text };
}

function mkMessageStartEvent(role: string, content: unknown): { type: "message_start"; message: { role: string; content: unknown } } {
  return { type: "message_start", message: { role, content } };
}

function mkMessageEndEvent(role: string, content: unknown): { type: "message_end"; message: { role: string; content: unknown } } {
  return { type: "message_end", message: { role, content } };
}

function mkFlatMessageEvent(
  type: "message_start" | "message_update" | "message_end",
  role: string,
  text: string
): { type: string; role: string; text: string; messageId: string } {
  return { type, role, text, messageId: "flat-message-id" };
}

// ── 测试 ───────────────────────────────────────────────

describe("index 集成", () => {
  let mock: MockPiHandle;
  let ctx: MockCtx;

  beforeEach(() => {
    mock = createMockPi();
    messageNavRail(mock.pi);
    ctx = makeCtx(mock.ui);
  });

  async function emitUserMessage(text: string, targetCtx: MockCtx = ctx) {
    await mock.emit("input", mkInputEvent(text), targetCtx);
    await mock.emit("message_start", mkMessageStartEvent("user", text), targetCtx);
    await mock.emit("message_end", mkMessageEndEvent("user", text), targetCtx);
  }

  it("setLabel 调用", () => {
    assert.equal(mock.label(), "消息导航栏");
  });

  it("注册全部快捷键", () => {
    const accels = [
      "alt+right", "alt+arrowright", "alt+shift+right",
      "alt+left", "alt+arrowleft", "alt+shift+left",
      ...Array.from({ length: 9 }, (_, i) => `alt+${i + 1}`),
      "alt+/",
    ];
    for (const a of accels) {
      assert.equal(mock.hasShortcut(a), true, `快捷键 ${a} 应已注册`);
    }
  });

  it("input 等待宿主确认，message_start user 后渲染用户小点", async () => {
    await mock.emit("input", mkInputEvent("你好"), ctx);
    assert.equal(mock.widgets.at(-1)!.content[0], "");
    await mock.emit("message_start", mkMessageStartEvent("user", "你好"), ctx);
    const last = mock.widgets.at(-1)!;
    assert.equal(last.key, "message-nav-rail");
    assert.equal(last.content[0], "◉");
    assert.equal(last.opts?.placement, "aboveEditor");
  });

  it("连续新增用户小点时自动选中最新项", async () => {
    await emitUserMessage("第一条");
    await emitUserMessage("第二条");

    assert.equal(mock.widgets.at(-1)!.content[0], "● ◉");
  });

  it("重复用户结束事件不会重新抢占历史选择", async () => {
    await emitUserMessage("第一条");
    await emitUserMessage("第二条");
    mock.fireShortcut("alt+left");
    assert.equal(mock.widgets.at(-1)!.content[0], "◉ ●");

    await mock.emit("message_end", mkMessageEndEvent("user", "第二条"), ctx);

    assert.equal(mock.widgets.at(-1)!.content[0], "◉ ●");
  });

  it("自动选中最新小点时不主动跳转 transcript", async () => {
    const scrolled: string[] = [];
    const noJumpCtx: MockCtx = {
      ui: {
        ...mock.ui,
        scrollToEntryId: (id) => {
          scrolled.push(id);
          return true;
        },
      },
      sessionManager: { getBranch: () => [] },
    };

    await mock.emit("message_start", mkMessageStartEvent("user", "新问题"), noJumpCtx);

    assert.equal(mock.widgets.at(-1)!.content[0], "◉");
    assert.deepEqual(scrolled, []);
  });

  it("空白 input 不生成消息", async () => {
    await mock.emit("input", mkInputEvent("   "), ctx);
    assert.equal(mock.widgets.at(-1)!.content[0], "");
  });

  it("完整对话流只保留用户输入节点", async () => {
    await emitUserMessage("问题");
    await mock.emit("message_start", mkMessageStartEvent("assistant", [{ type: "text", text: "" }]), ctx);
    await mock.emit("message_end", mkMessageEndEvent("assistant", [{ type: "text", text: "最终答案" }]), ctx);
    const last = mock.widgets.at(-1)!;
    assert.equal(last.content[0], "◉");
  });

  it("message_end user 可作为 input 缺失时的用户消息来源", async () => {
    await mock.emit("message_end", mkMessageEndEvent("user", "问题"), ctx);
    assert.equal(mock.widgets.at(-1)!.content[0], "◉");
    mock.fireShortcut("alt+right");
    mock.fireShortcut("alt+/");
    assert.match(mock.notifications.at(-1)!.msg, /问题/);
  });

  it("input 与 message_end user 内容相同时不重复添加", async () => {
    await mock.emit("input", mkInputEvent("同一个问题"), ctx);
    await mock.emit("message_end", mkMessageEndEvent("user", "同一个问题"), ctx);
    assert.equal(mock.widgets.at(-1)!.content[0], "◉");
  });

  it("相同长前缀的连续用户消息不会误去重", async () => {
    const prefix = "a".repeat(80);
    await emitUserMessage(`${prefix}1`);
    await emitUserMessage(`${prefix}2`);
    assert.equal(mock.widgets.at(-1)!.content[0], "● ◉");
  });

  it("相同事件 ID 的用户消息只添加一次", async () => {
    const event = {
      type: "message_end",
      messageId: "user-event-id",
      role: "user",
      text: "问题",
    };
    await mock.emit("message_end", event, ctx);
    await mock.emit("message_end", event, ctx);
    assert.equal(mock.widgets.at(-1)!.content[0], "◉");
  });

  it("input 与 message_end 共用事件 ID 后不会污染下一条消息", async () => {
    const input = { type: "input", messageId: "shared-id", text: "问题" };
    const end = {
      type: "message_end",
      messageId: "shared-id",
      role: "user",
      text: "问题",
    };
    await mock.emit("input", input, ctx);
    await mock.emit("message_end", end, ctx);
    await mock.emit("message_end", mkMessageEndEvent("assistant", "回答"), ctx);
    await mock.emit("message_end", mkMessageEndEvent("user", "问题"), ctx);
    assert.equal(mock.widgets.at(-1)!.content[0], "● ◉");
  });

  it("兼容扁平 user 事件 payload 并忽略 assistant 事件", async () => {
    await mock.emit("input", mkInputEvent("问题"), ctx);
    await mock.emit(
      "message_start",
      mkFlatMessageEvent("message_start", "user", "问题"),
      ctx
    );
    await mock.emit(
      "message_end",
      mkFlatMessageEvent("message_end", "user", "问题"),
      ctx
    );
    await mock.emit(
      "message_start",
      mkFlatMessageEvent("message_start", "assistant", ""),
      ctx
    );
    await mock.emit(
      "message_update",
      mkFlatMessageEvent("message_update", "assistant", "中间答案"),
      ctx
    );
    await mock.emit(
      "message_end",
      mkFlatMessageEvent("message_end", "assistant", "最终答案"),
      ctx
    );

    assert.equal(mock.widgets.at(-1)!.content[0], "◉");
    mock.fireShortcut("alt+right");
    mock.fireShortcut("alt+/");
    assert.match(mock.notifications.at(-1)!.msg, /问题/);
  });

  it("streaming assistant 不生成节点", async () => {
    await emitUserMessage("q");
    await mock.emit("message_start", mkMessageStartEvent("assistant", []), ctx);
    const last = mock.widgets.at(-1)!;
    assert.equal(last.content[0], "◉");
  });

  it("assistant 更新不会改变用户节点或预览", async () => {
    const branchCtx: MockCtx = {
      ui: mock.ui,
      sessionManager: {
        getBranch: () => [
          { id: "u1", type: "message", message: { role: "user", content: "q" } },
        ],
      },
    };
    await mock.emit("session_start", {}, branchCtx);
    await mock.emit("message_start", mkMessageStartEvent("assistant", []), branchCtx);
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(mock.widgets.at(-1)!.content[0], "●");
    await mock.emit(
      "message_update",
      mkFlatMessageEvent("message_update", "assistant", "正在回答"),
      branchCtx
    );
    mock.fireShortcut("alt+right");
    mock.fireShortcut("alt+/");
    assert.match(mock.notifications.at(-1)!.msg, /q/);
  });

  it("非空历史会话中 message_end 不会清除尚未持久化的用户消息", async () => {
    const branch = [
      { id: "old-user", type: "message", message: { role: "user", content: "历史问题" } },
    ];
    const branchCtx: MockCtx = {
      ui: mock.ui,
      sessionManager: { getBranch: () => branch },
    };
    await mock.emit("session_start", {}, branchCtx);
    await mock.emit("message_start", mkMessageStartEvent("user", "新问题"), branchCtx);
    assert.equal(mock.widgets.at(-1)!.content[0], "● ◉");

    await mock.emit("message_end", mkMessageEndEvent("user", "新问题"), branchCtx);

    assert.equal(mock.widgets.at(-1)!.content[0], "● ◉");
  });

  it("message_start 接受 user 角色作为权威消息来源", async () => {
    await mock.emit("message_start", mkMessageStartEvent("user", "hi"), ctx);
    assert.equal(mock.widgets.at(-1)!.content[0], "◉");
  });

  it("message_start 忽略非 user 角色", async () => {
    await mock.emit("message_start", mkMessageStartEvent("developer", []), ctx);
    assert.equal(mock.widgets.length, 0);
  });

  it("session_start 从 branch 重建", async () => {
    const branchCtx: MockCtx = {
      ui: mock.ui,
      sessionManager: {
        getBranch: () => [
          { id: "e0", type: "message", message: { role: "user", content: "历史问题" } },
          { id: "e1", type: "message", message: { role: "assistant", content: [{ type: "text", text: "历史回答" }] } },
        ],
      },
    };
    await mock.emit("session_start", {}, branchCtx);
    assert.equal(mock.widgets.at(-1)!.content[0], "●");
  });

  it("session_start 兼容扁平历史 entry", async () => {
    const branchCtx: MockCtx = {
      ui: mock.ui,
      sessionManager: {
        getBranch: () => [
          { id: "e0", type: "user", content: "历史问题" },
          { id: "e1", type: "assistant", text: "历史回答" },
        ],
      },
    };
    await mock.emit("session_start", {}, branchCtx);
    assert.equal(mock.widgets.at(-1)!.content[0], "●");
    mock.fireShortcut("alt+right");
    mock.fireShortcut("alt+/");
    assert.match(mock.notifications.at(-1)!.msg, /历史问题/);
  });

  it("session_switch 会立即清空已切换离开的会话", async () => {
    const branch = [
      { id: "old-user", type: "message", message: { role: "user", content: "旧会话" } },
    ];
    const sessionManager = { getBranch: () => branch };
    await mock.emit("session_start", {}, { ui: mock.ui, sessionManager });
    assert.equal(mock.widgets.at(-1)!.content[0], "●");

    branch.length = 0;
    assert.equal(mock.hasHandler("session_switch"), true);
    await mock.emit("session_switch", { type: "session_switch", reason: "new" }, {
      ui: mock.ui,
      sessionManager,
    });

    assert.equal(mock.widgets.at(-1)!.content[0], "");

    branch.push({
      id: "new-user",
      type: "message",
      message: { role: "user", content: "新会话" },
    });
    await mock.emit("session_switch", { type: "session_switch", reason: "resume" }, {
      ui: mock.ui,
      sessionManager,
    });
    assert.equal(mock.widgets.at(-1)!.content[0], "●");
    assert.deepEqual(mock.terminalListenerCounts(), {
      subscriptions: 3,
      unsubscriptions: 2,
    });
  });

  it("本地命令 input 不会在空会话留下幽灵节点", async () => {
    await mock.emit("session_start", {}, ctx);
    await mock.emit("input", { type: "input", text: "/help", source: "interactive" }, ctx);
    await new Promise((resolve) => setTimeout(resolve, 300));

    assert.equal(mock.widgets.at(-1)!.content[0], "");
  });

  it("每个事件使用新 ctx 时不会重复注册终端输入监听器", async () => {
    const sessionManager = { getBranch: () => [] };
    const freshCtx = (): MockCtx => ({ ui: mock.ui, sessionManager });

    await mock.emit("session_start", {}, freshCtx());
    await mock.emit("message_start", mkMessageStartEvent("assistant", []), freshCtx());
    await mock.emit("message_update", mkFlatMessageEvent("message_update", "assistant", "1"), freshCtx());
    await mock.emit("message_update", mkFlatMessageEvent("message_update", "assistant", "12"), freshCtx());

    assert.deepEqual(mock.terminalListenerCounts(), {
      subscriptions: 1,
      unsubscriptions: 0,
    });
  });

  it("事件触发时会从 getBranch 校准生成小点", async () => {
    const branch: Array<{
      id: string;
      type: string;
      message?: { role: string; content: unknown };
    }> = [];
    const appendCtx: MockCtx = {
      ui: mock.ui,
      sessionManager: {
        getBranch: () => branch,
      },
    };

    await mock.emit("session_start", {}, appendCtx);
    branch.push({
      id: "u1",
      type: "message",
      message: { role: "user", content: "追加问题" },
    });
    branch.push({
      id: "a1",
      type: "message",
      message: { role: "assistant", content: [{ type: "text", text: "追加回答" }] },
    });
    await mock.emit("message_end", mkMessageEndEvent("assistant", "追加回答"), appendCtx);

    assert.equal(mock.widgets.at(-1)!.content[0], "◉");
  });

  it("message_start 忽略 branch 中的 assistant 条目", async () => {
    const branch = [
      { id: "u1", type: "message", message: { role: "user", content: "问题" } },
      { id: "a1", type: "message", message: { role: "assistant", content: "" } },
    ];
    const branchCtx: MockCtx = {
      ui: mock.ui,
      sessionManager: {
        getBranch: () => branch,
      },
    };

    await mock.emit("message_start", mkMessageStartEvent("assistant", ""), branchCtx);

    assert.equal(mock.widgets.at(-1)!.content[0], "◉");
  });

  it("Alt+→ 选中第一条", async () => {
    const historyCtx: MockCtx = {
      ui: mock.ui,
      sessionManager: {
        getBranch: () => [
          { id: "u0", type: "message", message: { role: "user", content: "a" } },
          { id: "u1", type: "message", message: { role: "user", content: "b" } },
        ],
      },
    };
    await mock.emit("session_start", {}, historyCtx);
    mock.fireShortcut("alt+right");
    const last = mock.widgets.at(-1)!;
    assert.equal(last.content[0], "◉ ●");
  });

  it("长会话中 Alt+→ 会移动可见窗口展示第一条选中消息", async () => {
    const branchCtx: MockCtx = {
      ui: mock.ui,
      sessionManager: {
        getBranch: () => Array.from({ length: 50 }, (_, i) => ({
          id: `u${i}`,
          type: "message",
          message: { role: "user", content: String(i) },
        })),
      },
    };
    await mock.emit("session_start", {}, branchCtx);
    mock.fireShortcut("alt+right");

    assert.equal(mock.widgets.at(-1)!.content[0].startsWith("◉ "), true);
  });

  it("Alt+← 不越过首位", async () => {
    await emitUserMessage("a");
    mock.fireShortcut("alt+right");
    mock.fireShortcut("alt+left");
    assert.equal(mock.widgets.at(-1)!.content[0], "◉");
  });

  it("兼容旧方向键别名选择消息", async () => {
    await emitUserMessage("a");
    await emitUserMessage("b");
    mock.fireShortcut("alt+arrowleft");
    assert.equal(mock.widgets.at(-1)!.content[0], "◉ ●");
    mock.fireShortcut("alt+arrowright");
    assert.equal(mock.widgets.at(-1)!.content[0], "● ◉");
  });

  it("raw Alt+方向键输入可兜底选择消息", async () => {
    await emitUserMessage("a");
    await emitUserMessage("b");
    assert.deepEqual(mock.fireTerminalInput("\x1b[1;3D"), { consume: true });
    assert.equal(mock.widgets.at(-1)!.content[0], "◉ ●");
    assert.deepEqual(mock.fireTerminalInput("\x1b[1;3C"), { consume: true });
    assert.equal(mock.widgets.at(-1)!.content[0], "● ◉");
  });

  it("Alt+1 选中可见窗口第 1 个", async () => {
    await emitUserMessage("a");
    await emitUserMessage("b");
    mock.fireShortcut("alt+1");
    assert.equal(mock.widgets.at(-1)!.content[0], "◉ ●");
  });

  it("Alt+/ 预览选中消息", async () => {
    await emitUserMessage("预览内容");
    mock.fireShortcut("alt+right");
    mock.fireShortcut("alt+/");
    const n = mock.notifications.at(-1)!;
    assert.match(n.msg, /用户/);
    assert.match(n.msg, /预览内容/);
    assert.equal(n.level, "info");
  });

  it("Alt+/ 未选中时 warning", async () => {
    await mock.emit("input", mkInputEvent("x"), ctx);
    mock.fireShortcut("alt+/");
    const n = mock.notifications.at(-1)!;
    assert.equal(n.level, "warning");
    assert.match(n.msg, /未选中/);
  });

  it("Alt+→ 选中并跳转到对应 entry", async () => {
    const scrolled: Array<{ id: string; align?: string }> = [];
    const scrollCtx: MockCtx = {
      ui: {
        ...mock.ui,
        scrollToEntryId: (id, opts) => {
          scrolled.push({ id, align: opts?.align });
          return true;
        },
      },
      sessionManager: {
        getBranch: () => [
          { id: "e0", type: "message", message: { role: "user", content: "a" } },
          { id: "e1", type: "message", message: { role: "user", content: "b" } },
        ],
      },
    };
    await mock.emit("session_start", {}, scrollCtx);
    mock.fireShortcut("alt+right");
    assert.deepEqual(scrolled[0], { id: "e0", align: "center" });
  });

  it("跳转前会用 getBranch 真实 entry id 替换临时 id", async () => {
    const scrolled: string[] = [];
    const branch: Array<{
      id: string;
      type: string;
      message?: { role: string; content: unknown };
    }> = [];
    const appendCtx: MockCtx = {
      ui: {
        ...mock.ui,
        scrollToEntryId: (id) => {
          scrolled.push(id);
          return true;
        },
      },
      sessionManager: {
        getBranch: () => branch,
      },
    };

    await mock.emit("input", mkInputEvent("相同问题"), appendCtx);
    await mock.emit("message_start", mkMessageStartEvent("user", "相同问题"), appendCtx);
    branch.push({
      id: "real-user-entry-id",
      type: "message",
      message: { role: "user", content: "相同问题" },
    });
    mock.fireShortcut("alt+right");

    assert.equal(scrolled[0], "real-user-entry-id");
  });

  it("缺少 scrollToEntryId 时快捷键更新选中并提示", async () => {
    await emitUserMessage("a");
    mock.fireShortcut("alt+right");
    assert.equal(mock.widgets.at(-1)!.content[0], "◉");
    assert.equal(mock.notifications.at(-1)?.level, "warning");
    assert.match(mock.notifications.at(-1)?.msg ?? "", /无法跳转/);
    assert.deepEqual(mock.errors, []);
  });


  it("异常事件不崩溃且记日志", async () => {
    const badCtx: MockCtx = {
      ui: mock.ui,
      sessionManager: { getBranch: () => { throw new Error("boom"); } },
    };
    await mock.emit("session_start", {}, badCtx);
    assert.ok(mock.errors.length > 0);
  });
});
