# Message Nav Rail 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现一个 Oh My Pi 扩展，在输入框上方渲染横向消息导航小点条，用快捷键选中并预览消息。

**当前状态（2026-07-21 核对）：** 已用本地 Oh My Pi `17.0.5` 维护源码核对扩展 API。当前项目以 `types/pi-coding-agent.d.ts` 保存实际使用的宿主类型子集，并在运行时兼容两类已出现事件 payload：`event.message.role/content` 与 `event.role/text/content/messageId`。导航栏只保留用户输入，assistant entry 与流式输出不生成节点。

**Architecture:** 纯 TypeScript 扩展模块，入口为 `message-nav-rail.ts`，通过 `ExtensionAPI` 注册事件处理器（触发刷新/临时显示）、快捷键（移动选中/可选跳转）、`ctx.ui.setWidget`（渲染小点条）。消息列表以 `sessionManager.getBranch()` 为权威来源；跳转优先走能力检测后的 `ctx.ui.scrollToEntryId`，缺失时静默降级。

**Tech Stack:** TypeScript, Node.js test runner, tsx, esbuild, Oh My Pi Extension API（`@oh-my-pi/pi-coding-agent` 的本地类型存根）。

**Spec:** 原计划引用的 `docs/superpowers/specs/2026-07-05-message-nav-rail-design.md` 当前不存在，本文件暂作为实现与验证记录。

---

## 文件结构

```
F:\WebCode\message-nav-rail\
├── src\
│   ├── types.ts          # 类型定义（RailMessage, RailState）
│   ├── collector.ts      # 消息收集器（事件监听 → messages 数组）
│   ├── renderer.ts       # 小点条渲染逻辑（messages → 字符串数组）
│   ├── state.ts          # 状态管理（selectedIndex, 重建, clamp）
│   ├── shortcuts.ts      # 快捷键注册与处理
│   └── index.ts          # 扩展入口（工厂函数，注册一切）
├── test\
│   ├── renderer.test.ts  # 渲染逻辑测试
│   ├── state.test.ts     # 状态管理测试
│   └── collector.test.ts # 消息收集测试
├── message-nav-rail.ts   # Oh My Pi 加载入口（re-export src/index.ts）
├── types\
│   └── pi-coding-agent.d.ts # 本地宿主 API 类型存根
└── package.json
```

**职责边界：**
- `types.ts`：纯类型，无逻辑。
- `collector.ts`：事件 → RailMessage[]，纯数据收集，无 UI。
- `renderer.ts`：RailMessage[] + selectedIndex + width → string[]，纯函数，无副作用。
- `state.ts`：RailState 的操作（move, clamp, rebuild），纯函数。
- `shortcuts.ts`：快捷键 → 状态操作 + notify，依赖 ctx。
- `index.ts`：组装，注册到 pi；兼容多种事件 payload；存在 `ctx.ui.scrollToEntryId` 时滚动消息视图，缺失时静默降级。

## 当前命令

```bash
npm test
npm run typecheck
npm run build
```

说明：`npm run build` 输出 `dist/message-nav-rail.mjs`，当前开发与 Oh My Pi 加载入口仍以 `message-nav-rail.ts` 为准；`dist/` 作为构建产物默认不提交。

## 当前 API 核对结论

