# Slow Joe Trading Bot - Improvement Plan

## ✅ Completed Fixes

### 1. Strategy Execution Logic Bug ✅
**Status**: Fixed
- Modified `StrategyService.evaluate()` to return `TradeDecision[]` instead of `void`
- Updated `StrategyEvaluateProcessor` to use returned trades and enqueue them properly
- Removed duplicate logic that was closing all positions without using strategy decisions

**Files Modified**:
- `backend/src/strategy/strategy.service.ts`
- `backend/src/jobs/processors/strategy-evaluate.processor.ts`

### 2. Cooldown Mechanism Implementation ✅
**Status**: Fixed
- Implemented cooldown tracking using `cooldownMap` that stores cycle counts per symbol
- Cooldown decrements each evaluation cycle
- New positions check cooldown before opening (respects `COOLDOWN_CYCLES` config, default 2)
- Cooldown is set when a new position is opened
- Added `clearCooldown()` method for manual clearing

**Files Modified**:
- `backend/src/strategy/strategy.service.ts`

### 3. Order Execution with Fill Timeout & Market Order Fallback ✅
**Status**: Fixed
- Replaced fixed wait with periodic polling (every 30 seconds)
- Monitors order status until filled or timeout (default 15 minutes)
- Cancels unfilled limit orders after timeout
- Implements market order fallback with slippage check
- Validates slippage doesn't exceed `MAX_SLIPPAGE_PCT` before placing market order
- Handles edge cases (order filled during cancellation, etc.)

**Files Modified**:
- `backend/src/jobs/processors/order-execute.processor.ts`

### 4. Position Sizing Lot Steps ✅
**Status**: Fixed
- Added `LotSizeInfo` interface to track lot size, decimals, and minimum order size
- Implemented `getLotSizeInfo()` in KrakenAdapter to fetch from Kraken API
- Added caching for lot size info (24-hour TTL)
- Updated `calculateSize()` to use `roundToLotSize()` instead of generic 8-decimal rounding
- Validates against exchange minimum order sizes
- Falls back to safe defaults if API call fails

**Files Modified**:
- `backend/src/exchange/exchange.service.ts` - Added lot size caching and rounding
- `backend/src/exchange/adapters/kraken.adapter.ts` - Added `getLotSizeInfo()` method
- `backend/src/strategy/strategy.service.ts` - Updated `calculateSize()` to use lot size rounding

---

## 🔴 Critical Issues & Bugs (Remaining)

*All critical bugs have been fixed!*

---

## 🟠 Missing Features (High Priority)

### 5. Backtesting System ✅
**Status**: Implemented
- Created complete backtesting system with CSV import
- Reuses StrategyService logic for consistency
- Simulates trades with slippage/fees
- Generates comprehensive performance metrics
- Full UI integration in Dashboard

**Files Created**:
- `backend/src/backtester/backtester.module.ts`
- `backend/src/backtester/backtester.service.ts`
- `backend/src/backtester/backtester.controller.ts`
- `backend/src/backtester/dto/backtest-request.dto.ts`
- `backend/src/backtester/dto/backtest-result.dto.ts`
- `frontend/src/components/Backtest.tsx`
- `frontend/src/components/Backtest.css`

**Priority**: P1 (High Priority) - ✅ Completed

### 6. Fee Tracking & NAV Calculation ✅
**Status**: Implemented
- Added fee field to Trade entity
- Extract fees from Kraken API order responses
- Record fees in all trade executions (limit and market orders)
- Track total fees in metrics
- Display fees in dashboard and trades components
- Fees are automatically accounted for in NAV (exchange balance already reflects fees)

**Files Modified**:
- `backend/src/entities/trade.entity.ts` - Added fee field
- `backend/src/exchange/exchange.service.ts` - Added fee to OrderResult interface
- `backend/src/exchange/adapters/kraken.adapter.ts` - Extract fees from API
- `backend/src/jobs/processors/order-execute.processor.ts` - Record fees
- `backend/src/jobs/processors/reconcile.processor.ts` - Track total fees
- `backend/src/metrics/metrics.service.ts` - Fee tracking methods
- `backend/src/metrics/metrics.controller.ts` - Return fees in API
- `frontend/src/components/Dashboard.tsx` - Display total fees
- `frontend/src/components/Trades.tsx` - Display fees per trade

