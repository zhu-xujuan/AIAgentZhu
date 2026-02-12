#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "================================"
echo "AIAgent Stop Script (WSL)"
echo "================================"
echo

echo "Stopping backend (uvicorn 8001)..."
pkill -f "uvicorn src.main:app --host 0.0.0.0 --port 8001" >/dev/null 2>&1 || true

echo "Stopping frontend (next dev)..."
pkill -f "next dev" >/dev/null 2>&1 || true
cmd.exe /c "for /f \"tokens=5\" %a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do taskkill /F /PID %a >nul 2>&1" >/dev/null 2>&1 || true

echo "Stopping PostgreSQL container..."
cd "$ROOT_DIR"
if command -v docker-compose >/dev/null 2>&1; then
  docker-compose down || true
else
  docker compose down || true
fi

echo
echo "All services stopped."
