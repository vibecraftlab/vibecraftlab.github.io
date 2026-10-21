@echo off
rem internal-build.bat - build the internal wiki once (no server): whole vault -> public/.
rem "Warning: couldn't find git repository for <vault>" is harmless (the vault is Drive-synced, not git).
rem File is ASCII-only on purpose: cmd mis-parses batch files containing multibyte text after chcp 65001.
chcp 65001 >nul
setlocal
cd /d "%~dp0.."
set RC=0
where node >nul 2>nul || (echo [ERROR] node not found. Install Node 24+. & set RC=1 & goto :end)

echo === internal build: npm run internal -- --once ===
call npm run internal -- --once
set RC=%errorlevel%
echo.
if "%RC%"=="0" (echo [OK] output in public\. To browse it run internal-serve.bat.) else (echo [FAILED] build error. On a fresh clone the first build may fail while @quartz-themes/default installs - run once more.)

:end
if not defined NOPAUSE pause
exit /b %RC%
