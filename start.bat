@echo off
setlocal

:: Usage: start.bat [port]
:: Starts Vite in the background, waits for the server to be ready, then opens the default browser.

set PORT=%1
if "%PORT%"=="" set PORT=5173

echo Starting Vite on port %PORT% (logs -> vite.log)...

:: Start the npm script in a background cmd instance and redirect output to a log file
:: Use npm run start:open so the npm scripts control Vite (keeps behavior consistent with package.json)
start "Vite" /B cmd /c "npm run start:open --silent -- --port %PORT% > vite.log 2>&1"

echo Waiting for server at http://localhost:%PORT% ...
set /a COUNT=0

:checkloop
	:: Attempt a quick HTTP request using PowerShell. Exit code 0 means success.
	powershell -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 -Uri 'http://localhost:%PORT%' | Out-Null; exit 0 } catch { exit 1 }"
	if %ERRORLEVEL%==0 goto launched
	timeout /t 1 >nul
	set /a COUNT+=1
	if %COUNT% GEQ 60 goto failed
	goto checkloop

:launched
echo Server is up. Opening browser...
start "" "http://localhost:%PORT%"
goto end

:failed
echo Timed out waiting for server. See vite.log for details.
type vite.log
echo Attempting to open browser anyway...
start "" "http://localhost:%PORT%"

:end
endlocal