# Slow Momentum Spot Rotation Bot — DESIGN.md

**Purpose:** A self-contained, market‑neutral‑adjacent (spot-only) automated trading system that rotates a small portfolio between a basket of liquid spot crypto assets (e.g. BTC, ETH, SOL) using slow momentum signals. Built with **TypeScript**, **NestJS**, **TypeORM** + **Postgres**, **BullMQ** (Redis), and **React + Vite**. Designed to be dropped into Cursor IDE as a single design document.

---

# Quick Start (how to use this file in Cursor IDE)

1. Copy this file to Cursor as `DESIGN.md`.
2. Ask Cursor to scaffold backend and frontend: e.g. `Generate NestJS backend and React frontend using DESIGN.md`.
3. Use section headers to request targeted scaffolds (Entities, Kraken adapter, Strategy service, Backtester, Docker compose, etc.).

---

# One-line summary

Rotate allocated capital into the top momentum asset every 4–12 hours (default 6h) using EMA crossover + RSI + volatility filter; trade spot only, conservative sizing, paper-test then go live with small capital (£50).

---

# High-level architecture

```
                 +------------------+
                 |  Frontend (UI)   |
                 |  React + Vite    |
                 +--------+---------+
                          |
                          v
+---------------+   HTTPS / JWT   +--------------------+
| Scheduler /   | <--------------> |  Backend (NestJS)  |
| Cron (6h)     |                 | - Strategy Service |
+---------------+                 | - Exchange Adapter |
     |  ^                          | - Jobs (BullMQ)    |
     v  |                          | - TypeORM/Postgres |
+---------------+                  +---------+----------+
|  Redis / Bull  |                           |
+---------------+                            v
                                          Exchange API
                                           (Kraken / Coinbase)
```

Components:

* **Backend (NestJS)**: exchange adapter, strategy engine, scheduler, workers, REST API.
* **Database**: Postgres via TypeORM for persistence (assets, signals, positions, trades, metrics).
* **Queue**: Redis + BullMQ for queued jobs and retries.
* **Frontend**: React + Vite dashboard for metrics, controls, and manual trades.
* **Backtester**: reuses the same indicator + sizing logic for simulation.

---

# Non‑functional goals

* Start small: run on £50 capital.
* Safety-first: no leverage, conservative sizing, manual kill-switch.
* Deterministic: live logic must match backtest logic.
* Robust: idempotent jobs, retry/backoff, health checks.
* Observable: NAV/time series, trade logs, alerts.

---

# Exchange choice (UK‑friendly)

**Primary**: Kraken (spot trading; API available in UK) — recommended.
**Alternative**: Coinbase Advanced / Coinbase Pro (spot).
Use exchange sandbox for testing. Avoid derivatives to remain FCA-compliant for UK retail.

---

# Strategy overview (defaults)

* **Universe**: configurable list (default: `BTC-USD, ETH-USD, SOL-USD` or USDT pairs if exchange uses USDT). Start with 2 assets to reduce fees.
* **Cadence**: every **6 hours** (configurable to 4/6/12h).
* **Indicators (on 6-hour candles)**:

  * EMA Short = 12
  * EMA Long = 26
  * RSI Period = 14
* **Entry filter**: `EMA12 > EMA26` AND `RSI` within `[RSI_LOW=40, RSI_HIGH=70]` AND 24h absolute return < `VOLATILITY_PAUSE_PCT` (default 18%).
* **Ranking**: `score = (EMA12/EMA26) * (1 - abs(RSI-50)/50)` — pick top `K` assets (default `K=1`).
* **Position sizing**: `alloc = NAV * MAX_ALLOC_FRACTION` (default 20% per asset); respect `MIN_ORDER_USD` and exchange lot steps.
* **Execution**: prefer limit maker orders at mid*±offset (0.1%) with fill timeout; fall back to market order if not filled.
* **Cooldown**: do not re-enter same asset within `COOLDOWN_CYCLES` (default 2 cycles).

Rationale: slow cadence reduces slippage and fee drag; conservative filters avoid entering during chaotic moves.

---

# Database schema (TypeORM entities)

### `Asset` (assets to trade)

