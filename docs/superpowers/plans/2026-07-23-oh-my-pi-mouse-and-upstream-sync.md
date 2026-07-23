# Oh My Pi 鼠标交互修复、导航栏优化与上游版本同步计划

**日期：** 2026-07-23
**状态：** `v17.0.8` 源码同步、鼠标修复、导航栏新消息自动选中、补丁再生成、自动化验证和合并提交已完成；合并提交为 `813e4db05`，真实 Windows Terminal 手动验收待执行。Oh My Pi 完整构建、部署和发布仍未执行。
**源码基线：** 当前维护分支 `message-nav-rail` 的工作树已合入 Oh My Pi `v17.0.8`，上游基线提交 `5e362714fe3cdbecb16bc177067af20ba18d8c83`。
**已解析目标：** 上游最新正式标签 `v17.0.8`，提交 `5e362714fe3cdbecb16bc177067af20ba18d8c83`；不采用标签之后的 `upstream/main`。
**事实来源：** `ohmypi/oh-my-pi-clean` 中的 Oh My Pi Git 源码；本机安装目录和已编译 `omp.exe` 只用于最终验收，不作为修改来源。

## 1. 当前理解

message-nav-rail 扩展只负责消息采集、白点导航和调用宿主提供的跳转能力。固定输入框、transcript viewport、鼠标滚轮和终端鼠标协议属于 Oh My Pi TUI/interactive 层，不应在扩展中通过 escape sequence 或鼠标模拟实现。

导航栏当前在新增用户小点和 branch 刷新时保留旧 `selectedIndex`，因此最新小点不会自动高亮。该行为属于扩展自身状态管理，应在 message-nav-rail 内修复，不需要扩大 Oh My Pi 补丁。自动选中只改变导航栏状态，不自动调用 `scrollToEntryId`，避免把 transcript 切入手动滚动并干扰后续 assistant 输出的尾随。

当前两个鼠标现象来自同一个交互约束：

1. 主界面永久开启 `1000 + 1003 + 1006` SGR mouse tracking 后，终端把普通鼠标拖拽交给 TUI，原生文本选择需要终端提供的修饰键旁路，通常是 `Shift + 拖拽`。
2. 实体滚轮依赖终端发送 SGR wheel report，再由 Oh My Pi 把事件路由到内部 transcript viewport。当前单元测试覆盖了理想输入，但主界面不需要的 `1003` 全移动追踪和不完整的 start/stop 恢复契约会增加事件噪声与状态失配风险。

终端协议不能在同一时刻让无修饰键拖拽由终端原生选区处理，同时让滚轮由 TUI 内部 viewport 处理。若强制要求无修饰键选区，只能新增“选择模式/滚动模式”切换或实现应用级文本选择；两者都明显扩大改动范围。

## 2. 目标与非目标

### 目标

- 以 Oh My Pi 最新稳定标签为新基线，不追踪未发布的上游 `main`。
- 保持输入框固定、消息区内部滚动、PageUp/PageDown 和白点跳转。
- 让受支持终端中的实体滚轮稳定滚动 transcript viewport。
- 保留终端原生文本复制路径，明确使用 `Shift + 拖拽` 绕过应用鼠标追踪。
- 用户真正提交并生成新小点时，导航栏自动选中最新小点并将其纳入可见窗口。
- 把 Oh My Pi 实现改动限制在鼠标协议和输入路由的最小范围。
- 从维护源码生成版本化补丁；不手改生成补丁来反向替代源码修改。

### 非目标

- 不实现应用级文本选择、跨行 ANSI/CJK 选区和剪贴板管理。
- 不实现右侧 scrollbar thumb 的点击或拖拽；它继续只表示位置。
- 新小点自动选中时不主动跳转或重定位 transcript；是否返回消息区底部作为独立需求处理。
- 不修改本机已安装 `omp.exe`、插件目录或终端配置。
- 不在未授权时提交、推送、构建完整二进制、部署或发布 Release。

## 3. 上游版本同步

### 3.1 确定最新稳定版本

