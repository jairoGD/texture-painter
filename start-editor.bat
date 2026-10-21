@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is required to run Texture Painter.
  echo Install Node.js, then run this file again.
  pause
  exit /b 1
)

if not exist "node_modules\vite\bin\vite.js" (
  echo Project dependencies are missing.
  echo Run npm install in this folder once, then run this file again.
  pause
  exit /b 1
)

echo Starting Texture Painter...
echo Keep this window open while using the editor. Press Ctrl+C to stop the server.
call npm run dev -- --open

if errorlevel 1 pause
