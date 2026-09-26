@echo off
rem Starts Dayspring and opens its screen on the screen you chose in Settings -> Screen (the first time: the guided setup).
rem Dayspring itself runs hidden, so this window closes by itself in a moment. Already running? Its window comes back
rem instead of a second copy opening. The "Dayspring" shortcut does the same without showing this window at all.
rem Stop Dayspring: the X at the top of its screen, then "Quit Dayspring" (or "Stop Dayspring.cmd").
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Dayspring needs Node.js. Run "Install Dayspring.cmd" first.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Getting Dayspring ready ^(first run^)...
  call npm install --omit=dev --no-audit --no-fund || ( echo Installing failed. Check your internet connection and try again. & pause & exit /b 1 )
)
if not exist .env if exist .env.example copy .env.example .env >nul
node scripts\launch.mjs
if errorlevel 1 (
  echo.
  echo Dayspring didn't start. The reason is in data\logs\server.log, and docs\troubleshooting.md explains the usual ones.
  pause
  exit /b 1
)
exit /b 0
