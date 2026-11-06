@echo off
title CardioShield-AgeLess Application
color 0F
cls
echo =====================================================================
echo                 CardioShield-AgeLess Healthcare System               
echo =====================================================================
echo.
echo Starting CardioShield-AgeLess Python Flask Server...
echo.

cd /d "%~dp0"

REM Check for python
where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    set PY_CMD=py
    goto START_SERVER
)

where python >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    set PY_CMD=python
    goto START_SERVER
)

echo [WARNING] Python was not found in your PATH.
echo You can still run the entire application using VS Code Live Server!
echo The onboard Calibrated ML model will run directly inside your browser.
echo.
pause
exit /b

:START_SERVER
echo [OK] Python detected (%PY_CMD%).
echo [OK] Opening CardioShield in your browser: http://127.0.0.1:8080
echo.
timeout /t 2 >nul
start http://127.0.0.1:8080

echo =====================================================================
echo Flask is running on port 8080. Press Ctrl+C to stop.
echo If Flask is ever stopped, the app will continue to work seamlessly!
echo =====================================================================
echo.
%PY_CMD% server.py
pause

