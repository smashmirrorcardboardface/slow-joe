import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StrategyService, IndicatorResult } from '../strategy/strategy.service';
import { ExchangeService, OHLCV } from '../exchange/exchange.service';
import { BacktestRequestDto } from './dto/backtest-request.dto';
import { BacktestResultDto } from './dto/backtest-result.dto';

interface SimulatedPosition {
  symbol: string;
  quantity: number;
  entryPrice: number;
  entryDate: string;
}

interface SimulatedState {
  cash: number;
  positions: Map<string, SimulatedPosition>;
  trades: Array<{
    date: string;
    symbol: string;
    side: 'buy' | 'sell';
    quantity: number;
    price: number;
    fee: number;
    nav: number;
  }>;
  navHistory: Array<{
    date: string;
    nav: number;
    cash: number;
    positionsValue: number;
  }>;
}

@Injectable()
export class BacktesterService {
  constructor(
    private strategyService: StrategyService,
    private exchangeService: ExchangeService,
    private configService: ConfigService,
  ) {}

  async runBacktest(request: BacktestRequestDto): Promise<BacktestResultDto> {
    // Parse configuration
    const config = {
      cadenceHours: request.cadenceHours || parseInt(this.configService.get<string>('CADENCE_HOURS') || '6', 10),
      maxAllocFraction: request.maxAllocFraction || parseFloat(this.configService.get<string>('MAX_ALLOC_FRACTION') || '0.1'),
      rsiLow: request.rsiLow || parseFloat(this.configService.get<string>('RSI_LOW') || '40'),
      rsiHigh: request.rsiHigh || parseFloat(this.configService.get<string>('RSI_HIGH') || '70'),
      volatilityPausePct: request.volatilityPausePct || parseFloat(this.configService.get<string>('VOLATILITY_PAUSE_PCT') || '18'),
      minOrderUsd: request.minOrderUsd || parseFloat(this.configService.get<string>('MIN_ORDER_USD') || '5'),
      slippagePct: request.slippagePct || 0.001,
      feeRate: request.feeRate || 0.0016,
      cooldownCycles: request.cooldownCycles || parseInt(this.configService.get<string>('COOLDOWN_CYCLES') || '2', 10),
    };

    // Load OHLCV data
    const ohlcvData = await this.loadOHLCVData(request);
    
    // Group candles by symbol
    const candlesBySymbol = this.groupCandlesBySymbol(ohlcvData);
    
    // Initialize simulation state
    const state: SimulatedState = {
      cash: request.initialCapital,
      positions: new Map(),
      trades: [],
      navHistory: [],
    };

    // Get all unique timestamps (cadence periods) based on date range
    const startTime = new Date(request.startDate).getTime();
    const endTime = new Date(request.endDate).getTime();
    const cadencePeriods = this.getCadencePeriods(startTime, endTime, config.cadenceHours);
    
    const cooldownMap = new Map<string, number>();

    // Simulate each cadence period
    for (let i = 0; i < cadencePeriods.length; i++) {
      const period = cadencePeriods[i];
      const periodDate = new Date(period);

      // Get candles up to this period for each symbol
      const availableCandles: { [symbol: string]: OHLCV[] } = {};
      for (const symbol of request.universe) {
        const symbolCandles = candlesBySymbol[symbol] || [];
        availableCandles[symbol] = symbolCandles.filter(c => c.time <= period);
      }

      // Calculate indicators and generate signals (simulation-friendly, no DB calls)
      const signals: Array<{ symbol: string; indicators: IndicatorResult }> = [];
      
      for (const symbol of request.universe) {
        const candles = availableCandles[symbol];
        if (!candles || candles.length < 26) continue;

        try {
          // Use StrategyService's computeIndicators (pure function, no side effects)
          const indicators = await this.strategyService.computeIndicators(candles);
          
          // Check entry filters (same logic as StrategyService.evaluate)
          const passesFilter =
            indicators.ema12 > indicators.ema26 &&
            indicators.rsi >= config.rsiLow &&
            indicators.rsi <= config.rsiHigh;

          // Check volatility pause
          const currentPrice = candles[candles.length - 1].close;
          const price24hAgo = candles[Math.max(0, candles.length - 4)].close;
          const return24h = Math.abs((currentPrice - price24hAgo) / price24hAgo) * 100;

          if (return24h > config.volatilityPausePct) continue;

          if (passesFilter) {
            signals.push({ symbol, indicators });
          }
        } catch (error: any) {
          // Silently skip symbols with errors in backtesting
        }
      }

      // Rank by score
      signals.sort((a, b) => b.indicators.score - a.indicators.score);

      // Get top asset (K=1)
      const targetAssets = signals.slice(0, 1).map(s => s.symbol);

      // Update cooldown
      for (const [symbol, cycles] of cooldownMap.entries()) {
        if (cycles > 0) {
          cooldownMap.set(symbol, cycles - 1);
        } else {
          cooldownMap.delete(symbol);
        }
      }

      // Determine trades needed
      const trades: Array<{ symbol: string; side: 'buy' | 'sell'; quantity: number }> = [];

      // Close positions not in target
      for (const [symbol, position] of state.positions.entries()) {
        if (!targetAssets.includes(symbol)) {
          trades.push({
            symbol,
            side: 'sell',
            quantity: position.quantity,
          });
          // Set cooldown when selling (consistent with strategy service)
          cooldownMap.set(symbol, config.cooldownCycles);
        }
      }

      // Open new positions (check cooldown)
      for (const symbol of targetAssets) {
        if (!state.positions.has(symbol)) {
          const cooldownCyclesRemaining = cooldownMap.get(symbol) || 0;
          if (cooldownCyclesRemaining > 0) continue;

          const candles = availableCandles[symbol];
          if (!candles || candles.length === 0) continue;

          const currentPrice = candles[candles.length - 1].close;
          const nav = await this.calculateNAV(state, availableCandles);
          const quantity = await this.calculateSize(nav, currentPrice, symbol, config);

          if (quantity > 0) {
            trades.push({ symbol, side: 'buy', quantity });
            // Note: Cooldown is NOT set when buying - it's set when selling (above)
            // This matches the strategy service behavior
          }
        }
      }

      // Execute trades at next period's open price
      if (i < cadencePeriods.length - 1) {
        const nextPeriod = cadencePeriods[i + 1];
        await this.executeTrades(trades, nextPeriod, availableCandles, state, config);
      }

      // Record NAV at this period
      const nav = await this.calculateNAV(state, availableCandles);
      state.navHistory.push({
        date: periodDate.toISOString(),
        nav,
        cash: state.cash,
        positionsValue: nav - state.cash,
      });
    }

    // Calculate final metrics
    return this.calculateMetrics(state, request);
  }

