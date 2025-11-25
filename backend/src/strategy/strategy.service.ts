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

  async calculateSize(navUsd: number, priceUsd: number, symbol: string): Promise<number> {
    const maxAllocFraction = await this.settingsService.getSettingNumber('MAX_ALLOC_FRACTION');
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

    // Rank by score
    signals.sort((a, b) => b.indicators.score - a.indicators.score);

    // Get current positions first (needed for calculating available slots)
    const currentPositions = await this.positionsService.findOpen();
    const currentPositionCount = currentPositions.length;

    // Get top K assets based on MAX_POSITIONS setting
    const maxPositions = await this.settingsService.getSettingInt('MAX_POSITIONS');
    
    // Calculate how many new positions we can open
    const availableSlots = Math.max(0, maxPositions - currentPositionCount);
    const topK = Math.min(availableSlots, signals.length);
    
    const targetAssets = signals.slice(0, topK).map((s) => s.symbol);
    
    const topSignals = signals.slice(0, Math.min(5, signals.length)).map(s => `${s.symbol} (score: ${s.indicators.score.toFixed(3)})`).join(', ');
    this.logger.log(`Position selection: maxPositions=${maxPositions}, current=${currentPositionCount}, availableSlots=${availableSlots}, topK=${topK}, targetAssets=[${targetAssets.join(', ')}], topSignals=[${topSignals}]`, {
      maxPositions,
      currentPositionCount,
      availableSlots,
      topK,
      targetAssets,
      totalSignals: signals.length,
      nav,
      allSignals: signals.map(s => ({ symbol: s.symbol, score: s.indicators.score, rsi: s.indicators.rsi })),
      currentPositions: currentPositions.map(p => p.symbol),
    });
    const currentHoldings = new Set(currentPositions.map((p) => p.symbol));

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
      const openOrders = await this.exchangeService.getOpenOrders();
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
    for (const pos of currentPositions) {
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
        
        const profitThresholdPct = Math.max(minProfitPct, totalFeesPct * 100);
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

    // Close positions not in target (but skip those already marked for profit/loss exit)
    // IMPORTANT: Only exit if we can do so profitably (or at minimal loss)
    const exitSymbols = new Set(trades.filter(t => t.side === 'sell').map(t => t.symbol));
    for (const pos of currentPositions) {
      // Skip if already marked for profit/loss exit
      if (exitSymbols.has(pos.symbol)) {
        continue;
      }
      
      if (!targetAssets.includes(pos.symbol)) {
        // SLOW MOMENTUM PHILOSOPHY: Don't exit positions immediately
        // Positions need time to develop momentum. Only exit if:
        // 1. Position has been held for at least 2 cadence cycles (to give momentum time to develop)
        // 2. OR we can exit profitably (lock in gains)
        // 3. OR loss is minimal (cut losses early, but only after minimum hold period)
        
        const positionAgeMs = Date.now() - pos.openedAt.getTime();
        const positionAgeHours = positionAgeMs / (1000 * 60 * 60);
        const minHoldCycles = 2; // Minimum 2 cadence cycles before "not in target" exit
        const minHoldHours = cadenceHours * minHoldCycles;
        
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

    // Get actual free USD balance from exchange (more accurate than calculating from NAV)
    let availableCash = 0;
    try {
      const balance = await this.exchangeService.getBalance('USD');
      availableCash = parseFloat(balance.free.toString());
      
      // Also subtract locked funds from open orders
      try {
        const openOrders = await this.exchangeService.getOpenOrders();
        let lockedInOrders = 0;
        for (const order of openOrders) {
          if (order.side === 'buy') {
            // For buy orders, the locked amount is quantity * price
            lockedInOrders += order.remainingQuantity * order.price;
          }
        }
        availableCash -= lockedInOrders;
        
        this.logger.debug(`Retrieved free USD balance from exchange`, {
          free: balance.free,
          locked: balance.locked,
          openOrdersCount: openOrders.length,
          lockedInOrders: lockedInOrders.toFixed(4),
          availableCash: availableCash.toFixed(4),
        });
      } catch (ordersError: any) {
        this.logger.warn(`Could not get open orders, using balance only`, {
          error: ordersError.message,
        });
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

    // Open new positions (check cooldown and available cash)
    for (const symbol of targetAssets) {
      if (!currentHoldings.has(symbol)) {
        // Check if there's already a pending buy order for this symbol
        if (pendingBuySymbols.has(symbol)) {
          this.logger.debug(`Skipping symbol - buy order already pending`, {
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
        const alloc = remainingCash * maxAllocFraction;
        
        const quantity = await this.calculateSize(remainingCash, ticker.price, symbol);
        
        // Log detailed calculation for debugging
        if (quantity === 0) {
          const lotInfo = await this.exchangeService.getLotSizeInfo(symbol);
          const calculatedQty = alloc / ticker.price;
          const roundedQty = await this.exchangeService.roundToLotSize(symbol, calculatedQty);
          const orderValueUsd = roundedQty * ticker.price;
          
          this.logger.log(`Skipping symbol - cannot create order: Allocation ($${alloc.toFixed(4)}) results in quantity ${calculatedQty.toFixed(8)}, rounded to ${roundedQty.toFixed(8)}. ${roundedQty < lotInfo.minOrderSize ? `Rounded quantity (${roundedQty.toFixed(8)}) < minOrderSize (${lotInfo.minOrderSize})` : ''}${orderValueUsd < minOrderUsd ? `; Order value ($${orderValueUsd.toFixed(4)}) < MIN_ORDER_USD ($${minOrderUsd.toFixed(4)})` : ''}`, {
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
          // Set cooldown for this symbol
          this.cooldownMap.set(symbol, cooldownCycles);
          this.logger.log(`Added buy trade`, {
            symbol,
            quantity: quantity.toFixed(8),
            orderValue: orderValue.toFixed(4),
            remainingCash: remainingCash.toFixed(4),
            maxOrderValue: maxOrderValue.toFixed(4),
            feeBuffer: feeBuffer.toFixed(4),
            allocatedCash: allocatedCash.toFixed(4),
            availableCash: availableCash.toFixed(4),
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


