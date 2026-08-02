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

:: 用 PowerShell 更可靠地杀掉占着端口的旧进程（杀掉 pythonw 和 python 两种）
powershell -Command "Get-NetTCPConnection -LocalPort '%PORT%' -ErrorAction SilentlyContinue | ForEach-Object { try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue; Write-Host ('Killed PID ' + $_.OwningProcess) } catch {} }"

echo.
echo Project: %SCRIPT_DIR%
echo Port: %PORT%
echo URL: http://127.0.0.1:%PORT%/
echo.

:: 用 PowerShell Start-Process 启动服务器，最小化运行（无弹窗）
powershell -Command "Start-Process -FilePath '%PY_CMD%' -ArgumentList '%SCRIPT_DIR%scripts\local_server.py','--port','%PORT%','--root','%SCRIPT_DIR%' -WindowStyle Minimized -PassThru | Out-Null"

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
echo 完成！请等待浏览器打开报站器.
echo To stop the server: open Task Manager and end the 'python' process.
pause
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
