#!/bin/bash
# HR Matching Tool - Start Script

echo "🚀 HR Matching Tool wird gestartet..."

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Start Backend
echo "📦 Backend starten..."
cd "$SCRIPT_DIR/backend"
node server.js &
BACKEND_PID=$!
echo "   Backend PID: $BACKEND_PID"

# Wait for backend
sleep 2

# Start Frontend
echo "🎨 Frontend starten..."
cd "$SCRIPT_DIR/frontend"
./node_modules/.bin/vite &
FRONTEND_PID=$!
echo "   Frontend PID: $FRONTEND_PID"

echo ""
echo "✅ HR Matching Tool läuft!"
echo "   Frontend: http://localhost:5173"
echo "   Backend:  http://localhost:3001"
echo "   n8n:      http://localhost:5678"
echo ""
echo "   Drücke Ctrl+C zum Beenden"

# Cleanup on exit
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; echo '👋 Beendet.'" EXIT

wait
