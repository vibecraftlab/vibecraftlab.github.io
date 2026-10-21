@echo off
rem internal-serve.bat - internal wiki: build whole vault with Quartz (--watch) and serve on 127.0.0.1:8080 ONLY.
rem Stop with Ctrl+C (answer Y to "Terminate batch job?"). Nothing is committed or pushed.
rem Optional env: PORT=8081   VAULT_PATH=D:\path\llm-wiki
rem File is ASCII-only on purpose: cmd mis-parses batch files containing multibyte text after chcp 65001.
chcp 65001 >nul
setlocal
cd /d "%~dp0.."
set RC=0
where node >nul 2>nul || (echo [ERROR] node not found. Install Node 24+. & set RC=1 & goto :end)
if not defined PORT set PORT=8080

echo === internal wiki: npm run internal  ^(http://127.0.0.1:%PORT%^) ===
echo     edits in the vault are rebuilt automatically. Ctrl+C to stop.
echo.
call npm run internal
set RC=%errorlevel%

:end
if not defined NOPAUSE pause
exit /b %RC%
