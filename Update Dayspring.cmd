@echo off
rem Checks for a newer Dayspring and installs it if you say yes. Your data (the data folder) and your keys (.env)
rem are never touched, and your current version is backed up to backups\ first.
cd /d "%~dp0"
where node >nul 2>nul || ( echo Dayspring needs Node.js. Run "Install Dayspring.cmd" first. & pause & exit /b 1 )
node --env-file-if-exists=.env scripts\update.mjs %*
echo.
pause