  private async loadOHLCVData(request: BacktestRequestDto): Promise<Array<OHLCV & { symbol?: string }>> {
    // If CSV data provided, parse it
    if (request.ohlcvData) {
      return this.parseCSV(request.ohlcvData);
    }

    // Otherwise, fetch from exchange (for future enhancement)
    // For now, require CSV data
    throw new Error('OHLCV data (CSV) is required for backtesting');
  }

  private parseCSV(csvData: string): Array<OHLCV & { symbol?: string }> {
    const lines = csvData.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    
    const candles: Array<OHLCV & { symbol?: string }> = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',');
      if (values.length < headers.length) continue;

      const row: any = {};
      headers.forEach((header, index) => {
        row[header] = values[index].trim();
      });

      // Parse timestamp
      let timestamp: number;
      if (row.timestamp) {
        timestamp = new Date(row.timestamp).getTime();
      } else if (row.date) {
        timestamp = new Date(row.date).getTime();
      } else if (row.time) {
        timestamp = new Date(row.time).getTime();
      } else {
        continue; // Skip if no timestamp
      }

      const candle: OHLCV & { symbol?: string } = {
        time: timestamp,
        open: parseFloat(row.open || row.o || '0'),
        high: parseFloat(row.high || row.h || '0'),
        low: parseFloat(row.low || row.l || '0'),
        close: parseFloat(row.close || row.c || '0'),
        volume: parseFloat(row.volume || row.v || '0'),
      };

