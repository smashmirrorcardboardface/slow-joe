#!/bin/bash
# Script to kill all backend processes and free port 3000

echo "Killing all nest watch processes..."
pkill -f "nest start --watch"

echo "Killing any process on port 3000..."
lsof -ti:3000 | xargs kill -9 2>/dev/null || true

sleep 1

if lsof -ti:3000 > /dev/null 2>&1; then
    echo "⚠️  Port 3000 is still in use. Try: sudo lsof -ti:3000 | xargs kill -9"
else
    echo "✅ Port 3000 is now free"
fi

