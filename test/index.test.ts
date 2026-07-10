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

interface MockCtx extends ExtensionContext {
  navigateTree?: (id: string, opts?: { summarize?: boolean }) => Promise<unknown>;
}

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
}


function createMockPi(): MockPiHandle {
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => void | Promise<void>>();
  const shortcuts = new Map<string, () => void>();
  const widgets: RecordedWidget[] = [];
  const notifications: Array<{ msg: string; level?: string }> = [];
  const terminalInputHandlers = new Set<(data: string) => { consume?: boolean } | undefined>();
  const errors: string[] = [];

  const ui: MockUI = {
    setWidget: (key, content, opts) =>
      widgets.push({ key, content: content ?? [], opts }),
    onTerminalInput: (handler) => {
      terminalInputHandlers.add(handler);
      return () => { terminalInputHandlers.delete(handler); };
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

  it("input 事件渲染用户小点", async () => {
    await mock.emit("input", mkInputEvent("你好"), ctx);
    const last = mock.widgets.at(-1)!;
    assert.equal(last.key, "message-nav-rail");
    assert.equal(last.content[0], "●");
    assert.equal(last.opts?.placement, "aboveEditor");
  });

  it("完整对话流: input → start → update → end", async () => {
    await mock.emit("input", mkInputEvent("问题"), ctx);
    await mock.emit("message_start", mkMessageStartEvent("assistant", [{ type: "text", text: "" }]), ctx);
    await mock.emit("message_end", mkMessageEndEvent("assistant", [{ type: "text", text: "最终答案" }]), ctx);
    const last = mock.widgets.at(-1)!;
    assert.equal(last.content[0], "● ○");
  });

  it("message_end user 可作为 input 缺失时的用户消息来源", async () => {
    await mock.emit("message_end", mkMessageEndEvent("user", "问题"), ctx);
    assert.equal(mock.widgets.at(-1)!.content[0], "●");
    mock.fireShortcut("alt+right");
    mock.fireShortcut("alt+/");
    assert.match(mock.notifications.at(-1)!.msg, /问题/);
  });

  it("input 与 message_end user 内容相同时不重复添加", async () => {
    await mock.emit("input", mkInputEvent("同一个问题"), ctx);
    await mock.emit("message_end", mkMessageEndEvent("user", "同一个问题"), ctx);
    assert.equal(mock.widgets.at(-1)!.content[0], "●");
  });

  it("兼容扁平 message 事件 payload", async () => {
    await mock.emit("input", mkInputEvent("问题"), ctx);
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

    assert.equal(mock.widgets.at(-1)!.content[0], "● ○");
    mock.fireShortcut("alt+right");
    mock.fireShortcut("alt+right");
    mock.fireShortcut("alt+/");
    assert.match(mock.notifications.at(-1)!.msg, /最终答案/);
  });

  it("streaming 中显示半填充符号", async () => {
    await mock.emit("input", mkInputEvent("q"), ctx);
    await mock.emit("message_start", mkMessageStartEvent("assistant", []), ctx);
    const last = mock.widgets.at(-1)!;
    assert.equal(last.content[0], "● ◐");
  });

  it("message_start 忽略 user 角色", async () => {
    await mock.emit("message_start", mkMessageStartEvent("user", "hi"), ctx);
    assert.equal(mock.widgets.length, 0);
  });

  it("message_start 只接受 assistant 角色", async () => {
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
    assert.equal(mock.widgets.at(-1)!.content[0], "● ○");
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
    assert.equal(mock.widgets.at(-1)!.content[0], "● ○");
    mock.fireShortcut("alt+right");
    mock.fireShortcut("alt+/");
    assert.match(mock.notifications.at(-1)!.msg, /历史问题/);
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

    assert.equal(mock.widgets.at(-1)!.content[0], "● ○");
  });

  it("message_start 已能从 getBranch 看到真实 assistant 时不追加临时小点", async () => {
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

    assert.equal(mock.widgets.at(-1)!.content[0], "● ○");
  });

  it("Alt+→ 选中第一条", async () => {
    await mock.emit("input", mkInputEvent("a"), ctx);
    await mock.emit("input", mkInputEvent("b"), ctx);
    mock.fireShortcut("alt+right");
    const last = mock.widgets.at(-1)!;
    assert.equal(last.content[0], "◉ ●");
  });

  it("Alt+← 不越过首位", async () => {
    await mock.emit("input", mkInputEvent("a"), ctx);
    mock.fireShortcut("alt+right");
    mock.fireShortcut("alt+left");
    assert.equal(mock.widgets.at(-1)!.content[0], "◉");
  });

  it("兼容旧方向键别名选择消息", async () => {
    await mock.emit("input", mkInputEvent("a"), ctx);
    await mock.emit("input", mkInputEvent("b"), ctx);
    mock.fireShortcut("alt+arrowright");
    assert.equal(mock.widgets.at(-1)!.content[0], "◉ ●");
    mock.fireShortcut("alt+arrowleft");
    assert.equal(mock.widgets.at(-1)!.content[0], "◉ ●");
  });

  it("raw Alt+方向键输入可兜底选择消息", async () => {
    await mock.emit("input", mkInputEvent("a"), ctx);
    await mock.emit("input", mkInputEvent("b"), ctx);
    assert.deepEqual(mock.fireTerminalInput("\x1b[1;3C"), { consume: true });
    assert.equal(mock.widgets.at(-1)!.content[0], "◉ ●");
    assert.deepEqual(mock.fireTerminalInput("\x1b[1;3D"), { consume: true });
    assert.equal(mock.widgets.at(-1)!.content[0], "◉ ●");
  });

  it("Alt+1 选中可见窗口第 1 个", async () => {
    await mock.emit("input", mkInputEvent("a"), ctx);
    await mock.emit("input", mkInputEvent("b"), ctx);
    mock.fireShortcut("alt+1");
    assert.equal(mock.widgets.at(-1)!.content[0], "◉ ●");
  });

  it("Alt+/ 预览选中消息", async () => {
    await mock.emit("input", mkInputEvent("预览内容"), ctx);
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
    const scrolled: Array<{ id: string; align?: string; highlight?: boolean }> = [];
    const scrollCtx: MockCtx = {
      ui: {
        ...mock.ui,
        scrollToEntryId: (id, opts) => {
          scrolled.push({ id, align: opts?.align, highlight: opts?.highlight });
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
    assert.deepEqual(scrolled[0], { id: "e0", align: "center", highlight: true });
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
    branch.push({
      id: "real-user-entry-id",
      type: "message",
      message: { role: "user", content: "相同问题" },
    });
    mock.fireShortcut("alt+right");

    assert.equal(scrolled[0], "real-user-entry-id");
  });

  it("缺少 scrollToEntryId 时可回退到 legacy navigateTree", async () => {
    const navigated: string[] = [];
    const navCtx: MockCtx = {
      ui: mock.ui,
      sessionManager: {
        getBranch: () => [
          { id: "e0", type: "message", message: { role: "user", content: "a" } },
          { id: "e1", type: "message", message: { role: "user", content: "b" } },
        ],
      },
      navigateTree: async (id) => { navigated.push(id); },
    };
    await mock.emit("input", mkInputEvent("a"), navCtx);
    await mock.emit("input", mkInputEvent("b"), navCtx);
    mock.fireShortcut("alt+right");
    assert.equal(navigated[0], "e0");
  });

  it("缺少 navigateTree 时快捷键只更新选中不崩溃", async () => {
    await mock.emit("input", mkInputEvent("a"), ctx);
    mock.fireShortcut("alt+right");
    assert.equal(mock.widgets.at(-1)!.content[0], "◉");
    assert.equal(mock.notifications.length, 0);
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
