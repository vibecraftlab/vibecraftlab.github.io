@echo off
rem publish.bat - PUBLIC publish: branch check -> npm run check -> human confirm (type yes) -> npm run publish
rem   publish.bat                 commit message "publish: YYYY-MM-DD (N files)"
rem   publish.bat "post: title"   custom commit message
rem Publishing is IRREVERSIBLE (public git history). Humans only - never automate this.
rem File is ASCII-only on purpose: cmd mis-parses batch files containing multibyte text after chcp 65001.
chcp 65001 >nul
setlocal
cd /d "%~dp0.."
set RC=0
where node >nul 2>nul || (echo [ERROR] node not found. Install Node 24+. & set RC=1 & goto :end)

set "BR="
for /f "delims=" %%b in ('git branch --show-current') do set "BR=%%b"
if /i not "%BR%"=="main" (echo [ABORT] current branch is "%BR%", not main. Publish only from main. & set RC=1 & goto :end)

echo === 1/2 publish check: npm run check ===
call npm run check
if errorlevel 1 (echo. & echo [ABORT] something is blocked. Fix it and run again. & set RC=1 & goto :end)

echo.
echo *** Publishing is IRREVERSIBLE: it stays in the public repo's git history forever. ***
echo     Did you read the ok-list (pages going out) and the warnings (local paths etc.) above?
set "ANSWER="
set /p "ANSWER=Type yes to publish (anything else cancels): "
if /i not "%ANSWER%"=="yes" (echo [CANCELLED] nothing was published. & set RC=1 & goto :end)

echo.
echo === 2/2 publish: npm run publish %* ===
call npm run publish -- %*
set RC=%errorlevel%
echo.
if "%RC%"=="0" (echo [OK] pushed. Live at https://vibecraftlab.github.io/ in 1-2 min. Progress: https://github.com/vibecraftlab/vibecraftlab.github.io/actions) else (echo [FAILED] see output above. Check git status to see whether content/ was committed.)

:end
if not defined NOPAUSE pause
exit /b %RC%
