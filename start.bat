@echo off
setlocal enabledelayedexpansion
echo ================================
echo AIAgent Startup Script
echo ================================
echo.

cd /d %~dp0

REM Check Docker status
echo [1/4] Checking Docker status...
docker info > nul 2>&1
if !errorlevel! neq 0 (
    echo Docker is not running. Starting Docker Desktop...
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    echo Waiting for Docker to start...
    call :wait_for_docker
    if !errorlevel! neq 0 (
        echo ERROR: Docker failed to start after 2 minutes.
        echo WARNING: Continuing without PostgreSQL. Database features will be disabled.
        goto skip_postgres
    )
)
echo Docker is running.
echo.

REM Detect docker compose command (docker-compose vs docker compose)
set DOCKER_COMPOSE=docker-compose
docker-compose version > nul 2>&1
if !errorlevel! neq 0 (
    set DOCKER_COMPOSE=docker compose
)
echo Using: !DOCKER_COMPOSE!

REM Start PostgreSQL via Docker Compose
echo Starting PostgreSQL database...
!DOCKER_COMPOSE! up -d postgres
if !errorlevel! neq 0 (
    echo WARNING: Failed to start PostgreSQL. Database features will be disabled.
    goto skip_postgres
)
echo PostgreSQL container started.
echo Waiting for PostgreSQL to be ready...
call :wait_for_postgres
echo Additional wait for PostgreSQL initialization...
timeout /t 5 /nobreak > nul
echo.

:skip_postgres
echo.

REM Stop existing processes more aggressively
echo Stopping existing processes...

REM Kill all processes on port 8001
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8001" ^| findstr "LISTENING" 2^>nul') do (
    echo Stopping process %%a on port 8001...
    taskkill /F /PID %%a >nul 2>&1
)

REM Kill all processes on port 3000
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING" 2^>nul') do (
    echo Stopping process %%a on port 3000...
    taskkill /F /PID %%a >nul 2>&1
)

REM Kill all processes on port 3030 (Slidev Preview)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3030" ^| findstr "LISTENING" 2^>nul') do (
    echo Stopping process %%a on port 3030...
    taskkill /F /PID %%a >nul 2>&1
)

REM Also kill any python processes running uvicorn
taskkill /F /IM python.exe /FI "WINDOWTITLE eq AIAgent Backend*" >nul 2>&1

REM Wait for processes to fully stop
timeout /t 3 /nobreak > nul

echo.
echo Starting backend and frontend...
echo.

REM Find Python executable
set PYTHON_EXE=
REM Check for virtual environment first
if exist "%~dp0backend\venv\Scripts\python.exe" (
    set PYTHON_EXE=%~dp0backend\venv\Scripts\python.exe
    echo Found Python in virtual environment
) else (
    REM Check common Python locations
    where python >nul 2>&1
    if !errorlevel! equ 0 (
        for /f "delims=" %%i in ('where python') do (
            if not defined PYTHON_EXE set PYTHON_EXE=%%i
        )
        echo Found Python: !PYTHON_EXE!
    ) else if exist "C:\ProgramData\miniconda3\python.exe" (
        set PYTHON_EXE=C:\ProgramData\miniconda3\python.exe
        echo Found Python in miniconda3
    ) else if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" (
        set PYTHON_EXE=%LOCALAPPDATA%\Programs\Python\Python311\python.exe
        echo Found Python 3.11
    ) else if exist "%LOCALAPPDATA%\Programs\Python\Python310\python.exe" (
        set PYTHON_EXE=%LOCALAPPDATA%\Programs\Python\Python310\python.exe
        echo Found Python 3.10
    )
)

if not defined PYTHON_EXE (
    echo ERROR: Python not found. Please install Python 3.10+ or create a virtual environment.
    echo.
    echo To create a virtual environment:
    echo   cd backend
    echo   python -m venv venv
    echo   venv\Scripts\activate
    echo   pip install -r requirements.txt
    pause
    exit /b 1
)

REM Start backend in a new window
echo [2/4] Starting backend (port 8001)...
start "AIAgent Backend" cmd /k "cd /d %~dp0backend && "!PYTHON_EXE!" -m uvicorn src.main:app --host 0.0.0.0 --port 8001 --reload"

REM Wait for backend to start
echo Waiting for backend to start...
timeout /t 8 /nobreak > nul

REM Start frontend in a new window
echo [3/4] Starting frontend (port 3000)...
start "AIAgent Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo [4/4] Verifying services...
timeout /t 3 /nobreak > nul
echo.
echo ================================
echo Startup Complete!
echo ================================
echo.
echo Frontend: http://localhost:3000
echo Backend API: http://localhost:8001
echo API Documentation: http://localhost:8001/docs
echo PostgreSQL: localhost:5432 (aiagent database)
echo.
echo Each service is running in a separate window.
echo To stop, press Ctrl+C in each window.
echo.
pause
exit /b 0

REM ========================================
REM Function: Wait for Docker to start
REM ========================================
:wait_for_docker
set count=0
:wait_docker_loop
timeout /t 5 /nobreak > nul
docker info > nul 2>&1
if !errorlevel! equ 0 (
    echo Docker started successfully.
    exit /b 0
)
set /a count+=1
echo Still waiting for Docker... [!count!/24]
if !count! lss 24 goto wait_docker_loop
exit /b 1

REM ========================================
REM Function: Wait for PostgreSQL to be ready
REM ========================================
:wait_for_postgres
set pg_count=0
:wait_pg_loop
docker exec aiagent-postgres pg_isready -U postgres > nul 2>&1
if !errorlevel! equ 0 (
    echo PostgreSQL is ready!
    exit /b 0
)
set /a pg_count+=1
echo Waiting for PostgreSQL... [!pg_count!/12]
if !pg_count! geq 12 (
    echo WARNING: PostgreSQL may not be fully ready. Continuing anyway...
    exit /b 1
)
timeout /t 5 /nobreak > nul
goto wait_pg_loop
