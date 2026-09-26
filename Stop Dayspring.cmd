@echo off
rem Stops Dayspring completely (the voice, alarms and reminders stop too). Start it again with the Dayspring icon.
rem You can also stop it from the Dayspring screen: move the pointer to the top edge, press the X, then "Quit Dayspring".
cd /d "%~dp0"
where node >nul 2>nul || ( echo Dayspring needs Node.js. & pause & exit /b 1 )
node scripts\launch.mjs --stop
timeout /t 3 /nobreak >nul
