@echo off
rem Automate on Windows: double-click this file, or run `start.cmd [command]` in a terminal.
rem It runs start.ps1 with -ExecutionPolicy Bypass for this one process, so it works on a
rem machine where running PowerShell scripts is disabled. Commands: see start.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
set AUTOMATE_EXIT=%ERRORLEVEL%
rem Keep the window open when double-clicked, so the URL and the sign-in key can be read.
echo %CMDCMDLINE% | find /i "/c" >nul && pause
exit /b %AUTOMATE_EXIT%
