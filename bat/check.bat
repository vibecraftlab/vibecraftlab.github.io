@echo off
rem check.bat - publish lint only (read-only). Shows what would go out (ok), what is blocked (x), warnings (!).
rem File is ASCII-only on purpose: cmd mis-parses batch files containing multibyte text after chcp 65001.
chcp 65001 >nul
setlocal
cd /d "%~dp0.."
set RC=0
where node >nul 2>nul || (echo [ERROR] node not found. Install Node 24+. & set RC=1 & goto :end)

echo === publish check: npm run check ===
call npm run check
set RC=%errorlevel%
echo.
if "%RC%"=="0" (echo [OK] nothing blocked. Read the warnings and the ok-list, then run publish.bat.) else (echo [BLOCKED] fix the x items above before publishing.)

:end
if not defined NOPAUSE pause
exit /b %RC%
