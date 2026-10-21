@echo off
rem sync.bat - vault -> content/ (no commit, no push). If anything is blocked, content/ is left untouched.
rem File is ASCII-only on purpose: cmd mis-parses batch files containing multibyte text after chcp 65001.
chcp 65001 >nul
setlocal
cd /d "%~dp0.."
set RC=0
where node >nul 2>nul || (echo [ERROR] node not found. Install Node 24+. & set RC=1 & goto :end)

echo === vault to content/: npm run sync ===
call npm run sync
set RC=%errorlevel%
echo.
if "%RC%"=="0" (echo [OK] content/ updated. Commit + push is done by publish.bat. & git status --short content) else (echo [BLOCKED] content/ was not changed.)

:end
if not defined NOPAUSE pause
exit /b %RC%
