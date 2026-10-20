#!/usr/bin/env bash
# Starts the FastAPI matching backend and the Vite frontend together.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_PY="$ROOT_DIR/.venv/bin/uvicorn"
BACKEND_DIR="$ROOT_DIR/backend"
WEB_DIR="$ROOT_DIR/web"

BACKEND_PORT=8000
FRONTEND_PORT=5177

cleanup() {
  echo ""
  echo "Stopping..."
  [[ -n "${BACKEND_PID:-}" ]] && kill "$BACKEND_PID" 2>/dev/null || true
  [[ -n "${FRONTEND_PID:-}" ]] && kill "$FRONTEND_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Free the ports if a previous run left something listening.
lsof -ti:"$BACKEND_PORT" -sTCP:LISTEN 2>/dev/null | xargs -r kill || true
lsof -ti:"$FRONTEND_PORT" -sTCP:LISTEN 2>/dev/null | xargs -r kill || true

echo "Starting backend on http://localhost:$BACKEND_PORT ..."
(cd "$BACKEND_DIR" && "$VENV_PY" main:app --port "$BACKEND_PORT") &
BACKEND_PID=$!

echo "Waiting for backend to come up..."
until curl -sf "http://localhost:$BACKEND_PORT/health" >/dev/null 2>&1; do
  sleep 0.5
done
echo "Backend ready."

echo "Starting frontend on http://localhost:$FRONTEND_PORT ..."
(cd "$WEB_DIR" && npm run dev -- --port "$FRONTEND_PORT") &
FRONTEND_PID=$!

echo ""
echo "Which Shinobi Are You? is running:"
echo "  Frontend: http://localhost:$FRONTEND_PORT"
echo "  Backend:  http://localhost:$BACKEND_PORT"
echo ""
echo "Press Ctrl+C to stop both."

wait
