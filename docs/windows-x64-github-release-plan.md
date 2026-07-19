# Windows x64 GitHub Release 实施计划

## 结论

第一阶段只支持 **Windows 10/11 x64**，适用于 Intel、AMD 的 x86-64 处理器。通过 GitHub prerelease 分发非官方定制 Oh My Pi，不支持 Windows ARM64、32 位 Windows、macOS 和 Linux。

目标电脑只需下载 Release ZIP 并运行 PowerShell 安装器，不需要 Git、Node.js、npm、Bun、Rust、Visual Studio 或 Oh My Pi 源码。

## 当前理解

本项目交付物由三个必须保持兼容的组件组成：

1. 定制版 `omp.exe`：提供消息跳转 API 和固定输入框布局。
2. `message-nav-rail` 扩展：提供消息导航栏、快捷键、预览和跳转调用。
3. native addon：是否需要作为外置文件发布，必须通过干净环境实验确认。

三个组件必须作为一个 bundle 构建、发布、安装、升级和回滚，不能独立混用不同版本。

当前构建基线为 Oh My Pi `17.0.5`：锁定 `can1357/oh-my-pi` 稳定标签对应提交 `9fd6e97113f5ed3a847e66d346970efdf8afcad9`，再应用 `patches/oh-my-pi/17.0.5-release-windows-x64.patch`。这使 GitHub Actions 不依赖尚未推送的本地 fork 合并提交。

GitHub Windows runner 的 workspace 位于 `D:`，而 Bun 全局缓存通常位于 `C:`。Bun 1.3.14 存在编译目标跨盘移动失败的问题（Bun issue #28327），因此工作流将 `BUN_INSTALL_CACHE_DIR` 固定到 `${{ github.workspace }}/.tmp/bun-cache`，让下载、解压和最终缓存位于同一卷。

## 发布状态（2026-07-17）