      // Extract symbol if present
      if (row.symbol) {
        candle.symbol = row.symbol;
      }

      candles.push(candle);
    }

    return candles.sort((a, b) => a.time - b.time);
  }

  private groupCandlesBySymbol(candles: Array<OHLCV & { symbol?: string }>): { [symbol: string]: OHLCV[] } {
    const grouped: { [symbol: string]: OHLCV[] } = {};
    
    for (const candle of candles) {
      const symbol = candle.symbol || 'BTC-USD'; // Default if no symbol column
      if (!grouped[symbol]) {
        grouped[symbol] = [];
      }
      // Remove symbol from candle object before storing
      const { symbol: _, ...ohlcv } = candle;
      grouped[symbol].push(ohlcv);
    }
    
    return grouped;
  }

  private getCadencePeriods(startTime: number, endTime: number, cadenceHours: number): number[] {
    const periods: number[] = [];
    const cadenceMs = cadenceHours * 60 * 60 * 1000;
    let current = startTime;

    while (current <= endTime) {
      periods.push(current);
      current += cadenceMs;
    }

    return periods;
  }

  private async calculateNAV(
    state: SimulatedState,
    availableCandles: { [symbol: string]: OHLCV[] },
  ): Promise<number> {
    let positionsValue = 0;

    for (const [symbol, position] of state.positions.entries()) {
      const candles = availableCandles[symbol];
      if (!candles || candles.length === 0) continue;

      const currentPrice = candles[candles.length - 1].close;
      positionsValue += position.quantity * currentPrice;
    }

    return state.cash + positionsValue;
  }

  private async calculateSize(
    navUsd: number,
    priceUsd: number,
    symbol: string,
    config: any,
  ): Promise<number> {
    const alloc = navUsd * config.maxAllocFraction;
    if (alloc < config.minOrderUsd) return 0;

    const qty = alloc / priceUsd;
    
    // Round to lot size (simplified - in production use exchangeService.roundToLotSize)
    try {
      const lotInfo = await this.exchangeService.getLotSizeInfo(symbol);
      const rounded = Math.floor(qty / lotInfo.lotSize) * lotInfo.lotSize;
      const multiplier = Math.pow(10, lotInfo.lotDecimals);
      return Math.floor(rounded * multiplier) / multiplier;
    } catch (error) {
      // Fallback to 8 decimals
      return Math.floor(qty * 100000000) / 100000000;
    }
  }

  private async executeTrades(
    trades: Array<{ symbol: string; side: 'buy' | 'sell'; quantity: number }>,
    periodTime: number,
    availableCandles: { [symbol: string]: OHLCV[] },
    state: SimulatedState,
    config: any,
  ): Promise<void> {
    for (const trade of trades) {
      const candles = availableCandles[trade.symbol];
      if (!candles || candles.length === 0) continue;

      // Find candle at or before this period
      const candle = candles.find(c => c.time <= periodTime) || candles[candles.length - 1];
      const fillPrice = candle.open; // Execute at next bar's open

      // Apply slippage
      const slippage = trade.side === 'buy' 
        ? fillPrice * config.slippagePct 
        : -fillPrice * config.slippagePct;
      const finalPrice = fillPrice + slippage;

      // Calculate fee
      const tradeValue = trade.quantity * finalPrice;
      const fee = tradeValue * config.feeRate;

      // Execute trade
      if (trade.side === 'buy') {
        const cost = tradeValue + fee;
        if (state.cash >= cost) {
          state.cash -= cost;
          state.positions.set(trade.symbol, {
            symbol: trade.symbol,
            quantity: trade.quantity,
            entryPrice: finalPrice,
            entryDate: new Date(periodTime).toISOString(),
          });
        }
      } else {
        const position = state.positions.get(trade.symbol);
        if (position && position.quantity >= trade.quantity) {
          const proceeds = tradeValue - fee;
          state.cash += proceeds;
          
          if (position.quantity === trade.quantity) {
            state.positions.delete(trade.symbol);
          } else {
            position.quantity -= trade.quantity;
          }
        }
      }

      // Record trade
      const nav = await this.calculateNAV(state, availableCandles);
      state.trades.push({
        date: new Date(periodTime).toISOString(),
        symbol: trade.symbol,
        side: trade.side,
        quantity: trade.quantity,
        price: finalPrice,
        fee,
        nav,
      });
    }
  }

  private calculateMetrics(
    state: SimulatedState,
    request: BacktestRequestDto,
  ): BacktestResultDto {
    if (state.navHistory.length === 0) {
      throw new Error('No NAV history available');
    }

    const startNav = state.navHistory[0].nav;
    const endNav = state.navHistory[state.navHistory.length - 1].nav;
    const totalReturn = ((endNav - startNav) / startNav) * 100;

    // Calculate days
    const startDate = new Date(request.startDate);
    const endDate = new Date(request.endDate);
    const days = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));

    // CAGR
    const cagr = (Math.pow(endNav / startNav, 365 / days) - 1) * 100;

    // Calculate returns for volatility and Sharpe
    const returns: number[] = [];
    for (let i = 1; i < state.navHistory.length; i++) {
      const prevNav = state.navHistory[i - 1].nav;
      const currNav = state.navHistory[i].nav;
      returns.push((currNav - prevNav) / prevNav);
    }

    // Volatility (annualized)
    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
    const volatility = Math.sqrt(variance * (365 / days)) * 100;

    // Sharpe ratio (assuming risk-free rate of 0)
    const sharpeRatio = volatility > 0 ? (meanReturn * Math.sqrt(365 / days)) / (volatility / 100) : 0;

    // Max drawdown
    let maxDrawdown = 0;
    let peak = startNav;
    for (const navPoint of state.navHistory) {
      if (navPoint.nav > peak) peak = navPoint.nav;
      const drawdown = ((navPoint.nav - peak) / peak) * 100;
      if (drawdown < maxDrawdown) maxDrawdown = drawdown;
    }

    // Trade statistics
    const winningTrades = state.trades.filter((t, i) => {
      if (i === 0) return false;
      const prevNav = state.navHistory[i - 1]?.nav || startNav;
      return t.nav > prevNav;
    }).length;

    const losingTrades = state.trades.length - winningTrades;
    const winRate = state.trades.length > 0 ? (winningTrades / state.trades.length) * 100 : 0;

    // Profit factor
    const profits = state.trades.filter(t => t.nav > startNav).reduce((sum, t) => sum + (t.nav - startNav), 0);
    const losses = state.trades.filter(t => t.nav <= startNav).reduce((sum, t) => sum + Math.abs(t.nav - startNav), 0);
    const profitFactor = losses > 0 ? profits / losses : profits > 0 ? Infinity : 0;

    // Total fees
    const totalFees = state.trades.reduce((sum, t) => sum + t.fee, 0);

    // Turnover (simplified)
    const totalTradeValue = state.trades.reduce((sum, t) => sum + Math.abs(t.quantity * t.price), 0);
    const turnover = startNav > 0 ? totalTradeValue / startNav : 0;

    return {
      totalReturn,
      cagr,
      sharpeRatio,
      maxDrawdown,
      volatility,
      winRate,
      profitFactor,
      totalTrades: state.trades.length,
      winningTrades,
      losingTrades,
      totalFees,
      turnover,
      navHistory: state.navHistory,
      trades: state.trades,
      startDate: request.startDate,
      endDate: request.endDate,
      initialCapital: request.initialCapital,
      finalNav: endNav,
      days,
    };
  }
}

