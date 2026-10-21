@echo off
rem test.bat - regression tests: publish sync (21) + vault write hook (20). Run both after touching patterns.js.
rem File is ASCII-only on purpose: cmd mis-parses batch files containing multibyte text after chcp 65001.
rem (the vault default path contains Korean, so it is resolved through node with \u escapes)
rem Set NOPAUSE=1 to skip the pause at the end.
chcp 65001 >nul
setlocal
cd /d "%~dp0.."
set RC=0
where node >nul 2>nul || (echo [ERROR] node not found. Install Node 24+. & set RC=1 & goto :end)
for /f "usebackq delims=" %%v in (`node -e "process.stdout.write(process.env.VAULT_PATH?process.env.VAULT_PATH:'G:\\\ub0b4 \ub4dc\ub77c\uc774\ube0c\\llm-wiki')"`) do set "VAULT_PATH=%%v"

echo === 1/2 sync tests: node --test scripts\sync-public.test.mjs ===
node --test scripts\sync-public.test.mjs
set RC=%errorlevel%
if not "%RC%"=="0" (echo. & echo [FAILED] sync tests. & goto :end)

echo.
echo === 2/2 hook tests: node --test "%VAULT_PATH%\.claude\hooks\test-hooks.js" ===
if not exist "%VAULT_PATH%\.claude\hooks\test-hooks.js" (echo [ERROR] vault not found at "%VAULT_PATH%" - set VAULT_PATH. & set RC=1 & goto :end)
node --test "%VAULT_PATH%\.claude\hooks\test-hooks.js"
set RC=%errorlevel%
echo.
if "%RC%"=="0" (echo [OK] sync + hook tests passed.) else (echo [FAILED] hook tests.)

:end
if not defined NOPAUSE pause
exit /b %RC%
