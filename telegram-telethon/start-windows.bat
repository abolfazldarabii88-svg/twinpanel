@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-windows.ps1"
echo.
echo Launcher finished. Copy the error text above before closing this window.
pause
endlocal
