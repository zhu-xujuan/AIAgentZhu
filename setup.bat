@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

echo ================================
echo AIAgent Initial Setup
echo ================================
echo.
echo This script will:
echo 1. Install frontend dependencies
echo 2. Check environment configuration files
echo 3. Build Docker images
echo.
pause
echo.

cd /d %~dp0

REM Install frontend dependencies
echo [1/3] Installing frontend dependencies...
cd frontend
call npm install
if !errorlevel! neq 0 (
    echo ERROR: npm install failed.
    pause
    exit /b 1
)
cd ..
echo.

REM Check environment configuration files
echo [2/3] Checking environment configuration files...

if not exist "backend\.env" (
    echo ERROR: backend\.env not found.
    echo Please create backend\.env based on .env.example.
    pause
    exit /b 1
) else (
    echo backend\.env: OK
)

if not exist "frontend\.env.local" (
    echo ERROR: frontend\.env.local not found.
    echo Please create frontend\.env.local with NEXT_PUBLIC_API_URL=http://localhost:8001
    pause
    exit /b 1
) else (
    echo frontend\.env.local: OK
)
echo.

REM Check Docker and build images
echo [3/3] Building Docker images...

REM Check if Docker is running
docker info >nul 2>&1
if !errorlevel! neq 0 (
    echo.
    echo WARNING: Docker is not running.
    echo.
    echo Please start Docker Desktop and run setup.bat again,
    echo or run start.bat which will start Docker automatically.
    echo.
    echo Skipping Docker image build...
    goto setup_complete
)

REM Detect docker compose command
set DOCKER_COMPOSE=docker-compose
docker-compose version >nul 2>&1
if !errorlevel! neq 0 (
    set DOCKER_COMPOSE=docker compose
)

%DOCKER_COMPOSE% build
if !errorlevel! neq 0 (
    echo WARNING: Docker image build failed, but you can continue.
    echo start.bat will attempt to build images when starting.
)
echo.

:setup_complete
echo ================================
echo Setup Complete!
echo ================================
echo.
echo Run the following command to start the application:
echo start.bat
echo.
pause
