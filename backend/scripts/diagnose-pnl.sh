#!/bin/bash

# P&L Diagnostic Script
# This script gathers all relevant information to understand why P&L is negative

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_SCRIPT="${SCRIPT_DIR}/api-request.sh"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${BLUE}=== P&L Diagnostic Report ===${NC}\n"

# Get metrics
echo -e "${CYAN}Fetching metrics...${NC}" >&2
METRICS=$("${API_SCRIPT}" GET /api/metrics)

if command -v jq &> /dev/null; then
  # Use jq for proper JSON parsing
  echo -e "${YELLOW}1. Current NAV and Fees:${NC}"
  NAV=$(echo "$METRICS" | jq -r '.nav // 0')
  TOTAL_FEES=$(echo "$METRICS" | jq -r '.totalFees // 0')
  printf "   NAV: \$%.2f\n" "$NAV"
  printf "   Total Fees: \$%.2f\n" "$TOTAL_FEES"
  echo ""

  echo -e "${YELLOW}2. P&L Breakdown:${NC}"
  UNREALIZED=$(echo "$METRICS" | jq -r '.unrealizedPnL // 0')
  REALIZED=$(echo "$METRICS" | jq -r '.realizedPnL // 0')
  TOTAL_PNL=$(echo "$METRICS" | jq -r '.totalPnL // 0')
  
  printf "   Unrealized P&L: \$%.2f\n" "$UNREALIZED"
  printf "   Realized P&L: \$%.2f\n" "$REALIZED"
  printf "   Total P&L: \$%.2f\n" "$TOTAL_PNL"
  
  if (( $(echo "$TOTAL_PNL < 0" | bc -l 2>/dev/null || echo "0") )); then
    echo -e "   ${RED}⚠ Negative P&L detected!${NC}"
  fi
  echo ""

  echo -e "${YELLOW}3. Open Positions:${NC}"
  POSITION_COUNT=$(echo "$METRICS" | jq -r '.openPositions | length')
  if [ "$POSITION_COUNT" = "0" ]; then
    echo "   No open positions"
  else
    echo "$METRICS" | jq -r '.openPositions[]? | 
      "   \(.symbol): \(.quantity) @ \$\(.entryPrice) -> \$\(.currentPrice) | P&L: \$\(.profit | tostring | .[0:10]) (\(.profitPct | tostring | .[0:6])%)"' 2>/dev/null
  fi
  echo ""

  echo -e "${YELLOW}4. P&L by Symbol:${NC}"
  echo "$METRICS" | jq -r '.pnlBySymbol | to_entries[]? | 
    "   \(.key): Realized: \$\(.value.realized | tostring | .[0:10]), Unrealized: \$\(.value.unrealized | tostring | .[0:10]), Total: \$\(.value.total | tostring | .[0:10])"' 2>/dev/null || echo "   No symbol breakdown available"
  echo ""

  echo -e "${YELLOW}5. Trading Statistics:${NC}"
  WIN_RATE=$(echo "$METRICS" | jq -r '.winRate // 0')
  WINNING=$(echo "$METRICS" | jq -r '.winningTrades // 0')
  LOSING=$(echo "$METRICS" | jq -r '.losingTrades // 0')
  AVG_PROFIT=$(echo "$METRICS" | jq -r '.avgProfitPerTrade // 0')
  LARGEST_WIN=$(echo "$METRICS" | jq -r '.largestWin // 0')
  LARGEST_LOSS=$(echo "$METRICS" | jq -r '.largestLoss // 0')
  
  printf "   Win Rate: %.1f%%\n" "$WIN_RATE"
  echo "   Winning Trades: $WINNING"
  echo "   Losing Trades: $LOSING"
  printf "   Avg Profit/Trade: \$%.2f\n" "$AVG_PROFIT"
  printf "   Largest Win: \$%.2f\n" "$LARGEST_WIN"
  printf "   Largest Loss: \$%.2f\n" "$LARGEST_LOSS"
  echo ""

  echo -e "${YELLOW}6. Recent Trades (last 5):${NC}"
  echo "$METRICS" | jq -r '.recentTradesList[0:5][]? | 
    "   \(.side | ascii_upcase) \(.symbol): \(.quantity) @ \$\(.price) | Fee: \$\(.fee // 0)"' 2>/dev/null
  echo ""

  echo -e "${YELLOW}7. Relevant Settings:${NC}"
  SETTINGS=$("${API_SCRIPT}" GET /api/settings)
  echo "$SETTINGS" | jq -r '.[]? | select(.key | test("MIN_PROFIT|MAX_LOSS|PROFIT_FEE_BUFFER|VOLATILITY")) | "   \(.key): \(.value)"' 2>/dev/null || echo "   Could not fetch settings"
  echo ""

  echo -e "${BLUE}=== Analysis ===${NC}"
  if (( $(echo "$TOTAL_PNL < 0" | bc -l 2>/dev/null || echo "0") )); then
    echo -e "${RED}Negative P&L likely caused by:${NC}"
    if (( $(echo "$UNREALIZED < 0" | bc -l 2>/dev/null || echo "0") )); then
      echo "  • Open positions are underwater (entry price > current price)"
    fi
    if (( $(echo "$REALIZED < 0" | bc -l 2>/dev/null || echo "0") )); then
      echo "  • Closed trades resulted in losses"
    fi
    if (( $(echo "$TOTAL_FEES > 0" | bc -l 2>/dev/null || echo "0") )); then
      printf "  • Trading fees: \$%.2f\n" "$TOTAL_FEES"
    fi
  else
    echo -e "${GREEN}P&L is positive!${NC}"
  fi

else
  # Fallback without jq
  echo -e "${YELLOW}Install 'jq' for detailed analysis: sudo apt install jq${NC}"
  echo ""
  echo "Raw metrics output:"
  echo "$METRICS" | head -50
fi