- 构建 Action [`29553749190`](https://github.com/Frashmeat/message-nav-rail/actions/runs/29553749190) 已成功，源码提交为 `d7e9d6bee9512327fd6e8a195989c857a734c57e`。
- [`v17.0.1-custom.1`](https://github.com/Frashmeat/message-nav-rail/releases/tag/v17.0.1-custom.1) 已发布为 prerelease。
- Release 资产为 `message-nav-rail-omp-17.0.1-custom.1-windows-x64.zip` 及对应 `.zip.sha256`。
- 发布 ZIP 的 SHA-256 为 `c3349134b0e52c7f144cc75e392b9e559b8bfb98eb225f5789b5a7107acf1f1a`。
- 首个 prerelease 已完成构建、打包和静态完整性验收；独立 Windows 10/11 目标机的安装、升级与故障回滚验收仍待执行。

## 上游升级状态（2026-07-19）

- 本地维护分支已合并官方稳定版 `v17.0.5`，上游提交为 `9fd6e97113f5ed3a847e66d346970efdf8afcad9`。
- `17.0.5` 的维护补丁和发布补丁内容一致，SHA-256 均为 `f8e69e485c820c0cd166b98766003e3e132d4d8cc412d8ff4a459fc52321e905`。
- 两个补丁均已在官方 `v17.0.5` 干净工作树上通过 `git apply --check`。
- Transcript 固定视口、滚动条、主界面鼠标跟踪及 fullscreen overlay 定向测试通过；Windows ConPTY 的 4 个全量重绘时序回归测试连续两轮通过，`render-regressions.test.ts` 全部 102 项通过，`bun run check` 通过。
- 尚未执行 native 构建、`omp.exe` 构建、部署或发布 `17.0.5-custom.1`；上一份可下载 prerelease 仍是 `17.0.1-custom.1`。

## 支持范围

### 支持

- Windows 10 x64。
- Windows 11 x64。
- Intel x86-64 处理器。
- AMD x86-64 处理器。
- 64 位 PowerShell 5.1 或 PowerShell 7。
- GitHub Release ZIP 离线安装。

### 暂不支持

- Windows ARM64。
- 32 位 Windows/x86/IA-32。
- macOS。
- Linux。
- 自动静默升级。
- Windows Authenticode 代码签名。
- 无人值守企业级部署。

## 主要矛盾

发布流程的主要矛盾是：**开发机上的构建产物可以运行，不等于 Release 包能在没有源码、构建工具和 native 缓存的干净电脑上独立运行。**

第一突破口是验证上游 Windows x64 Release 构建产物是否已经正确内嵌 native addon。该结论决定 ZIP 内容、安装路径、备份范围和回滚逻辑。

## 目标架构

```mermaid
flowchart LR
    A["message-nav-rail commit"] --> C["GitHub Actions Windows x64"]
    B["Oh My Pi upstream commit"] --> C
    P["17.0.5 定制补丁"] --> C
    C --> D["构建 omp.exe"]
    C --> E["构建 message-nav-rail.mjs"]
    D --> F["native 自包含探测"]
    E --> G["Release 打包"]
    F --> G
    G --> H["GitHub prerelease"]
    H --> I["Windows x64 安装器"]
    I --> J["备份 → 安装 → 验证 → 提交"]
    J --> K["失败自动回滚"]
```

## Release 版本规则

组合版本采用：

```text
v<upstream-version>-custom.<revision>
```

示例：

```text
v17.0.1-custom.1
v17.0.1-custom.2
v17.0.5-custom.1
```

每个版本必须锁定：

- message-nav-rail commit。
- Oh My Pi upstream commit。
- 定制补丁 SHA-256。
- Oh My Pi 上游版本。
- Bun 版本。
- Rust toolchain。
- Windows runner 信息。

## 预计 Release 内容

最终内容由 native 自包含实验决定。

### 理想结构：native 已内嵌

```text
message-nav-rail-omp-17.0.5-custom.1-windows-x64.zip
├─ omp.exe
├─ extension/
│  ├─ message-nav-rail.mjs
│  └─ package.json
├─ install.ps1
├─ uninstall.ps1
├─ manifest.json
├─ SHA256SUMS.txt
├─ README.txt
└─ LICENSES/
   └─ oh-my-pi-LICENSE.txt
```

### 备选结构：需要外置 native

在理想结构基础上增加：

```text
natives/
├─ pi_natives.win32-x64-baseline.node
└─ pi_natives.win32-x64-modern.node
```

不得在实验完成前假定只需要 `omp.exe`。

## native 自包含调查结论（2026-07-13）

本节证据来自此前构建的 `16.3.15` 二进制，用于记录内嵌 native 发布结构的早期可行性调查；下列版本输出仅属于该历史验证，不是 17.0.1 的验收结果。

调查证据：

- 上游 Windows x64 Release 构建目标是 `bun-windows-x64-modern`，构建前执行 `bun run gen:native`。
- 当前定制 `omp.exe` 内包含 `embedded-addons.win32-x64.tar.gz` 元数据和 `pi_natives.win32-x64-baseline.node`，记录大小为 132,817,920 字节。
- loader 在 compiled binary 模式下将内嵌 addon 提取到隔离用户目录的 `.omp/natives/16.3.15/`。
- 使用 `scripts/probe-oh-my-pi-binary.ps1` 在隔离 `HOME`、无既有 native 缓存条件下运行成功。
- `omp.exe --version` 返回 `omp/16.3.15`。
- `omp.exe grep` 成功搜索测试文件，证明真实 native 能力已加载。
- 强制 `PI_NATIVE_VARIANT=modern` 时仍能安全回退并提取 baseline。

调查结论：

- 现状是：当前 Windows x64 定制二进制已内嵌 baseline native addon，但运行时仍会将其提取到用户缓存目录。
- 关键约束是：目标用户目录必须可写，安装/健康检查必须允许首次启动生成 `.omp/natives/<version>/`。
- 我之前不知道但现在知道的是：Release 不需要额外携带 `.node` 文件，单个 `omp.exe` 能在无外部缓存条件下完成提取并执行真实 native 功能。
- 基于以上，我的判断是：第一版 ZIP 使用“内嵌 native”结构；安装器需要验证提取结果，但无需独立安装或备份 native 文件。

### 17.0.1 发布构建验收（2026-07-17）

GitHub Actions run `29553749190` 已在 Windows x64 runner 上完成 native、`omp.exe`、扩展、baseline/modern 内嵌 native 探测及 Release 打包。下载 Action Artifact 后完成了以下独立校验：

- Artifact 外层 ZIP SHA-256 与 GitHub API digest 一致。
- 发布 ZIP 与独立 `.sha256` 一致，SHA-256 为 `c3349134b0e52c7f144cc75e392b9e559b8bfb98eb225f5789b5a7107acf1f1a`。
- bundle 包含 `omp.exe`、扩展、安装/卸载脚本、manifest、许可证、说明和内部校验清单。
- `manifest.json` 记录 `bundleVersion=17.0.1-custom.1`、`upstreamVersion=17.0.1`、目标源码提交和 Oh My Pi 基线。
- `SHA256SUMS.txt` 中 8 个文件的内部 SHA-256 全部复核通过。


## 分阶段实施

### 阶段 1：范围与基线

目标：建立可追溯的发布输入和版本规则。

完成条件：发布平台、组件边界、版本命名和 commit 锁定方式全部明确。

### 阶段 2：native 自包含验证

目标：证明构建出的 `omp.exe` 在干净 HOME、无源码、无 `.omp/natives` 缓存条件下是否可以运行真实 native 功能。

实验至少包含：

1. 使用上游官方 Windows binary 构建脚本生成定制 `omp.exe`。
2. 创建隔离的临时 `HOME`、`USERPROFILE` 和安装目录。
3. 确保隔离环境没有源码、`node_modules` 和已有 native 缓存。
4. 运行 `omp.exe --version`。
5. 执行能够确定加载 native addon 的轻量探测。
6. 检查运行过程中是否创建或读取外部 native 文件。
7. 删除构建目录后再次执行探测。
8. 记录最终必须打包的运行时文件清单。

完成条件：能够用证据回答“Release 是否需要外置 native 文件”。

### 阶段 3：打包、安装和回滚

目标：实现 Windows x64 的事务式安装。

安装事务：

```text
预检查 → manifest schema 校验 → 包内文件与 SHA-256 清单一一核对
→ 备份 → 临时复制 → 原子替换
→ 安装扩展/native → 启动探测 → 写入安装清单
```

解压后可先运行 `install.ps1 -ValidateOnly`，只验证 manifest、文件覆盖率、路径安全和 SHA-256，不修改本机状态。覆盖升级会备份旧 `installation.json`；失败回滚或手动恢复上一版时一并恢复该清单，保留连续回滚链。

任何后续步骤失败时：

```text
停止安装 → 恢复 omp.exe → 恢复 native → 恢复扩展 → 验证旧版本
```

完成条件：首次安装、覆盖升级、失败回滚和手动卸载均有自动化测试或可复现验证记录。

### 阶段 4：GitHub Actions

目标：在 GitHub 托管 Windows runner 上完成可重复构建与打包。

第一版采用手动 `workflow_dispatch`，输入至少包括：

- bundle version。
- Oh My Pi upstream commit。
- 是否创建 prerelease。

所有 dispatch 输入必须先映射为步骤环境变量，再作为单独参数传给 PowerShell 或 Git；禁止把 `${{ inputs.* }}` 直接插值进 `run` 代码块。Oh My Pi ref 在 checkout 前按 commit 或合法 branch 校验。

工作流必须：

1. 检出两个指定 commit。
2. 固定 Bun 和 Rust toolchain。
3. 构建 native 和定制 `omp.exe`。
4. 构建扩展单文件产物。
5. 运行定向测试和类型检查。
6. 执行 native 自包含探测。
7. 生成 manifest、许可证目录和 SHA-256。
8. 生成 Windows x64 ZIP。
9. 先上传 Actions artifact。
10. 经人工确认后创建 GitHub prerelease。

完成条件：同一输入可稳定生成结构一致、哈希可验证的安装包。

2026-07-17，run `29553749190` 已完成一次成功构建和 Artifact 校验。prerelease 由人工确认产物后使用 GitHub CLI 创建，自动创建 Release 的工作流仍未实现。

### 阶段 5：干净环境验收

目标：在没有开发环境的 Windows x64 电脑或 VM 上验证最终体验。

干净环境必须满足：

- 没有项目源码。
- 没有 Oh My Pi 源码。
- 没有 Bun、Rust、Visual Studio 构建环境。
- 没有旧 `.omp/natives` 缓存，或明确记录已有安装状态。

完成条件：只使用 GitHub Release 资产完成安装、功能验证、升级和回滚。

### 阶段 6：首个 prerelease

目标：发布 `v17.0.1-custom.1`。

完成状态：已于 2026-07-17 发布为 GitHub prerelease；稳定版转换所需的独立目标机验收仍未完成。

正式稳定版的转换条件：

- 至少两台独立 Windows x64 环境安装成功。
- 至少一次从旧版本升级成功。
- 至少一次故障注入回滚成功。
- Release 哈希、许可证和源码 commit 信息完整。

## Checklist

### A. 发布基线

- [x] 明确只支持 Windows 10/11 x64。
- [x] 明确支持 Intel/AMD x86-64。
- [x] 明确不支持 Windows ARM64 和 32 位 Windows。
- [x] 明确第一版使用 GitHub prerelease。
- [x] 明确组合版本格式 `v<upstream>-custom.<revision>`。
- [x] 确认首个 Release 使用的 Oh My Pi 版本：`17.0.1`。
- [x] 确认首个 Release 使用的 Oh My Pi upstream commit：`b0d04e517335ada4e00ef8dc93aad9f4d1be8d21`。
- [ ] 确认首个 Release 使用的 message-nav-rail commit。

### B. native 自包含性

- [x] 阅读并记录上游 Windows binary 构建参数。
- [x] 阅读并记录 native embed/loader 的实际路径。
- [x] 建立隔离 HOME 的本地探测脚本。
- [x] 在无 `.omp/natives` 缓存时运行基础探测。
- [x] 确定一个真实加载 native 的探测动作。
- [x] 记录探测读取和生成的外部文件。
- [ ] 删除源码及构建目录后重复探测。
- [x] 决定 Release 是否携带外置 native：第一版不额外携带，`omp.exe` 内嵌 baseline 并运行时提取。
- [x] 验证 modern 请求会安全回退到内嵌 baseline；第一版无需外置变体。

### C. 打包产物

- [x] 新增 `scripts/package-release.ps1`。
- [x] 构建 `message-nav-rail.mjs`。
- [x] 复制定制 `omp.exe`。
- [x] 根据实验结果复制 native 文件。
- [x] 生成 `manifest.json`。
- [x] 生成 `SHA256SUMS.txt`。
- [x] 收集 Oh My Pi MIT License。
- [ ] 收集需要随包分发的第三方许可证。
- [x] 生成离线 `README.txt`。
- [x] 生成版本化 Windows x64 ZIP。
- [ ] 检查 ZIP 中不存在源码缓存、密钥和个人绝对路径。

### D. 安装器

- [x] 新增 `scripts/install-release.ps1`。
- [x] 检查 Windows、OS x64 和 64 位 PowerShell。
- [x] 检查安装包结构和 manifest schema。
- [x] 校验包内文件与 `SHA256SUMS.txt` 一一对应，拒绝遗漏、重复和目录越界条目。
- [x] 支持 `-ValidateOnly` 只执行 manifest 和 SHA-256 校验。
- [ ] 检查目标目录写权限。
- [x] 检查 `omp.exe` 是否正在运行。
- [x] 备份旧 `omp.exe`。
- [ ] 备份旧 native 文件。
- [x] 备份或记录旧扩展状态。
- [x] 使用临时文件原子替换 `omp.exe`。
- [x] 从永久目录安装扩展。
- [x] 执行基础版本探测。
- [x] 执行真实 native 探测。
- [x] 保存 `installation.json`。
- [x] 安装失败自动回滚。
- [x] 失败回滚时恢复上一版 `installation.json`。
- [ ] 安装输出不泄露敏感路径或凭据。

### E. 卸载与回滚

- [x] 新增 `scripts/uninstall-release.ps1`。
- [x] 支持恢复最近一次备份。
- [x] 恢复二进制和扩展；native 由内嵌二进制按版本自行提取。
- [ ] 支持仅移除定制扩展；当前卸载入口要求 `-RestorePrevious` 并恢复完整安装前状态。
- [x] 覆盖升级回滚时恢复上一版 `installation.json`，保留连续回滚链。
- [ ] 保留备份的默认行为明确。
- [x] 没有可用备份时拒绝破坏性恢复。
- [x] 回滚后重新执行健康检查。

### F. GitHub Actions

- [x] 新增 `.github/workflows/build-windows-x64.yml`。
- [x] 使用 `workflow_dispatch`。
- [x] dispatch 输入通过环境变量传递，不直接插值进 PowerShell `run` 块。
- [x] checkout 前校验 Oh My Pi commit/branch ref。
- [x] 锁定 Oh My Pi upstream commit，并应用版本化定制补丁。
- [x] 固定 Bun 版本。
- [ ] 固定 Rust MSVC toolchain。
- [x] 运行定向测试和类型检查。
- [x] 构建 Windows x64 `omp.exe`。
- [x] 构建扩展单文件产物。
- [x] 执行 native 自包含探测。
- [x] 调用 Release 打包脚本。
- [x] 上传 Actions artifact。
- [ ] 新增创建 prerelease 的发布步骤或独立工作流。
- [x] 配置最小 GitHub Actions 权限。
- [ ] 对第三方 Actions 固定版本或 commit。
- [x] 记录两个源码 commit 和工具链版本。

### G. Release 内容

- [x] Release 标题明确“非官方定制构建”。
- [x] Release Notes 标明上游版本。
- [x] Release Notes 标明 Windows x64 限制。
- [x] Release Notes 标明 Intel/AMD x86-64 支持。
- [x] Release Notes 标明不支持 ARM64 和 32 位 Windows。
- [x] 上传 ZIP。
- [x] 上传独立 SHA-256 文件。
- [x] 上传或附带许可证。
- [x] 标记为 prerelease。
- [x] 公布安装和回滚命令。

### H. 干净环境验收

- [ ] Windows 10 x64 安装验证。
- [ ] Windows 11 x64 安装验证。
- [ ] Intel x64 环境验证。
- [ ] AMD x64 环境验证，或明确记录尚未覆盖。
- [ ] 无构建工具环境验证。
- [ ] 无 native 缓存环境验证。
- [ ] 删除 Release 解压目录后扩展仍可用。
- [ ] 消息导航显示正常。
- [ ] Alt+方向键选择正常。
- [ ] Alt+/ 预览正常。
- [ ] 消息跳转正常。
- [ ] 固定输入框正常。
- [x] 隔离目录中的升级安装成功。
- [ ] 故障注入触发自动回滚。
- [x] 隔离目录中的手动卸载恢复成功。

## 风险门禁

以下任一条件未满足时，不创建正式稳定 Release：

- native 自包含性没有明确结论。
- Release 文件清单不能从干净环境实验推导。
- 安装器没有在失败后恢复旧版本。
- `omp.exe`、native 和扩展无法证明版本一致。
- 缺少 Oh My Pi MIT License。
- manifest 或 SHA-256 缺失。
- 没有在独立 Windows x64 环境完成安装验证。

## 验收标准

### 构建验收

- GitHub Actions 在 Windows runner 上成功构建。
- 测试和类型检查通过。
- 产物记录完整 commit 和工具链信息。
- ZIP 内容可重复生成且结构固定。

### 安装验收

- 目标电脑不需要开发工具。
- 安装前完成 SHA-256 校验。
- 已有安装得到完整备份。
- 安装后基础探测和 native 探测通过。
- 解压目录删除后仍能正常使用。

### 功能验收

- 导航栏显示用户、模型和流式消息状态。
- 快捷键选择、预览和消息跳转正常。
- 固定输入框布局正常。

### 恢复验收

- 人为制造安装失败后能够自动恢复。
- 手动卸载能够恢复安装前版本。
- 回滚后旧版本通过健康检查。
- 覆盖升级回滚后恢复上一版安装清单，并能继续执行更早版本的受管回滚。

## 当前阶段

当前首个 prerelease 已完成，处于 **阶段 5：独立 Windows x64 干净环境验收**；正式稳定版转换条件仍未全部满足。
