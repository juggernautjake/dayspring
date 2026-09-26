@echo off
rem Opens the Dayspring display on the chosen screen (Settings -> Screen, saved as "display" in data\owner.json).
rem   On a second screen (a TV, a monitor, a tablet-style display...): full screen, no browser bars.
rem   On your main screen: a normal app window, so your desktop is never taken over.
rem Overrides: DS_SCREEN (auto / primary / secondary / a number), DS_PROFILE (browser profile folder name), PORT.
rem Exit code 1 = the chosen screen isn't connected (nothing was opened).
setlocal
if "%PORT%"=="" set PORT=4747
if "%DS_PROFILE%"=="" set DS_PROFILE=DayspringDisplay
rem Already open (maybe hidden or minimized)? Bring that window back instead of opening a second one.
powershell -NoProfile -Command "try { $r = Invoke-RestMethod -Method Post -TimeoutSec 20 -ContentType 'application/json' -Uri http://127.0.0.1:%PORT%/api/window -Body (@{action='show'} | ConvertTo-Json); if ($r.found -gt 0) { exit 0 } else { exit 1 } } catch { exit 1 }"
if %errorlevel%==0 exit /b 0
set SX=
for /f "usebackq tokens=1-5" %%a in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pick-screen.ps1"`) do (
  set SX=%%a
  set SY=%%b
  set SW=%%c
  set SH=%%d
  set SP=%%e
)
if "%SX%"=="" (
  echo The screen chosen for Dayspring isn't connected. Plug it in and set Windows to "Extend" ^(Win+P^), or pick another screen in Settings.
  exit /b 1
)
rem Which browser shows the display: DS_BROWSER, else "displayBrowser" in data\owner.json (chrome / edge), else Chrome.
rem Edge brings Microsoft's free "Natural" voices; Chrome is the default.
if "%DS_BROWSER%"=="" for /f "usebackq delims=" %%b in (`powershell -NoProfile -Command "try { (Get-Content '%~dp0..\data\owner.json' -Raw | ConvertFrom-Json).displayBrowser } catch { }"`) do set DS_BROWSER=%%b
set BROWSER=
set EDGE="%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
set CHROME="%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if /i "%DS_BROWSER%"=="edge" (set ORDER=%EDGE% %CHROME%) else (set ORDER=%CHROME% %EDGE%)
for %%p in (%ORDER%) do (
  if not defined BROWSER if exist %%p set BROWSER=%%~p
)
if "%BROWSER%"=="" (
  echo Dayspring needs Google Chrome or Microsoft Edge to show its display.
  start "" http://localhost:%PORT%/display
  exit /b 0
)
set FLAGS=--app=http://localhost:%PORT%/display --user-data-dir="%LOCALAPPDATA%\%DS_PROFILE%" --autoplay-policy=no-user-gesture-required --use-fake-ui-for-media-stream --no-first-run --disable-session-crashed-bubble --disable-features=Translate --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding
if "%SP%"=="1" (
  start "" "%BROWSER%" %FLAGS% --window-position=%SX%,%SY% --window-size=%SW%,%SH% --start-maximized
) else (
  start "" "%BROWSER%" %FLAGS% --kiosk --window-position=%SX%,%SY%
)
exit /b 0
