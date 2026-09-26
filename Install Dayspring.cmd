@echo off
rem Installs Dayspring on this computer:
rem   1. checks for Node.js 22.9 or newer (and offers to install it with winget if it's missing)
rem   2. downloads Dayspring's parts (npm install)
rem   3. creates your private settings file (.env) for keys you may add later
rem   4. adds Dayspring to the Start menu and the desktop, and (if you want) starts it with Windows
rem Nothing personal leaves your computer. Run it again any time; it's safe.
setlocal
cd /d "%~dp0"
title Install Dayspring
echo.
echo   Dayspring installer
echo   -------------------
echo.

rem ---- 1. Node.js
set NODE_OK=0
where node >nul 2>nul && node -e "const [a, b] = process.versions.node.split('.').map(Number); process.exit(a > 22 || (a === 22 && b >= 9) ? 0 : 1)" && set NODE_OK=1
if "%NODE_OK%"=="1" goto node_ok
echo Dayspring needs Node.js 22.9 or newer, and it isn't installed (or it's too old).
where winget >nul 2>nul || goto node_manual
choice /c YN /m "Install Node.js LTS now with winget (Microsoft's installer)"
if errorlevel 2 goto node_manual
winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements
echo.
echo Node.js is installed. Close this window and run "Install Dayspring.cmd" again so Windows picks it up.
pause
exit /b 0
:node_manual
echo Get it from https://nodejs.org (the "LTS" button), install it, then run this again.
start "" https://nodejs.org/en/download
pause
exit /b 1
:node_ok
for /f %%v in ('node -v') do echo [ok] Node.js %%v

rem ---- 2. parts
echo Downloading Dayspring's parts (a minute or two)...
call npm install --omit=dev --no-audit --no-fund
if errorlevel 1 (
  echo Installing failed. Check your internet connection and run this again.
  pause
  exit /b 1
)
echo [ok] Parts installed

rem ---- 3. private settings file
if not exist .env (
  copy .env.example .env >nul
  echo [ok] Created .env ^(your keys go here, or add them in the setup wizard^)
) else echo [ok] Keeping your existing .env
if not exist data mkdir data

rem ---- 4. shortcuts
set HERE=%~dp0
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$w = New-Object -ComObject WScript.Shell; $here = $env:HERE.TrimEnd('\');" ^
  "$menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Dayspring'; New-Item -ItemType Directory -Force $menu | Out-Null;" ^
  "function mk($path, $target, $desc) { $s = $w.CreateShortcut($path); $s.TargetPath = $target; $s.WorkingDirectory = $here; $s.IconLocation = (Join-Path $here 'dayspring.ico'); $s.Description = $desc; $s.WindowStyle = 7; $s.Save() }" ^
  "mk (Join-Path $menu 'Dayspring.lnk') (Join-Path $here 'Start Dayspring.cmd') 'Start Dayspring';" ^
  "mk (Join-Path $menu 'Update Dayspring.lnk') (Join-Path $here 'Update Dayspring.cmd') 'Check for a newer Dayspring';" ^
  "$u = $w.CreateShortcut((Join-Path $menu 'Dayspring Settings.url')); $u.TargetPath = 'http://localhost:4747/setup'; $u.Save();" ^
  "$u = $w.CreateShortcut((Join-Path $menu 'Dayspring Help.url')); $u.TargetPath = 'http://localhost:4747/help'; $u.Save();" ^
  "mk (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Dayspring.lnk') (Join-Path $here 'Start Dayspring.cmd') 'Start Dayspring'"
echo [ok] Added Dayspring to the Start menu and the desktop

choice /c YN /m "Start Dayspring automatically when you sign in to Windows"
if errorlevel 2 (
  del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Dayspring.lnk" >nul 2>nul
  goto done
)
powershell -NoProfile -Command "$w = New-Object -ComObject WScript.Shell; $s = $w.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Startup')) 'Dayspring.lnk')); $s.TargetPath = (Join-Path $env:HERE 'Start Dayspring.cmd'); $s.WorkingDirectory = $env:HERE; $s.WindowStyle = 7; $s.IconLocation = (Join-Path $env:HERE 'dayspring.ico'); $s.Save()"
echo [ok] Dayspring will start when you sign in

:done
echo.
echo Dayspring is installed (the plain version: no settings yet).
echo Next, Dayspring's guided setup opens in your browser and talks you through the rest (about 10 minutes).
choice /c YN /m "Start Dayspring now"
if errorlevel 2 exit /b 0
call "%~dp0Start Dayspring.cmd"
