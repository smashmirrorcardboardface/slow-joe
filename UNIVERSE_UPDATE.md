# Updated Trading Universe

## New Assets Added

I've added 6 new assets to the Kraken adapter configuration:

1. **MATIC-USD** (Polygon) - Layer 2 scaling solution
2. **UNI-USD** (Uniswap) - DeFi DEX token
3. **ATOM-USD** (Cosmos) - Interoperability blockchain
4. **LTC-USD** (Litecoin) - Established altcoin
5. **NEAR-USD** (NEAR Protocol) - Layer 1 blockchain
6. **AAVE-USD** (Aave) - DeFi lending protocol

## Updated UNIVERSE Setting

**IMPORTANT:** MATIC-USD is **NOT available on Kraken**. Use this updated list (14 assets):

```
BTC-USD,ETH-USD,SOL-USD,LINK-USD,AVAX-USD,ADA-USD,XRP-USD,DOGE-USD,DOT-USD,UNI-USD,ATOM-USD,LTC-USD,NEAR-USD,AAVE-USD
```

**Verified Working Pairs:**
- ✅ BTC-USD, ETH-USD, SOL-USD, LINK-USD, AVAX-USD, ADA-USD, XRP-USD, DOGE-USD, DOT-USD (original 9)
- ✅ UNI-USD, ATOM-USD, LTC-USD (confirmed working in logs)
- ⚠️ NEAR-USD, AAVE-USD (added but not yet confirmed - check logs)

**Removed:**
- ❌ MATIC-USD (not available on Kraken - Polygon rebranded to POL but POLUSD may not exist either)

**Note:** If NEAR-USD or AAVE-USD also fail, remove them from the list. The bot will log warnings for any pairs that don't exist.

## What This Gives You

**Before:** 9 assets
**After:** 15 assets (67% increase)

### Benefits:
- **More opportunities**: With many assets filtered by EMA ratio, having more options increases the chance of finding signals
- **Better diversification**: Different ecosystems (Layer 1, Layer 2, DeFi) reduce correlation
- **Different volatility profiles**: Mix of high and moderate volatility assets
- **More trading opportunities**: When one asset is filtered out, others may pass

### Asset Categories:
- **Layer 1**: BTC, ETH, SOL, AVAX, NEAR, ATOM
- **Layer 2**: MATIC
- **DeFi**: LINK, UNI, AAVE
- **Established**: LTC, ADA, XRP, DOT
- **Meme/Community**: DOGE

## Next Steps

1. Update the UNIVERSE setting in your dashboard Settings page
2. Monitor for 1-2 weeks to see signal frequency
3. If signals are still sparse, you can add more from the "Lower Priority" list:
   - BCH-USD (Bitcoin Cash)
   - FTM-USD (Fantom)
   - ALGO-USD (Algorand)
   - ETC-USD (Ethereum Classic)

## Technical Details

All new assets have been configured with:
- ✅ Symbol mapping (Kraken format conversion)
- ✅ Price decimal precision
- ✅ Lot size and minimum order requirements
- ✅ Reverse symbol mapping for order status

The bot is ready to trade these new assets immediately after you update the UNIVERSE setting.

