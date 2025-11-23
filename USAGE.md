# Slow Joe Trading Bot - Usage Guide

## Overview

Slow Joe is an automated trading bot that rotates a portfolio between crypto assets based on slow momentum signals (EMA crossover + RSI). It trades **spot only** (no leverage) with conservative position sizing.

## Quick Start

### 1. Initial Setup

#### Prerequisites
- Docker and docker-compose (or Postgres + Redis running locally)
- Kraken API credentials (or use sandbox for testing)
- Node.js 20+ (for local development)

#### Configuration

1. **Set up environment variables:**
   ```bash
   cd backend
   cp .env.example .env
   ```

2. **Edit `backend/.env` with your settings:**
   ```bash
   # Exchange credentials (REQUIRED)
   EXCHANGE_NAME=kraken
   KRAKEN_API_KEY=your_api_key_here
   KRAKEN_API_SECRET=your_api_secret_here

   # Database (if not using Docker)
   DATABASE_URL=postgres://postgres:postgres@localhost:5432/rotationbot
   REDIS_HOST=localhost
   REDIS_PORT=6379

   # Strategy settings
   UNIVERSE=BTC-USD,ETH-USD  # Start with 2 assets to reduce fees
   CADENCE_HOURS=6           # How often to evaluate (4/6/12 hours)
   MAX_ALLOC_FRACTION=0.2     # Max 20% per asset (allows trading with lower NAV)
   MIN_ORDER_USD=5           # Minimum order size
   MIN_BALANCE_USD=20        # Stop trading if NAV drops below this

   # Risk controls
   VOLATILITY_PAUSE_PCT=18   # Pause if 24h return > 18%
   RSI_LOW=40                # RSI filter lower bound
   RSI_HIGH=70               # RSI filter upper bound

   # Admin login
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=your_secure_password

   # Alert system (optional but recommended)
   ALERTS_ENABLED=true
   ALERTS_EMAIL_ENABLED=true
   ALERTS_EMAIL_RECIPIENTS=your-email@example.com
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=your-email@gmail.com
   SMTP_PASSWORD=your-app-password
   SMTP_FROM=your-email@gmail.com
   ALERTS_LOW_BALANCE_USD=50
   ALERTS_LARGE_DRAWDOWN_PCT=10
   ```
   
   **Note**: For detailed alert setup instructions, see `ALERTS_SETUP.md`

### 2. Start the System

#### Option A: Using Docker Compose (Recommended)
```bash
# Start all services
docker-compose up

# Or run in background
docker-compose up -d
```

#### Option B: Local Development
```bash
# Terminal 1: Start Postgres and Redis
docker-compose up postgres redis

# Terminal 2: Start Backend
cd backend
npm install
npm run start:dev

# Terminal 3: Start Frontend
cd frontend
npm install
npm run dev
```

### 3. Access the Dashboard

1. Open http://localhost:5173 in your browser
2. Login with your admin credentials
3. You'll see the dashboard with:
   - **Metrics**: NAV, P&L, positions count
   - **Signals**: Recent indicator calculations
   - **Positions**: Current holdings
   - **Trades**: Trade history
   - **Settings**: Strategy configuration

## How It Works

### Strategy Logic

The bot follows this process every `CADENCE_HOURS` (default 6 hours):

1. **Signal Generation** (`SignalPoller` job):
   - Fetches 6-hour OHLC candles for each asset in universe
   - Calculates indicators:
     - EMA12 and EMA26
     - RSI(14)
     - Score = (EMA12/EMA26) × (1 - |RSI-50|/50)

2. **Entry Filters**:
   - EMA12 > EMA26 (uptrend)
   - RSI between 40-70 (not overbought/oversold)
   - 24h return < 18% (volatility pause)

3. **Ranking**:
   - Assets ranked by score
   - Top asset selected (default K=1)

4. **Position Sizing**:
   - Allocation = NAV × MAX_ALLOC_FRACTION (default 10%)
   - Respects MIN_ORDER_USD minimum

5. **Execution**:
   - Places limit maker orders (to save fees)
   - Falls back to market if not filled within timeout

### Jobs & Scheduling

- **SignalPoller**: Runs every 6 hours (configurable), generates signals
- **StrategyEvaluate**: Triggered by poller, determines trades needed
- **OrderExecute**: Executes individual trades
- **Reconcile**: Runs hourly, updates NAV from exchange balances

## Using the System

### Paper Trading First (Recommended)

**Before going live, test with paper trading:**

1. **Use Kraken Sandbox** (if available):
   - Get sandbox API credentials
   - Update `.env` with sandbox credentials
   - Test with fake money

2. **Or start with minimal capital**:
   - Fund your Kraken account with small amount (£50-£100)
   - Set `MIN_BALANCE_USD=20` to prevent over-trading
   - Monitor closely for first few days

### Starting Trading