**Priority**: P1 (High Priority) - ✅ Completed

### 7. Alerting System ✅
**Problem**: Design specifies Telegram/email alerts for critical events, but only console.log exists.

**Implementation Needed**:
- ✅ Create `backend/src/alerts/alerts.service.ts` with email support (nodemailer)
- ✅ Support email alerts with HTML formatting
- ✅ Alert on: order failures, exchange unreachable, low balance, large drawdowns, health check failures
- ✅ Configurable alert thresholds via environment variables
- ✅ Alert history/logging with database storage
- ✅ Cooldown mechanism to prevent alert spam
- ✅ API endpoints for viewing alert history

**Files Created**:
- ✅ `backend/src/entities/alert.entity.ts` - Alert database entity
- ✅ `backend/src/alerts/alerts.module.ts` - Alerts module
- ✅ `backend/src/alerts/alerts.service.ts` - Email alert service
- ✅ `backend/src/alerts/alerts.controller.ts` - Alert history API
- ✅ `backend/src/alerts/dto/alert-config.dto.ts` - Configuration DTO

**Integration Points**:
- ✅ Order execution processor - alerts on order failures
- ✅ Health service - alerts on database/Redis/exchange failures
- ✅ Reconcile processor - alerts on low balance and large drawdowns

**Environment Variables Required**:
- `ALERTS_ENABLED=true`
- `ALERTS_EMAIL_ENABLED=true`
- `ALERTS_EMAIL_RECIPIENTS=email1@example.com,email2@example.com`
- `SMTP_HOST=smtp.gmail.com`
- `SMTP_PORT=587`
- `SMTP_USER=your-email@gmail.com`
- `SMTP_PASSWORD=your-app-password`
- `SMTP_SECURE=false`
- `SMTP_FROM=your-email@gmail.com`
- `ALERTS_LOW_BALANCE_USD=50`
- `ALERTS_LARGE_DRAWDOWN_PCT=10`
- `ALERTS_COOLDOWN_ORDER_FAILURE=60` (minutes)
- `ALERTS_COOLDOWN_EXCHANGE=30`
- `ALERTS_COOLDOWN_LOW_BALANCE=1440` (24 hours)
- `ALERTS_COOLDOWN_DRAWDOWN=60`

**Priority**: P1 (High Priority) - ✅ COMPLETED

### 8. Health & Monitoring Endpoints ✅
**Status**: Implemented
- Created comprehensive health check system
- `GET /health` - Simple health check (used by frontend)
- `GET /api/health` - Detailed health check with all components
- `GET /api/metrics/prometheus` - Prometheus metrics endpoint
- Checks database, Redis, and exchange connectivity
- Tracks queue depths (waiting, active, completed, failed, delayed)
- Measures response times for each component
- Returns structured health status (healthy/unhealthy/degraded)
- Prometheus format with proper metrics

**Files Created/Modified**:
- `backend/src/health/health.module.ts`
- `backend/src/health/health.controller.ts`
- `backend/src/health/health.service.ts`
- `backend/src/app.controller.ts` - Updated to use HealthService
- `backend/src/metrics/metrics.controller.ts` - Added Prometheus endpoint
- `frontend/src/components/Dashboard.tsx` - Updated health check

**Priority**: P1 (High Priority) - ✅ Completed

---

## 🟡 Testing & Quality

### 9. Unit Tests
**Problem**: No test files exist. Jest configured but unused.

**Priority Tests**:
- `StrategyService.computeIndicators()` - verify EMA/RSI calculations
- `StrategyService.calculateSize()` - test position sizing logic
- `StrategyService.evaluate()` - test trade decision logic with cooldown
- Exchange adapter methods - mock API responses
- Order execution processor - test fill timeout and market order fallback

