@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Stahujem aktualne data (trva 1-3 minuty)...
node fetch.mjs
if errorlevel 1 (
  echo.
  echo Nastala chyba pri stahovani dat.
  pause
  exit /b 1
)
start "" "%~dp0site\index.html"
