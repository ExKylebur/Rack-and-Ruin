@echo off
REM ============================================================
REM  Rack & Ruin - launch the game
REM
REM  Double-click this file. It starts the local server (needed
REM  because the game uses ES modules, which browsers block when
REM  you open the .html directly from disk) and opens your browser.
REM  Close the server window to stop the game.
REM ============================================================
cd /d "%~dp0"

REM pick a Python command that exists
set "PY=python"
where python >nul 2>&1
if errorlevel 1 (
  where py >nul 2>&1
  if errorlevel 1 (
    echo [error] Python was not found on PATH. Install Python 3 and try again.
    pause
    exit /b 1
  )
  set "PY=py"
)

echo Starting Rack ^& Ruin server on http://localhost:8000 ...
start "Rack and Ruin server" cmd /c %PY% "server\multiplayer_server.py" --port 8000

REM give the server a moment, then open the browser
timeout /t 2 /nobreak >nul
start "" "http://localhost:8000/"

echo.
echo The game is open in your browser.
echo A separate window is running the server - close it to stop the game.
