@echo off
rem The older name for open-display.cmd, kept so existing shortcuts and launchers still work: the Dayspring screen on the
rem second screen, with the browser profile it has always used (its sign-ins live there).
set DS_SCREEN=secondary& set DS_PROFILE=DayspringTV& call "%~dp0open-display.cmd" %*
