@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%setup-oh-my-pi-bun-and-verify.ps1" -BuildNative %*
exit /b %ERRORLEVEL%
