@echo off
setlocal

cd /d "%~dp0"

echo Starting Virtual Agency Server...
echo.
virtual-agency-server.exe

echo.
echo Server stopped. Press any key to close.
pause >nul

