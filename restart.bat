@echo off
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

where python >nul 2>&1
if errorlevel 1 ( echo [ERROR] Python not found. & pause & exit /b 1 )

set "PORT=8940"
if exist "%SCRIPT_DIR%port.txt" ( set /p PORT=<"%SCRIPT_DIR%port.txt" )

echo Killing server on port %PORT%...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort '%PORT%' -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -gt 0 } | Sort-Object OwningProcess -Unique | ForEach-Object { try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue; Write-Host ('Killed PID ' + $_.OwningProcess) } catch {} }"

ping -n 2 127.0.0.1 >nul

echo Starting server...
powershell -NoProfile -Command "$serverScript='%SCRIPT_DIR%scripts\local_server.py'; $projectRoot='%SCRIPT_DIR%.'; $serverArgs=('\"{0}\" --port {1} --root \"{2}\"' -f $serverScript,'%PORT%',$projectRoot); Start-Process -FilePath 'python' -ArgumentList $serverArgs -WindowStyle Hidden"

echo Waiting for server...
set /a TRIES=0
:wait
set /a TRIES+=1
if %TRIES% gtr 15 ( echo Timeout & goto end )
powershell -Command "try{Invoke-WebRequest -Uri 'http://127.0.0.1:%PORT%/' -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop|Out-Null;exit 0}catch{exit 1}" >nul 2>&1
if errorlevel 1 ( ping -n 2 127.0.0.1 >nul & goto wait )

echo Server ready!
start "" "http://127.0.0.1:%PORT%/"

:end
if not "%~1"=="--no-pause" pause
