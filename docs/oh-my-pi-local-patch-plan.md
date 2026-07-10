# Oh My Pi 本地补丁方案

## 结论

本项目不走上游 PR。采用“稳定扩展 + 本地最小补丁”的方案：

- 扩展保持保守实现，只依赖实测稳定的扩展 API。
- Oh My Pi 本地补丁只补两个核心能力：消息跳转、输入框固定。
- 补丁失效时，扩展自动降级为小白点、选中、预览，不崩溃、不干扰输入。

## 背景

当前扩展已结合本地 Oh My Pi `16.3.15` 维护源码核对：

- 可用：`pi.on`、`pi.registerShortcut`、`ctx.ui.setWidget`、`ctx.ui.notify`
- 权威消息来源：`ctx.sessionManager.getBranch()`。扩展用它重建小白点，并用真实 `entry.id` 做跳转锚点。
- 不应依赖：`ctx.sessionManager.onEntryAppended(handler)`。源码中它是 `SessionManager` 内部单回调属性，不是稳定的扩展订阅 API。
- 需要本地补丁暴露：`ctx.ui.scrollToEntryId`
- 不使用：事件 `ExtensionContext` 中不存在的 `ctx.navigateTree`
- 不使用：`ctx.ui.setFooter`。当前 Oh My Pi interactive/RPC 路径并不适合作为小白点渲染面，扩展只使用 `ctx.ui.setWidget(..., { placement: "aboveEditor" })`。

因此跳转和输入框固定不应在扩展里硬 hack。

## 目标

### 扩展层目标

扩展负责：

- 生成消息小白点
- `/resume` 后继续维护小白点
- 快捷键移动选中
- `Alt+/` 预览选中消息
- 如果宿主提供跳转 API，则调用跳转
- 如果宿主没有跳转 API，则静默降级
- 事件流只作为刷新触发和短暂临时显示；一旦 `getBranch()` 可用，以 branch 重建结果为准

扩展不负责：

- 改终端滚动行为
- 固定输入框
- 调用 Oh My Pi 内部 session 方法改变会话状态
- 模拟键盘、鼠标、搜索或终端 escape sequence

### 本地补丁目标

补丁只做两件事：

1. 给扩展暴露消息滚动 API。
2. 改 TUI 布局，让输入框固定在终端底部。

## 前置条件

本地补丁方案成立的前提是：必须取得 Oh My Pi 的源码、可维护 fork，或官方发布包对应的可 patch 构建来源。

当前仓库只有 `message-nav-rail` 扩展源码，不能直接修改 `omp.exe` 内部 TUI。若只有编译后的 `C:\Users\Administrator\.local\bin\omp.exe`，则不能稳定实施本方案中的核心补丁，只能维持扩展稳定版。

进入补丁实施前，需要先确认：

- Oh My Pi 源码位置或 fork 地址。
- 本地能构建出可运行的 `omp.exe`。
- 能在更新 Oh My Pi 后重新应用补丁。
- 能保留原版 `omp.exe` 作为回滚。

如果这些条件不满足，实施边界就是：

- 扩展继续生成小白点、选中和预览。
- 不做消息跳转。
- 不做输入框固定。

## 补丁一：暴露消息跳转 API

建议 API：

```ts
ctx.ui.scrollToEntryId(entryId: string, options?: {
  align?: "start" | "center" | "end" | "nearest";
}): boolean;
```

第一版可以先实现最小版本：

```ts
ctx.ui.scrollToEntryId(entryId: string): boolean;
```

行为约束：

- 只滚动消息视图，不改变 session branch。
- 找到目标消息返回 `true`。
- 找不到目标消息返回 `false`。
- 不抛异常。
- 不要求扩展理解 Oh My Pi 内部渲染结构。

核心实现思路：

```text
entry.id
  -> 消息渲染节点 / row index
  -> message viewport scrollTo
```

核心需要维护一个可随布局重建的锚点映射。不要假设终端行号或 row 引用永久稳定，因为消息换行、流式更新、窗口 resize、折叠、主题变化都可能触发布局重排。

```ts
entryIdToAnchor: Map<string, MessageAnchor>
```

渲染或重排消息时绑定 entry id：

```ts
anchor.entryId = entry.id;
entryIdToAnchor.set(entry.id, anchor);
```

跳转时：

```ts
function scrollToEntryId(id: string): boolean {
  const anchor = entryIdToAnchor.get(id);
  if (!anchor) return false;
  messageViewport.scrollTo(anchor);
  return true;
}
```

要求：

