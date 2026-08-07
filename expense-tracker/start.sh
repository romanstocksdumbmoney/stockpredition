#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cleanup() {
  if [[ -n "${BACKEND_PID:-}" ]]; then
    kill "${BACKEND_PID}" 2>/dev/null || true
  fi
  if [[ -n "${FRONTEND_PID:-}" ]]; then
    kill "${FRONTEND_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

cd "${ROOT_DIR}/backend"
uvicorn main:app --reload --port 8000 &
BACKEND_PID=$!

cd "${ROOT_DIR}/frontend"
npm run dev -- --port 3000 &
FRONTEND_PID=$!

echo "========================================"
echo "  Expense Tracker is running!"
echo "========================================"
echo ""
echo "  Open your browser and go to:"
echo "  http://localhost:3000"
echo ""
echo "  API running at:"
echo "  http://localhost:8000"
echo ""
echo "  Press CTRL+C to stop"
echo "========================================"

wait -n "${BACKEND_PID}" "${FRONTEND_PID}"
