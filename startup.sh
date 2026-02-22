#!/bin/sh
# Startup script for Flux Performance Dashboard
# Runs both the Express API server and SvelteKit frontend

set -e

echo "🚀 Starting Flux Performance Dashboard..."
echo "========================================"

# Start the Express API server in the background
# The API server will read API_PORT (or PORT falls back to 3000 if not set)
echo "📡 Starting API server on port ${API_PORT:-3000}..."
# Explicitly set PORT for the API server to avoid conflicts
PORT=${API_PORT:-3000} node src/server.js &
API_PID=$!

# Wait for the API server to be ready
echo "⏳ Waiting for API server to be ready..."
RETRIES=30
until curl -sf http://127.0.0.1:${API_PORT:-3000}/api/health > /dev/null 2>&1; do
    RETRIES=$((RETRIES - 1))
    if [ $RETRIES -eq 0 ]; then
        echo "❌ API server failed to start within 30 seconds. Exiting."
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

# Wait for any process to exit
wait -n

# Exit with status of process that exited first
exit $?