**Files to Create**:
- `backend/src/strategy/strategy.service.spec.ts`
- `backend/src/exchange/exchange.service.spec.ts`
- `backend/src/jobs/processors/order-execute.processor.spec.ts`
- `backend/src/jobs/processors/strategy-evaluate.processor.spec.ts`

**Priority**: P1 (High Priority)

### 10. Integration Tests
**Problem**: No integration tests for job processors or API endpoints.

**Implementation Needed**:
- E2E tests for signal poller → strategy evaluate → order execute flow
- Test with mocked exchange responses
- Verify database state after job execution
- Test API endpoints with authentication

**Files to Create**:
- `backend/test/jobs.e2e-spec.ts`
- `backend/test/api.e2e-spec.ts`

**Priority**: P2 (Medium Priority)

---

## 🟢 Observability & Logging

### 11. Structured Logging ✅
**Problem**: Using `console.log/error` instead of structured logging.

**Fix Needed**: 
- ✅ Integrate Winston logger
- ✅ Structured JSON logs with context (job ID, symbol, etc.)
- ✅ Log levels (debug, info, warn, error)
- ✅ Request ID tracking for API calls

**Files Modified**:
- ✅ `backend/src/logger/logger.service.ts` - Winston logger service
- ✅ `backend/src/logger/logger.module.ts` - Logger module
- ✅ `backend/src/logger/request-id.middleware.ts` - Request ID middleware
- ✅ `backend/src/main.ts` - configured logger
- ✅ Replaced all `console.log/error` with logger calls across all services

**Priority**: P1 (High Priority) - ✅ COMPLETED

### 12. Metrics Time Series
**Problem**: NAV stored as single latest value, no historical tracking for charts/analysis.

**Fix Needed**: 
- Ensure NAV snapshots are stored regularly (already in `Metric` entity)
- Add endpoint `/api/metrics/history` for time series data
- Frontend chart showing NAV over time
- Store metrics at regular intervals (every hour or on NAV change)

**Files to Modify**:
- `backend/src/metrics/metrics.controller.ts` - add history endpoint
- `frontend/src/components/Metrics.tsx` - add chart

**Priority**: P2 (Medium Priority)

---

## 🔵 Frontend Improvements

### 13. Real-time Updates
**Problem**: Dashboard requires manual refresh to see updates.

**Fix Needed**: 
- WebSocket or Server-Sent Events for live updates
- Auto-refresh signals, positions, NAV every 30-60 seconds
- Show "last updated" timestamps
- Loading states during refresh

**Files to Modify**:
- `backend/src/main.ts` - add WebSocket/SSE support
- `frontend/src/components/Dashboard.tsx` - add auto-refresh
- `frontend/src/components/*.tsx` - add last updated timestamps

**Priority**: P2 (Medium Priority)

### 14. Enhanced Charts & Visualization
**Problem**: Basic dashboard, could show more insights.

**Enhancements Needed**:
- NAV chart over time (using Recharts)
- P&L breakdown by asset
- Signal strength visualization
- Trade execution timeline
- Performance metrics (win rate, avg hold time)

**Files to Modify/Create**:
- `frontend/src/components/Metrics.tsx` - add charts
- `frontend/src/components/Performance.tsx` (new)

**Priority**: P3 (Nice to Have)

### 15. Better Error Handling & User Feedback
**Problem**: Errors may not be visible to user, no loading states.

**Fix Needed**:
- Error toast notifications
- Loading spinners for async operations
- Clear error messages for API failures
- Retry mechanisms for failed requests

**Files to Modify**:
- `frontend/src/components/*.tsx` - add error handling
- `frontend/src/contexts/ErrorContext.tsx` (new)

**Priority**: P2 (Medium Priority)

---

## 🟣 Configuration & Runtime

### 16. Runtime Configuration Updates
**Problem**: Strategy parameters require restart to change.

**Fix Needed**:
- Add `PUT /api/settings` endpoint to update config at runtime
- Store in database or in-memory with persistence
- Validate new values before applying
- Log config changes for audit

**Files to Modify**:
- `backend/src/settings/settings.controller.ts`
- `backend/src/settings/settings.service.ts`

**Priority**: P2 (Medium Priority)