- 消息重排后重建或刷新 `entryIdToAnchor`。
- 流式消息更新后，目标 anchor 仍能指向该消息当前布局位置。
- 窗口 resize 后，下一次跳转使用更新后的布局位置。

## 补丁二：固定输入框

目标布局：

```text
┌──────────────────────────────┐
│ Header / Status              │
├──────────────────────────────┤
│                              │
│ Message Scroll Viewport      │  只有这里滚动
│                              │
├──────────────────────────────┤
│ AboveEditor Widgets          │  小白点栏固定在输入框上方
├──────────────────────────────┤
│ Composer / Input Box         │  永远固定底部
└──────────────────────────────┘
```

要求：

- 输入框不进入消息 scrollback。
- 鼠标滚轮、PageUp、PageDown 只滚动消息区域。
- `aboveEditor` widget 固定在输入框上方。
- `scrollToEntryId` 只滚动消息区域。
- 跳转后输入框仍可直接输入。

## 扩展侧适配

扩展必须用能力检测，不用版本判断。

消息列表必须以 `ctx.sessionManager.getBranch()` 为准：

- `session_start` 时从 branch 全量重建。
- `input`、`message_start`、`message_end` 后安排短延迟刷新，吸收 Oh My Pi 写入 session 的时序差。
- branch 派生消息标记为可锚定，使用真实 `entry.id` 跳转。
- 事件派生的临时消息只用于即时显示，不能调用 `scrollToEntryId` 跳转。
- 如果 `message_start` 时 branch 已经包含真实 assistant entry，不再追加临时 assistant 点，避免重复小白点。
- 方向键快捷键同时注册 `alt+right/left` 和旧别名 `alt+arrowright/arrowleft`。
- 如果宿主暴露 `ctx.ui.onTerminalInput`，扩展额外监听常见 Alt+方向键 escape sequence 作为兜底，避免终端/解析别名差异导致无法选中。

推荐写法：

```ts
function jumpToMessage(ctx: ExtensionContext, entryId: string): boolean {
  return ctx.ui.scrollToEntryId?.(entryId, {
    align: "center",
  }) ?? false;
}
```

如果 API 不存在：

```ts
// 静默降级：只移动选中，不提示、不报错
return false;
```

不要写：

```ts
if (ompVersion === "16.3.8") {
  // ...
}
```

## 本地维护方式

已新增补丁维护目录：

```text
patches/
  oh-my-pi/
    README.md
    <oh-my-pi-version>-scroll-to-entry-and-fixed-composer.patch  # 按实际源码版本生成
```

`patches/oh-my-pi/README.md` 记录补丁目标、前置条件、源码定位关键词、应用/回滚流程和验收清单。

注意：Oh My Pi fork 的活跃维护工作树已经迁移到 `F:\WebCode\message-nav-rail\ohmypi\oh-my-pi-clean`，当前分支是 `message-nav-rail`，`origin` 指向 `https://github.com/Frashmeat/oh-my-pi.git`，`upstream` 指向 `https://github.com/can1357/oh-my-pi.git`。维护源码当前版本是 `16.3.15`；安装版本必须通过 `omp.exe --version` 实时确认。旧目录 `F:\WebCode\message-nav-rail\ohmypi\oh-my-pi` 的 Git 索引状态异常，只保留作参考，不再用于提交、生成 patch 或构建。

当前第二版实现状态：

- 已给扩展 UI context 增加可选 `scrollToEntryId(entryId, options): boolean`。
- 已给 transcript 渲染增加 `entryId -> Component` 锚点映射。
- 已给 `TranscriptContainer` 增加内部 viewport，负责消息区域行滚动和锚点跳转。
- 已新增 `FixedTranscriptLayout`，让 Oh My Pi interactive root 只挂一个固定高度布局组件。
- 已把欢迎、警告、changelog 挂入 transcript 内容区；输入区、状态区、`aboveEditor`/`belowEditor` widget 挂入固定底部区域。
- 固定布局每次 render 都返回终端高度行数，避免 TUI 根层再用完整 frame 尾部锚定把跳转压回底部。
- 已接入 PageUp/PageDown 到内部 transcript viewport；编辑器有多行草稿时不抢占编辑器翻页。
- 已接入 SGR mouse wheel 到内部 transcript viewport；是否生效取决于终端/Oh My Pi TUI 是否向主界面发送 SGR mouse 事件。
- 内部 viewport 回到底部后恢复自动尾随，后续新增和流式增长的消息继续可见。

