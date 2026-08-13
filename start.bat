@echo off
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

call :find_python
if not defined PY_CMD (
    echo [ERROR] Python not found.
    goto :fail
)

set "PORT=8940"
if exist "%SCRIPT_DIR%port.txt" (
    set /p PORT=<"%SCRIPT_DIR%port.txt"
)

:: Stop the previous server without attempting to terminate PID 0.
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort '%PORT%' -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -gt 0 } | Sort-Object OwningProcess -Unique | ForEach-Object { try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue; Write-Host ('Killed PID ' + $_.OwningProcess) } catch {} }"

echo.
echo Project: %SCRIPT_DIR%
echo Port: %PORT%
echo URL: http://127.0.0.1:%PORT%/
echo.

:: Quote script and project paths because the workspace path contains spaces.
powershell -NoProfile -Command "$serverScript='%SCRIPT_DIR%scripts\local_server.py'; $projectRoot='%SCRIPT_DIR%.'; $serverArgs=('\"{0}\" --port {1} --root \"{2}\"' -f $serverScript,'%PORT%',$projectRoot); Start-Process -FilePath '%PY_CMD%' -ArgumentList $serverArgs -WindowStyle Hidden -PassThru | Out-Null"

echo Waiting for server...
set /a RETRIES=0
:wait_loop
set /a RETRIES+=1
if %RETRIES% gtr 20 (
    echo [FAIL] Timeout - server did not start.
    goto :fail
)
powershell -Command "try{Invoke-WebRequest -Uri 'http://127.0.0.1:%PORT%/' -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop|Out-Null;exit 0}catch{exit 1}" >nul 2>&1
if errorlevel 1 (
    ping -n 2 127.0.0.1 >nul
    goto wait_loop
)

echo Server ready!
start "" "http://127.0.0.1:%PORT%/"
echo.
echo Done. The browser should open the simulator shortly.
echo To stop the server: open Task Manager and end the 'python' process.
if not "%~1"=="--no-pause" pause
goto :eof

:find_python
where python >nul 2>&1
if not errorlevel 1 ( set "PY_CMD=python" & goto :eof )
where python3 >nul 2>&1
if not errorlevel 1 ( set "PY_CMD=python3" & goto :eof )
where py >nul 2>&1
if not errorlevel 1 ( set "PY_CMD=py" & goto :eof )
goto :eof

:fail
pause
exit /b 1
