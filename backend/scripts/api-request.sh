#!/bin/bash

# API Request Utility for Slow Joe Backend
# Usage: ./api-request.sh [METHOD] [ENDPOINT] [BODY]
# Example: ./api-request.sh GET /api/positions
# Example: ./api-request.sh POST /api/settings '{"key":"value"}'

set -e

# Configuration
API_BASE_URL="${API_BASE_URL:-http://localhost:3000}"
API_USERNAME="${API_USERNAME:-admin}"
API_PASSWORD="${API_PASSWORD:-admin}"
TOKEN_CACHE_FILE="${HOME}/.slow-joe-token"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to login and get token
login() {
  echo -e "${YELLOW}Logging in...${NC}" >&2
  local response=$(curl -s -X POST "${API_BASE_URL}/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"${API_USERNAME}\",\"password\":\"${API_PASSWORD}\"}")
  
  local token=$(echo "$response" | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)
  
  if [ -z "$token" ]; then
    echo -e "${RED}Error: Failed to login. Response: $response${NC}" >&2
    exit 1
  fi
  
  echo "$token" > "$TOKEN_CACHE_FILE"
  echo "$token"
}

# Function to get token (from cache or login)
get_token() {
  if [ -f "$TOKEN_CACHE_FILE" ]; then
    local cached_token=$(cat "$TOKEN_CACHE_FILE")
    # Try to use cached token, if it fails, login again
    local test_response=$(curl -s -w "%{http_code}" -o /dev/null \
      -H "Authorization: Bearer $cached_token" \
      "${API_BASE_URL}/api/positions" 2>/dev/null || echo "000")
    
    if [ "$test_response" = "200" ] || [ "$test_response" = "401" ]; then
      # Token might be valid, but 401 means we need to re-login
      if [ "$test_response" = "401" ]; then
        login
      else
        echo "$cached_token"
      fi
    else
      # Token might be expired or invalid, login again
      login
    fi
  else
    login
  fi
}

# Parse arguments
METHOD="${1:-GET}"
ENDPOINT="${2:-/api/positions}"
BODY="${3:-}"

# Remove leading slash if present and add /api prefix if not present
if [[ ! "$ENDPOINT" =~ ^/api/ ]]; then
  if [[ "$ENDPOINT" =~ ^/ ]]; then
    ENDPOINT="/api${ENDPOINT}"
  else
    ENDPOINT="/api/${ENDPOINT}"
  fi
fi

# Get token
TOKEN=$(get_token)

# Build curl command
CURL_CMD="curl -s -X ${METHOD}"

# Add headers
CURL_CMD="${CURL_CMD} -H 'Authorization: Bearer ${TOKEN}'"
CURL_CMD="${CURL_CMD} -H 'Content-Type: application/json'"

# Add body if provided
if [ -n "$BODY" ]; then
  CURL_CMD="${CURL_CMD} -d '${BODY}'"
fi

# Add URL
CURL_CMD="${CURL_CMD} '${API_BASE_URL}${ENDPOINT}'"

# Execute and pretty print JSON if jq is available
if command -v jq &> /dev/null; then
  eval "$CURL_CMD" | jq .
else
  eval "$CURL_CMD"
fi

