#!/bin/bash

# Test Alert Script
# This script tests the alert system by sending a test alert

echo "Testing Alert System..."
echo ""

# Check if backend is running
if ! curl -s http://localhost:3000/health > /dev/null 2>&1; then
    echo "❌ Backend is not running. Please start it first:"
    echo "   cd backend && npm run start:dev"
    exit 1
fi

echo "✅ Backend is running"
echo ""

# Get JWT token (you'll need to login first)
echo "To test the alert, you need to:"
echo ""
echo "1. Login to get a JWT token:"
echo "   curl -X POST http://localhost:3000/api/auth/login \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"username\":\"admin\",\"password\":\"admin\"}'"
echo ""
echo "2. Copy the 'access_token' from the response"
echo ""
echo "3. Send test alert:"
echo "   curl -X POST http://localhost:3000/api/alerts/test \\"
echo "     -H 'Authorization: Bearer YOUR_TOKEN_HERE'"
echo ""
echo "Or use this script with a token:"
echo "   ./test-alert.sh YOUR_TOKEN_HERE"
echo ""

if [ -n "$1" ]; then
    TOKEN=$1
    echo "Sending test alert with provided token..."
    RESPONSE=$(curl -s -X POST http://localhost:3000/api/alerts/test \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json")
    
    echo "$RESPONSE" | jq . 2>/dev/null || echo "$RESPONSE"
    echo ""
    echo "✅ Test alert sent! Check your email inbox (and spam folder)."
else
    echo "ℹ️  No token provided. Follow the steps above to test manually."
fi

