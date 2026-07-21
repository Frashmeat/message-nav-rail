# 消息导航栏扩展

为 Oh My Pi 提供会话消息导航栏，在输入框上方仅显示用户输入节点，并支持键盘选择、预览和跳转。

## 功能

- 使用 `●` 展示用户输入，模型消息和流式输出不生成节点。
- 使用 `Alt+←` / `Alt+→` 移动当前选择。
- 使用 `Alt+1` 至 `Alt+9` 选择当前可见范围内的消息。
- 使用 `Alt+/` 预览选中消息。
- 在宿主提供 `scrollToEntryId` 时跳转到对应会话条目。
- 用户节点由宿主 `message_start` / `message_end` 确认，`/help`、`!command` 等本地输入不会生成幽灵节点。
- 在 `session_switch` 时立即按当前 branch 重建，覆盖 `/resume`、新建、分叉和 handoff。

## 使用方式

项目入口是 `message-nav-rail.ts`，`package.json` 已通过 `omp.extensions` 声明该扩展。安装依赖后，可由支持 TypeScript 扩展的 Oh My Pi 环境直接加载项目目录。

```powershell
npm install
```

如需生成单文件 ESM 产物：

```powershell
npm run build
```

构建结果位于 `dist/message-nav-rail.mjs`，`dist/` 不纳入版本控制。

## 宿主要求

基础导航栏和消息预览仅依赖公开扩展接口。消息跳转需要 Oh My Pi UI 提供 `scrollToEntryId`；当前本地补丁、同步和部署方式见：

- `docs/oh-my-pi-local-patch-plan.md`
- `patches/oh-my-pi/README.md`

宿主不支持跳转或消息尚未持久化时，扩展会保留选中状态并显示警告，不会中断会话。

## 开发验证

```powershell
npm test
npm run typecheck
npm run build
```

建议先运行相关单元测试和类型检查，再按需执行构建及 Oh My Pi 集成验证。Oh My Pi 本地验证脚本位于 `scripts/`。

## 目录结构

- `src/index.ts`：扩展入口、事件同步和宿主集成。
- `src/collector.ts`：实时消息状态更新。
- `src/state.ts`：会话重建、选择和可见范围。
- `src/renderer.ts`：导航栏渲染。
- `src/shortcuts.ts`：快捷键行为。
- `test/`：单元与入口集成测试。

## Windows x64 预构建发布

当前可下载版本为 [GitHub prerelease `v17.0.6-custom.1`](https://github.com/Frashmeat/message-nav-rail/releases/tag/v17.0.6-custom.1)。第一阶段仅支持 Windows 10/11 x64（Intel/AMD x86-64），不支持 Windows ARM64 和 32 位 Windows。

该版本已完成 Windows x64 native/OMP 构建、内嵌 native 探测、Release 打包和静态完整性校验。发布 ZIP 的 SHA-256 为 `d5ddc67977494a65d634e439f7fe5227a583ef143d5117d42d58cd173eae1b12`。本机安装的二进制不会随源码升级或 Release 自动更新，仍需下载发布包并运行安装器。

解压发布包后可先只验证 manifest、包内文件清单和全部 SHA-256，不执行安装：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -ValidateOnly
```

覆盖升级会备份上一版 `installation.json`；卸载恢复上一版时也会恢复该清单，从而保留连续回滚能力。

本地生成测试包：

```powershell
.\scripts\package-release.ps1 -BundleVersion 17.0.6-custom.1
```

验证现有定制 `omp.exe` 的内嵌 native：

```powershell
.\scripts\probe-oh-my-pi-binary.ps1 -NativeVariant baseline -KeepWorkDir
.\scripts\probe-oh-my-pi-binary.ps1 -NativeVariant modern -KeepWorkDir
```

完整实施计划和验收 Checklist 见 `docs/windows-x64-github-release-plan.md`。
