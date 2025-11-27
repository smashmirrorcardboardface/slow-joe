# Viability Test Settings - Applied Changes

## Goal
Prove profitability at small scale ($36 NAV) before investing more capital.

## Current Performance Issues
- **Fees exceed profits by 10x** ($0.52 fees vs $0.05 profit)
- **Trading too frequently** (18 trades/day)
- **Hold times too short** (3.2 hours average)
- **Profit targets too low** (10% = $3.60 on $36 NAV, but fees eat most of it)
- **Win rate too low** (40%)

## Settings Applied

### 1. MIN_PROFIT_PCT: 10% → **18%**
**Rationale:** 
- With fees ~0.5% per round trip, we need much higher targets
- 18% on $36 NAV = $6.48 profit
- After ~$0.18 fees, net profit = $6.30 (meaningful profit)
- Forces bot to wait for larger moves, reducing trading frequency

**Expected Impact:** 
- Fewer trades (only exits when 18%+ profit)
- Larger absolute profits when targets are hit
- Better fee-to-profit ratio

### 2. MAX_POSITIONS: 2 → **1**
**Rationale:**
- At $36 NAV, 1 position allows ~$18 allocation vs ~$10 each for 2 positions
- Larger positions = larger absolute profits (18% of $18 = $3.24 vs 18% of $10 = $1.80)
- Reduces total number of trades by 50%

**Expected Impact:**
- Fewer trades overall
- Larger profits per winning trade
- Simpler portfolio management

### 3. MAX_ALLOC_FRACTION: 0.35 → **0.5**
**Rationale:**
- With only 1 position, we can allocate more per trade
- 50% of $36 = $18 position
- Larger positions = larger absolute profits when 18% target is hit

**Expected Impact:**
- Larger position sizes
- Better profit potential per trade

### 4. MIN_PROFIT_USD: $0.15 → **$1.00**
**Rationale:**
- Prevents tiny profits ($0.0047) that get eaten by fees
- Ensures each profitable trade makes at least $1.00
- Forces bot to wait for meaningful moves

**Expected Impact:**
- No more micro-profits
- Every profitable trade is meaningful

### 5. COOLDOWN_CYCLES: Already at **5**
**Rationale:**
- 5 cycles × 6 hours = 30 hours cooldown between re-entering same asset
- Dramatically reduces trading frequency
- Prevents overtrading

**Expected Impact:**
- Trading frequency: 18/day → 2-3/day (85% reduction)
- Fee reduction: ~$0.52/day → ~$0.08/day

### 6. Minimum Hold Cycles: 3-4 → **6-8** (Code Change)
**Rationale:**
- Rotation check: 3 cycles → 6 cycles (12-24 hours)
- "Not in target" exit: 4 cycles → 8 cycles (16-24 hours)
- Let winners run longer to capture larger moves
- Reduces premature exits

**Expected Impact:**
- Longer hold times (12-24 hours vs 3-4 hours)
- Capture larger price moves
- Fewer trades (less rotation)

## Expected Results

### Before (Current State)
- Trading frequency: **18 trades/day**
- Fees: **~$0.52/day**
- Profit: **~$0.05/day**
- Net: **-$0.47/day** (losing money)
- Avg hold time: **3.2 hours**

### After (With New Settings)
- Trading frequency: **2-3 trades/day** (85% reduction)
- Fees: **~$0.08/day** (85% reduction)
- Profit target: **18%** (80% increase)
- Position size: **~$18** (80% increase)
- Min profit: **$1.00** (567% increase)
- Avg hold time: **12-24 hours** (4-8x increase)

### Success Criteria
After 1-2 weeks, the bot should:
1. **Net positive P&L** (profits > fees)
2. **Win rate > 50%** (more winners than losers)
3. **Avg profit per trade > $1.00** (meaningful profits)
4. **Trading frequency < 5 trades/day** (sustainable)

## What to Monitor

1. **Trading Frequency**: Should drop to 2-3 trades/day
2. **Fee-to-Profit Ratio**: Should be < 20% (currently 1000%+)
3. **Win Rate**: Should improve as we wait for better setups
4. **Average Hold Time**: Should increase to 12-24 hours
5. **Net P&L**: Should become positive after fees

## Next Steps

1. **Monitor for 1-2 weeks** with these settings
2. **Review optimizer reports** nightly to see if further adjustments needed
3. **If profitable**: Consider scaling up NAV gradually ($50 → $100 → $200)
4. **If still unprofitable**: May need even more aggressive settings or strategy changes

## Notes

- These settings are **conservative and aggressive** - designed to prove viability
- The bot will trade **much less frequently** - this is intentional
- **Patience required** - may go days without trades (this is good!)
- The goal is **quality over quantity** - fewer, better trades