- `setLabel`、`pi.on(event, handler(event, ctx))`、`registerShortcut(shortcut, options)`：已结合 `17.0.5` 维护源码确认。
- `ctx.ui.setWidget(key, content, options)`、`ctx.ui.notify`：已结合 `17.0.5` 维护源码确认。
- `ctx.sessionManager.getBranch()`：当前扩展用它作为权威消息来源；`session_start`、`session_switch` 和消息事件后刷新 branch，解决 `/resume`、空会话切换和真实 `entry.id` 锚定问题。
- `ctx.sessionManager.onEntryAppended(handler)`：本地源码核对后确认不应作为扩展 API 使用。它是 `SessionManager` 内部单回调属性，不是稳定订阅接口，扩展已移除依赖。
- `ctx.ui.scrollToEntryId(id)`：需要本地 Oh My Pi 补丁暴露；存在时快捷键跳转到真实 entry，不存在时只移动选中。
- `ctx.ui.onTerminalInput(handler)`：存在时用于 Alt+方向键 raw input 兜底；OMP 每个事件都会创建新 `ExtensionContext`，因此当前实现按稳定 UI 身份复用监听器，并在会话切换时重绑。
- `ctx.navigateTree(id)`：只属于命令上下文，不在消息事件的 `ExtensionContext` 中使用。
- `ctx.ui.setFooter(...)`：不再使用。当前扩展只以 `setWidget(..., { placement: "aboveEditor" })` 渲染小白点，避免绑定 Oh My Pi 后续 footer 语义。
- `input`：只作为 branch 刷新触发，不直接创建用户点；本地命令不会进入会话树，不能把原始输入等同于消息。
- `message_start`、`message_end`：`omp -p` 实测 payload 为 `event.message.role/content`；用户临时点由这两个消息事件确认，assistant 事件仅触发 branch 校准，当前实现同时兼容旧计划中出现过的扁平 payload。
- `message_update`：assistant 流式更新不进入导航栏状态。

## 当前已知限制

- 输入框固定属于 Oh My Pi 核心 TUI 行为，扩展不能直接控制输入框本身；当前依赖本地 Oh My Pi 固定布局补丁实现。
- `scrollToEntryId` 需要本地 Oh My Pi 补丁暴露。缺失跳转 API 时扩展静默降级，不提示、不改变会话状态。
- 用户本机曾存在旧版全局扩展 `C:\Users\Administrator\.omp\agent\extensions\message-nav-rail.mjs`，可能覆盖或干扰当前包安装。正式安装当前包前应删除或禁用旧文件，再执行 `omp install . --force`。

> 下方 Task 章节是 2026-07-05 的历史实施计划，部分代码片段保留当时写法，仅作为演进记录；当前可执行入口、脚本和 API 核对结论以上方“当前状态 / 当前命令 / 当前 API 核对结论”为准，尤其不能再直接按 `input` 创建用户消息。

---

## Task 1: 项目脚手架与类型定义

**Files:**
- Create: `F:\WebCode\message-nav-rail\package.json`
- Create: `F:\WebCode\message-nav-rail\src\types.ts`
- Create: `F:\WebCode\message-nav-rail\tsconfig.json`

- [ ] **Step 1: 初始化 package.json**

```json
{
  "name": "message-nav-rail",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test": "node --import tsx --test test/*.test.ts"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/node": "^22.0.0"
  }
}
```

- [ ] **Step 2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 3: 创建 src/types.ts**

```ts
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
```

- [ ] **Step 4: 安装依赖**

Run: `cd F:\WebCode\message-nav-rail && npm install`
Expected: 安装成功，生成 node_modules

- [ ] **Step 5: Commit**

```bash
cd F:\WebCode\message-nav-rail
git init
git add -A
git commit -m "chore: scaffold message-nav-rail project"
```

---

## Task 2: 渲染逻辑（纯函数）

