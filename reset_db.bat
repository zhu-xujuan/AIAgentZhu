@echo off
setlocal enabledelayedexpansion
echo ================================
echo PostgreSQL Reset Script
echo ================================
echo.

cd /d %~dp0

REM Check Docker status
echo Checking Docker status...
docker info > nul 2>&1
if !errorlevel! neq 0 (
    echo Docker is not running. Starting Docker Desktop...
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    echo Waiting for Docker to start...
    call :wait_for_docker
    if !errorlevel! neq 0 (
        echo ERROR: Docker failed to start after 2 minutes.
        echo Please start Docker Desktop manually and try again.
        pause
        exit /b 1
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

REM Start PostgreSQL if not running
echo Starting PostgreSQL...
!DOCKER_COMPOSE! up -d postgres
if !errorlevel! neq 0 (
    echo WARNING: docker-compose up failed, but continuing...
)
echo Waiting for PostgreSQL to start (15 seconds)...
timeout /t 15 /nobreak > nul

REM Check if PostgreSQL is accepting connections
echo Checking if PostgreSQL is accepting connections...
docker exec aiagent-postgres pg_isready -U postgres > nul 2>&1
if !errorlevel! neq 0 (
    echo PostgreSQL is not ready yet. Waiting additional 15 seconds...
    timeout /t 15 /nobreak > nul
)

echo.
echo ================================
echo Deleting all data...
echo ================================

echo Deleting uploaded files...
if exist "%~dp0data\uploads\files" (
    rmdir /s /q "%~dp0data\uploads\files"
    echo Deleted: data\uploads\files
)
if exist "%~dp0data\uploads\metadata" (
    rmdir /s /q "%~dp0data\uploads\metadata"
    echo Deleted: data\uploads\metadata
)
mkdir "%~dp0data\uploads\files" 2>nul
mkdir "%~dp0data\uploads\metadata" 2>nul
echo Upload directories recreated.
echo.

echo Deleting PostgreSQL data...
!DOCKER_COMPOSE! down -v
echo.

echo Restarting PostgreSQL with fresh data...
!DOCKER_COMPOSE! up -d postgres
echo.

echo Waiting for PostgreSQL to initialize (30 seconds)...
timeout /t 30 /nobreak > nul

echo.
echo Verifying PostgreSQL is ready...
docker exec aiagent-postgres pg_isready -U postgres
if !errorlevel! neq 0 (
    echo WARNING: PostgreSQL may not be ready yet.
) else (
    echo PostgreSQL is ready with fresh database!
)

echo.
echo ================================
echo Done! All data has been reset.
echo ================================
pause
exit /b 0

REM ========================================
REM Function: Wait for Docker to start
REM ========================================
:wait_for_docker
set count=0
:wait_loop
timeout /t 5 /nobreak > nul
docker info > nul 2>&1
if !errorlevel! equ 0 (
    echo Docker started successfully.
    exit /b 0
)
set /a count+=1
echo Still waiting for Docker... [!count!/24]
if !count! lss 24 goto wait_loop
exit /b 1
