# Oh My Pi 本地补丁维护说明

本目录维护 `message-nav-rail` 依赖的 Oh My Pi 本地补丁。

当前仓库包含扩展源码；Oh My Pi fork 的活跃维护工作树是：

```text
F:\WebCode\message-nav-rail\ohmypi\oh-my-pi-clean
```

这个工作树当前在 `message-nav-rail` 分支，remote 配置为：

```text
origin   https://github.com/Frashmeat/oh-my-pi.git
upstream https://github.com/can1357/oh-my-pi.git
```

旧工作树仍保留在：

```text
F:\WebCode\message-nav-rail\ohmypi\oh-my-pi
```

旧工作树启用了异常 sparse checkout，`git status` 会显示大量 deleted/untracked；只作为迁移参考，不再作为提交、生成 patch 或构建来源。

没有源码、fork 或可构建发布包时，不要尝试修改 `omp.exe` 二进制文件；这类修改不可维护，也无法稳定覆盖 Oh My Pi 高频更新。

## 补丁目标

本地补丁只解决两件事：

1. 向扩展上下文暴露 `ctx.ui.scrollToEntryId(entryId, options)`。
2. 调整 TUI 布局，让输入框固定在终端底部，只让消息区域滚动。

当前已归档补丁：

```text
patches/oh-my-pi/16.3.15-scroll-to-entry-and-fixed-composer.patch
```

扩展侧已经按能力检测适配：

- 存在 `ctx.ui.scrollToEntryId` 时，`Alt+Left`、`Alt+Right`、`Alt+1..9` 会尝试滚动到选中消息。
- 不存在该 API 时，快捷键只移动选中，不提示错误，不改变会话状态。
- 小白点列表以 `ctx.sessionManager.getBranch()` 为权威来源，使用 branch 中真实 `entry.id` 跳转。
- `ctx.sessionManager.onEntryAppended` 是 Oh My Pi 内部单回调属性，不作为扩展订阅 API 使用。
- `ctx.ui.setWidget(..., { placement: "aboveEditor" })` 仍是小白点主渲染路径。

## 前置条件

实施补丁前必须满足：

- 已取得 Oh My Pi 源码、可维护 fork，或官方发布包对应的可 patch 构建来源。
- 本地能从该源码构建出可运行的 `omp.exe`。
- 已保留原版 `omp.exe` 作为回滚目标。
- 能在 Oh My Pi 更新后重新应用并验证补丁。

当前已知用户运行的二进制位置是：

```powershell
C:\Users\Administrator\.local\bin\omp.exe
```

当前维护工作树 `packages/coding-agent/package.json` 标注的 `@oh-my-pi/pi-coding-agent` 版本是 `16.3.15`。安装版本必须通过 `omp.exe --version` 实时确认；生成 patch 文件和替换 `omp.exe` 时，以实际源码版本为准。

另外，旧工作树 `oh-my-pi` 的 Git 索引当前异常：`git status` 显示大量文件同时为 deleted/untracked，`git ls-files` 对已存在文件返回为空。不要基于该状态直接生成或提交 patch。

## Bun 环境与验证脚本

已新增本地脚本：

```powershell
F:\WebCode\message-nav-rail\scripts\setup-oh-my-pi-bun-and-verify.ps1
```

在正常联网的 PowerShell 中运行：

```powershell
cd F:\WebCode\message-nav-rail
.\scripts\verify-oh-my-pi.cmd
```

脚本会：

- 用 `ExecutionPolicy Bypass` 启动 PowerShell 验证脚本，避免 Developer PowerShell 禁止执行 `.ps1`。
- 自动把 `%USERPROFILE%\.cargo\bin` 放到当前进程 PATH 前面，避免旧的独立 Rust 抢先。
- native 构建前自动尝试加载 Visual Studio x64 developer environment。
- 检查 `F:\WebCode\message-nav-rail\ohmypi\oh-my-pi-clean` 是否存在。
- 安装或校验 `bun@1.3.14`。
- 执行 `bun install`。
- 检查 `packages/natives/native` 是否存在当前平台的 native addon；如果缺失，会先尝试从 `C:\Users\Administrator\.omp\natives\<版本>` 恢复同版本 `.node` 文件。
- 执行本补丁相关的局部测试。
- 执行 `bun --cwd=packages/coding-agent run check`。

