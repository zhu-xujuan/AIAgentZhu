@echo off
setlocal enabledelayedexpansion
echo ================================
echo AIAgent Stop Script
echo ================================
echo.

echo Stopping all processes...
echo.

REM Detect docker compose command (docker-compose vs docker compose)
set DOCKER_COMPOSE=docker-compose
docker-compose version > nul 2>&1
if !errorlevel! neq 0 (
    set DOCKER_COMPOSE=docker compose
)

REM Stop PostgreSQL via Docker Compose
echo Stopping PostgreSQL database...
!DOCKER_COMPOSE! down
echo.

REM Kill all processes on port 8001 (Backend)
echo Stopping backend (port 8001)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8001" ^| findstr "LISTENING"') do (
    echo   Killing PID %%a
    taskkill /F /PID %%a >nul 2>&1
)

REM Kill all processes on port 3000 (Frontend)
echo Stopping frontend (port 3000)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo   Killing PID %%a
    taskkill /F /PID %%a >nul 2>&1
)

REM Kill any remaining node processes for frontend
taskkill /F /IM node.exe /FI "WINDOWTITLE eq AIAgent Frontend*" >nul 2>&1

echo.
echo ================================
echo All services stopped!
echo ================================
echo.
echo To restart: run start.bat
echo.
pause
