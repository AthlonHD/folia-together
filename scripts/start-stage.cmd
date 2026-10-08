@echo off
rem scripts/start-stage.cmd
rem One-click start for the "play on the server, remote control for everyone" setup.
rem Opens one window per service so each keeps its own log:
rem   1. Netease API   (port 4000)
rem   2. Stage relay   (port 4100)
rem   3. Frontend      (port 3000)  - production build served by "vite preview" (default, fast for visitors)
rem                                   or "vite dev" when started with --dev (slow: thousands of module requests)
rem Then it waits for the frontend and opens the playback host page (?host=1) in your normal Chrome.
rem Run this from the server's console desktop (RustDesk/ToDesk), NOT over RDP, so the sound goes to the console session.
rem
rem The Netease API is expected in %USERPROFILE%\api-enhanced. Otherwise run
rem   set API_DIR=D:\path\to\api-enhanced
rem first.
rem Flags (combine in any order):
rem   --dev         use "vite dev" instead of the production build
rem   --no-browser  do not open the host page
rem   --dry-run     only print what would be done
setlocal
for %%I in ("%~dp0..") do set "REPO=%%~fI"
if "%API_DIR%"=="" set "API_DIR=%USERPROFILE%\api-enhanced"
set "HOST_URL=http://localhost:3000/?host=1"

if not exist "%API_DIR%\app.js" (
    echo [ERROR] Netease API not found: "%API_DIR%\app.js"
    echo         Set API_DIR to the api-enhanced folder, e.g.  set API_DIR=D:\api-enhanced
    pause
    exit /b 1
)

rem No spaces before && - they would become part of the variable values.
set "API_CMD=set ENABLE_GENERAL_UNBLOCK=false&& set PORT=4000&& node app.js"
set "WEB_CMD=npm run stage:serve"
set "WEB_TITLE=Folia - Frontend build (3000)"
set "DRY_RUN="
set "NO_BROWSER="
rem Flags can be combined and given in any order.
for %%A in (%*) do (
    if /i "%%~A"=="--dev" (
        set "WEB_CMD=npm run dev"
        set "WEB_TITLE=Folia - Frontend dev (3000)"
    )
    if /i "%%~A"=="--dry-run" set "DRY_RUN=1"
    if /i "%%~A"=="--no-browser" set "NO_BROWSER=1"
)

rem Find Chrome (first hit wins); without it the default browser opens the page.
set "CHROME="
for %%P in ("%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "%LocalAppData%\Google\Chrome\Application\chrome.exe") do (
    if exist %%P if not defined CHROME set "CHROME=%%~P"
)

if defined DRY_RUN (
    echo [API  ] in "%API_DIR%": "%API_CMD%"
    echo [Relay] in "%REPO%": npm run stage:relay
    echo [Web  ] in "%REPO%": %WEB_CMD%
    if defined NO_BROWSER (
        echo [Host ] skipped ^(--no-browser^)
    ) else if defined CHROME (
        echo [Host ] wait for port 3000, then "%CHROME%" --autoplay-policy=no-user-gesture-required "%HOST_URL%"
    ) else (
        echo [Host ] wait for port 3000, then open "%HOST_URL%" in the default browser
    )
    exit /b 0
)

start "Folia - Netease API (4000)" /D "%API_DIR%" cmd /k "%API_CMD%"
start "Folia - Stage Relay (4100)" /D "%REPO%" cmd /k "npm run stage:relay"
start "%WEB_TITLE%" /D "%REPO%" cmd /k "%WEB_CMD%"

echo Started 3 windows. The frontend window builds first (a few seconds) before it listens on port 3000.

if defined NO_BROWSER goto done

echo Waiting for the frontend on port 3000 ...
powershell -NoProfile -Command "for ($i = 0; $i -lt 120; $i++) { try { Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000/' -TimeoutSec 2 | Out-Null; exit 0 } catch { Start-Sleep -Seconds 1 } }; exit 1"
if errorlevel 1 (
    echo [WARN] The frontend did not come up within 2 minutes. Check the frontend window, then open %HOST_URL% yourself.
    goto done
)

rem The autoplay flag only takes effect when Chrome is not already running; otherwise click the page once.
if defined CHROME (
    start "" "%CHROME%" --autoplay-policy=no-user-gesture-required "%HOST_URL%"
) else (
    start "" "%HOST_URL%"
)
echo Opened the host page: %HOST_URL%
echo If the music does not start by itself, click the page once to allow autoplay.

:done
endlocal
