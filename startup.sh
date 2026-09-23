#!/bin/sh
# Startup script for Flux Performance Dashboard
# Runs both the Express API server and SvelteKit frontend

set -e

API_PID=""
FRONTEND_PID=""

# kill -0 alone is not enough: a child that has exited but not been reaped yet is a zombie,
# and kill -0 still succeeds on a zombie. /proc says which it is.
alive() {
    kill -0 "$1" 2>/dev/null && ! grep -qs '^State:[[:space:]]*Z' "/proc/$1/status"
}

stop_all() {
    [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null
    [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null
}

# A stop signal takes both processes down cleanly
trap 'stop_all; exit 0' TERM INT

echo "🚀 Starting Flux Performance Dashboard..."
echo "========================================"

# Start the Express API server in the background
# The API server will read API_PORT (or PORT falls back to 3000 if not set)
echo "📡 Starting API server on port ${API_PORT:-3000}..."
# Explicitly set PORT for the API server to avoid conflicts
PORT=${API_PORT:-3000} node src/server.js &
API_PID=$!

# Wait for the API server to be ready. -m bounds each probe: a hung request must not stall
# the loop past its 30-attempt budget (issue #309).
echo "⏳ Waiting for API server to be ready..."
RETRIES=30
until curl -sf -m 5 http://127.0.0.1:${API_PORT:-3000}/api/health/live > /dev/null 2>&1; do
    RETRIES=$((RETRIES - 1))
    if [ $RETRIES -eq 0 ]; then
        echo "❌ API server failed to start within 30 seconds. Exiting."
        stop_all
        exit 1
    fi
    sleep 1
done
echo "✅ API server is ready."

# Start the SvelteKit frontend (using the built app)
echo "🎨 Starting frontend on port ${FRONTEND_PORT:-5173}..."
# Set PORT environment variable for SvelteKit
PORT=${FRONTEND_PORT:-5173} HOST=${HOST:-0.0.0.0} node build/index.js &
FRONTEND_PID=$!

echo "✅ Both services started successfully!"
echo "   API: http://localhost:${API_PORT:-3000}"
echo "   Frontend: http://localhost:${FRONTEND_PORT:-5173}"
echo "========================================"

# Supervise: if EITHER process exits, stop the other and exit non-zero so the container
# stops and the orchestrator restarts it (issue #309). `wait $A $B` waited for BOTH, so a
# crashed frontend left the API running and the container reporting healthy while the site
# was down. Polling with kill -0 works in busybox sh, which has no reliable `wait -n`.
set +e
while alive "$API_PID" && alive "$FRONTEND_PID"; do
    sleep 5 & wait $! # interruptible, so a stop signal is handled immediately
done

if alive "$API_PID"; then
    echo "❌ Frontend process exited -- stopping the container."
else
    echo "❌ API process exited -- stopping the container."
fi
stop_all
exit 1
