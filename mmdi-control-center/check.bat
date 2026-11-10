@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed or not on PATH.& pause & exit /b 1)
node --check server.js
if errorlevel 1 (echo Syntax check failed.) else (echo Server syntax is valid.)
pause