如果已经手动安装好了 Bun，只想验证：

```powershell
.\scripts\verify-oh-my-pi.cmd -SkipBunInstall
```

如果只想先跑局部测试、不跑 package check：

```powershell
.\scripts\verify-oh-my-pi.cmd -SkipCheck
```

如果只想检查 Bun、仓库和 native 环境，不跑测试也不跑 check：

```powershell
.\scripts\verify-oh-my-pi.cmd -SkipBunInstall -SkipDepsInstall -SkipTests -SkipCheck
```

如果脚本提示缺少 `pi_natives.win32-x64-baseline.node` 或同类 native addon，且本机没有同版本缓存，则明确触发 native 构建：

```powershell
.\scripts\verify-oh-my-pi.cmd
```

`-BuildNative` 会执行 `bun --cwd=packages/natives run build`，Windows x64 下会强制 `TARGET_VARIANT=baseline`，便于所有 x64 CPU 回退加载。该步骤需要 Rust 以及可用的 MSVC/Windows C++ build tools；如果普通 PowerShell 找不到编译工具，改用 Developer PowerShell 后重跑。

如果需要直接调用底层脚本，可运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-oh-my-pi-bun-and-verify.ps1 -BuildNative
```

## 本地部署脚本

构建通过后，使用：

```powershell
cd F:\WebCode\message-nav-rail
.\scripts\deploy-oh-my-pi-local.cmd
```

脚本会：

- 检查 `ohmypi\oh-my-pi-clean\packages\coding-agent\dist\omp.exe` 是否存在。
- 如果当前 `omp.exe` 正在运行，则停止部署并提示先关闭会话。
- 备份当前 `C:\Users\Administrator\.local\bin\omp.exe`，备份名形如 `omp.exe.20260708-215500.bak`。
- 复制新构建的 `omp.exe` 到 `C:\Users\Administrator\.local\bin\omp.exe`。
- 执行 `omp.exe --version`。
- 默认执行 `omp.exe install F:\WebCode\message-nav-rail --force` 重装扩展。

如果只想替换二进制、不重装扩展：

```powershell
.\scripts\deploy-oh-my-pi-local.cmd -SkipExtensionInstall
```

## 同步上游脚本

更新 Oh My Pi fork 时，优先使用：

```powershell
cd F:\WebCode\message-nav-rail
.\scripts\sync-oh-my-pi-upstream.cmd
```

脚本会在 `F:\WebCode\message-nav-rail\ohmypi\oh-my-pi-clean` 中执行以下流程：

- 要求 Oh My Pi 工作树干净；如果存在未提交改动，会停止并列出 `git status --porcelain`。
- 检查 `origin` 和 `upstream` remote 是否存在。
- 拉取 `origin` 与 `upstream`。
- 切到当前本地分支，默认是 `message-nav-rail`。
- 如果 `origin/<当前分支>` 存在，先执行 `git merge --ff-only origin/<当前分支>`。
- 合并 `upstream/<上游默认分支>`。
- 如果某一步失败，停止并打印失败步骤、错误详情和下一步建议。
- 如果发生冲突，停止并列出冲突文件，同时提示手动 `git status`、解决冲突、`git merge --continue`、再 push。
- 如果没有冲突，自动执行 `git push origin HEAD:<当前分支>`。
- 默认先构建 `packages/natives/native/pi_natives.win32-x64-baseline.node`，再构建新的 `packages/coding-agent/dist/omp.exe`，部署到 `C:\Users\Administrator\.local\bin\omp.exe`，并重装当前扩展。
- 显式传入 `-Repo` 时，验证、native 构建、二进制构建和部署都会使用同一个仓库，不会回退到默认维护目录。

只想同步到本地、不自动推送时：

```powershell
.\scripts\sync-oh-my-pi-upstream.cmd -NoPush
```

默认命令会同步上游后直接更新本机正在使用的 `omp.exe`。如果还要在部署前跑本地补丁验证：

```powershell
.\scripts\sync-oh-my-pi-upstream.cmd -Verify -SkipDepsInstall
```

这个组合会在 Git 同步成功后继续执行验证、构建和部署：

- `-Verify`：运行本地补丁验证脚本。
- `-SkipDepsInstall`：验证时复用现有依赖，避免每次都跑 `bun install`。

如果只想同步和 push，不替换当前使用的 `omp.exe`：

```powershell
.\scripts\sync-oh-my-pi-upstream.cmd -NoDeploy
```

如果只想同步并构建，不部署：

```powershell
.\scripts\sync-oh-my-pi-upstream.cmd -NoDeploy -Build
```

如果需要显式指定分支：

```powershell
.\scripts\sync-oh-my-pi-upstream.cmd -Branch message-nav-rail -UpstreamBranch main
```

注意：同步脚本默认会执行 Git 同步、push、构建和本机部署。如果某一步失败，脚本会停止并打印失败步骤、错误详情和建议命令。

如果部署时报 native addon 缺少类似 `__piNativesV16_3_15` 的版本哨兵，说明 `omp.exe` 已更新，但本地 `.node` native 文件仍来自旧版本。处理方式是重新构建 native、重新构建 `omp.exe`、再部署：

```powershell
cd F:\WebCode\message-nav-rail\ohmypi\oh-my-pi-clean
$env:TARGET_VARIANT = "baseline"
bun --cwd=packages/natives run build
bun --cwd=packages/coding-agent run build

