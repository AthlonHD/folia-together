@echo off
rem scripts/start-stage.cmd
rem One-click start for the "play on the server, remote control for everyone" setup.
rem Opens one window per service so each keeps its own log:
rem   1. Netease API   (port 4000)
rem   2. Stage relay   (port 4100)
rem   3. QQ Music API  (port 4300)
rem   4. KuGou API     (port 4400)
rem   5. Frontend      (port 3000)  - production build served by "vite preview" (default, fast for visitors)
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
rem Access token: the relay reads STAGE_TOKEN, or creates and saves one in %USERPROFILE%\.folia-stage\token on first start.
rem Everyone who wants to control this server (and the host page itself) needs it.
set "TOKEN_FILE=%USERPROFILE%\.folia-stage\token"
if defined STAGE_TOKEN_FILE set "TOKEN_FILE=%STAGE_TOKEN_FILE%"

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

rem Chrome flags for the host page. A window that is covered or in the background gets throttled
rem (timers slowed, renderer priority lowered) and the music stutters for a second at a time.
rem These flags turn that off; Chrome only reads them when it starts fresh (no chrome.exe running).
set "CHROME_FLAGS=--autoplay-policy=no-user-gesture-required --disable-renderer-backgrounding --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-features=CalculateNativeWinOcclusion"

rem Find Chrome (first hit wins); without it the default browser opens the page.
set "CHROME="
for %%P in ("%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "%LocalAppData%\Google\Chrome\Application\chrome.exe") do (
    if exist %%P if not defined CHROME set "CHROME=%%~P"
)

if defined DRY_RUN (
    echo [API  ] in "%API_DIR%": "%API_CMD%"
    echo [Relay] in "%REPO%": npm run stage:relay
    echo [QQ   ] in "%REPO%": npm run stage:qq
    echo [KuGou] in "%REPO%": npm run stage:kugou
    echo [Web  ] in "%REPO%": "%WEB_CMD%"
    if defined NO_BROWSER (
        echo [Host ] skipped ^(--no-browser^)
    ) else if defined CHROME (
        echo [Host ] wait for port 3000, then "%CHROME%" %CHROME_FLAGS% "%HOST_URL%"
    ) else (
        echo [Host ] wait for port 3000, then open "%HOST_URL%" in the default browser
    )
    exit /b 0
)

start "Folia - Netease API (4000)" /D "%API_DIR%" cmd /k "%API_CMD%"
start "Folia - Stage Relay (4100)" /D "%REPO%" cmd /k "npm run stage:relay"
start "Folia - QQ Music API (4300)" /D "%REPO%" cmd /k "npm run stage:qq"
start "Folia - KuGou API (4400)" /D "%REPO%" cmd /k "npm run stage:kugou"
start "%WEB_TITLE%" /D "%REPO%" cmd /k "%WEB_CMD%"

echo Started 5 windows. The frontend window builds first (a few seconds) before it listens on port 3000.

if defined NO_BROWSER goto done

echo Waiting for the frontend on port 3000 ...
powershell -NoProfile -Command "for ($i = 0; $i -lt 120; $i++) { try { Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000/' -TimeoutSec 2 | Out-Null; exit 0 } catch { Start-Sleep -Seconds 1 } }; exit 1"
if errorlevel 1 (
    echo [WARN] The frontend did not come up within 2 minutes. Check the frontend window, then open %HOST_URL% yourself.
    goto done
)

rem Read the access token (the relay has created it by now) and put it on the host page address.
set "TOKEN_VALUE=%STAGE_TOKEN%"
if not defined TOKEN_VALUE if exist "%TOKEN_FILE%" set /p TOKEN_VALUE=<"%TOKEN_FILE%"
if defined TOKEN_VALUE set "HOST_URL=%HOST_URL%&token=%TOKEN_VALUE%"

rem The autoplay flag only takes effect when Chrome is not already running; otherwise click the page once.
if defined CHROME (
    tasklist /FI "IMAGENAME eq chrome.exe" 2>nul | find /I "chrome.exe" >nul
    if not errorlevel 1 (
        echo [WARN] Chrome is already running, so it ignores the anti-throttling flags. If the music stutters
        echo        while the host window is in the background, close ALL Chrome windows and run this script again.
    )
    start "" "%CHROME%" %CHROME_FLAGS% "%HOST_URL%"
) else (
    start "" "%HOST_URL%"
)
echo Opened the host page.
if defined TOKEN_VALUE (
    echo.
    echo Access token: %TOKEN_VALUE%
    echo Visitors who want to control this server open  YOUR-ADDRESS/?token=%TOKEN_VALUE%
    echo or choose "Control the server" in Settings - Playback and type the token. Without it they play on their own device.
    echo The token is also shown on the host page under Settings - Playback - Playback location.
) else (
    echo [WARN] No access token found yet. Check the relay window, or the file %TOKEN_FILE%.
)
echo If the music does not start by itself, click the page once to allow autoplay.
echo The host page stops drawing the visuals while its window is not focused; click the window to bring them back.

:done
endlocal
