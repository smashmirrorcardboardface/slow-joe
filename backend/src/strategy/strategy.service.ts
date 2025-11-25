import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EMA, RSI } from 'technicalindicators';
import { ExchangeService, OHLCV } from '../exchange/exchange.service';
import { SignalsService } from '../signals/signals.service';
import { AssetsService } from '../assets/assets.service';
import { PositionsService } from '../positions/positions.service';
import { MetricsService } from '../metrics/metrics.service';
import { SettingsService } from '../settings/settings.service';
import { LoggerService } from '../logger/logger.service';
import { getBotId, getUserrefPrefix, orderBelongsToBot } from '../common/utils/bot.utils';

export interface IndicatorResult {
  ema12: number;
  ema26: number;
  rsi: number;
  score: number;
}

export interface TradeDecision {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
}

@Injectable()
export class StrategyService {
  private enabled = true;
  private cooldownMap: Map<string, number> = new Map(); // Maps symbol to cycle count when last entered
  private botIdCache?: string;
  private userrefPrefixCache?: string;

  constructor(
    private configService: ConfigService,
    private settingsService: SettingsService,
    private exchangeService: ExchangeService,
    private signalsService: SignalsService,
    private assetsService: AssetsService,
    private positionsService: PositionsService,
    private metricsService: MetricsService,
    private logger: LoggerService,
  ) {
    this.logger.setContext('StrategyService');
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  toggle(enabled: boolean): void {
    this.enabled = enabled;
  }

  private getBotIdValue(): string {
    if (!this.botIdCache) {
      this.botIdCache = getBotId(this.configService);
    }
    return this.botIdCache;
  }

  private getUserrefPrefixValue(): string {
    if (!this.userrefPrefixCache) {
      this.userrefPrefixCache = getUserrefPrefix(this.configService);
    }
    return this.userrefPrefixCache;
  }

  async computeIndicators(candles: OHLCV[]): Promise<IndicatorResult> {
    const closes = candles.map((c) => c.close);
    
    const ema12Values = EMA.calculate({ period: 12, values: closes });
    const ema26Values = EMA.calculate({ period: 26, values: closes });
    const rsiValues = RSI.calculate({ period: 14, values: closes });

    const ema12 = ema12Values[ema12Values.length - 1];
    const ema26 = ema26Values[ema26Values.length - 1];
    const rsi = rsiValues[rsiValues.length - 1] ?? 50;

    // Score formula based on actual performance analysis:
    // - Wins have RSI 55-65 (avg 56.22), losses have RSI 45-65 (avg 54.81)
    // - Wins have EMA ratio ~1.0013, losses have EMA ratio ~1.0045
    // - Key insight: Moderate EMA separation (1.001-1.002) with RSI 55-65 performs best
    //   Very high EMA ratios (1.004+) may indicate overextension and reversals
    const emaRatio = ema12 / ema26;
    
    // EMA component: Reward moderate separation (1.001-1.002), penalize extremes
    // Too low (<1.001) = weak trend, too high (>1.003) = overextended
    let emaScore = 1.0;
    if (emaRatio >= 1.001 && emaRatio <= 1.002) {
      emaScore = 1.05; // Best range (where wins cluster)
    } else if (emaRatio > 1.002 && emaRatio <= 1.003) {
      emaScore = 1.02; // Good range
    } else if (emaRatio > 1.003) {
      emaScore = 0.95; // Penalty for overextension (where losses are)
    } else {
      emaScore = 0.90; // Penalty for weak trend
    }
    
    // RSI component: Strongly prefer 55-65 range (where 9/11 wins occurred)
    let rsiScore = 1.0;
    if (rsi >= 55 && rsi <= 65) {
      rsiScore = 1.15; // Strong bonus for optimal range
    } else if (rsi >= 50 && rsi < 55) {
      rsiScore = 1.05; // Moderate bonus
    } else if (rsi >= 45 && rsi < 50) {
      rsiScore = 0.90; // Penalty (where many losses are)
    } else {
      rsiScore = 0.85; // Further penalty
    }
    
    // Combined score: EMA quality * RSI quality
    // This should correlate with wins (higher score = better performance)
    const score = emaScore * rsiScore;

    return { ema12, ema26, rsi, score };
  }

  async calculateSize(navUsd: number, priceUsd: number, symbol: string, allocFraction?: number): Promise<number> {
    const maxAllocFraction = allocFraction || await this.settingsService.getSettingNumber('MAX_ALLOC_FRACTION');
    const minOrderUsd = await this.settingsService.getSettingNumber('MIN_ORDER_USD');

    const alloc = navUsd * maxAllocFraction;
    if (alloc < minOrderUsd) return 0;

    const qty = alloc / priceUsd;
    
    // Round to exchange lot size increment
    const roundedQty = await this.exchangeService.roundToLotSize(symbol, qty);
    
    // Validate minimum order size
    const lotInfo = await this.exchangeService.getLotSizeInfo(symbol);
    if (roundedQty < lotInfo.minOrderSize) {
      this.logger.debug(`Calculated quantity below minimum`, {
        symbol,
        roundedQty,
        minOrderSize: lotInfo.minOrderSize,
      });
      return 0;
    }
    
    // Validate minimum USD value
    const orderValueUsd = roundedQty * priceUsd;
    if (orderValueUsd < minOrderUsd) {
      this.logger.debug(`Order value below minimum USD`, {
        symbol,
        orderValueUsd,
        minOrderUsd,
      });
      return 0;
    }
    
    return roundedQty;
  }

  /**
   * Get positions that are due for evaluation based on their purchase time
   * Each position is evaluated on its own cycle starting from when it was opened
   */
  private async getPositionsDueForEvaluation(): Promise<Array<{ position: any; cyclesSinceOpen: number; nextEvaluationTime: Date }>> {
    const botId = this.getBotIdValue();
    const currentPositions = await this.positionsService.findOpenByBot(botId);
    const cadenceHours = await this.settingsService.getSettingInt('CADENCE_HOURS');
    const now = new Date();
    const duePositions: Array<{ position: any; cyclesSinceOpen: number; nextEvaluationTime: Date }> = [];

    for (const pos of currentPositions) {
      const openedAt = pos.openedAt;
      const ageMs = now.getTime() - openedAt.getTime();
      const ageHours = ageMs / (1000 * 60 * 60);
      
      // Calculate how many full cadence cycles have passed
      const cyclesSinceOpen = Math.floor(ageHours / cadenceHours);
      
      // If no cycles have passed yet, position is too new (less than 1 cadence cycle old)
      if (cyclesSinceOpen < 1) {
        continue;
      }
      
      // Calculate when the last completed cycle's evaluation should have happened
      // If cyclesSinceOpen = 2, cycles 1 and 2 are complete, so check if we're past cycle 2's evaluation time
      const lastCompletedCycleEvaluationTime = new Date(openedAt.getTime() + (cyclesSinceOpen * cadenceHours * 60 * 60 * 1000));
      
      // Calculate when the next evaluation should happen (for logging)
      const nextEvaluationTime = new Date(openedAt.getTime() + ((cyclesSinceOpen + 1) * cadenceHours * 60 * 60 * 1000));
      
      // Position is due if we're past the last completed cycle's evaluation time
      // Allow evaluation from the exact evaluation time onwards (no upper limit, so we don't miss evaluations)
      if (now.getTime() >= lastCompletedCycleEvaluationTime.getTime()) {
        duePositions.push({
          position: pos,
          cyclesSinceOpen,
          nextEvaluationTime,
        });
      }
    }

    return duePositions;
  }

  async evaluate(): Promise<TradeDecision[]> {
    if (!this.enabled) {
      this.logger.debug('Strategy is disabled');
      return [];
    }

    const nav = await this.metricsService.getNAV();
    const minBalanceUsd = await this.settingsService.getSettingNumber('MIN_BALANCE_USD');

    if (nav < minBalanceUsd) {
      this.logger.debug(`NAV below minimum, skipping evaluation`, {
        nav,
        minBalanceUsd,
      });
      return [];
    }

    const universeStr = await this.settingsService.getSetting('UNIVERSE');
    const universe = universeStr.split(',').map(s => s.trim());
    const cadenceHours = await this.settingsService.getSettingInt('CADENCE_HOURS');
    const interval = `${cadenceHours}h`;
    const cooldownCycles = await this.settingsService.getSettingInt('COOLDOWN_CYCLES');
    
    // Get positions that are due for evaluation
    const duePositions = await this.getPositionsDueForEvaluation();
    const duePositionSymbols = new Set(duePositions.map(dp => dp.position.symbol));
    
    this.logger.log(`Per-position evaluation: ${duePositions.length} position(s) due for evaluation`, {
      duePositions: duePositions.map(dp => ({
        symbol: dp.position.symbol,
        cyclesSinceOpen: dp.cyclesSinceOpen,
        nextEvaluationTime: dp.nextEvaluationTime.toISOString(),
      })),
    });

    const rsiLow = await this.settingsService.getSettingNumber('RSI_LOW');
    const rsiHigh = await this.settingsService.getSettingNumber('RSI_HIGH');
    const volatilityPausePct = await this.settingsService.getSettingNumber('VOLATILITY_PAUSE_PCT');

    // Entry filter thresholds (dynamic max based on volatility)
    const minEMARatio = 1.001; // Minimum 0.1% separation (wins average 1.0013)

    // Fetch signals for all assets
    const signals: Array<{ symbol: string; indicators: IndicatorResult }> = [];
    const filteredSignals: Array<{ symbol: string; reasons: string[]; indicators: IndicatorResult; return24h: number; maxEmaRatio: number }> = [];

    for (const symbol of universe) {
      try {
        const ohlcv = await this.exchangeService.getOHLCV(symbol, interval, 50);
        if (ohlcv.length < 26) {
          this.logger.debug(`Not enough data for symbol`, { symbol, candleCount: ohlcv.length });
          continue;
        }

        const indicators = await this.computeIndicators(ohlcv);

        // Check volatility pause (24h return)
        const currentPrice = ohlcv[ohlcv.length - 1].close;
        const price24hAgo = ohlcv[Math.max(0, ohlcv.length - 4)].close; // Approximate 24h
        const return24h = Math.abs((currentPrice - price24hAgo) / price24hAgo) * 100;

        // Check entry filters
        const emaRatio = indicators.ema12 / indicators.ema26;
        const dynamicMaxEMARatio = this.getVolatilityAdjustedMaxEmaRatio(return24h, volatilityPausePct);
        
        const passesFilter =
          emaRatio >= minEMARatio &&
          emaRatio <= dynamicMaxEMARatio && // Filter out overextended trends
          indicators.ema12 > indicators.ema26 &&
          indicators.rsi >= rsiLow &&
          indicators.rsi <= rsiHigh;

        if (return24h > volatilityPausePct) {
          this.logger.debug(`Volatility pause triggered`, {
            symbol,
            return24h,
            volatilityPausePct,
          });
          continue;
        }

        if (passesFilter) {
          signals.push({ symbol, indicators });
        } else {
          // Track why signal was filtered out
          const filterReasons = [];
          if (emaRatio < minEMARatio) {
            filterReasons.push(`EMA ratio too low (${emaRatio.toFixed(6)} < ${minEMARatio})`);
          }
          if (emaRatio > dynamicMaxEMARatio) {
            filterReasons.push(`EMA ratio too high (${emaRatio.toFixed(6)} > ${dynamicMaxEMARatio.toFixed(3)})`);
          }
          if (indicators.ema12 <= indicators.ema26) {
            filterReasons.push(`EMA12 <= EMA26 (not bullish)`);
          }
          if (indicators.rsi < rsiLow) {
            filterReasons.push(`RSI too low (${indicators.rsi.toFixed(2)} < ${rsiLow})`);
          }
          if (indicators.rsi > rsiHigh) {
            filterReasons.push(`RSI too high (${indicators.rsi.toFixed(2)} > ${rsiHigh})`);
          }
          
          filteredSignals.push({ symbol, reasons: filterReasons, indicators, return24h, maxEmaRatio: dynamicMaxEMARatio });
          
          this.logger.debug(`Signal filtered out: ${symbol} - ${filterReasons.join('; ')}`, {
            symbol,
            emaRatio: emaRatio.toFixed(6),
            ema12: indicators.ema12.toFixed(4),
            ema26: indicators.ema26.toFixed(4),
            rsi: indicators.rsi.toFixed(2),
            score: indicators.score.toFixed(3),
            minEMARatio,
            maxEMARatio: dynamicMaxEMARatio,
            rsiLow,
            rsiHigh,
            return24h,
            volatilityPausePct,
          });
        }

        // Persist signal
        await this.signalsService.create({
          symbol,
          indicators,
          cadenceWindow: interval,
        });
      } catch (error: any) {
        this.logger.error(`Error processing symbol`, error.stack, {
          symbol,
          error: error.message,
        });
      }
    }

    // Log summary of filtered signals if all were filtered
    if (signals.length === 0 && filteredSignals.length > 0) {
      const summaryLines = [
        `All ${filteredSignals.length} signal(s) filtered out. Filter breakdown:`,
        `Thresholds: EMA ratio minimum ${minEMARatio.toFixed(3)} with volatility-aware cap, RSI [${rsiLow} - ${rsiHigh}]`,
      ];
      
      filteredSignals.forEach(f => {
        const emaRatio = (f.indicators.ema12 / f.indicators.ema26);
        summaryLines.push(
          `  ${f.symbol}: ${f.reasons.join('; ')} (EMA ratio: ${emaRatio.toFixed(6)}, RSI: ${f.indicators.rsi.toFixed(2)}, Score: ${f.indicators.score.toFixed(3)}, Max EMA cap: ${f.maxEmaRatio.toFixed(3)}, 24h return: ${f.return24h.toFixed(2)}%)`
        );
      });
      
      this.logger.log(summaryLines.join('\n'), {
        totalSignals: filteredSignals.length,
        filterBreakdown: filteredSignals.map(f => ({
          symbol: f.symbol,
          reasons: f.reasons,
          emaRatio: (f.indicators.ema12 / f.indicators.ema26).toFixed(6),
          rsi: f.indicators.rsi.toFixed(2),
          score: f.indicators.score.toFixed(3),
          maxEmaRatio: f.maxEmaRatio.toFixed(3),
          return24h: f.return24h.toFixed(2),
        })),
        thresholds: {
          minEMARatio,
          rsiLow,
          rsiHigh,
        },
      });
    }

    const botId = this.getBotIdValue();
    const userrefPrefix = this.getUserrefPrefixValue();

    // Get current positions first (needed for calculating available slots and adjusting scores)
    const currentPositions = await this.positionsService.findOpenByBot(botId);
    const currentPositionCount = currentPositions.length;
    
    // Create a map of current positions with their P&L for score adjustment
    const positionPnLMap = new Map<string, { profit: number; profitPct: number }>();
    for (const pos of currentPositions) {
      try {
        const ticker = await this.exchangeService.getTicker(pos.symbol);
        const currentPrice = ticker.bid || ticker.price;
        const entryPrice = parseFloat(pos.entryPrice);
        const quantity = parseFloat(pos.quantity);
        const entryValue = quantity * entryPrice;
        const positionValue = quantity * currentPrice;
        const profit = positionValue - entryValue;
        const profitPct = (profit / entryValue) * 100;
        
        positionPnLMap.set(pos.symbol, { profit, profitPct });
        this.logger.log(`Position P&L calculated for score adjustment`, {
          symbol: pos.symbol,
          entryPrice: entryPrice.toFixed(4),
          currentPrice: currentPrice.toFixed(4),
          profit: profit.toFixed(4),
          profitPct: profitPct.toFixed(2),
        });
      } catch (error: any) {
        // If we can't get ticker, skip P&L adjustment for this position
        this.logger.warn(`Could not get P&L for position ${pos.symbol}`, {
          error: error.message,
        });
      }
    }
    
    // Log P&L map for debugging
    if (positionPnLMap.size > 0) {
      const pnlSummary = Array.from(positionPnLMap.entries()).map(([symbol, pnl]) => 
        `${symbol}: ${pnl.profitPct.toFixed(2)}%`
      ).join(', ');
      this.logger.log(`Position P&L map: ${pnlSummary}`, {
        positionCount: positionPnLMap.size,
        pnlDetails: Array.from(positionPnLMap.entries()).map(([symbol, pnl]) => ({
          symbol,
          profitPct: pnl.profitPct.toFixed(2),
          profit: pnl.profit.toFixed(4),
        })),
      });
    }
    
    // Log signals being checked
    const signalsWithPositions = signals.filter(s => positionPnLMap.has(s.symbol));
    const heldPositionsNotInSignals = Array.from(positionPnLMap.keys()).filter(symbol => 
      !signals.some(s => s.symbol === symbol)
    );
    
    if (signalsWithPositions.length > 0) {
      this.logger.log(`Checking ${signalsWithPositions.length} signal(s) for held positions`, {
        symbols: signalsWithPositions.map(s => s.symbol),
      });
    }
    
    // Log held positions that aren't in signals (filtered out or don't meet entry criteria)
    if (heldPositionsNotInSignals.length > 0) {
      const pnlForFiltered = heldPositionsNotInSignals.map(symbol => {
        const pnl = positionPnLMap.get(symbol);
        return `${symbol}: ${pnl?.profitPct.toFixed(2)}%`;
      }).join(', ');
      this.logger.log(`Held positions not in signals (filtered out or don't meet entry criteria): ${pnlForFiltered}`, {
        symbols: heldPositionsNotInSignals,
        pnlDetails: heldPositionsNotInSignals.map(symbol => {
          const pnl = positionPnLMap.get(symbol);
          return { symbol, profitPct: pnl?.profitPct.toFixed(2), profit: pnl?.profit.toFixed(4) };
        }),
      });
    }
    
    // Adjust signal scores based on current position performance
    // Penalize positions we're holding that are losing money
    for (const signal of signals) {
      const positionPnL = positionPnLMap.get(signal.symbol);
      if (positionPnL) {
        // If we're holding this position and it's losing money, penalize the score
        // This ensures we don't rank losing positions as "best signals"
        if (positionPnL.profitPct < -0.5) { // Losing more than 0.5%
          // Penalize based on loss severity: 
          // -0.5% loss = 15% score reduction
          // -1% loss = 30% score reduction
          // -2% loss = 50% score reduction (capped)
          const lossMagnitude = Math.abs(positionPnL.profitPct);
          const penaltyPct = Math.min(lossMagnitude * 30, 50); // 30% per 1% loss, cap at 50%
          const penaltyFactor = 1.0 - (penaltyPct / 100);
          const originalScore = signal.indicators.score;
          signal.indicators.score *= penaltyFactor;
          this.logger.log(`Adjusted signal score for losing position`, {
            symbol: signal.symbol,
            originalScore: originalScore.toFixed(3),
            adjustedScore: signal.indicators.score.toFixed(3),
            profitPct: positionPnL.profitPct.toFixed(2),
            penaltyPct: penaltyPct.toFixed(1),
            penaltyFactor: penaltyFactor.toFixed(3),
          });
        } else {
          // Log when we're holding a position but it's not losing enough to penalize
          this.logger.log(`Position ${signal.symbol} P&L: ${positionPnL.profitPct.toFixed(2)}% (no penalty, threshold: -0.5%)`, {
            symbol: signal.symbol,
            profitPct: positionPnL.profitPct.toFixed(2),
            score: signal.indicators.score.toFixed(3),
          });
        }
      }
    }

    // Rank by adjusted score
    signals.sort((a, b) => b.indicators.score - a.indicators.score);

    // Get top K assets based on MAX_POSITIONS setting
    const maxPositions = await this.settingsService.getSettingInt('MAX_POSITIONS');
    
    // Calculate how many new positions we can open
    let availableSlots = Math.max(0, maxPositions - currentPositionCount);
    const currentHoldings = new Set(currentPositions.map((p) => p.symbol));
    
    // Filter out signals for positions we already hold, then select top K
    const availableSignals = signals.filter(s => !currentHoldings.has(s.symbol));
    const topK = Math.min(availableSlots, availableSignals.length);
    
    let targetAssets = availableSignals.slice(0, topK).map((s) => s.symbol);
    
    const topSignals = signals.slice(0, Math.min(5, signals.length)).map(s => `${s.symbol} (score: ${s.indicators.score.toFixed(3)})`).join(', ');
    this.logger.log(`Position selection: maxPositions=${maxPositions}, current=${currentPositionCount}, availableSlots=${availableSlots}, topK=${topK}, targetAssets=[${targetAssets.join(', ')}], topSignals=[${topSignals}]`, {
      maxPositions,
      currentPositionCount,
      availableSlots,
      topK,
      targetAssets,
      totalSignals: signals.length,
      availableSignals: availableSignals.length,
      nav,
      allSignals: signals.map(s => ({ symbol: s.symbol, score: s.indicators.score, rsi: s.indicators.rsi })),
      currentPositions: currentPositions.map(p => p.symbol),
    });

    // Update cooldown map: decrement cycles for all symbols
    for (const [symbol, cycles] of this.cooldownMap.entries()) {
      if (cycles > 0) {
        this.cooldownMap.set(symbol, cycles - 1);
      } else {
        this.cooldownMap.delete(symbol);
      }
    }

    // Determine trades needed
    const trades: TradeDecision[] = [];

    // Get profit and loss threshold settings
    const minProfitUsd = await this.settingsService.getSettingNumber('MIN_PROFIT_USD');
    const maxLossUsd = await this.settingsService.getSettingNumber('MAX_LOSS_USD');
    const minProfitPct = await this.settingsService.getSettingNumber('MIN_PROFIT_PCT');
    const maxLossPct = await this.settingsService.getSettingNumber('MAX_LOSS_PCT');
    const minPositionValueForExit = await this.settingsService.getSettingNumber('MIN_POSITION_VALUE_FOR_EXIT');
    const profitFeeBufferPct = await this.settingsService.getSettingNumber('PROFIT_FEE_BUFFER_PCT');
    const volatilityAdjustmentFactor = await this.settingsService.getSettingNumber('VOLATILITY_ADJUSTMENT_FACTOR');

    // Check for existing open orders to avoid duplicates
    let pendingSellSymbols = new Set<string>();
    let pendingBuySymbols = new Set<string>();
    try {
      const openOrders = (await this.exchangeService.getOpenOrders()).filter(order =>
        orderBelongsToBot(order, userrefPrefix),
      );
      pendingSellSymbols = new Set(
        openOrders.filter(o => o.side === 'sell').map(o => o.symbol)
      );
      pendingBuySymbols = new Set(
        openOrders.filter(o => o.side === 'buy').map(o => o.symbol)
      );
    } catch (ordersError: any) {
      this.logger.debug(`Could not check open orders, proceeding with profit/loss check`, {
        error: ordersError.message,
      });
    }

    // Check for profit/loss threshold exits FIRST (before other exit logic)
    // This ensures we lock in profits or cut losses as soon as thresholds are hit
    // Only check positions that are due for evaluation (per-position evaluation cycle)
    for (const pos of currentPositions) {
      // Skip if position is not due for evaluation (per-position evaluation cycle)
      if (!duePositionSymbols.has(pos.symbol)) {
        this.logger.debug(`Skipping profit/loss check - position not due for evaluation`, {
          symbol: pos.symbol,
        });
        continue;
      }
      
      try {
        // Skip if there's already a pending sell order for this symbol
        if (pendingSellSymbols.has(pos.symbol)) {
          this.logger.debug(`Skipping profit/loss check - sell order already pending`, {
            symbol: pos.symbol,
          });
          continue;
        }

        const ticker = await this.exchangeService.getTicker(pos.symbol);
        // Use bid price for sell orders (what we'd actually get when selling)
        // This gives a more realistic profit calculation
        const currentPrice = ticker.bid || ticker.price;
        const entryPrice = parseFloat(pos.entryPrice);
        const quantity = parseFloat(pos.quantity);
        
        // Calculate position value and profit/loss
        // Use bid price for position value since that's what we'd get when selling
        const positionValue = quantity * currentPrice;
        const entryValue = quantity * entryPrice;
        const profit = quantity * (currentPrice - entryPrice);
        const profitPct = (profit / entryValue) * 100;
        
        // 1. Minimum position size check - skip if position is too small
        if (positionValue < minPositionValueForExit) {
          this.logger.debug(`Skipping exit check for small position`, {
            symbol: pos.symbol,
            positionValue: positionValue.toFixed(4),
            minPositionValueForExit: minPositionValueForExit.toFixed(4),
          });
          continue;
        }
        
        // 2. Calculate volatility-adjusted thresholds
        // Get recent price volatility (24h return as proxy)
        let volatilityMultiplier = 1.0;
        try {
          const ohlcv = await this.exchangeService.getOHLCV(pos.symbol, '24h', 2);
          if (ohlcv.length >= 2) {
            const price24hAgo = ohlcv[0].close;
            const return24h = Math.abs((currentPrice - price24hAgo) / price24hAgo) * 100;
            // If volatility is high (>10%), apply adjustment factor
            if (return24h > 10) {
              volatilityMultiplier = volatilityAdjustmentFactor;
            }
          }
        } catch (volError: any) {
          // If we can't get volatility, use default multiplier
          this.logger.debug(`Could not calculate volatility for ${pos.symbol}, using default`, {
            error: volError.message,
          });
        }
        
        // 3. Calculate thresholds (use percentage-based, fallback to USD for small positions)
        // Profit threshold: use percentage of position value, ensure it covers fees + buffer
        const krakenMakerFee = 0.0016; // 0.16% maker fee
        const krakenTakerFee = 0.0026; // 0.26% taker fee (use worst case)
        const totalFeesPct = (krakenTakerFee * 2) + (profitFeeBufferPct / 100); // Buy + sell fees + buffer
        
        // Ensure profit threshold accounts for fees: if MIN_PROFIT_PCT is 3%, we need at least 3% + fees to make real profit
        // Add 0.6% buffer on top of fees to ensure we're making meaningful profit after fees
        const minProfitAfterFees = totalFeesPct * 100 + 0.6; // Fees (~0.52%) + 0.6% buffer = ~1.12% minimum
        const profitThresholdPct = Math.max(minProfitPct, minProfitAfterFees);
        const profitThresholdUsd = (entryValue * profitThresholdPct) / 100;
        const effectiveProfitThreshold = Math.max(profitThresholdUsd, minProfitUsd);
        
        // Loss threshold: use percentage, adjusted for volatility
        const lossThresholdPct = maxLossPct * volatilityMultiplier;
        const lossThresholdUsd = (entryValue * lossThresholdPct) / 100;
        const effectiveLossThreshold = Math.max(lossThresholdUsd, maxLossUsd);
        
        // 4. Check for profit exit (with fee awareness)
        if ((minProfitPct > 0 || minProfitUsd > 0) && profit >= effectiveProfitThreshold) {
          // Verify profit actually covers fees
          const estimatedFees = entryValue * krakenTakerFee + positionValue * krakenTakerFee;
          const netProfit = profit - estimatedFees;
          
          if (netProfit > 0 || profit >= effectiveProfitThreshold * 1.1) { // Allow 10% margin for fee estimation
            this.logger.log(`[PROFIT EXIT] Closing position due to profit threshold`, {
              symbol: pos.symbol,
              entryPrice: entryPrice.toFixed(4),
              currentPrice: currentPrice.toFixed(4),
              quantity: quantity.toFixed(8),
              profit: profit.toFixed(4),
              profitPct: profitPct.toFixed(2),
              netProfit: netProfit.toFixed(4),
              effectiveProfitThreshold: effectiveProfitThreshold.toFixed(4),
              profitThresholdPct: profitThresholdPct.toFixed(2),
              estimatedFees: estimatedFees.toFixed(4),
            });
            
            trades.push({
              symbol: pos.symbol,
              side: 'sell',
              quantity: quantity,
            });
            // Set cooldown to prevent immediate re-entry after selling
            this.cooldownMap.set(pos.symbol, cooldownCycles);
            
            // Skip further checks for this position (already marked for exit)
            continue;
          } else {
            this.logger.debug(`Profit threshold met but fees would exceed profit, holding`, {
              symbol: pos.symbol,
              profit: profit.toFixed(4),
              estimatedFees: estimatedFees.toFixed(4),
              netProfit: netProfit.toFixed(4),
            });
          }
        }
        
        // 5. Check for stop-loss exit (with volatility adjustment)
        if ((maxLossPct > 0 || maxLossUsd > 0) && profit <= -effectiveLossThreshold) {
          this.logger.log(`[STOP-LOSS EXIT] Closing position due to loss threshold`, {
            symbol: pos.symbol,
            entryPrice: entryPrice.toFixed(4),
            currentPrice: currentPrice.toFixed(4),
            quantity: quantity.toFixed(8),
            loss: Math.abs(profit).toFixed(4),
            lossPct: Math.abs(profitPct).toFixed(2),
            effectiveLossThreshold: effectiveLossThreshold.toFixed(4),
            lossThresholdPct: lossThresholdPct.toFixed(2),
            volatilityMultiplier: volatilityMultiplier.toFixed(2),
          });
          
          trades.push({
            symbol: pos.symbol,
            side: 'sell',
            quantity: quantity,
          });
          // Set cooldown to prevent immediate re-entry after selling
          this.cooldownMap.set(pos.symbol, cooldownCycles);
          
          // Skip further checks for this position (already marked for exit)
          continue;
        }
      } catch (error: any) {
        this.logger.warn(`Error checking profit/loss threshold for position`, {
          symbol: pos.symbol,
          error: error.message,
        });
        // Continue to other exit logic if profit/loss check fails
      }
    }

    // ROTATION LOGIC: Exit underperforming positions to rotate to better signals
    // After minimum hold period, if position is not in top 4-5 and better signals are available, rotate
    // Only check positions that are due for evaluation (per-position evaluation cycle)
    const exitSymbols = new Set(trades.filter(t => t.side === 'sell').map(t => t.symbol));
    const top4Signals = signals.slice(0, 4).map(s => s.symbol);
    const top5Signals = signals.slice(0, 5).map(s => s.symbol);
    
    // Create a map of symbol to score for quick lookup
    const signalScoreMap = new Map<string, number>();
    signals.forEach(s => signalScoreMap.set(s.symbol, s.indicators.score));
    
    for (const pos of currentPositions) {
      // Skip if already marked for exit
      if (exitSymbols.has(pos.symbol)) {
        continue;
      }
      
      // Skip if position is not due for evaluation (per-position evaluation cycle)
      if (!duePositionSymbols.has(pos.symbol)) {
        this.logger.debug(`Skipping rotation check - position not due for evaluation`, {
          symbol: pos.symbol,
        });
        continue;
      }
      
      // Check if position has been held for minimum period
      // Increase minimum hold period to let winners run and reduce fee drag
      const positionAgeMs = Date.now() - pos.openedAt.getTime();
      const positionAgeHours = positionAgeMs / (1000 * 60 * 60);
      const minHoldCycles = 3; // Minimum 3 cadence cycles (6-12 hours) before rotation to reduce trading frequency
      const minHoldHours = cadenceHours * minHoldCycles;
      
      // Calculate current P&L to check if position is profitable
      let currentProfitPct = 0;
      let isProfitable = false;
      try {
        const ticker = await this.exchangeService.getTicker(pos.symbol);
        const currentPrice = ticker.bid || ticker.price;
        const entryPrice = parseFloat(pos.entryPrice);
        const quantity = parseFloat(pos.quantity);
        const entryValue = quantity * entryPrice;
        const positionValue = quantity * currentPrice;
        const grossProfit = positionValue - entryValue;
        const krakenTakerFee = 0.0026;
        const estimatedFees = entryValue * krakenTakerFee + positionValue * krakenTakerFee;
        const netProfit = grossProfit - estimatedFees;
        currentProfitPct = (grossProfit / entryValue) * 100;
        // Consider profitable if net profit is positive OR gross profit > 1% (fees are ~0.52%)
        isProfitable = netProfit > 0 || currentProfitPct > 1.0;
      } catch (error: any) {
        // If we can't get ticker, assume not profitable to be conservative
        this.logger.debug(`Could not calculate P&L for rotation check`, { symbol: pos.symbol, error: error.message });
      }
      
      // Only consider rotation if position has been held for minimum period
      if (positionAgeHours >= minHoldHours) {
        const positionScore = signalScoreMap.get(pos.symbol) || 0;
        const isInTop5 = top5Signals.includes(pos.symbol);
        const isInTop4 = top4Signals.includes(pos.symbol);
        
        this.logger.debug(`[ROTATION CHECK] Position eligible for rotation check`, {
          symbol: pos.symbol,
          positionAgeHours: positionAgeHours.toFixed(2),
          minHoldHours: minHoldHours.toFixed(2),
          positionScore: positionScore.toFixed(3),
          isInTop5,
          isInTop4,
          isProfitable,
          currentProfitPct: currentProfitPct.toFixed(2),
          top5Signals,
          top4Signals,
        });
        
        // DON'T rotate out of profitable positions - let winners run
        // Only rotate if position is losing money or barely breaking even
        if (isProfitable && currentProfitPct > 1.5) {
          this.logger.debug(`[ROTATION SKIPPED] Position is profitable (${currentProfitPct.toFixed(2)}%), letting winner run`, {
            symbol: pos.symbol,
            currentProfitPct: currentProfitPct.toFixed(2),
            positionScore: positionScore.toFixed(3),
          });
          continue; // Skip rotation for profitable positions
        }
        
        // If position is not in top 5 and there are better signals available (top 4)
        if (!isInTop5 && top4Signals.length > 0) {
          // Find the worst top 4 signal that we're not holding
          const worstTop4Signal = top4Signals[top4Signals.length - 1];
          const worstTop4Score = signalScoreMap.get(worstTop4Signal) || 0;
          
          // Only rotate if current position score is significantly worse than worst top 4
          // This prevents unnecessary rotation when scores are close
          const scoreDiff = worstTop4Score - positionScore;
          this.logger.debug(`[ROTATION CHECK] Score comparison`, {
            symbol: pos.symbol,
            positionScore: positionScore.toFixed(3),
            worstTop4Signal,
            worstTop4Score: worstTop4Score.toFixed(3),
            scoreDiff: scoreDiff.toFixed(3),
            threshold: 0.05,
            willRotate: scoreDiff > 0.05,
          });
          if (scoreDiff > 0.05) { // At least 0.05 score difference
            try {
              const ticker = await this.exchangeService.getTicker(pos.symbol);
              const currentPrice = ticker.bid || ticker.price;
              const entryPrice = parseFloat(pos.entryPrice);
              const quantity = parseFloat(pos.quantity);
              const entryValue = quantity * entryPrice;
              const positionValue = quantity * currentPrice;
              
              const grossProfit = positionValue - entryValue;
              const krakenTakerFee = 0.0026;
              const estimatedFees = entryValue * krakenTakerFee + positionValue * krakenTakerFee;
              const netProfit = grossProfit - estimatedFees;
              const maxAcceptableLoss = entryValue * 0.015; // 1.5% max loss for rotation
              
              // Only rotate if we can exit profitably or at minimal loss
              this.logger.debug(`[ROTATION CHECK] Cost analysis`, {
                symbol: pos.symbol,
                entryPrice: entryPrice.toFixed(4),
                currentPrice: currentPrice.toFixed(4),
                grossProfit: grossProfit.toFixed(4),
                estimatedFees: estimatedFees.toFixed(4),
                netProfit: netProfit.toFixed(4),
                maxAcceptableLoss: maxAcceptableLoss.toFixed(4),
                willRotate: netProfit > 0 || (netProfit >= -maxAcceptableLoss && grossProfit > -maxAcceptableLoss),
              });
              if (netProfit > 0 || (netProfit >= -maxAcceptableLoss && grossProfit > -maxAcceptableLoss)) {
                this.logger.log(`[ROTATION] Exiting underperforming position to rotate to better signal`, {
                  symbol: pos.symbol,
                  positionScore: positionScore.toFixed(3),
                  worstTop4Signal,
                  worstTop4Score: worstTop4Score.toFixed(3),
                  scoreDiff: scoreDiff.toFixed(3),
                  positionAgeHours: positionAgeHours.toFixed(2),
                  netProfit: netProfit.toFixed(4),
                });
                
                trades.push({
                  symbol: pos.symbol,
                  side: 'sell',
                  quantity: parseFloat(pos.quantity),
                });
                // Set cooldown to prevent immediate re-entry after selling
                this.cooldownMap.set(pos.symbol, cooldownCycles);
                exitSymbols.add(pos.symbol);
                continue; // Skip to next position
              } else {
                this.logger.debug(`[ROTATION SKIPPED] Position underperforming but exit would be too costly`, {
                  symbol: pos.symbol,
                  positionScore: positionScore.toFixed(3),
                  worstTop4Score: worstTop4Score.toFixed(3),
                  netProfit: netProfit.toFixed(4),
                  maxAcceptableLoss: maxAcceptableLoss.toFixed(4),
                });
              }
            } catch (error: any) {
              this.logger.warn(`[ROTATION SKIPPED] Could not evaluate rotation for position`, {
                symbol: pos.symbol,
                error: error.message,
              });
            }
          }
        } else {
          this.logger.debug(`[ROTATION SKIPPED] Position not in top 5 but no better signals available or score difference too small`, {
            symbol: pos.symbol,
            positionScore: positionScore.toFixed(3),
            isInTop5,
            top5Signals,
          });
        }
      } else {
        this.logger.debug(`[ROTATION SKIPPED] Position too new for rotation`, {
          symbol: pos.symbol,
          positionAgeHours: positionAgeHours.toFixed(2),
          minHoldHours: minHoldHours.toFixed(2),
        });
      }
    }
    
    // Close positions not in target (but skip those already marked for exit)
    // IMPORTANT: Only exit if we can do so profitably (or at minimal loss)
    // Only check positions that are due for evaluation (per-position evaluation cycle)
    for (const pos of currentPositions) {
      // Skip if already marked for exit
      if (exitSymbols.has(pos.symbol)) {
        continue;
      }
      
      // Skip if position is not due for evaluation (per-position evaluation cycle)
      if (!duePositionSymbols.has(pos.symbol)) {
        this.logger.debug(`Skipping target exit check - position not due for evaluation`, {
          symbol: pos.symbol,
        });
        continue;
      }
      
      if (!targetAssets.includes(pos.symbol)) {
        // SLOW MOMENTUM PHILOSOPHY: Don't exit positions immediately
        // Positions need time to develop momentum. Only exit if:
        // 1. Position has been held for at least 2 cadence cycles (to give momentum time to develop)
        // 2. OR we can exit profitably (lock in gains)
        // 3. OR loss is minimal (cut losses early, but only after minimum hold period)
        
        // Reuse position age calculation from rotation check above
        const positionAgeMs = Date.now() - pos.openedAt.getTime();
        const positionAgeHours = positionAgeMs / (1000 * 60 * 60);
        const minHoldCycles = 4; // Minimum 4 cadence cycles (8-12 hours) before "not in target" exit to reduce trading frequency
        const minHoldHours = cadenceHours * minHoldCycles;
        
        // Calculate current P&L - don't exit profitable positions just because they're not in target
        let currentProfitPct = 0;
        let isProfitable = false;
        try {
          const ticker = await this.exchangeService.getTicker(pos.symbol);
          const currentPrice = ticker.bid || ticker.price;
          const entryPrice = parseFloat(pos.entryPrice);
          const quantity = parseFloat(pos.quantity);
          const entryValue = quantity * entryPrice;
          const positionValue = quantity * currentPrice;
          const grossProfit = positionValue - entryValue;
          const krakenTakerFee = 0.0026;
          const estimatedFees = entryValue * krakenTakerFee + positionValue * krakenTakerFee;
          const netProfit = grossProfit - estimatedFees;
          currentProfitPct = (grossProfit / entryValue) * 100;
          // Consider profitable if net profit is positive OR gross profit > 1% (fees are ~0.52%)
          isProfitable = netProfit > 0 || currentProfitPct > 1.0;
        } catch (error: any) {
          // If we can't get ticker, assume not profitable to be conservative
          this.logger.debug(`Could not calculate P&L for target exit check`, { symbol: pos.symbol, error: error.message });
        }
        
        // DON'T exit profitable positions just because they're not in target - let winners run
        if (isProfitable && currentProfitPct > 1.5) {
          this.logger.debug(`[TARGET EXIT SKIPPED] Position is profitable (${currentProfitPct.toFixed(2)}%), letting winner run even though not in target`, {
            symbol: pos.symbol,
            currentProfitPct: currentProfitPct.toFixed(2),
            targetAssets,
          });
          continue; // Skip exit for profitable positions
        }
        
        // If position is too new, skip exit (let momentum develop)
        if (positionAgeHours < minHoldHours) {
          this.logger.debug(`[TARGET EXIT SKIPPED] Position too new - holding for momentum to develop`, {
            symbol: pos.symbol,
            positionAgeHours: positionAgeHours.toFixed(2),
            minHoldHours: minHoldHours.toFixed(2),
            cadenceHours,
          });
          continue; // Skip this position - too new to exit
        }
        
        // Before exiting, check if we can exit profitably or at least minimize loss
        try {
          const ticker = await this.exchangeService.getTicker(pos.symbol);
          // Use bid price for sell orders (what we'd actually get when selling)
          // This gives a more realistic profit calculation
          const currentPrice = ticker.bid || ticker.price;
          const entryPrice = parseFloat(pos.entryPrice);
          const quantity = parseFloat(pos.quantity);
          const entryValue = quantity * entryPrice;
          const positionValue = quantity * currentPrice;
          
          // Calculate gross profit
          const grossProfit = positionValue - entryValue;
          
          // Estimate fees (worst case: taker fees on both sides)
          const krakenTakerFee = 0.0026; // 0.26% taker fee
          const estimatedFees = entryValue * krakenTakerFee + positionValue * krakenTakerFee;
          const netProfit = grossProfit - estimatedFees;
          
          // Only exit if:
          // 1. We have a net profit (lock in gains), OR
          // 2. The loss is acceptable (less than 1.5% of entry value) AND position is old enough
          // This respects the slow momentum philosophy: give positions time, but exit if they're clearly not working
          const maxAcceptableLoss = entryValue * 0.015; // 1.5% max loss for "not in target" exits
          
          if (netProfit > 0 || (netProfit >= -maxAcceptableLoss && grossProfit > -maxAcceptableLoss)) {
            this.logger.log(`[TARGET EXIT] Closing position not in target assets (held ${positionAgeHours.toFixed(2)}h)`, {
              symbol: pos.symbol,
              entryPrice: entryPrice.toFixed(4),
              currentPrice: currentPrice.toFixed(4),
              grossProfit: grossProfit.toFixed(4),
              estimatedFees: estimatedFees.toFixed(4),
              netProfit: netProfit.toFixed(4),
              positionAgeHours: positionAgeHours.toFixed(2),
              minHoldHours: minHoldHours.toFixed(2),
            });
            
            trades.push({
              symbol: pos.symbol,
              side: 'sell',
              quantity: parseFloat(pos.quantity),
            });
            // Set cooldown to prevent immediate re-entry after selling
            this.cooldownMap.set(pos.symbol, cooldownCycles);
          } else {
            this.logger.debug(`[TARGET EXIT SKIPPED] Position not in target but exit would be too costly`, {
              symbol: pos.symbol,
              entryPrice: entryPrice.toFixed(4),
              currentPrice: currentPrice.toFixed(4),
              grossProfit: grossProfit.toFixed(4),
              estimatedFees: estimatedFees.toFixed(4),
              netProfit: netProfit.toFixed(4),
              maxAcceptableLoss: maxAcceptableLoss.toFixed(4),
              positionAgeHours: positionAgeHours.toFixed(2),
            });
          }
        } catch (error: any) {
          // If we can't get ticker, log warning but don't exit (safer to hold than exit blindly)
          this.logger.warn(`[TARGET EXIT SKIPPED] Could not evaluate exit for position not in target`, {
            symbol: pos.symbol,
            error: error.message,
          });
        }
      }
    }

    // Recalculate available slots and target assets after exits
    // This ensures we can buy into better signals when we rotate out of underperforming positions
    const exitCount = trades.filter(t => t.side === 'sell').length;
    if (exitCount > 0) {
      const newAvailableSlots = Math.max(0, maxPositions - (currentPositionCount - exitCount));
      // Filter out held positions from signals before selecting top K
      const availableSignalsAfterExit = signals.filter(s => !currentHoldings.has(s.symbol));
      const newTopK = Math.min(newAvailableSlots, availableSignalsAfterExit.length);
      const newTargetAssets = availableSignalsAfterExit.slice(0, newTopK).map((s) => s.symbol);
      
      // Update targetAssets to include signals we want to rotate into
      // Add any top 4 signals that we're not already holding and not already in targetAssets
      for (const topSignal of top4Signals) {
        if (!currentHoldings.has(topSignal) && !newTargetAssets.includes(topSignal) && newTargetAssets.length < maxPositions) {
          newTargetAssets.push(topSignal);
        }
      }
      
      targetAssets = newTargetAssets;
      // Update availableSlots to reflect the new count after exits
      availableSlots = newAvailableSlots;
      
      this.logger.log(`Recalculated targets after ${exitCount} exit(s): availableSlots=${newAvailableSlots}, targetAssets=[${targetAssets.join(', ')}]`, {
        exitCount,
        newAvailableSlots,
        newTopK,
        targetAssets,
        top4Signals,
      });
    }

    // Get actual free USD balance from exchange (more accurate than calculating from NAV)
    let availableCash = 0;
    try {
      const balance = await this.exchangeService.getBalance('USD');
      // balance.free should already exclude locked funds, but let's verify
      // by checking open orders and comparing with balance.locked
      const freeBalance = parseFloat(balance.free.toString());
      const lockedBalance = parseFloat(balance.locked.toString());
      
      // Get open buy orders to verify locked funds calculation
      try {
        const openOrders = (await this.exchangeService.getOpenOrders()).filter(order =>
          orderBelongsToBot(order, userrefPrefix),
        );
        let calculatedLockedInBuyOrders = 0;
        for (const order of openOrders) {
          if (order.side === 'buy') {
            // For buy orders, the locked amount is remaining quantity * price
            calculatedLockedInBuyOrders += order.remainingQuantity * order.price;
          }
        }
        
        // Use the exchange's free balance directly (it should already exclude locked funds)
        // But log both for debugging
        availableCash = freeBalance;
        
        // Log detailed balance info for debugging
        this.logger.log(`Available cash calculation from exchange balance`, {
          freeBalance: freeBalance.toFixed(4),
          lockedBalance: lockedBalance.toFixed(4),
          totalBalance: (freeBalance + lockedBalance).toFixed(4),
          openBuyOrdersCount: openOrders.filter(o => o.side === 'buy').length,
          calculatedLockedInBuyOrders: calculatedLockedInBuyOrders.toFixed(4),
          availableCash: availableCash.toFixed(4),
          difference: Math.abs(lockedBalance - calculatedLockedInBuyOrders).toFixed(4),
        });
        
        // If there's a significant discrepancy, warn about it
        const discrepancy = Math.abs(lockedBalance - calculatedLockedInBuyOrders);
        if (discrepancy > 0.01) {
          this.logger.warn(`Locked balance discrepancy detected`, {
            exchangeLocked: lockedBalance.toFixed(4),
            calculatedLocked: calculatedLockedInBuyOrders.toFixed(4),
            discrepancy: discrepancy.toFixed(4),
            usingFreeBalance: freeBalance.toFixed(4),
          });
        }
      } catch (ordersError: any) {
        this.logger.warn(`Could not get open orders, using free balance only`, {
          error: ordersError.message,
          freeBalance: freeBalance.toFixed(4),
        });
        availableCash = freeBalance;
      }
    } catch (error: any) {
      this.logger.warn(`Could not get balance from exchange, falling back to NAV calculation`, {
        error: error.message,
      });
      // Fallback: Calculate from NAV if exchange balance fails
      availableCash = nav;
      for (const pos of currentPositions) {
        try {
          const ticker = await this.exchangeService.getTicker(pos.symbol);
          const positionValue = parseFloat(pos.quantity) * ticker.price;
          availableCash -= positionValue;
        } catch (tickerError: any) {
          // Estimate using entry price if ticker fails
          const positionValue = parseFloat(pos.quantity) * parseFloat(pos.entryPrice);
          availableCash -= positionValue;
        }
      }
    }
    
    this.logger.log(`Available cash calculation: NAV=$${nav.toFixed(4)}, positions=${currentPositionCount}, availableCash=$${availableCash.toFixed(4)}`, {
      nav,
      currentPositionCount,
      availableCash,
      method: 'exchange_balance',
    });
    
    // Track allocated cash for new positions we're about to open
    let allocatedCash = 0;

    // Check if we've queued sell orders in this evaluation cycle
    // If so, wait for them to fill before buying new positions (cash will be available after fills)
    const pendingSellsInThisCycle = trades.filter(t => t.side === 'sell').length;
    if (pendingSellsInThisCycle > 0) {
      this.logger.log(`Deferring buy orders - waiting for ${pendingSellsInThisCycle} sell order(s) to fill before buying new positions`, {
        pendingSells: pendingSellsInThisCycle,
        sellSymbols: trades.filter(t => t.side === 'sell').map(t => t.symbol),
        targetAssets,
        reason: 'Cash will be available after sell orders fill',
      });
      // Return trades (sells only, no buys) - buys will happen in next evaluation cycle
      return trades;
    }

    // Open new positions (check cooldown and available cash)
    for (const symbol of targetAssets) {
      if (!currentHoldings.has(symbol)) {
        // Check if there's already a pending buy order for this symbol on the exchange
        if (pendingBuySymbols.has(symbol)) {
          this.logger.debug(`Skipping symbol - buy order already pending on exchange`, {
            symbol,
          });
          continue;
        }
        
        // Check if we've already added a buy trade for this symbol in this evaluation
        const alreadyAdded = trades.some(t => t.side === 'buy' && t.symbol === symbol);
        if (alreadyAdded) {
          this.logger.debug(`Skipping symbol - buy trade already added in this evaluation`, {
            symbol,
          });
          continue;
        }
        
        // Check cooldown: skip if symbol is still in cooldown
        const cooldownCyclesRemaining = this.cooldownMap.get(symbol) || 0;
        if (cooldownCyclesRemaining > 0) {
          this.logger.debug(`Skipping symbol - still in cooldown`, {
            symbol,
            cooldownCyclesRemaining,
          });
          continue;
        }

        const ticker = await this.exchangeService.getTicker(symbol);
        
        // Calculate size based on available cash (not full NAV)
        const remainingCash = availableCash - allocatedCash;
        
        // Get settings to check why calculateSize might return 0
        const maxAllocFraction = await this.settingsService.getSettingNumber('MAX_ALLOC_FRACTION');
        const minOrderUsd = await this.settingsService.getSettingNumber('MIN_ORDER_USD');
        
        // Count remaining slots to fill
        // Count how many buy trades we've already added in this evaluation
        const buyTradesAdded = trades.filter(t => t.side === 'buy').length;
        // Calculate how many slots we're still trying to fill
        // This is: availableSlots - buyTradesAdded (including current symbol we're processing)
        const remainingSlots = Math.max(1, availableSlots - buyTradesAdded);
        
        // Get lot size info to check minimum order requirements
        const lotInfo = await this.exchangeService.getLotSizeInfo(symbol);
        const minOrderSizeUsd = Math.max(lotInfo.minOrderSize * ticker.price, minOrderUsd);
        
        // Adjust allocation fraction based on remaining slots
        // If multiple slots remain, use a larger fraction to ensure each position meets minimums
        let effectiveAllocFraction = maxAllocFraction;
        if (remainingSlots > 1) {
          // Use larger fraction when multiple slots: 0.35 -> 0.50 for 2 slots, 0.60 for 3 slots
          // This ensures each position gets enough cash to meet minimum order sizes
          effectiveAllocFraction = Math.min(maxAllocFraction * (1 + (remainingSlots - 1) * 0.3), 0.90);
          this.logger.debug(`Using adjusted allocation fraction for multiple slots`, {
            symbol,
            availableSlots,
            buyTradesAdded,
            remainingSlots,
            maxAllocFraction,
            effectiveAllocFraction: effectiveAllocFraction.toFixed(3),
          });
        }
        
        // Calculate initial allocation
        let alloc = remainingCash * effectiveAllocFraction;
        
        // Determine maximum allocation cap based on remaining slots
        // When multiple slots are available, we can be more aggressive with the first position
        // to ensure it meets minimum order sizes
        let maxAllocCap = 0.80; // Default: 80% cap
        if (remainingSlots > 1) {
          // More aggressive cap when multiple slots: 90% for 2 slots, 95% for 3+ slots
          maxAllocCap = Math.min(0.80 + (remainingSlots - 1) * 0.10, 0.95);
        }
        
        // If allocation is less than minimum order size, try to increase it to meet the minimum
        // Use a more aggressive cap when multiple slots are available
        if (alloc < minOrderSizeUsd) {
          const minRequiredFraction = minOrderSizeUsd / remainingCash;
          
          // Check if we can meet the minimum even with maximum allocation
          if (remainingCash * maxAllocCap >= minOrderSizeUsd) {
            // We have enough cash to meet minimum, boost allocation
            effectiveAllocFraction = Math.min(minRequiredFraction * 1.05, maxAllocCap); // Add 5% buffer, cap at maxAllocCap
            alloc = remainingCash * effectiveAllocFraction;
            this.logger.debug(`Increased allocation to meet minimum order size`, {
              symbol,
              minOrderSizeUsd: minOrderSizeUsd.toFixed(2),
              originalAlloc: (remainingCash * maxAllocFraction).toFixed(2),
              adjustedAlloc: alloc.toFixed(2),
              effectiveAllocFraction: effectiveAllocFraction.toFixed(3),
              maxAllocCap: maxAllocCap.toFixed(2),
              remainingSlots,
            });
          } else {
            // Even maximum allocation isn't enough - log and let calculateSize return 0
            this.logger.debug(`Cannot meet minimum order size even with maximum allocation`, {
              symbol,
              minOrderSizeUsd: minOrderSizeUsd.toFixed(2),
              maxPossibleAlloc: (remainingCash * maxAllocCap).toFixed(2),
              remainingCash: remainingCash.toFixed(2),
              maxAllocCap: maxAllocCap.toFixed(2),
              remainingSlots,
            });
          }
        }
        
        // Use the adjusted fraction for size calculation
        const quantity = await this.calculateSize(remainingCash, ticker.price, symbol, effectiveAllocFraction);
        
        // Log detailed calculation for debugging
        if (quantity === 0) {
          const calculatedQty = alloc / ticker.price;
          const roundedQty = await this.exchangeService.roundToLotSize(symbol, calculatedQty);
          const orderValueUsd = roundedQty * ticker.price;
          
          this.logger.log(`Skipping symbol - cannot create order: Allocation ($${alloc.toFixed(4)}) results in quantity ${calculatedQty.toFixed(8)}, rounded to ${roundedQty.toFixed(8)}. ${roundedQty < lotInfo.minOrderSize ? `Rounded quantity (${roundedQty.toFixed(8)}) < minOrderSize (${lotInfo.minOrderSize})` : ''}${orderValueUsd < minOrderUsd ? `; Order value ($${orderValueUsd.toFixed(4)}) < MIN_ORDER_USD ($${minOrderUsd.toFixed(4)})` : ''}`, {
            symbol,
            remainingCash: remainingCash.toFixed(4),
            price: ticker.price.toFixed(4),
            maxAllocFraction,
            effectiveAllocFraction: effectiveAllocFraction.toFixed(3),
            remainingSlots,
            alloc: alloc.toFixed(4),
            minOrderUsd,
            minOrderSize: lotInfo.minOrderSize,
            calculatedQty: calculatedQty.toFixed(8),
            roundedQty: roundedQty.toFixed(8),
            orderValueUsd: orderValueUsd.toFixed(4),
          });
        }
        
        if (quantity > 0) {
          const orderValue = quantity * ticker.price;
          
          // Ensure order value doesn't exceed available cash (accounting for fees)
          // Use a 5% buffer OR minimum $2.00, whichever is larger, to account for:
          // - Trading fees (typically 0.16-0.26% on Kraken, so 0.5% total for buy+sell worst case)
          // - Locked funds in pending orders
          // - Rounding errors
          // - Price slippage (maker orders should have minimal slippage)
          // - Exchange balance may include locked funds
          // 5% is more reasonable than 30% - fees are only ~0.5%, so 5% gives plenty of headroom
          const feeBuffer = Math.max(remainingCash * 0.05, 2.00);
          const maxOrderValue = remainingCash - feeBuffer;
          
          if (orderValue > maxOrderValue) {
            this.logger.log(`Order value exceeds available cash, skipping`, {
              symbol,
              orderValue: orderValue.toFixed(4),
              maxOrderValue: maxOrderValue.toFixed(4),
              remainingCash: remainingCash.toFixed(4),
              feeBuffer: feeBuffer.toFixed(4),
              availableCash: availableCash.toFixed(4),
              allocatedCash: allocatedCash.toFixed(4),
            });
            continue;
          }
          
          allocatedCash += orderValue;
          
          trades.push({ symbol, side: 'buy', quantity });
          // Note: Cooldown is set when positions are EXITED (sold), not when entered (bought)
          // This prevents immediate re-entry after selling, but allows buying new positions
          this.logger.log(`Added buy trade`, {
            symbol,
            quantity: quantity.toFixed(8),
            orderValue: orderValue.toFixed(4),
            remainingCash: remainingCash.toFixed(4),
            maxOrderValue: maxOrderValue.toFixed(4),
            feeBuffer: feeBuffer.toFixed(4),
            allocatedCash: allocatedCash.toFixed(4),
            availableCash: availableCash.toFixed(4),
            effectiveAllocFraction: effectiveAllocFraction.toFixed(3),
            remainingSlots,
            cooldownCycles,
          });
        } else {
          // Get lot size info to provide detailed reason
          const lotInfo = await this.exchangeService.getLotSizeInfo(symbol);
          const calculatedQty = alloc / ticker.price;
          const roundedQty = await this.exchangeService.roundToLotSize(symbol, calculatedQty);
          const orderValueUsd = roundedQty * ticker.price;
          const reasons = [];
          if (alloc < minOrderUsd) {
            reasons.push(`Allocation ($${alloc.toFixed(4)}) < MIN_ORDER_USD ($${minOrderUsd.toFixed(4)})`);
          }
          if (roundedQty < lotInfo.minOrderSize) {
            reasons.push(`Rounded quantity (${roundedQty.toFixed(8)}) < minOrderSize (${lotInfo.minOrderSize})`);
          }
          if (orderValueUsd < minOrderUsd) {
            reasons.push(`Order value ($${orderValueUsd.toFixed(4)}) < MIN_ORDER_USD ($${minOrderUsd.toFixed(4)})`);
          }
          
          this.logger.log(`Skipping symbol - cannot create order: ${reasons.length > 0 ? reasons.join('; ') : 'Unknown reason'}`, {
            symbol,
            remainingCash: remainingCash.toFixed(4),
            price: ticker.price.toFixed(4),
            maxAllocFraction,
            alloc: alloc.toFixed(4),
            minOrderUsd,
            minOrderSize: lotInfo.minOrderSize,
            calculatedQty: calculatedQty.toFixed(8),
            roundedQty: roundedQty.toFixed(8),
            orderValueUsd: orderValueUsd.toFixed(4),
          });
        }
      }
    }

    const tradesSummary = trades.length > 0 
      ? trades.map(t => `${t.side.toUpperCase()} ${t.symbol} (${t.quantity.toFixed(8)})`).join(', ')
      : 'none';
    this.logger.log(`Strategy evaluation complete: ${trades.length} trade(s) [${tradesSummary}], availableCash=$${availableCash.toFixed(4)}, allocatedCash=$${allocatedCash.toFixed(4)}, remainingCash=$${(availableCash - allocatedCash).toFixed(4)}`, {
      totalTrades: trades.length,
      trades: trades.map(t => ({ symbol: t.symbol, side: t.side, quantity: t.quantity })),
      availableCash: availableCash.toFixed(4),
      allocatedCash: allocatedCash.toFixed(4),
      remainingCash: (availableCash - allocatedCash).toFixed(4),
      targetAssetsCount: targetAssets.length,
      currentPositionCount,
      maxPositions,
      availableSlots,
      targetAssets,
      currentPositions: currentPositions.map(p => p.symbol),
      cooldownSymbols: Array.from(this.cooldownMap.entries()).map(([sym, cycles]) => ({ symbol: sym, cycles })),
    });

    if (trades.length === 0) {
      const reasons = [];
      if (availableSlots <= 0) {
        reasons.push(`No available slots (maxPositions: ${maxPositions}, current: ${currentPositionCount})`);
      }
      if (availableCash < 1) {
        reasons.push(`Insufficient cash (available: $${availableCash.toFixed(4)})`);
      }
      if (targetAssets.length === 0) {
        if (signals.length === 0) {
          reasons.push(`No signals passed entry filters (all ${universe.length} assets filtered out)`);
        } else {
          reasons.push(`No target assets selected (${signals.length} signal(s) generated but topK=0, availableSlots=${availableSlots})`);
        }
      }
      const alreadyHeld = targetAssets.filter(s => currentHoldings.has(s));
      if (alreadyHeld.length > 0) {
        reasons.push(`Already holding: ${alreadyHeld.join(', ')}`);
      }
      const inCooldown = targetAssets.filter(s => (this.cooldownMap.get(s) || 0) > 0);
      if (inCooldown.length > 0) {
        reasons.push(`In cooldown: ${inCooldown.map(s => `${s} (${this.cooldownMap.get(s)} cycles)`).join(', ')}`);
      }
      const pendingBuy = targetAssets.filter(s => pendingBuySymbols.has(s));
      if (pendingBuy.length > 0) {
        reasons.push(`Pending buy orders: ${pendingBuy.join(', ')}`);
      }
      
      this.logger.log(`No trades generated - ${reasons.length > 0 ? reasons.join('; ') : 'Unknown reason'}`, {
        hasAvailableSlots: availableSlots > 0,
        availableCash: availableCash.toFixed(4),
        targetAssets,
        totalSignals: signals.length,
        signalsPassedFilters: signals.length,
        currentPositions: currentPositions.map(p => p.symbol),
        symbolsInCooldown: Array.from(this.cooldownMap.keys()),
        symbolsAlreadyHeld: alreadyHeld,
        pendingBuySymbols: Array.from(pendingBuySymbols),
      });
    } else if (trades.length < availableSlots) {
      // Log why we didn't fill all available slots
      const alreadyHeld = targetAssets.filter(s => currentHoldings.has(s));
      const inCooldown = targetAssets.filter(s => (this.cooldownMap.get(s) || 0) > 0);
      const reasons = [];
      if (alreadyHeld.length > 0) {
        reasons.push(`Already holding: ${alreadyHeld.join(', ')}`);
      }
      if (inCooldown.length > 0) {
        reasons.push(`In cooldown: ${inCooldown.map(s => `${s} (${this.cooldownMap.get(s)} cycles)`).join(', ')}`);
      }
      if (availableCash - allocatedCash < 2) {
        reasons.push(`Insufficient remaining cash ($${(availableCash - allocatedCash).toFixed(4)})`);
      }
      
      this.logger.log(`Only ${trades.length} of ${availableSlots} available slots filled${reasons.length > 0 ? ` - ${reasons.join('; ')}` : ''}`, {
        tradesCount: trades.length,
        availableSlots,
        targetAssets,
        alreadyHeld,
        inCooldown: Array.from(this.cooldownMap.entries()).filter(([s]) => targetAssets.includes(s)),
        remainingCash: (availableCash - allocatedCash).toFixed(4),
      });
    }

    return trades;
  }

  /**
   * Clear cooldown for a symbol (useful for manual trades or testing)
   */
  clearCooldown(symbol: string): void {
    this.cooldownMap.delete(symbol);
  }

  /**
   * Adjust the maximum EMA ratio based on recent volatility.
   * Calm markets allow slightly higher EMA separation, while high volatility tightens the cap.
   */
  private getVolatilityAdjustedMaxEmaRatio(return24h: number, volatilityPausePct: number): number {
    const calmCap = 1.006; // When markets are quiet we can tolerate slightly higher EMA spread
    const volatileCap = 1.003; // Tighten cap as volatility approaches pause threshold
    if (volatilityPausePct <= 0) {
      return volatileCap;
    }
    const normalized = Math.min(Math.max(return24h / volatilityPausePct, 0), 1); // 0 (calm) -> 1 (at pause)
    const dynamicCap = calmCap - normalized * (calmCap - volatileCap);
    return parseFloat(dynamicCap.toFixed(6));
  }
}


