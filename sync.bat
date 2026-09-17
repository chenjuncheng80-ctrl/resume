@echo off
rem Pull the latest published content into this folder, so the copy of
rem index.html on your disk matches what the admin published to GitHub.
rem Publishing updates GitHub (and the site at resume-coral-iota.vercel.app);
rem it does not touch this folder. That is why this file exists.

cd /d "%~dp0"

git pull --ff-only origin main
if errorlevel 1 (
  echo.
  echo Pull failed - usually local edits that were never committed.
  echo Open this folder in a terminal and run: git status
) else (
  echo.
  echo Done. Reopen index.html to see the latest content.
)

echo.
pause