1. 确认根仓库与 `ohmypi/oh-my-pi-clean` 工作区干净。
2. 从 `upstream` 获取分支和标签，不推送到 `origin`。
3. 按语义版本排序标签，排除 prerelease，选取最新正式 `vX.Y.Z`。
4. 核对目标标签提交、`packages/coding-agent/package.json` 版本和 changelog。
5. 如果没有比 `v17.0.6` 更新的正式标签，停止版本迁移，只执行鼠标修复计划并报告事实。

2026-07-23 调查结果：最新正式版本为 `v17.0.8`。无写入 merge-tree 预检发现 4 个内容冲突，集中在 `input-controller.ts`、`interactive-mode.ts`、`types.ts` 和 `ui-helpers.ts`；其余定制文件可自动合并或不与上游变化重叠。

### 3.2 合并维护分支

1. 比较 `v17.0.6..目标标签` 对当前定制文件的影响。
2. 先执行无提交合并或等价的冲突预检，记录冲突文件。
3. 只解决与现有定制补丁重叠的冲突，不清理或重构范围外上游代码。
4. 在用户明确授权 Git 提交后，才完成维护分支 merge commit；未经授权不推送 fork。

### 3.3 本轮执行结果

- 已获取并选择最新正式标签 `v17.0.8`，没有追踪标签之后的 `upstream/main`。
- 已完成合并，4 处内容冲突均同时保留上游新增能力与现有 transcript 定制；当前无未解决冲突，合并提交为 `813e4db05`。
- 已从 `v17.0.8` 到维护工作树的真实差异重新生成维护补丁和 Windows x64 发布补丁；纳入鼠标生命周期修复后的 SHA-256 均为 `37dc67539893b6713c4682c567c49d6aaae7951d75ebf0ac78530e8ca33ecdb0`。
- 补丁已在干净 `v17.0.8` 工作树通过正向 `git apply --check`，并在维护工作树通过反向检查。
- Oh My Pi 鼠标、输入、transcript 和 TUI 渲染定向测试 204 项通过；根仓库测试 66 项、TypeScript typecheck 和扩展单文件构建通过，本轮 Oh My Pi 文件的局部 Biome 检查通过。
- 已实施第 4 节鼠标协议修复和第 5 节导航栏自动选中，并完成 Oh My Pi 合并提交；尚未执行 Oh My Pi 完整构建、部署或发布。

## 4. 最小鼠标修复

预计只修改以下 Oh My Pi 实现文件：

### `packages/tui/src/tui.ts`

- 把 fullscreen pointer tracking 与普通主界面 tracking 分开：
  - fullscreen overlay 保持 `1000 + 1003 + 1006`，继续支持 hover、click 和 wheel；
  - 主界面只启用 `1000 + 1006`，接收 button/wheel report，不启用不必要的 any-motion `1003`。
- 明确区分“期望的主界面追踪状态”和“终端当前已启用状态”。
- `stop()` 时关闭实际鼠标追踪；后续 `start()` 时若主界面仍需要追踪则重新开启。
- fullscreen overlay 进入和退出时正确切换、恢复主界面追踪模式。

### `packages/coding-agent/src/modes/controllers/input-controller.ts`

- 编辑器聚焦且收到有效 SGR mouse report 时：
  - wheel report 滚动 transcript 并消费；
  -主界面不使用的 click/release report 直接消费，避免继续进入编辑器。
- 非编辑器焦点和 fullscreen overlay 继续由当前焦点组件处理，不抢占其鼠标行为。

`packages/coding-agent/src/modes/interactive-mode.ts` 继续只声明主界面需要 mouse tracking；除非新上游改变 API，否则不扩大该文件修改。

## 5. 导航栏新消息自动选中

该优化只修改 message-nav-rail 扩展，不修改 Oh My Pi：

### `src/collector.ts`

- 真正追加用户消息时，把 `selectedIndex` 设置为新消息的末尾索引。
- 第一条新消息直接显示为选中态；连续追加时选中随最新小点前移。

### `src/index.ts`

- 在 `message_start`、`message_end` 和 live branch 刷新之间区分“真正新增小点”“重复确认”和“临时 ID 替换为真实 entry id”。
- 只有真正新增小点时自动选中最新项；重复事件、延迟去重和锚点 ID 替换不得再次抢占用户选择。
- `session_start`、`session_switch` 加载的历史小点维持既有未选中行为，不把会话恢复误判为新消息。
- 自动选中只触发导航栏重绘，不调用 `navigateToMessage` 或 `scrollToEntryId`；快捷键显式选择仍按既有逻辑跳转。

