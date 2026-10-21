@echo off
rem typecheck.bat - Quartz's own checks (upstream "check"): tsc --noEmit + prettier --check. Only needed after editing Quartz code/config.
rem File is ASCII-only on purpose: cmd mis-parses batch files containing multibyte text after chcp 65001.
chcp 65001 >nul
setlocal
cd /d "%~dp0.."
set RC=0
where node >nul 2>nul || (echo [ERROR] node not found. Install Node 24+. & set RC=1 & goto :end)

echo === quartz typecheck: npm run typecheck ===
call npm run typecheck
set RC=%errorlevel%
echo.
if "%RC%"=="0" (echo [OK] tsc + prettier passed.) else (echo [FAILED] formatting issues can be fixed with: npm run format)

:end
if not defined NOPAUSE pause
exit /b %RC%
