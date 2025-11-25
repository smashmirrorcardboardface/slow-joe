# Slow Joe Trading Bot

A self-contained, market-neutral-adjacent automated trading system that rotates a portfolio between liquid spot crypto assets using slow momentum signals.

## Architecture

- **Backend**: NestJS with TypeORM + PostgreSQL, BullMQ (Redis) for job queues
- **Frontend**: React + Vite dashboard
- **Exchange**: Kraken (spot trading)

## Quick Start

### Prerequisites

- Docker and Docker Compose (or docker-compose standalone)
- Node.js 20+ (for local development)

**Note**: If `docker compose` doesn't work, install docker-compose standalone:
```bash
mkdir -p ~/.local/bin
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o ~/.local/bin/docker-compose
chmod +x ~/.local/bin/docker-compose
export PATH="$HOME/.local/bin:$PATH"
```

Make sure your user is in the docker group:
```bash
sudo usermod -aG docker $USER
# Then log out and back in, or run: newgrp docker
```

### Using Docker Compose

1. Copy environment variables:
   ```bash
   cp backend/.env.example backend/.env
   ```

2. Update `backend/.env` with your Kraken API credentials and other settings.
   
   **Important**: For email alerts, configure SMTP settings. See `ALERTS_SETUP.md` for detailed instructions.

3. **If you get permission errors** (files owned by root), fix permissions first:
   ```bash
   ./fix-permissions.sh
   # Or manually:
   sudo chown -R $USER:$USER backend/dist frontend/dist 2>/dev/null
   sudo rm -rf backend/dist frontend/dist
   ```

4. Start all services:
   ```bash
   # Use docker-compose (with hyphen) if docker compose doesn't work
   docker-compose up
   # Or: docker compose up (if compose plugin is installed)
   ```

4. Access the frontend at http://localhost:5173
5. Backend API is available at http://localhost:3000

### Local Development

#### Backend

```bash
cd backend
npm install
cp .env.example .env
# Update .env with your settings
npm run start:dev
```

#### Running Tests

See [TESTING.md](./TESTING.md) for detailed testing documentation.

Quick commands:
```bash
cd backend
# Run tests once
npm test

# Run tests in watch mode (automatically re-runs on file changes)
npm run test:watch

# Run tests with coverage
npm run test:cov
```

#### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Default Login

- Username: `admin`
- Password: `admin`

(Change these in production via `ADMIN_USERNAME` and `ADMIN_PASSWORD` environment variables)

## Features

- **Automated Trading**: Rotates portfolio based on EMA crossover + RSI signals
- **Risk Controls**: Conservative sizing, volatility filters, emergency stop
- **Dashboard**: Real-time metrics, signals, positions, and trades
- **Job Queue**: BullMQ for reliable job processing with retries
- **Backtesting**: (To be implemented) Uses same strategy logic for historical simulation

## Strategy Parameters

Configure via environment variables:

- `UNIVERSE`: Comma-separated list of trading pairs (default: BTC-USD,ETH-USD)
- `CADENCE_HOURS`: How often to evaluate signals (default: 6)
- `MAX_ALLOC_FRACTION`: Max allocation per asset (default: 0.1 = 10%)
- `RSI_LOW` / `RSI_HIGH`: RSI filter bounds (default: 40-70)
- `VOLATILITY_PAUSE_PCT`: Pause trading if 24h return exceeds this (default: 18%)

See `backend/.env.example` for all available settings.

### Running Multiple Bots on the Same Kraken Account

Slow Joe can now tag every position and order with a `BOT_ID`, allowing multiple bots to share a Kraken account without stepping on each other’s trades. When running alongside another bot (e.g., Fast Eddy):

- Set a unique `BOT_ID` in `backend/.env` (default is `slow-joe`).
- Set a unique numeric `BOT_USERREF_PREFIX` (1–3 digits). Orders created by Slow Joe will embed this prefix in Kraken’s `userref`, and Slow Joe will only manage orders with that prefix.
- Ensure each bot’s `UNIVERSE` is disjoint, or consciously coordinate which symbols they control. Slow Joe will only create/close positions that carry its `BOT_ID`, but exchange balances are still shared.

Example `.env` snippet:

```
BOT_ID=slow-joe
BOT_USERREF_PREFIX=10
```

Run the other bot with a different `BOT_ID`/prefix combo to keep their orders and reconciliations isolated.

## API Endpoints

All endpoints require JWT authentication (except `/api/auth/login`):

- `POST /api/auth/login` - Login
- `GET /api/metrics` - NAV, P&L, positions
- `GET /api/signals` - Recent signals
- `GET /api/positions` - Open/closed positions
- `GET /api/trade` - Recent trades
- `POST /api/trade/manual` - Manual trade execution
- `POST /api/strategy/toggle` - Enable/disable automated trading
- `GET /api/settings` - Current strategy settings

## Safety Features

- No leverage (spot only)
- Minimum balance gate
- Volatility pause
- Emergency stop toggle
- Conservative position sizing

## License

MIT