cd F:\WebCode\message-nav-rail
.\scripts\deploy-oh-my-pi-local.cmd
```

如果 native 构建报：

```text
libnode.dll not found in any search path
```

通常不是 Node 没装，而是 Rust 当前 host 是 `x86_64-pc-windows-gnullvm`，触发了 `napi-build` 的 GNU 链接路径。Oh My Pi 本地 Windows 构建应使用 `x86_64-pc-windows-msvc`。处理方式：

```powershell
rustup toolchain install nightly-2026-04-29-x86_64-pc-windows-msvc
rustup default nightly-2026-04-29-x86_64-pc-windows-msvc
```

如果 `rustup` 不存在，而 `rustc -vV` 显示来源类似 `C:\Program Files\Rust stable LLVM ...\bin\rustc.exe`，说明当前是独立安装的 GNU/LLVM Rust，不是 rustup 管理的 MSVC toolchain。需要先安装 rustup，并确保 `%USERPROFILE%\.cargo\bin` 在 PATH 中优先于旧的 `C:\Program Files\Rust stable LLVM ...\bin`。

进入 Oh My Pi 仓库后，`rustc` 会读取 `rust-toolchain.toml` 并同步项目指定工具链。如果报 `C:\Users\Administrator\.rustup\tmp\... 拒绝访问`，先修复 `.rustup` 目录权限或删除损坏的 `tmp` 目录后重试：

```powershell
Remove-Item "$env:USERPROFILE\.rustup\tmp" -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$env:USERPROFILE\.rustup\tmp"
```

同时确保已安装 Visual Studio Build Tools 的 `Desktop development with C++`，然后在 Developer PowerShell for Visual Studio 中重跑：

```powershell
cd F:\WebCode\message-nav-rail
.\scripts\setup-oh-my-pi-bun-and-verify.ps1 -BuildNative
```

## 当前本地源码改动

已在 `F:\WebCode\message-nav-rail\ohmypi\oh-my-pi-clean` 的 `message-nav-rail` 分支迁移第一版本地补丁：

- `packages/coding-agent/src/extensibility/extensions/types.ts`
  - 新增 `ExtensionScrollToEntryOptions`
  - 给 `ExtensionUIContext` 增加可选 `scrollToEntryId(entryId, options): boolean`
- `packages/coding-agent/scripts/build-binary.ts`
  - Windows/npm shim 环境下，内部 `bun ...` 子命令改用当前进程的真实 `process.execPath`
  - 避免外层能运行 `bun`，但 `Bun.spawn(["bun", ...])` 报 `ENOENT: uv_spawn 'bun'`
- `packages/tui/src/tui.ts`
  - 新增主界面 `setMouseTrackingEnabled(enabled)`，让普通 interactive UI 可以接收 SGR mouse wheel
  - fullscreen overlay 退出后，如果主界面仍需要 mouse tracking，会自动恢复
- `packages/coding-agent/src/session/session-context.ts`
  - 给 `SessionContext` 增加与 `messages` 平行的 `messageEntryIds`
  - 保证删除 dangling assistant message 时同步删除对应 entry id
- `packages/coding-agent/src/modes/components/transcript-container.ts`
  - 新增固定 viewport row provider
  - 新增 `scrollComponentIntoView`
  - viewport 模式下只渲染 transcript 可见切片，并阻止其进入 native scrollback commit
- `packages/coding-agent/src/modes/components/fixed-transcript-layout.ts`
  - 新增 interactive root 固定布局
  - transcript 只占用终端高度扣除固定底部区域后的行数
  - editor、status、hook widgets 等底部区域始终渲染在终端底部
- `packages/coding-agent/src/modes/interactive-mode.ts`
  - TUI root 只挂载一个 `FixedTranscriptLayout`
  - 欢迎、警告、changelog 改为 transcript 内容，不再作为独立 root children
  - interactive UI 启动后启用主界面 mouse tracking，退出前关闭
  - 维护 `entryId -> Component` 锚点表
  - 实现 `scrollToEntryId`
  - 实现 transcript viewport 行滚动和页滚动入口
- `packages/coding-agent/src/modes/controllers/input-controller.ts`
  - 把 PageUp/PageDown 接入内部 transcript viewport
  - 把 SGR mouse wheel 接入内部 transcript viewport
- `packages/coding-agent/src/modes/utils/ui-helpers.ts`
  - 在历史/恢复渲染时按 `messageEntryIds` 注册用户/助手消息锚点
- `packages/coding-agent/src/modes/controllers/extension-ui-controller.ts`
  - 把 `ctx.ui.scrollToEntryId` 转发到 interactive transcript
- 已新增局部测试：
  - `packages/coding-agent/src/modes/controllers/extension-ui-controller.test.ts`
  - `packages/coding-agent/test/modes/components/transcript-container.test.ts`

第二版修正点：

- 第一版只在 `TranscriptContainer` 内做 viewport，但 `chatContainer`、status、editor 仍是多个 TUI root children；TUI 根层仍会按完整 frame 尾部计算 `windowTop`，导致跳转后画面被重新压回底部。
- 第二版把 interactive root 收敛为单个固定高度布局组件，根 frame 长度稳定等于终端高度；跳转只改变 transcript 内部 viewport，不再触发根层尾部锚定。
- 该方案固定的是应用内部消息视图。终端原生滚动条属于终端 scrollback，不能稳定实现“拖动原生滚动条时输入框仍固定”。验收时应使用 PageUp/PageDown、鼠标滚轮或小白点跳转验证应用内部滚动。
- 固定布局会减少进入终端原生 scrollback 的内容；如果主界面没有启用 SGR mouse tracking，滚轮不会进入应用内部滚动，用户只能看到当前 viewport。因此第二版同时启用主界面 mouse tracking。

第三版修正点：

- 修复滚轮、PageDown 或消息跳转回到底部后仍停留在手动浏览模式的问题；只要 viewport 位于最大偏移量，后续新增消息和流式增长就恢复自动尾随。
- `FixedTranscriptLayout` 使用共享 `ScrollView` 在消息区右侧绘制内部滚动条；内容溢出时显示轨道和滑块，不溢出时不显示。
- 消息内容按扣除滚动条预留列后的宽度重新布局，避免滚动条覆盖最后一列文本，并保证锚点行号、跳转位置与实际换行一致。
- 内部滚动条用于显示当前位置；当前交互仍通过鼠标滚轮、PageUp/PageDown 和小白点跳转完成，不提供鼠标拖拽滑块。

## 源码定位清单

拿到源码后，优先用这些关键词定位实现位置：

```text
setWidget
aboveEditor
ExtensionContext
sessionManager
getBranch
scrollToEntryId
Composer
Input
MessageViewport
viewport
scroll
```

需要找到两类代码：

- 扩展上下文构造处：给 `ctx.ui` 注入 `scrollToEntryId`。
- TUI 布局/消息视口处：维护 entry id 到消息布局锚点的映射，并把 composer 固定在底部。

## 补丁一：scrollToEntryId

建议最小 API：

```ts
scrollToEntryId(entryId: string, options?: {
  align?: "start" | "center" | "end" | "nearest";
}): boolean
```

行为要求：

- 只滚动消息视图，不改变 session branch。
- 找到目标消息返回 `true`。
- 找不到目标消息返回 `false`。
- 不向扩展抛异常。
- 窗口 resize、消息换行、流式更新后，下一次跳转使用最新布局位置。

实现要点：

```text
entry.id
  -> entryIdToAnchor
  -> messageViewport.scrollTo(anchor)