预期状态示例：

```text
新建第一条：◉
连续追加：  ● ◉  →  ● ● ◉
恢复历史：  ● ●  （保持未选中）
```

## 6. 补丁与项目文件同步

源码迁移完成后：

1. 从“目标稳定标签 → 维护源码工作树/提交”生成新的版本化补丁。
2. 同步生成同内容的维护补丁与 Windows x64 发布补丁。
3. 更新补丁 SHA-256、目标上游提交和版本说明。
4. 更新以下跟随版本的项目文件：
   - `patches/oh-my-pi/README.md`
   - `docs/oh-my-pi-local-patch-plan.md`
   - `docs/windows-x64-github-release-plan.md`
   - `.github/workflows/build-windows-x64.yml`
   - `test/workflow.test.ts`
5. 根 README 的下载链接只在新 Release 实际发布后更新；源码同步阶段不得把尚未发布的版本描述为可下载版本。

## 7. 验证

### 必须执行的针对性验证

- TUI mouse parser、mouse tracking 和 input-controller 测试。
- 新增主界面不启用 `1003` 的协议测试。
- 新增 `start → stop → start` 追踪恢复测试。
- 新增非 wheel mouse report 不进入 editor 的路由测试。
- transcript viewport 滚动、到底恢复自动尾随、PageUp/PageDown 和 entry jump 测试。
- 新增用户小点自动选中最新项，且长会话可见窗口随选中项移动。
- 重复 `message_end`、延迟 branch 刷新和临时 ID 替换不重复抢占选择。
- session 恢复只加载历史小点，不自动选中；自动选中不调用 transcript 跳转接口。
- 新版本补丁在目标稳定标签干净树上的 `git apply --check`。
- 根扩展的 `npm test`、`npm run typecheck` 和 `npm run build`。

### 手动验收

- Windows Terminal 中实体滚轮只滚动消息区，输入框保持固定。
- `Shift + 拖拽` 可以选中文本并复制。
- PageUp/PageDown 和白点跳转正常。
- fullscreen selector 的 wheel、click、hover 不回归。
- 退出、打开外部编辑器、返回 TUI 后鼠标状态一致。

### 需要额外授权的验证

- Oh My Pi 全量测试或完整 workspace check。
- native addon 和 Windows x64 `omp.exe` 完整构建。
- 本机部署、安装器升级/回滚验证和 GitHub Actions/Release。

## 8. 风险与回退

- 传统 Console Host 或不支持 SGR mouse 的终端仍可能无法把实体滚轮交给 TUI；此时 PageUp/PageDown 是保底路径，不能通过扩展层模拟修复。
- 即使移除主界面 `1003`，只要 `1000` tracking 开启，无修饰键原生拖拽选择仍受终端协议限制；这是已知取舍，不应误报为完全恢复直接选择。
- 新消息到达时会按已确认需求覆盖导航栏中的历史选中项；去重或锚点替换不得被误判为新消息，否则会造成重复抢选中。
- 如果最新上游已经重构 transcript layout 或 mouse routing，应优先采用上游结构并缩减本地补丁，而不是强行保留旧实现。
- 合并冲突无法安全解决时，保留当前 `v17.0.6` 分支不动，在独立工作树验证新基线；不得重置、覆盖或清理用户工作。
- 发布补丁始终可以回退到已验证的 `17.0.6-custom.2`，本轮不删除历史补丁和发布资产。

## 9. 完成条件

- 最新稳定 Oh My Pi 基线和提交已被明确记录。
- 维护源码在新基线上只保留必要定制差异。
- 鼠标协议、生命周期和滚轮路由有可观察测试保护。
- 真正新增用户小点会自动选中最新项，历史恢复、重复事件和 transcript 尾随不回归。
- 新版本补丁能在干净上游标签上应用，并与维护源码差异一致。
- 所有已执行与未执行验证均有记录；未提交、未部署、未发布的状态不被描述为已完成。
