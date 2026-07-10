@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%sync-oh-my-pi-upstream.ps1" %*
exit /b %ERRORLEVEL%
