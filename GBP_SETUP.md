# Using GBP Instead of USD

If you want to trade with GBP instead of converting to USD, you need to:

## Option 1: Quick Fix - Convert to USD (Easiest)

On Kraken:
1. Go to **Trade** → **Convert** (or **Funding** → **Convert**)
2. Convert your £20 GBP to USD
3. The bot will automatically use USD to trade BTC-USD and ETH-USD

**This is the simplest option** - no code changes needed!

## Option 2: Configure Bot for GBP Pairs

If you prefer to keep GBP, update your configuration:

### Step 1: Update `.env` file

Change the universe to GBP pairs:
```bash
UNIVERSE=BTC-GBP,ETH-GBP
```

### Step 2: Update Reconcile Processor

The reconcile job is hardcoded to look for USD. You'll need to update it:

File: `backend/src/jobs/processors/reconcile.processor.ts`

Change line 26 from:
```typescript
const baseCurrency = 'USD';
```

To:
```typescript
const baseCurrency = 'GBP';
```

### Step 3: Update Kraken Adapter Symbol Mapping

File: `backend/src/exchange/adapters/kraken.adapter.ts`

Add GBP pairs to the mapping (around line 48):
```typescript
private convertSymbol(symbol: string): string {
  const mapping: { [key: string]: string } = {
    'BTC-USD': 'XBTUSD',
    'ETH-USD': 'ETHUSD',
    'SOL-USD': 'SOLUSD',
    'BTC-GBP': 'XBTGBP',  // Add this
    'ETH-GBP': 'ETHGBP',  // Add this
  };
  return mapping[symbol] || symbol.replace('-', '');
}
```

### Step 4: Update MIN_BALANCE and MIN_ORDER settings

Since you're using GBP, update these in `.env`:
```bash
MIN_BALANCE_USD=20  # This will work but the label says USD
MIN_ORDER_USD=5     # This will work but the label says USD
```

(These are just variable names - they'll work with GBP values too)

## Recommendation

**For simplicity, convert GBP → USD on Kraken** and use the default BTC-USD/ETH-USD pairs. This requires no code changes and is the most liquid market.

If you want to stick with GBP, follow Option 2 above.

