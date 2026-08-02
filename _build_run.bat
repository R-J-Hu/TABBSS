@echo off
cd /d "D:\Downloads\CurrentVersion"
"C:\Python314\python.exe" "D:\Downloads\CurrentVersion\scripts\build_release.py" --edition audit --os windows
echo.
echo Build finished. Press any key to close.
pause >nul
