@echo off
REM ============================================================
REM  Rack & Ruin -> GitHub uploader
REM  Repo: https://github.com/ExKylebur/Rack-and-Ruin
REM
REM  Usage:  double-click this file, or run from a terminal:
REM            push-to-github.bat "optional commit message"
REM ============================================================
setlocal
cd /d "%~dp0"

REM --- make sure this folder is a git repo ---------------------
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo [error] This folder is not a git repository.
  pause
  exit /b 1
)

REM --- point 'origin' at the GitHub repo (add it if missing) ---
git remote get-url origin >nul 2>&1
if errorlevel 1 (
  echo [info] Adding remote 'origin'...
  git remote add origin https://github.com/ExKylebur/Rack-and-Ruin.git
)

REM --- commit any pending changes ------------------------------
set "MSG=%*"
if "%MSG%"=="" set "MSG=Update Rack and Ruin"
echo [info] Staging changes...
git add -A
git commit -m "%MSG%"
if errorlevel 1 echo [info] Nothing new to commit - pushing existing commits.

REM --- upload every local branch to GitHub ---------------------
echo [info] Pushing to GitHub...
git push -u origin --all
if errorlevel 1 (
  echo.
  echo [error] Push failed. Common causes:
  echo   - the GitHub repo already has commits ^(needs a pull/merge first^)
  echo   - you were not signed in ^(complete the browser/login prompt and retry^)
  pause
  exit /b 1
)

echo.
echo [done] Uploaded to https://github.com/ExKylebur/Rack-and-Ruin
pause
endlocal
