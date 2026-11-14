@echo off
setlocal
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
if exist "release\speaker-update\win-unpacked\Meeting Companion.exe" (
  start "" "release\speaker-update\win-unpacked\Meeting Companion.exe"
  exit /b
)
if exist "release\win-unpacked\Meeting Companion.exe" (
  start "" "release\win-unpacked\Meeting Companion.exe"
  exit /b
)
if exist "node_modules\electron\dist\electron.exe" (
  start "" "node_modules\electron\dist\electron.exe" "."
  exit /b
)
echo Please install dependencies and run npm run build, or extract the release ZIP.
pause