```

`entryIdToAnchor` 必须在消息重排后刷新，不能依赖永久稳定的终端行号。

## 补丁二：固定输入框

目标结构：

```text
Header / Status
Message Scroll Viewport
AboveEditor Widgets
Composer / Input Box
```

行为要求：

- 输入框不进入消息 scrollback。
- 鼠标滚轮、PageUp、PageDown 只滚动消息区域。
- `aboveEditor` widget 固定在输入框上方。
- `scrollToEntryId` 只滚动消息区域。
- 跳转后输入框仍可直接输入。

## 应用流程

拿到源码后：

```powershell
cd <oh-my-pi-source>
git checkout -b local/message-nav-rail-patch
```

完成源码修改并修复 Git checkout 状态后生成补丁：

```powershell
$version = (Get-Content packages/coding-agent/package.json -Raw | ConvertFrom-Json).version
$patchPath = "F:\WebCode\message-nav-rail\patches\oh-my-pi\$version-scroll-to-entry-and-fixed-composer.patch"
$diffLines = @(git diff --binary upstream/main -- packages/coding-agent packages/tui)
$diffText = [string]::Join("`n", [string[]]$diffLines) + "`n"
[IO.File]::WriteAllText($patchPath, $diffText, [Text.UTF8Encoding]::new($false))
git apply --check --reverse $patchPath
```

如果当前 checkout 仍出现“大量 deleted/untracked”，不要执行上面的命令。应先重新 clone 干净源码，或修复 Git 索引后再生成。

以后重新应用：

```powershell
cd <oh-my-pi-source>
$version = "16.3.15" # 必须与目标源码版本一致
git apply "F:\WebCode\message-nav-rail\patches\oh-my-pi\$version-scroll-to-entry-and-fixed-composer.patch"
```

如果 Oh My Pi 版本变化导致补丁冲突，不要强行套用；先重新定位上述源码位置，再生成新版本补丁。

## 回滚流程

优先回滚到原版 `omp.exe`：

```powershell
Copy-Item <backup-omp.exe> C:\Users\Administrator\.local\bin\omp.exe -Force
```

源码仓库内回滚本地补丁：

```powershell
cd <oh-my-pi-source>
$version = "16.3.15" # 必须与当前补丁版本一致
git apply -R "F:\WebCode\message-nav-rail\patches\oh-my-pi\$version-scroll-to-entry-and-fixed-composer.patch"
```

## 验收清单

扩展稳定性：

- 小白点生成正常。
- `/resume` 后小白点继续正确生成。
- `Alt+Left` / `Alt+Right` 能移动选中。
- `Alt+/` 能预览选中消息。
- 删除或禁用本地补丁后，跳转静默失效，不弹错误。

本地补丁有效性：

- `Alt+1..9` 能滚动到对应消息。
- `Alt+Left` / `Alt+Right` 移动选中后能滚动到对应消息。
- 输入框在终端滚动时仍固定在底部。
- `aboveEditor` 小白点栏固定在输入框上方。
- 跳转后输入框仍可直接输入。
- 消息内容超过内部 viewport 时显示右侧滚动条，滑块位置随滚轮、PageUp/PageDown 和消息跳转同步变化。

当前行为说明：

- 固定输入框通过内部 transcript viewport 实现，浏览历史应依赖扩展跳转/后续内部滚动键，而不是终端原生 scrollback。
- PageUp/PageDown 已接入内部 viewport；编辑器有多行草稿时保留编辑器自己的翻页行为。
- 鼠标滚轮已按 SGR mouse wheel 接入内部 viewport；是否生效取决于终端/Oh My Pi TUI 是否向主界面发送 SGR mouse 事件。
- PageDown、滚轮或消息跳转回到底部后会恢复自动尾随，后续新增和流式增长的消息保持可见。
- 内容超过 viewport 高度时显示应用内部右侧滚动条；该滚动条是位置指示器，不依赖终端原生 scrollback，也不支持鼠标拖拽。