```ts
@Entity('assets')
export class Asset {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() symbol: string; // e.g. BTC-USD
  @Column() displayName: string; // BTC
  @Column({ default: true }) enabled: boolean;
}
```

### `Signal` (indicator snapshot)

```ts
@Entity('signals')
export class Signal {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() symbol: string;
  @Column('jsonb') indicators: any; // {ema12, ema26, rsi, score}
  @Column() cadenceWindow: string; // e.g. 6h
  @CreateDateColumn() generatedAt: Date;
}
```

### `Position` (open holding)

```ts
@Entity('positions')
export class Position {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() symbol: string;
  @Column('decimal', { precision: 18, scale: 8 }) quantity: string;
  @Column('decimal', { precision: 18, scale: 8 }) entryPrice: string;
  @Column({ type: 'varchar', default: 'open' }) status: 'open'|'closed';
  @CreateDateColumn() openedAt: Date;
  @Column({ nullable: true }) closedAt: Date;
  @Column('jsonb', { nullable: true }) metadata: any;
}
```

### `Trade` (executed orders)

```ts
@Entity('trades')
export class Trade {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() symbol: string;
  @Column() side: 'buy'|'sell';
  @Column('decimal', { precision: 18, scale: 8 }) quantity: string;
  @Column('decimal', { precision: 18, scale: 8 }) price: string;
  @Column() exchangeOrderId: string;
  @CreateDateColumn() createdAt: Date;
}
```

### `Metric` (NAV and misc)

```ts
@Entity('metrics')
export class Metric {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() key: string; // e.g., NAV
  @Column('jsonb') value: any;
  @CreateDateColumn() createdAt: Date;
}
```

---

# Jobs / Scheduler

1. **SignalPoller** — CRON or Bull recurring job every `CADENCE_HOURS` (default 6h).

   * Fetch OHLC 6h candles for universe from exchange or public API.
   * Compute indicators for each asset.
   * Persist `Signal` and push `strategy.evaluate` job.

2. **StrategyEvaluate** (worker) — triggered by poller.

   * Load latest signals and current NAV.
   * Rank assets and compute target portfolio (top K).
   * Compute required trades to move from current holdings to target.
   * Enqueue `order.execute` jobs for each trade.

3. **OrderExecute** (worker)

   * Place limit order (maker) with idempotency key.
   * Monitor fill; if partial or not filled within `FILL_TIMEOUT`, escalate: cancel and optionally place market.
   * Persist `Trade` record and update `Position`.

4. **Reconcile** — hourly job.

   * Refresh balances and open orders from exchange; reconcile DB state.

5. **BacktesterRunner** — on demand; uses same strategy logic but simulated on historical OHLC.

6. **Watchdog / Alerts** — health checks (job lags, failed workers, exchange unreachable); send Telegram/email.

---

# API endpoints (REST)

* `POST /api/auth/login` — admin login (JWT)
* `GET /api/metrics` — NAV, total P&L, recent fees, positions
* `GET /api/signals` — recent signals
* `GET /api/positions` — open/closed
* `POST /api/trade/manual` — manual buy/sell (admin)
* `POST /api/settings` — update thresholds
* `POST /api/strategy/toggle` — enable/disable automated trading

All endpoints protected by JWT; admin UI uses these.

---

# Indicator & sizing code (reference)

### computeIndicators (6h candles)

```ts
import { EMA, RSI } from 'technicalindicators';

function computeIndicators(candles) {
  const closes = candles.map(c => c.close);
  const ema12 = EMA.calculate({ period: 12, values: closes }).slice(-1)[0];
  const ema26 = EMA.calculate({ period: 26, values: closes }).slice(-1)[0];
  const rsi  = RSI.calculate({ period: 14, values: closes }).slice(-1)[0];
  const score = (ema12 / ema26) * (1 - Math.abs((rsi ?? 50) - 50) / 50);
  return { ema12, ema26, rsi, score };
}
```

### calculateSize

```ts
function calculateSize(navUsd, priceUsd, fraction = 0.1, minUsd = 5) {
  const alloc = navUsd * fraction;
  if (alloc < minUsd) return 0;
  const qty = alloc / priceUsd;
  return roundToStep(qty, getLotStep(symbol));
}
```

Match these functions exactly in backtester and live to avoid mismatch.

