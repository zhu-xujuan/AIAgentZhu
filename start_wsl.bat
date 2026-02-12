@echo off
setlocal enabledelayedexpansion
echo ================================
echo AIAgent Startup Script (WSL Backend)
echo ================================
echo.

cd /d %~dp0

where wsl >nul 2>&1
if !errorlevel! neq 0 (
    echo ERROR: WSL is not installed or not in PATH.
    pause
    exit /b 1
)

for /f "delims=" %%i in ('wsl wslpath "%CD%"') do set WSL_PROJECT_DIR=%%i
if not defined WSL_PROJECT_DIR (
    echo ERROR: Failed to resolve WSL project path.
    pause
    exit /b 1
)

echo [1/4] Starting PostgreSQL with Docker Compose...
set DOCKER_COMPOSE=docker-compose
docker-compose version >nul 2>&1
if !errorlevel! neq 0 (
    set DOCKER_COMPOSE=docker compose
)
!DOCKER_COMPOSE! up -d postgres
if !errorlevel! neq 0 (
    echo WARNING: Failed to start PostgreSQL container. Continuing...
)
echo.

echo [2/4] Stopping old processes...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING" 2^>nul') do (
    taskkill /F /PID %%a >nul 2>&1
)
wsl bash -lc "pkill -f 'uvicorn src.main:app --host 0.0.0.0 --port 8001' >/dev/null 2>&1 || true"
echo.

echo [3/4] Starting backend in WSL (port 8001)...
start "AIAgent Backend (WSL)" wsl.exe bash -lc "cd \"!WSL_PROJECT_DIR!/backend\" && if [ -d venv ]; then source venv/bin/activate; fi && python3 -m uvicorn src.main:app --host 0.0.0.0 --port 8001 --reload; exec bash"
timeout /t 5 /nobreak >nul

echo [4/4] Starting frontend on Windows (port 3000)...
start "AIAgent Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"
echo.

echo ================================
echo Startup Complete!
echo ================================
echo.
echo Frontend: http://localhost:3000
echo Backend API: http://localhost:8001
echo Notes: Backend runs in WSL so Ollama URL can be accessed from WSL network.
echo.
pause
