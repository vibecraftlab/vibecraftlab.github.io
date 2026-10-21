@echo off
rem verify.bat - full verification, nothing published or committed: 1) publish check 2) sync + hook tests 3) internal build.
rem Run after moving the toolchain, changing patterns/scripts/config, or setting up a new PC.
rem File is ASCII-only on purpose: cmd mis-parses batch files containing multibyte text after chcp 65001.
rem (the vault default path contains Korean, so it is resolved through node with \u escapes)
rem Set NOPAUSE=1 to skip the pause at the end.
chcp 65001 >nul
setlocal
cd /d "%~dp0.."
set RC=0
where node >nul 2>nul || (echo [ERROR] node not found. Install Node 24+. & set RC=1 & goto :end)
for /f "usebackq delims=" %%v in (`node -e "process.stdout.write(process.env.VAULT_PATH?process.env.VAULT_PATH:'G:\\\ub0b4 \ub4dc\ub77c\uc774\ube0c\\llm-wiki')"`) do set "VAULT_PATH=%%v"
if not exist "%VAULT_PATH%\CLAUDE.md" (echo [ERROR] vault not found at "%VAULT_PATH%" - set VAULT_PATH. & set RC=1 & goto :end)

echo === 1/3 publish check: npm run check ===
call npm run check
if errorlevel 1 (set RC=1 & echo. & echo [FAILED] 1/3 publish check - something is blocked. & goto :end)

echo.
echo === 2/3 tests: sync (21) + hooks (20) ===
node --test scripts\sync-public.test.mjs
if errorlevel 1 (set RC=1 & echo. & echo [FAILED] 2/3 sync tests. & goto :end)
node --test "%VAULT_PATH%\.claude\hooks\test-hooks.js"
if errorlevel 1 (set RC=1 & echo. & echo [FAILED] 2/3 hook tests. & goto :end)

echo.
echo === 3/3 internal build: npm run internal -- --once ===
call npm run internal -- --once
if errorlevel 1 (set RC=1 & echo. & echo [FAILED] 3/3 internal build. & goto :end)

set RC=0
echo.
echo [OK] check + tests + build all passed. Publish with publish.bat, browse with internal-serve.bat.

:end
if not defined NOPAUSE pause
exit /b %RC%