---

# Execution & order strategy

* Use **limit-maker** orders at mid ± makerOffset (0.1%) to save fees.
* If maker order not filled within `FILL_TIMEOUT` (e.g., 15 minutes), cancel and re-evaluate: either reduce price or execute market order with `maxSlippage` cap.
* Always attach `clientOrderId` to support idempotent retries.
* Record exchange fees and subtract from NAV.

---

# Backtesting & evaluation

* Use historical 1h or 6h OHLC CSV. Normalize timezone to UTC.
* Replay: for each cadence bar, generate signal -> compute target -> simulate trades at next bar open (apply slippage + fees).
* Produce metrics: CAGR, annualized volatility, max drawdown, Sharpe-ish, turnover, fees paid.
* Parameter sweep: cadence (4/6/12h), EMA periods, RSI bounds, fee/slippage sensitivity.
* Walk-forward: train on older half, validate on newer half to avoid lookahead.

---

# Risk controls & safety

* **No leverage** — spot only.
* **Min balance gate**: if NAVUSD < `MIN_BALANCE_USD` (default £20) → disable trading.
* **Max allocation per asset**: `MAX_ALLOC_FRACTION` default 0.2 (20%).
* **Volatility pause**: if 24h return > `VOLATILITY_PAUSE_PCT`, pause trading.
* **Emergency stop**: dashboard toggle that immediately prevents job enqueue.
* **Manual market-close**: admin endpoint to close all positions with market orders.

---

# Observability & alerts

* Log all trades, signals, metrics. Store NAV time series in `metrics` table.
* Send alerts to Telegram or email for: order failure, exchange unreachable, low balance, unexpected large drawdown.
* Health endpoints: `/health` and `/metrics/prometheus` (optional).

---

# Deployment & local dev

* **Local**: `docker-compose.yml` with Postgres, Redis, backend, frontend.
* **Prod**: Managed Postgres (Neon/RDS), managed Redis (Upstash/RedisLabs), deploy backend to Fly/Render/Hetzner container.
* Secrets in environment variables or vault.
* Use TLS and restrict dashboard to known IPs if possible.

Example `docker-compose` services: `postgres`, `redis`, `backend`, `frontend`.

---

# `.env.example`

```
NODE_ENV=development
PORT=3000
FRONTEND_URL=http://localhost:5173

EXCHANGE_NAME=kraken
KRAKEN_API_KEY=your_key
KRAKEN_API_SECRET=your_secret

DATABASE_URL=postgres://postgres:postgres@localhost:5432/rotationbot
REDIS_URL=redis://localhost:6379
JWT_SECRET=change_this

UNIVERSE=BTC-USD,ETH-USD,SOL-USD
CADENCE_HOURS=6
MAX_ALLOC_FRACTION=0.2
MIN_ORDER_USD=5
MIN_BALANCE_USD=20
VOLATILITY_PAUSE_PCT=18
RSI_LOW=40
RSI_HIGH=70
EMA_SHORT=12
EMA_LONG=26
FILL_TIMEOUT_MINUTES=15
MAKER_OFFSET_PCT=0.001
MAX_SLIPPAGE_PCT=0.005
```

---

# Testing strategy

* Unit tests for indicator and sizing functions.
* Integration tests using Kraken sandbox / Coinbase sandbox.
* E2E tests: simulate cadence events, assert trades created and positions updated.
* Backtester regression tests: ensure live and backtest results align on simple scenarios.

---

# Next concrete actions I can generate for you (choose numbers)

1. Full NestJS backend scaffold (modules: exchange-adapter for Kraken, strategy, jobs, entities).
2. `exchange/kraken-adapter.ts` implementation skeleton (placeOrder, getTicker, getBalance).
3. `strategy.service.ts` implementing cadence, indicator calc, ranking, and job enqueue.
4. Backtester script (Node) that replays CSV OHLC and outputs performance metrics.
5. Minimal React + Vite dashboard scaffold.
6. `docker-compose.yml` for local dev (Postgres + Redis + backend + frontend).
7. `.env.example` (copy-ready).

Reply with the numbers you want (e.g., `1,2,4`) and I’ll output the files for you to paste into Cursor.

---

*End of DESIGN.md*
