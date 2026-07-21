# message-nav-rail

## 这是什么

message-nav-rail 是 Oh My Pi 的会话导航扩展。它会在输入框上方用白点显示用户输入，模型回复不会生成节点；选中白点后可以预览内容并跳转到对应消息。

当前预构建版本包含定制 `omp.exe` 和扩展，仅支持 Windows 10/11 x64（Intel/AMD），不支持 Windows ARM64 和 32 位 Windows。

## 怎么安装

1. 从 [`v17.0.6-custom.2` Release](https://github.com/Frashmeat/message-nav-rail/releases/tag/v17.0.6-custom.2) 下载 `message-nav-rail-omp-17.0.6-custom.2-windows-x64.zip` 和对应的 `.zip.sha256` 文件。
2. 解压 ZIP，并关闭所有正在运行的 `omp.exe`。
3. 在解压目录打开 PowerShell，先校验安装包：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -ValidateOnly
```

4. 校验通过后执行安装：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

安装器会备份现有 OMP，安装定制 `omp.exe` 和 message-nav-rail 扩展，并自动验证版本和 native 功能。安装完成后重新打开终端即可使用。

## 怎么使用

运行 Oh My Pi：

```powershell
omp
```

- 每个白点代表一条用户输入；模型回复和流式输出不会显示白点。
- 按 `Alt+←` / `Alt+→` 选择上一条或下一条用户输入，并跳转到对应消息。
- 按 `Alt+1` 至 `Alt+9` 直接选择当前可见范围内的第 1 至第 9 条用户输入。
- 按 `Alt+/` 预览当前选中的用户输入。
- 使用 `PageUp` / `PageDown` 或鼠标滚轮滚动消息区域；回到底部后会继续自动跟随新消息。
