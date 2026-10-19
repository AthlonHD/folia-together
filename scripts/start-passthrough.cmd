@echo off
rem scripts/start-passthrough.cmd
rem One-click for pass-through mode: installs missing tools (Node, Rust, MSVC), builds the WASAPI helper, lists devices, starts the app.
rem Usage: scripts\start-passthrough.cmd [-BuildOnly] [-NoStart]   (the work is in start-passthrough.ps1)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-passthrough.ps1" %*
exit /b %ERRORLEVEL%