**Files:**
- Create: `F:\WebCode\message-nav-rail\src\renderer.ts`
- Test: `F:\WebCode\message-nav-rail\test\renderer.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// test/renderer.test.ts
import { describe, expect, it } from "bun:test";
import { renderRail } from "../src/renderer";
import type { RailMessage } from "../src/types";

const mkMsg = (type: "user" | "assistant", id: string, streaming = false): RailMessage => ({
  id, type, preview: "x".repeat(80), timestamp: 0, streaming,
});

describe("renderRail", () => {
  it("空消息返回空字符串数组", () => {
    expect(renderRail([], -1, 80)).toEqual([""]);
  });

  it("渲染用户和模型小点", () => {
    const msgs = [mkMsg("user", "1"), mkMsg("assistant", "2")];
    const out = renderRail(msgs, -1, 80);
    expect(out[0]).toBe("● ○");
  });

  it("streaming 消息显示半填充", () => {
    const msgs = [mkMsg("assistant", "1", true)];
    expect(renderRail(msgs, -1, 80)[0]).toBe("◐");
  });

  it("选中索引显示高亮符号", () => {
    const msgs = [mkMsg("user", "1"), mkMsg("assistant", "2")];
    expect(renderRail(msgs, 0, 80)[0]).toBe("◉ ○");
    expect(renderRail(msgs, 1, 80)[0]).toBe("● ◉");
  });

  it("超限时只显示最近 N 个", () => {
    const msgs = Array.from({ length: 50 }, (_, i) => mkMsg("user", String(i)));
    // width=10 → maxVisible=5 → 只显示最近 5 个（id 45-49）
    const out = renderRail(msgs, -1, 10);
    expect(out[0]).toBe("● ● ● ● ●");
    expect(out[0].split(" ").length).toBe(5);
  });

  it("选中索引在可见窗口外不影响显示", () => {
    const msgs = Array.from({ length: 50 }, (_, i) => mkMsg("user", String(i)));
    // selectedIndex=0 在可见窗口外（窗口是 45-49）
    const out = renderRail(msgs, 0, 10);
    expect(out[0]).toBe("● ● ● ● ●");
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd F:\WebCode\message-nav-rail && node --import tsx --test test/renderer.test.ts`
Expected: FAIL（`renderRail` 未定义）

- [ ] **Step 3: 实现 renderer.ts**

```ts
// src/renderer.ts
import type { RailMessage } from "./types";

const SYMBOLS = {
  user: "●",
  assistant: "○",
  streaming: "◐",
  selected: "◉",
} as const;

export function renderRail(
  messages: RailMessage[],
  selectedIndex: number,
  width: number
): string[] {
  if (messages.length === 0) return [""];

  const slotWidth = 2; // 符号 + 空格
  const maxVisible = Math.max(1, Math.floor(width / slotWidth));
  const start = Math.max(0, messages.length - maxVisible);
  const visible = messages.slice(start);

  let line = "";
  for (let i = 0; i < visible.length; i++) {
    const idx = start + i;
    const m = visible[i];
    const base = m.streaming ? SYMBOLS.streaming : m.type === "user" ? SYMBOLS.user : SYMBOLS.assistant;
    const sym = idx === selectedIndex ? SYMBOLS.selected : base;
    line += sym + (i < visible.length - 1 ? " " : "");
  }
  return [line];
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd F:\WebCode\message-nav-rail && node --import tsx --test test/renderer.test.ts`
Expected: PASS（全部 6 个测试）

- [ ] **Step 5: Commit**

```bash
cd F:\WebCode\message-nav-rail
git add -A
git commit -m "feat: add rail renderer with overflow handling"
```

---

## Task 3: 状态管理（纯函数）

