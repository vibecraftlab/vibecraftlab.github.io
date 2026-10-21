@echo off
rem site-serve.bat - build the PUBLIC blog from content/ with site/build.mjs and preview it on this PC only.
rem Opens http://127.0.0.1:8090 . Run sync.bat first if the vault changed. Nothing is pushed.
rem File is ASCII-only on purpose: cmd mis-parses batch files containing multibyte text after chcp 65001.
chcp 65001 >nul
setlocal
cd /d "%~dp0.."
where node >nul 2>nul || (echo [ERROR] node not found. Install Node 24+. & if not defined NOPAUSE pause & exit /b 1)

echo === public blog preview: npm run site:serve  (Ctrl+C to stop) ===
start "" http://127.0.0.1:8090
call npm run site:serve
set RC=%errorlevel%
if not defined NOPAUSE pause
exit /b %RC%
