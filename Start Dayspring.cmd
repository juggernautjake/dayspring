@echo off
rem Starts Dayspring and opens its display on the screen you chose in Settings -> Screen.
rem The first time, it opens the setup wizard in your browser instead.
rem Already running? Then it just makes sure the display is open.
setlocal
cd /d "%~dp0"
if "%PORT%"=="" set PORT=4747
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

powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:%PORT%/api/build | Out-Null; exit 0 } catch { exit 1 }"
if %errorlevel%==0 goto opened

set DAYSPRING_DISPLAY=1
start "Dayspring server" /min cmd /k node --env-file-if-exists=.env server.mjs
rem wait for it to answer (up to 30 seconds)
powershell -NoProfile -Command "for ($i=0; $i -lt 30; $i++) { try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:%PORT%/api/build | Out-Null; exit 0 } catch { Start-Sleep 1 } }; exit 1"
if errorlevel 1 (
  echo Dayspring didn't start. Look at the "Dayspring server" window for the reason, or see docs\troubleshooting.md.
  pause
  exit /b 1
)

:opened
rem set up yet? (asks Dayspring; an older version without the wizard: a saved profile counts)
powershell -NoProfile -Command "try { $s = Invoke-RestMethod -TimeoutSec 3 http://127.0.0.1:%PORT%/api/setup/state; if ($s.setupDone -or $s.owner.setupDone) { exit 0 } else { exit 1 } } catch { if (Test-Path 'data\owner.json') { exit 0 } else { exit 1 } }"
if errorlevel 1 goto firstrun
goto display

:firstrun
rem first run: the guided setup. Microsoft Edge has the free natural voices the guide talks with, so it's used if present.
set EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe
if not exist "%EDGE%" set EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe
if exist "%EDGE%" (start "" "%EDGE%" --new-window http://localhost:%PORT%/welcome) else (start "" http://localhost:%PORT%/welcome)
rem and the display too, but only when there's a second screen for it
set DS_SCREEN=secondary

:display
call "%~dp0scripts\open-display.cmd" >nul
exit /b 0
