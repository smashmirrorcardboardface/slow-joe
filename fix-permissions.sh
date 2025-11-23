#!/bin/bash
# Fix permissions for dist directories created by Docker

echo "Fixing permissions for dist directories..."

# Backend dist
if [ -d "backend/dist" ]; then
    echo "Fixing backend/dist permissions..."
    sudo chown -R $USER:$USER backend/dist
    sudo rm -rf backend/dist
fi

# Frontend dist (if exists)
if [ -d "frontend/dist" ]; then
    echo "Fixing frontend/dist permissions..."
    sudo chown -R $USER:$USER frontend/dist
    sudo rm -rf frontend/dist
fi

echo "Permissions fixed! You can now run npm commands without sudo."

