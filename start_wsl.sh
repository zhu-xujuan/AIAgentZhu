#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
LOG_DIR="$ROOT_DIR/.run-logs"
ROOT_WIN_PATH="$(wslpath -w "$ROOT_DIR")"
WSL_IP="$(hostname -I | awk '{print $1}')"

mkdir -p "$LOG_DIR"

echo "================================"
echo "AIAgent Startup Script (WSL)"
echo "================================"
echo

echo "[1/4] Starting PostgreSQL with Docker Compose..."
if command -v docker-compose >/dev/null 2>&1; then
  docker-compose up -d postgres || echo "WARNING: Failed to start postgres (docker-compose)."
else
  docker compose up -d postgres || echo "WARNING: Failed to start postgres (docker compose)."
fi
echo

echo "[2/4] Stopping old processes..."
pkill -f "uvicorn src.main:app --host 0.0.0.0 --port 8001" >/dev/null 2>&1 || true
pkill -f "next dev" >/dev/null 2>&1 || true
# Also stop Windows-side Next.js on port 3000 and clear stale lock file.
cmd.exe /c "for /f \"tokens=5\" %a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do taskkill /F /PID %a >nul 2>&1" >/dev/null 2>&1 || true
cmd.exe /c "del /f /q \"$ROOT_WIN_PATH\\frontend\\.next\\dev\\lock\" 2>nul" >/dev/null 2>&1 || true
echo

echo "[2.5/4] Updating frontend API endpoint for WSL backend..."
FRONTEND_ENV_LOCAL="$FRONTEND_DIR/.env.local"
if [[ -f "$FRONTEND_ENV_LOCAL" ]]; then
  if grep -q '^NEXT_PUBLIC_API_URL=' "$FRONTEND_ENV_LOCAL"; then
    sed -i "s|^NEXT_PUBLIC_API_URL=.*|NEXT_PUBLIC_API_URL=http://$WSL_IP:8001|" "$FRONTEND_ENV_LOCAL"
  else
    echo "NEXT_PUBLIC_API_URL=http://$WSL_IP:8001" >> "$FRONTEND_ENV_LOCAL"
  fi
  if grep -q '^BACKEND_URL=' "$FRONTEND_ENV_LOCAL"; then
    sed -i "s|^BACKEND_URL=.*|BACKEND_URL=http://$WSL_IP:8001|" "$FRONTEND_ENV_LOCAL"
  else
    echo "BACKEND_URL=http://$WSL_IP:8001" >> "$FRONTEND_ENV_LOCAL"
  fi
else
  cat > "$FRONTEND_ENV_LOCAL" <<EOF
NEXT_PUBLIC_API_URL=http://$WSL_IP:8001
BACKEND_URL=http://$WSL_IP:8001
EOF
fi
echo "Frontend API URL -> http://$WSL_IP:8001"
echo

echo "[3/4] Starting backend in background (port 8001)..."
pushd "$BACKEND_DIR" >/dev/null
if [[ -d "venv" ]]; then
  source venv/bin/activate
fi
nohup python3 -m uvicorn src.main:app --host 0.0.0.0 --port 8001 >"$LOG_DIR/backend.log" 2>&1 &
popd >/dev/null
echo "Backend log: $LOG_DIR/backend.log"
echo

echo "[4/4] Starting frontend on Windows (port 3000)..."
powershell.exe -NoProfile -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/k','cd /d $ROOT_WIN_PATH\\frontend && npm run dev' -WindowStyle Normal" >/dev/null 2>&1 || {
  echo "WARNING: Windows frontend launch failed, falling back to WSL background process."
  pushd "$FRONTEND_DIR" >/dev/null
  nohup npm run dev >"$LOG_DIR/frontend.log" 2>&1 &
  popd >/dev/null
  echo "Frontend log: $LOG_DIR/frontend.log"
}
sleep 6
if ! cmd.exe /c "netstat -ano | findstr :3000 | findstr LISTENING" >/dev/null 2>&1; then
  echo "WARNING: Windows frontend did not open port 3000, using WSL fallback."
  pushd "$FRONTEND_DIR" >/dev/null
  nohup npm run dev >"$LOG_DIR/frontend.log" 2>&1 &
  popd >/dev/null
  echo "Frontend log: $LOG_DIR/frontend.log"
fi
echo "[4.5/4] Starting Slidev preview server on Windows (port 3030)..."
mkdir -p "$FRONTEND_DIR/.slidev"
if [[ ! -f "$FRONTEND_DIR/.slidev/slides.md" ]]; then
  cat > "$FRONTEND_DIR/.slidev/slides.md" <<EOF
---
title: Slides
---

# Slide Preview

Ready.
EOF
fi
powershell.exe -NoProfile -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/k','cd /d $ROOT_WIN_PATH\\frontend && npx slidev .slidev/slides.md --port 3030 --open false --log silent --bind 0.0.0.0' -WindowStyle Normal" >/dev/null 2>&1 || true
echo

echo "================================"
echo "Startup Complete!"
echo "================================"
echo "Frontend: http://localhost:3000"
echo "Backend API: http://localhost:8001"
echo
echo "Check status:"
echo "  ps -ef | grep -E 'uvicorn|next dev' | grep -v grep"
echo "Tail logs:"
echo "  tail -f .run-logs/backend.log"
echo "  tail -f .run-logs/frontend.log"