1. **Ensure backend is running** and connected to exchange
2. **Check settings** in dashboard:
   - Verify universe (start with 2 assets)
   - Check cadence (6 hours is conservative)
   - Review risk parameters

3. **Enable strategy**:
   - Toggle "Strategy: Enabled" button in dashboard header
   - Or use API: `POST /api/strategy/toggle` with `{"enabled": true}`

4. **Monitor**:
   - Watch signals tab to see indicator calculations
   - Check positions tab for open holdings
   - Review trades tab for execution history
   - Monitor NAV in metrics tab

### Manual Controls

#### Enable/Disable Trading
- Use the toggle button in dashboard header
- Or API: `POST /api/strategy/toggle`

#### Manual Trade
- API endpoint: `POST /api/trade/manual`
- Body: `{"symbol": "BTC-USD", "side": "buy", "quantity": "0.001", "price": "50000"}`

#### Close All Positions
- Currently requires API call (to be added to UI)
- Or manually disable strategy and close positions on exchange

### Monitoring

#### Key Metrics to Watch

1. **NAV (Net Asset Value)**:
   - Should update hourly via reconcile job
   - Tracks total portfolio value

2. **Signals**:
   - Check that signals are being generated every cadence period
   - Verify indicators look reasonable

3. **Trades**:
   - Monitor execution success rate
   - Check for failed orders

4. **Positions**:
   - Verify positions match exchange balances
   - Check entry prices are reasonable

#### Alerts & Safety

The system includes several safety features:

- **Minimum Balance Gate**: Stops trading if NAV < MIN_BALANCE_USD
- **Volatility Pause**: Skips trading if 24h return > VOLATILITY_PAUSE_PCT
- **Emergency Stop**: Toggle in dashboard immediately disables trading
- **Conservative Sizing**: Max 10% per asset (configurable)

### Troubleshooting

#### No Signals Being Generated
- Check backend logs for errors
- Verify exchange API connection
- Ensure universe symbols are correct (e.g., "BTC-USD" not "BTCUSD")
- Check that enough historical data exists (needs 26+ candles)

#### Trades Not Executing
- Check exchange API credentials
- Verify sufficient balance
- Check MIN_ORDER_USD threshold
- Review order execution logs in backend

#### Database Issues
- Ensure Postgres is running
- Check DATABASE_URL in .env
- Verify database exists: `createdb rotationbot`

#### Redis Issues
- Ensure Redis is running
- Check REDIS_HOST and REDIS_PORT
- Jobs won't process if Redis is down

## Configuration Examples

### Conservative Setup (Recommended for Start)
```bash
UNIVERSE=BTC-USD,ETH-USD
CADENCE_HOURS=6
MAX_ALLOC_FRACTION=0.1
MIN_BALANCE_USD=20
VOLATILITY_PAUSE_PCT=18
RSI_LOW=40
RSI_HIGH=70
```

### More Aggressive Setup
```bash
UNIVERSE=BTC-USD,ETH-USD,SOL-USD
CADENCE_HOURS=4
MAX_ALLOC_FRACTION=0.15
MIN_BALANCE_USD=50
VOLATILITY_PAUSE_PCT=25
RSI_LOW=35
RSI_HIGH=75
```

### Paper Trading Setup
```bash
# Use sandbox credentials
KRAKEN_API_KEY=sandbox_key
KRAKEN_API_SECRET=sandbox_secret
# Or use minimal real capital
MIN_BALANCE_USD=10
MAX_ALLOC_FRACTION=0.05
```

## API Endpoints

All endpoints require JWT authentication (except login):

- `POST /api/auth/login` - Login
- `GET /api/metrics` - Get NAV, P&L, positions
- `GET /api/signals` - Recent signals
- `GET /api/positions` - Open/closed positions
- `GET /api/trade` - Recent trades
- `POST /api/trade/manual` - Manual trade
- `POST /api/strategy/toggle` - Enable/disable trading
- `GET /api/settings` - Current settings

## Best Practices

1. **Start Small**: Begin with minimal capital (£50-£100)
2. **Paper Trade First**: Test with sandbox if available
3. **Monitor Closely**: Check dashboard daily initially
4. **Review Logs**: Check backend logs for errors
5. **Adjust Gradually**: Change one parameter at a time
6. **Keep Backups**: Export trade history regularly
7. **Set Alerts**: Monitor exchange for unexpected activity

## Safety Reminders

⚠️ **Important**:
- This is **spot trading only** (no leverage)
- Start with small capital
- Monitor regularly
- Keep emergency stop accessible
- Never share API credentials
- Use API keys with **read + trade** permissions only (no withdrawal)

## Next Steps

1. Configure your `.env` file
2. Start the system
3. Paper trade or start with minimal capital
4. Monitor for a few days
5. Adjust parameters based on performance
6. Scale up gradually if comfortable

For more details, see `DESIGN.md` for technical architecture.

