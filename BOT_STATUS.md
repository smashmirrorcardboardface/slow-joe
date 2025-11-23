# Bot Status & Log Explanation

## What the Bot is Currently Doing

Right now, the bot is **idle and waiting**. It's running in the background, but not actively trading. Here's what's happening:

### Current State
- ✅ **Connected to Kraken** - API authentication working
- ✅ **Database connected** - All data is being stored
- ✅ **Balance synced** - Your $25.41 USD balance is tracked
- ⏳ **Waiting for signals** - Next signal check in ~6 hours (default cadence)

## Scheduled Jobs (Automatic)

The bot runs two types of jobs automatically:

### 1. **Reconcile Job** (Every Hour)
- **What it does**: Fetches your actual balance from Kraken and updates the NAV (Net Asset Value)
- **Purpose**: Keeps the bot's internal balance in sync with your exchange balance
- **Log example**: 
  ```
  Reconcile: Starting reconciliation...
  Reconcile: NAV updated to 25.41
  ```

### 2. **Signal Poller Job** (Every 6 Hours)
- **What it does**: 
  1. Fetches price data (OHLCV candles) for each asset in your universe (BTC-USD, ETH-USD, etc.)
  2. Calculates technical indicators (EMA, RSI)
  3. Generates trading signals
  4. Evaluates which asset has the best momentum
  5. Decides whether to buy/sell/rebalance
- **Purpose**: This is the "brain" that decides what to trade
- **Log example**:
  ```
  SignalPoller: Starting signal polling...
  SignalPoller: Generated signal for BTC-USD
  ```

## Log Line Breakdown

### Startup Logs (Lines 1-77)
```
[Nest] 258848 - 21/11/2025, 12:54:41 LOG [NestFactory] Starting Nest application...
```
- **What it means**: Backend is starting up
- **Details**: Loading all modules (database, exchange, jobs, etc.)

```
KrakenAdapter initialized with API key: V9CtfDj1Rw... (length: 56)
API Secret length: 88
```
- **What it means**: Kraken API connection initialized successfully
- **Details**: Your API credentials are loaded and ready

```
[RouterExplorer] Mapped {/api/metrics, GET} route
```
- **What it means**: API endpoints are registered
- **Details**: The dashboard can now call these endpoints

### Database Queries (Lines 79-84)
```
query: SELECT "Metric"."id" AS "Metric_id"...
```
- **What it means**: Loading current NAV from database
- **Details**: Fetching the latest metrics to display in dashboard

### Reconcile Job Execution (Lines 85-90)
```
Reconcile: Starting reconciliation...
```
- **What it means**: Reconcile job started (either scheduled or manual)
- **Details**: About to fetch balance from Kraken

```
query: INSERT INTO "metrics"("id", "key", "value", "createdAt") VALUES (DEFAULT, $1, $2, DEFAULT) RETURNING "id", "createdAt" -- PARAMETERS: ["NAV","25.41"]
```
- **What it means**: Saving the new NAV value to database
- **Details**: Your balance of $25.41 is now stored

```
Reconcile: NAV updated to 25.41
```
- **What it means**: Reconcile completed successfully
- **Details**: Balance synced with Kraken

## What Happens Next?

### Immediate (Next Hour)
- ⏰ **Reconcile job** will run automatically at the top of the next hour
- Updates your balance from Kraken

### In ~6 Hours (Next Signal Check)
- 📊 **Signal Poller** will run
- Fetches price data for BTC-USD, ETH-USD, etc.
- Calculates indicators (EMA12, EMA26, RSI)
- Generates signals
- **If conditions are met**: May place a trade
- **If not**: Waits for next cycle

### When a Trade Happens
You'll see logs like:
```
StrategyEvaluate: Evaluating strategy...
StrategyEvaluate: Top asset: BTC-USD
OrderExecute: Placing buy order for BTC-USD
OrderExecute: Order filled at $45,230.50
```

## Current Bot Status Summary

| Status | Value |
|--------|-------|
| **Connection** | ✅ Connected to Kraken |
| **Balance** | $25.41 USD |
| **Strategy** | ⏸️ Waiting (check dashboard for enabled/disabled) |
| **Next Signal Check** | ~6 hours from last run |
| **Next Reconcile** | Top of next hour |
| **Open Positions** | 0 (no trades yet) |

## How to Check Status

1. **Dashboard**: Visit `http://localhost:5173` and log in
2. **Metrics Tab**: See your NAV, P&L, balance
3. **Signals Tab**: See recent signal calculations
4. **Positions Tab**: See any open positions
5. **Trades Tab**: See trade history
6. **Settings Tab**: Configure strategy parameters

## Manual Actions You Can Take

- **Reconcile Balance**: Click "Reconcile Balance" button to sync balance immediately
- **Toggle Strategy**: Enable/disable trading in Settings
- **Manual Trade**: Place a manual trade via Trades tab (if enabled)
- **View Logs**: Check backend terminal for detailed logs

## Understanding the Strategy

The bot uses a **slow momentum rotation strategy**:

1. **Every 6 hours**, it checks which asset has the best momentum
2. **Indicators used**:
   - EMA12 vs EMA26 (trend direction)
   - RSI (momentum strength)
   - 24h volatility filter (safety)
3. **Entry conditions**: 
   - EMA12 > EMA26 (uptrend)
   - RSI between 40-70 (not overbought/oversold)
   - Volatility < 18% (avoid chaos)
4. **Position sizing**: Uses 10% of NAV per asset (conservative)
5. **Cooldown**: Won't re-enter same asset for 2 cycles (12 hours)

This is a **conservative, slow-moving strategy** designed to reduce fees and avoid volatile periods.