**Files:**
- Create: `F:\WebCode\message-nav-rail\src\state.ts`
- Test: `F:\WebCode\message-nav-rail\test\state.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// test/state.test.ts
import { describe, expect, it } from "bun:test";
import { moveSelection, clampSelection, rebuildFromEntries } from "../src/state";
import { INITIAL_STATE } from "../src/types";
import type { RailMessage } from "../src/types";

describe("state", () => {
  it("moveSelection 右移", () => {
    const s = { ...INITIAL_STATE, messages: [{id:"1",type:"user",preview:"",timestamp:0}], selectedIndex: -1 };
    const s2 = moveSelection(s, 1);
    expect(s2.selectedIndex).toBe(0);
  });

  it("moveSelection 左移 clamp 到 0", () => {
    const s = { ...INITIAL_STATE, messages: [{id:"1",type:"user",preview:"",timestamp:0}], selectedIndex: 0 };
    const s2 = moveSelection(s, -1);
    expect(s2.selectedIndex).toBe(0);
  });

  it("moveSelection 右移 clamp 到末位", () => {
    const s = { ...INITIAL_STATE, messages: [{id:"1",type:"user",preview:"",timestamp:0}], selectedIndex: 0 };
    const s2 = moveSelection(s, 1);
    expect(s2.selectedIndex).toBe(0);
  });

  it("moveSelection 空消息不移动", () => {
    const s2 = moveSelection(INITIAL_STATE, 1);
    expect(s2.selectedIndex).toBe(-1);
  });

  it("clampSelection 修正越界", () => {
    const s = { ...INITIAL_STATE, messages: [{id:"1",type:"user",preview:"",timestamp:0}], selectedIndex: 5 };
    expect(clampSelection(s).selectedIndex).toBe(0);
  });

  it("rebuildFromEntries 重建用户和模型消息", () => {
    const entries = [
      { type: "user", content: "你好" },
      { type: "assistant", content: "你好，有什么可以帮你？" },
    ] as any;
    const s = rebuildFromEntries(entries);
    expect(s.messages.length).toBe(2);
    expect(s.messages[0].type).toBe("user");
    expect(s.messages[1].type).toBe("assistant");
    expect(s.messages[0].preview).toBe("你好");
    expect(s.messages[1].preview.startsWith("你好")).toBe(true);
    expect(s.selectedIndex).toBe(-1);
    expect(s.streamingAssistantId).toBeNull();
  });

  it("rebuildFromEntries preview 截断到 80 字符", () => {
    const long = "x".repeat(200);
    const entries = [{ type: "user", content: long }] as any;
    const s = rebuildFromEntries(entries);
    expect(s.messages[0].preview.length).toBe(80);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd F:\WebCode\message-nav-rail && node --import tsx --test test/state.test.ts`
Expected: FAIL（模块未定义）

- [ ] **Step 3: 实现 state.ts**

```ts
// src/state.ts
import type { RailState, RailMessage } from "./types";
import { INITIAL_STATE } from "./types";

const PREVIEW_LEN = 80;

export function moveSelection(state: RailState, delta: number): RailState {
  if (state.messages.length === 0) return state;
  const next = state.selectedIndex + delta;
  return { ...state, selectedIndex: clamp(next, 0, state.messages.length - 1) };
}

export function clampSelection(state: RailState): RailState {
  if (state.messages.length === 0) return { ...state, selectedIndex: -1 };
  return { ...state, selectedIndex: clamp(state.selectedIndex, 0, state.messages.length - 1) };
}

export function selectByVisibleIndex(state: RailState, n: number, width: number): RailState {
  if (state.messages.length === 0) return state;
  const maxVisible = Math.max(1, Math.floor(width / 2));
  const start = Math.max(0, state.messages.length - maxVisible);
  const idx = clamp(start + (n - 1), start, state.messages.length - 1);
  return { ...state, selectedIndex: idx };
}

export function rebuildFromEntries(entries: Array<{ type: string; content: string }>): RailState {
  const messages: RailMessage[] = [];
  for (const e of entries) {
    if (e.type !== "user" && e.type !== "assistant") continue;
    messages.push({
      id: `${e.type}-${messages.length}`,
      type: e.type,
      preview: truncate(e.content ?? "", PREVIEW_LEN),
      timestamp: 0,
      streaming: false,
    });
  }
  return { ...INITIAL_STATE, messages };
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd F:\WebCode\message-nav-rail && node --import tsx --test test/state.test.ts`
Expected: PASS（全部 7 个测试）

- [ ] **Step 5: Commit**

```bash
cd F:\WebCode\message-nav-rail
git add -A
git commit -m "feat: add state management with move/clamp/rebuild"
```

---

## Task 4: 消息收集器

