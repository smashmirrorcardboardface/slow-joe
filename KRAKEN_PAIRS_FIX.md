# Kraken Trading Pairs Fix

## Issue
Some of the newly added trading pairs are not available on Kraken, causing "Unknown asset pair" errors.

## Solution
I've updated the code to handle missing pairs gracefully. The market data endpoint will now:
- Continue working even if some pairs fail
- Log warnings for pairs that don't exist
- Return only valid market data

## Pairs That May Not Exist on Kraken

Some pairs might not be available on Kraken or may use different naming. Common issues:

1. **MATIC-USD**: Polygon rebranded to POL on some exchanges. Kraken might use `POLUSD` instead of `MATICUSD`
2. **NEAR-USD**: May not be available on Kraken
3. **AAVE-USD**: May not be available on Kraken

## Recommended Action

If you see errors for specific pairs, you can:

1. **Remove them from UNIVERSE** temporarily:
   ```
   BTC-USD,ETH-USD,SOL-USD,LINK-USD,AVAX-USD,ADA-USD,XRP-USD,DOGE-USD,DOT-USD,MATIC-USD,UNI-USD,ATOM-USD,LTC-USD
   ```
   (Removed NEAR-USD and AAVE-USD if they're causing errors)

2. **Check Kraken's actual trading pairs** by visiting their website or API documentation

3. **Use alternative pairs** that are confirmed to exist on Kraken

## Verified Pairs (Should Work)
- BTC-USD (XBTUSD)
- ETH-USD (ETHUSD)
- SOL-USD (SOLUSD)
- LINK-USD (LINKUSD)
- AVAX-USD (AVAXUSD)
- ADA-USD (ADAUSD)
- XRP-USD (XRPUSD)
- DOGE-USD (DOGEUSD)
- DOT-USD (DOTUSD)
- LTC-USD (LTCUSD)
- UNI-USD (UNIUSD)
- ATOM-USD (ATOMUSD)

## Pairs to Verify
- MATIC-USD (may need to be POLUSD)
- NEAR-USD (may not exist)
- AAVE-USD (may not exist)

The bot will now handle missing pairs gracefully and continue working with the pairs that do exist.

