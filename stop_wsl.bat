@echo off
setlocal enabledelayedexpansion
echo ================================
echo AIAgent Stop Script (WSL Backend)
echo ================================
echo.

echo Stopping frontend (port 3000)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING" 2^>nul') do (
    taskkill /F /PID %%a >nul 2>&1
)

echo Stopping backend in WSL (uvicorn 8001)...
wsl bash -lc "pkill -f 'uvicorn src.main:app --host 0.0.0.0 --port 8001' >/dev/null 2>&1 || true"

echo Stopping PostgreSQL container...
set DOCKER_COMPOSE=docker-compose
docker-compose version >nul 2>&1
if !errorlevel! neq 0 (
    set DOCKER_COMPOSE=docker compose
)
!DOCKER_COMPOSE! down

echo.
echo All services stopped.
echo.
pause