**Files:**
- Create: `F:\WebCode\message-nav-rail\src\collector.ts`
- Test: `F:\WebCode\message-nav-rail\test\collector.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// test/collector.test.ts
import { describe, expect, it } from "bun:test";
import { onInput, onMessageStart, onMessageUpdate, onMessageEnd } from "../src/collector";
import { INITIAL_STATE } from "../src/types";

describe("collector", () => {
  it("onInput 添加用户消息", () => {
    const s = onInput(INITIAL_STATE, "你好");
    expect(s.messages.length).toBe(1);
    expect(s.messages[0].type).toBe("user");
    expect(s.messages[0].preview).toBe("你好");
    expect(s.messages[0].streaming).toBeFalsy();
  });

  it("onMessageStart 添加 streaming 模型消息", () => {
    const s = onMessageStart(INITIAL_STATE, "msg-1");
    expect(s.messages.length).toBe(1);
    expect(s.messages[0].type).toBe("assistant");
    expect(s.messages[0].streaming).toBe(true);
    expect(s.streamingAssistantId).toBe("msg-1");
  });

  it("onMessageUpdate 更新 streaming 消息 preview", () => {
    let s = onMessageStart(INITIAL_STATE, "msg-1");
    s = onMessageUpdate(s, "msg-1", "正在回答");
    expect(s.messages[0].preview).toBe("正在回答");
  });

  it("onMessageEnd 结束 streaming", () => {
    let s = onMessageStart(INITIAL_STATE, "msg-1");
    s = onMessageEnd(s, "msg-1", "最终答案");
    expect(s.messages[0].streaming).toBe(false);
    expect(s.messages[0].preview).toBe("最终答案");
    expect(s.streamingAssistantId).toBeNull();
  });

  it("onMessageUpdate 忽略不匹配的 id", () => {
    let s = onMessageStart(INITIAL_STATE, "msg-1");
    s = onMessageUpdate(s, "other", "其他");
    expect(s.messages[0].preview).toBe("");
  });

  it("onInput preview 截断到 80 字符", () => {
    const s = onInput(INITIAL_STATE, "x".repeat(200));
    expect(s.messages[0].preview.length).toBe(80);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd F:\WebCode\message-nav-rail && node --import tsx --test test/collector.test.ts`
Expected: FAIL（模块未定义）

- [ ] **Step 3: 实现 collector.ts**

```ts
// src/collector.ts
import type { RailState, RailMessage } from "./types";

const PREVIEW_LEN = 80;

export function onInput(state: RailState, text: string): RailState {
  const msg: RailMessage = {
    id: `user-${state.messages.length}`,
    type: "user",
    preview: truncate(text, PREVIEW_LEN),
    timestamp: Date.now(),
  };
  return { ...state, messages: [...state.messages, msg] };
}

export function onMessageStart(state: RailState, id: string): RailState {
  const msg: RailMessage = {
    id,
    type: "assistant",
    preview: "",
    timestamp: Date.now(),
    streaming: true,
  };
  return {
    ...state,
    messages: [...state.messages, msg],
    streamingAssistantId: id,
  };
}

export function onMessageUpdate(state: RailState, id: string, text: string): RailState {
  if (state.streamingAssistantId !== id) return state;
  const messages = state.messages.map(m =>
    m.id === id ? { ...m, preview: truncate(text, PREVIEW_LEN) } : m
  );
  return { ...state, messages };
}

export function onMessageEnd(state: RailState, id: string, finalText: string): RailState {
  const messages = state.messages.map(m =>
    m.id === id ? { ...m, preview: truncate(finalText, PREVIEW_LEN), streaming: false } : m
  );
  return {
    ...state,
    messages,
    streamingAssistantId: state.streamingAssistantId === id ? null : state.streamingAssistantId,
  };
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd F:\WebCode\message-nav-rail && node --import tsx --test test/collector.test.ts`
Expected: PASS（全部 6 个测试）

- [ ] **Step 5: Commit**

```bash
cd F:\WebCode\message-nav-rail
git add -A
git commit -m "feat: add message collector for input/message events"
```

