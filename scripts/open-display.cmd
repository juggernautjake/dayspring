@echo off
rem Opens (or brings back) the Dayspring screen on the chosen screen (Settings -> Screen), in the chosen browser.
rem Dayspring must be running; this waits up to half a minute for it. It never opens a second window.
rem Overrides: DS_SCREEN (auto / primary / secondary / a number), PORT.
rem Exit code 1 = Dayspring isn't running, or the chosen screen isn't connected.
node "%~dp0launch.mjs" --open-display