### 17. Database Migrations
**Problem**: No migration files visible, schema changes might cause issues.

**Fix Needed**:
- Create initial migration for current schema
- Document migration process
- Add migration run to deployment scripts

**Files to Create**:
- `backend/src/migrations/1234567890-InitialSchema.ts`

**Priority**: P2 (Medium Priority)

---

## 🔴 Security & Production Readiness

### 18. Security Hardening
**Issues**:
- Default admin/admin credentials
- No rate limiting on API endpoints
- JWT secret might be weak
- No CORS configuration visible

**Fixes Needed**:
- Force password change on first login
- Add rate limiting (express-rate-limit)
- Validate JWT secret strength
- Configure CORS properly for production
- Add API key rotation support

**Files to Modify**:
- `backend/src/auth/auth.service.ts` - password change check
- `backend/src/main.ts` - rate limiting, CORS
- `backend/src/auth/auth.controller.ts` - password change endpoint

**Priority**: P2 (Medium Priority)

### 19. Error Recovery & Resilience
**Problem**: Job failures might not retry properly, no circuit breaker for exchange API.

**Fixes Needed**:
- Configure BullMQ retry strategies per job type
- Add circuit breaker for exchange API calls (opossum library)
- Graceful degradation if exchange is down
- Dead letter queue for permanently failed jobs

**Files to Modify**:
- `backend/src/jobs/jobs.module.ts` - configure retry strategies
- `backend/src/exchange/exchange.service.ts` - add circuit breaker

**Priority**: P2 (Medium Priority)

---

## 🟤 Performance & Scalability

### 20. Caching Strategy
**Problem**: OHLCV data fetched repeatedly, no caching mentioned.

**Fix Needed**:
- Verify OHLCV caching implementation (already has `useCache` parameter)
- Cache exchange ticker data (short TTL, 5-10 seconds)
- Redis cache for frequently accessed data

**Files to Modify**:
- `backend/src/exchange/exchange.service.ts` - verify caching
- Add ticker caching

**Priority**: P3 (Nice to Have)

### 21. Database Query Optimization
**Problem**: Potential N+1 queries in reconcile and strategy evaluation.

**Fix Needed**:
- Use TypeORM relations/joins instead of multiple queries
- Add database indexes on frequently queried fields (symbol, status, createdAt)
- Batch database operations where possible

**Files to Modify**:
- `backend/src/entities/*.entity.ts` - add indexes
- `backend/src/jobs/processors/reconcile.processor.ts` - optimize queries

**Priority**: P3 (Nice to Have)

---

## 📚 Documentation

### 22. API Documentation
**Problem**: No OpenAPI/Swagger documentation.

**Fix Needed**: 
- Add Swagger/OpenAPI with `@nestjs/swagger`
- Document all endpoints with examples
- Include authentication requirements

**Files to Modify**:
- `backend/src/main.ts` - add Swagger setup
- Add decorators to all controllers

**Priority**: P3 (Nice to Have)

### 23. Deployment Guide
**Problem**: No production deployment documentation.

**Fix Needed**:
- Add `DEPLOYMENT.md` with production setup steps
- Environment variable reference
- Monitoring setup guide
- Backup/restore procedures

**Files to Create**:
- `DEPLOYMENT.md`

**Priority**: P3 (Nice to Have)

---

## Priority Summary

**P0 (Critical - Fix Immediately)**:
- ✅ All critical bugs fixed!

**P1 (High Priority - Next Sprint)**:
- ✅ #5: Backtesting system
- ✅ #6: Fee tracking
- ✅ #7: Alerting system
- ✅ #8: Health endpoints
- ✅ #11: Structured logging
- #9: Unit tests

**P2 (Medium Priority)**:
- #10: Integration tests
- #12: Metrics time series
- #13: Real-time frontend updates
- #15: Error handling UX
- #16: Runtime configuration
- #17: Database migrations
- #18: Security hardening
- #19: Error recovery

**P3 (Nice to Have)**:
- #14: Enhanced charts
- #20: Caching improvements
- #21: Query optimization
- #22: API documentation
- #23: Deployment guide