---

## Task 5: 快捷键处理

**Files:**
- Create: `F:\WebCode\message-nav-rail\src\shortcuts.ts`

- [ ] **Step 1: 实现 shortcuts.ts（无独立测试，集成测试覆盖）**

```ts
// src/shortcuts.ts
import type { RailState } from "./types";
import { moveSelection, selectByVisibleIndex } from "./state";

export interface ShortcutContext {
  state: RailState;
  width: number;
  notify: (msg: string, level: "info" | "warn" | "error") => void;
  setState: (s: RailState) => void;
}

export function handleAltArrow(ctx: ShortcutContext, direction: 1 | -1): void {
  const next = moveSelection(ctx.state, direction);
  ctx.setState(next);
}

export function handleAltNumber(ctx: ShortcutContext, n: number): void {
  const next = selectByVisibleIndex(ctx.state, n, ctx.width);
  ctx.setState(next);
}

export function handleAltSlash(ctx: ShortcutContext): void {
  const idx = ctx.state.selectedIndex;
  if (idx < 0 || idx >= ctx.state.messages.length) {
    ctx.notify("未选中任何消息", "warn");
    return;
  }
  const m = ctx.state.messages[idx];
  ctx.notify(`[${m.type === "user" ? "用户" : "模型"}] ${m.preview}`, "info");
}
```

- [ ] **Step 2: Commit**

```bash
cd F:\WebCode\message-nav-rail
git add -A
git commit -m "feat: add shortcut handlers"
```

---

## Task 6: 扩展入口（组装）

**Files:**
- Create: `F:\WebCode\message-nav-rail\src\index.ts`
- Create: `F:\WebCode\message-nav-rail\message-nav-rail.ts`（加载入口，re-export）

- [ ] **Step 1: 实现 src/index.ts**

```ts
// src/index.ts
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { INITIAL_STATE, type RailState } from "./types";
import { renderRail } from "./renderer";
import { onInput, onMessageStart, onMessageUpdate, onMessageEnd } from "./collector";
import { rebuildFromEntries } from "./state";
import { handleAltArrow, handleAltNumber, handleAltSlash, type ShortcutContext } from "./shortcuts";

export default function messageNavRail(pi: ExtensionAPI) {
  pi.setLabel("消息导航栏");

  let state: RailState = { ...INITIAL_STATE };
  let width = 80;

  function rerender() {
    try {
      const lines = renderRail(state.messages, state.selectedIndex, width);
      pi.ctx?.ui.setWidget?.(lines, { placement: "aboveEditor" });
    } catch (e) {
      pi.logger?.error?.("message-nav-rail rerender failed", e);
    }
  }

  function setState(s: RailState) {
    state = s;
    rerender();
  }

  function makeShortcutCtx(): ShortcutContext {
    return { state, width, notify: (m, l) => pi.ctx?.ui?.notify?.(m, l), setState };
  }

  // 事件监听
  pi.on("input", async (event) => {
    try {
      state = onInput(state, event.text ?? "");
      rerender();
    } catch (e) { pi.logger?.error?.("input handler failed", e); }
  });

  pi.on("message_start", async (event) => {
    try {
      if (event.role === "assistant") {
        state = onMessageStart(state, event.messageId ?? String(Date.now()));
        rerender();
      }
    } catch (e) { pi.logger?.error?.("message_start handler failed", e); }
  });

  pi.on("message_update", async (event) => {
    try {
      if (event.role === "assistant" && state.streamingAssistantId) {
        state = onMessageUpdate(state, state.streamingAssistantId, event.text ?? "");
        rerender();
      }
    } catch (e) { pi.logger?.error?.("message_update handler failed", e); }
  });

  pi.on("message_end", async (event) => {
    try {
      if (event.role === "assistant" && state.streamingAssistantId) {
        state = onMessageEnd(state, state.streamingAssistantId, event.text ?? "");
        rerender();
      }
    } catch (e) { pi.logger?.error?.("message_end handler failed", e); }
  });

  pi.on("session_start", async (_event, ctx) => {
    try {
      const branch = ctx.sessionManager?.getBranch?.() ?? [];
      const entries = branch.map((e: any) => ({ type: e.type, content: extractText(e) }));
      state = rebuildFromEntries(entries);
      rerender();
    } catch (e) { pi.logger?.error?.("session_start rebuild failed", e); }
  });

  // 快捷键
  try {
    pi.registerShortcut("alt+arrowright", () => handleAltArrow(makeShortcutCtx(), 1));
    pi.registerShortcut("alt+arrowleft", () => handleAltArrow(makeShortcutCtx(), -1));
    for (let n = 1; n <= 9; n++) {
      pi.registerShortcut(`alt+${n}`, () => handleAltNumber(makeShortcutCtx(), n));
    }
    pi.registerShortcut("alt+/", () => handleAltSlash(makeShortcutCtx()));
  } catch (e) {
    pi.logger?.error?.("shortcut registration failed", e);
  }
}

function extractText(entry: any): string {
  if (typeof entry.content === "string") return entry.content;
  if (Array.isArray(entry.content)) {
    return entry.content
      .filter((c: any) => c?.type === "text")
      .map((c: any) => c.text ?? "")
      .join("");
  }
  return "";
}
```

