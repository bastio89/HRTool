#!/bin/bash
# HR Matching Tool - Start Script

echo "🚀 HR Matching Tool wird gestartet..."

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Graceful shutdown of existing processes (SIGTERM first, then SIGKILL)
echo "🧹 Alte Prozesse beenden (Ports 3001, 5173)..."
for PORT in 3001 5173; do
  PIDS=$(lsof -ti:$PORT 2>/dev/null)
  if [ -n "$PIDS" ]; then
    echo "$PIDS" | xargs kill -15 2>/dev/null
    sleep 1
    echo "$PIDS" | xargs kill -9 2>/dev/null
  fi
done
pkill -15 -f "HRTool/backend/server.js" 2>/dev/null
pkill -15 -f "HRTool/frontend.*vite" 2>/dev/null
sleep 1

# Clean up orphaned Vite dep-optimization temp folders (created by kill -9 in previous runs)
find "$SCRIPT_DIR/frontend/node_modules/.vite" -maxdepth 1 -name "deps_temp_*" -exec rm -rf {} + 2>/dev/null

# Start Backend
echo "📦 Backend starten..."
cd "$SCRIPT_DIR/backend"
node server.js &
BACKEND_PID=$!
echo "   Backend PID: $BACKEND_PID"

# Wait for backend (up to 60s)
for i in $(seq 1 60); do
  if lsof -i:3001 | grep -q LISTEN; then
    echo "✅ Backend bereit (${i}s)"
    break
  fi
  sleep 1
done

if ! lsof -i:3001 | grep -q LISTEN; then
  echo "⚠️  Backend hat Port 3001 nicht geöffnet – prüfe Logs."
fi

# Start Frontend
echo "🎨 Frontend starten..."
cd "$SCRIPT_DIR/frontend"
./node_modules/.bin/vite < /dev/null > /tmp/hrtool-vite.log 2>&1 &
FRONTEND_PID=$!
echo "   Frontend PID: $FRONTEND_PID"

# Wait until Vite is ready (up to 120s — should now start in <30s after Tailwind fix)
echo "   Warte auf Vite..."
for i in $(seq 1 120); do
  if lsof -i:5173 | grep -q LISTEN; then
    echo "✅ Vite bereit (${i}s)"
    break
  fi
  if [ $((i % 15)) -eq 0 ]; then
    echo "   ... noch am Starten (${i}s)"
  fi
  sleep 1
done

echo ""
if lsof -i:5173 | grep -q LISTEN; then
  echo "✅ HR Matching Tool ist bereit!"
else
  echo "⚠️  Vite hat Port 5173 nicht geöffnet. Log: /tmp/hrtool-vite.log"
  tail -10 /tmp/hrtool-vite.log
fi
echo "   Frontend: http://localhost:5173"
echo "   Backend:  http://localhost:3001"
echo "   n8n:      http://localhost:5678"
echo ""
echo "   Drücke Ctrl+C zum Beenden"

# Cleanup on exit
trap "echo '🛑 Stoppe...'; kill -15 $BACKEND_PID $FRONTEND_PID 2>/dev/null; sleep 1; kill -9 $BACKEND_PID $FRONTEND_PID 2>/dev/null; echo '👋 Beendet.'" EXIT

wait