本地验证脚本 `scripts/setup-oh-my-pi-bun-and-verify.ps1` 会在测试前检查 Oh My Pi workspace 的 native addon。若 `packages/natives/native/pi_natives.win32-x64-baseline.node` 缺失，脚本会先尝试从 `C:\Users\Administrator\.omp\natives\<版本>` 复制同版本缓存；没有缓存时，需要显式运行：

```powershell
.\scripts\verify-oh-my-pi.cmd
```

`scripts\verify-oh-my-pi.cmd` 会用 `ExecutionPolicy Bypass` 启动底层 PowerShell 脚本，并默认带 `-BuildNative`。底层脚本会自动把 `%USERPROFILE%\.cargo\bin` 放到当前进程 PATH 前面，并在缺少 `cl.exe` 时尝试加载 Visual Studio x64 developer environment。native 构建会触发 `bun --cwd=packages/natives run build`，属于重型本地构建，Windows 下需要 Rust 和 MSVC/Windows C++ build tools。

本地二进制部署统一使用：

```powershell
.\scripts\deploy-oh-my-pi-local.cmd
```

该脚本会备份当前 `C:\Users\Administrator\.local\bin\omp.exe`，复制维护仓库中的 `packages\coding-agent\dist\omp.exe`，并默认重装当前扩展。显式指定 `-Repo` 时，验证、native 构建、二进制构建和部署使用同一个仓库路径。

如果 native 构建报 `libnode.dll not found in any search path`，优先检查 `rustc -vV` 的 `host`。当前已遇到的失败原因是 Rust host 为 `x86_64-pc-windows-gnullvm`，触发了 `napi-build` 的 GNU 链接路径；Oh My Pi Windows 本地构建应切换到 `nightly-2026-04-29-x86_64-pc-windows-msvc`，并在 Developer PowerShell for Visual Studio 中执行验证脚本。如果 `rustup` 不存在，而 `rustc` 来源是 `C:\Program Files\Rust stable LLVM ...\bin\rustc.exe`，需要先安装 rustup，并让 `%USERPROFILE%\.cargo\bin` 在 PATH 中优先于旧 Rust 目录。

进入 Oh My Pi 仓库后，`rustc` 会读取 `rust-toolchain.toml` 并同步工具链；如果报 `.rustup\tmp\... 拒绝访问`，先删除并重建 `%USERPROFILE%\.rustup\tmp`，再重跑验证脚本。

## 更新 Oh My Pi 后的检查流程

查看版本：

```powershell
& "C:\Users\Administrator\.local\bin\omp.exe" --version
```

重新安装扩展：

```powershell
cd F:\WebCode\message-nav-rail
& "C:\Users\Administrator\.local\bin\omp.exe" install . --force
```

如存在旧扩展文件，先删除：

```powershell
Remove-Item "C:\Users\Administrator\.omp\agent\extensions\message-nav-rail.mjs" -ErrorAction SilentlyContinue
```

验收：

- 小白点生成正常。
- `/resume` 后小白点继续正确生成。
- `Alt+Left` / `Alt+Right` 能移动选中。
- `Alt+/` 能预览选中消息。
- 如果本地补丁有效，`Alt+1..9` 能滚动到对应消息。
- 如果本地补丁有效，输入框固定在终端底部。

降级验收：

- 删除或禁用本地补丁后，扩展仍能加载。
- 删除或禁用本地补丁后，小白点仍能生成。
- 删除或禁用本地补丁后，`Alt+Left` / `Alt+Right` 仍能移动选中。
- 删除或禁用本地补丁后，`Alt+/` 仍能预览选中消息。
- 删除或禁用本地补丁后，跳转功能静默失效，不弹错误、不改变会话状态。

## 风险

- Oh My Pi 更新频繁，本地补丁可能失效。
- 输入框固定涉及核心 TUI 布局，冲突概率高于 `scrollToEntryId`。
- `setFooter` 不作为小白点渲染路径，避免跟 Oh My Pi 后续 UI context 语义变化耦合。
- 不应调用内部 `sessionManager.moveTo` 等方法实现跳转，可能改变会话状态。

## 推荐实施顺序

1. 保持当前扩展稳定版。
2. 建立 `patches/oh-my-pi/` 目录。
3. 找到 Oh My Pi 本地源码或可 patch 的安装包来源。
4. 先做 `scrollToEntryId` 最小补丁。
5. 扩展检测到 `scrollToEntryId` 后启用跳转。
6. 再做输入框固定补丁。
7. 每次 Oh My Pi 更新后按验收清单检查。

## 最终原则

- 扩展不 hack 内部 API。
- 本地补丁尽量小。
- 所有高级能力都做能力检测。
- 补丁失效时扩展降级，不崩溃。