- [ ] **Step 2: 创建 message-nav-rail.ts（Oh My Pi 加载入口）**

```ts
// message-nav-rail.ts
export { default } from "./src/index.ts";
```

- [ ] **Step 3: 类型检查**

Run: `cd F:\WebCode\message-nav-rail && npm run typecheck`
Expected: 无类型错误（若 `@oh-my-pi/pi-coding-agent` 类型不可用，需后续在真实 Oh My Pi 环境验证）

- [ ] **Step 4: 运行全部测试**

Run: `cd F:\WebCode\message-nav-rail && npm test`
Expected: PASS（全部测试）

- [ ] **Step 5: Commit**

```bash
cd F:\WebCode\message-nav-rail
git add -A
git commit -m "feat: assemble extension entry with event and shortcut wiring"
```

---

## Task 7: 集成验证（手动）

**Files:**
- 无新文件，验证已实现的扩展

- [ ] **Step 1: 部署到 Oh My Pi 扩展目录**

```bash
cp F:\WebCode\message-nav-rail\message-nav-rail.ts ~/.omp/agent/extensions/message-nav-rail.ts
# 或创建符号链接
```

- [ ] **Step 2: 启动 Oh My Pi，输入对话**

Expected: 输入框上方出现小点条，用户输入显示 `●`，模型输出显示 `○`，流式中显示 `◐`

- [ ] **Step 3: 测试快捷键**

- `Alt+→` / `Alt+←`：选中移动，当前小点变为 `◉`
- `Alt+1`..`Alt+9`：直接选中可见窗口内对应小点
- `Alt+/`：弹出 notify 显示选中消息预览

- [ ] **Step 4: 测试超限**

连续输入超过 40 条消息（80 列终端），确认小点条只显示最近 40 个，不溢出。

- [ ] **Step 5: 测试 session 切换**

切换 session，确认小点条重建为新会话的消息。

- [ ] **Step 6: 记录问题并修复**

如有问题，回到对应 Task 修复。

---

## 验证清单

- [ ] 所有单元测试通过（`npm test`）
- [ ] 扩展在 Oh My Pi 中加载无报错
- [ ] 小点条正确显示在输入框上方
- [ ] 用户/模型/streaming/选中四种小点外观正确
- [ ] 快捷键 Alt+←/→/1-9// 全部工作
- [ ] 超限时只显示最近 N 个小点
- [ ] session 切换后小点条正确重建
- [ ] 无鼠标点击（已知限制）
- [ ] 无视图跳转（已知限制，用 notify 预览替代）
