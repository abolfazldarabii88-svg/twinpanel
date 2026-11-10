@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required.
  echo Install it from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)
rem Route Node.js HTTPS requests through the local Psiphon HTTP proxy.
rem Psiphon must be connected before starting this dashboard.
set "NODE_USE_ENV_PROXY=1"
set "HTTPS_PROXY=http://127.0.0.1:65354"
set "HTTP_PROXY=http://127.0.0.1:65354"
set "NO_PROXY=127.0.0.1,localhost"
echo Starting Mmdi Control Center...
echo Psiphon proxy: http://127.0.0.1:65354
echo Keep this window open while using the panel.
echo Open http://127.0.0.1:4317 in your browser.
node server.js
echo.
echo Mmdi Control Center stopped.
pause
