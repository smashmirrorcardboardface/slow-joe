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

    // Score prioritizes EMA trend strength (ema12/ema26 ratio)
    // RSI is already filtered by entry criteria, so we use it as a secondary factor
    // Reward RSI values in the 45-55 range (sweet spot for momentum) with a small boost
    const emaRatio = ema12 / ema26;
    const rsiBonus = rsi >= 45 && rsi <= 55 ? 1.05 : 1.0; // 5% bonus for optimal RSI
    const score = emaRatio * rsiBonus;

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

    // Fetch signals for all assets
    const signals: Array<{ symbol: string; indicators: IndicatorResult }> = [];

    for (const symbol of universe) {
      try {
        const ohlcv = await this.exchangeService.getOHLCV(symbol, interval, 50);
        if (ohlcv.length < 26) {
          this.logger.debug(`Not enough data for symbol`, { symbol, candleCount: ohlcv.length });
          continue;
        }

        const indicators = await this.computeIndicators(ohlcv);

        // Check entry filters
        const passesFilter =
          indicators.ema12 > indicators.ema26 &&
          indicators.rsi >= rsiLow &&
          indicators.rsi <= rsiHigh;

        // Check volatility pause (24h return)
        const currentPrice = ohlcv[ohlcv.length - 1].close;
        const price24hAgo = ohlcv[Math.max(0, ohlcv.length - 4)].close; // Approximate 24h
        const return24h = Math.abs((currentPrice - price24hAgo) / price24hAgo) * 100;

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

    // Check for profit/loss threshold exits FIRST (before other exit logic)
    // This ensures we lock in profits or cut losses as soon as thresholds are hit
    for (const pos of currentPositions) {
      try {
        const ticker = await this.exchangeService.getTicker(pos.symbol);
        const currentPrice = ticker.price;
        const entryPrice = parseFloat(pos.entryPrice);
        const quantity = parseFloat(pos.quantity);
        
        // Calculate position value and profit/loss
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
    const exitSymbols = new Set(trades.filter(t => t.side === 'sell').map(t => t.symbol));
    for (const pos of currentPositions) {
      // Skip if already marked for profit/loss exit
      if (exitSymbols.has(pos.symbol)) {
        continue;
      }
      
      if (!targetAssets.includes(pos.symbol)) {
        trades.push({
          symbol: pos.symbol,
          side: 'sell',
          quantity: parseFloat(pos.quantity),
        });
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
        const quantity = await this.calculateSize(remainingCash, ticker.price, symbol);
        
        if (quantity > 0) {
          const orderValue = quantity * ticker.price;
          
          // Ensure order value doesn't exceed available cash (accounting for fees)
          // Use a 30% buffer OR minimum $2.00, whichever is larger, to account for:
          // - Trading fees (typically 0.16-0.26% on Kraken)
          // - Locked funds in pending orders
          // - Rounding errors
          // - Price slippage
          // - Exchange balance may include locked funds
          const feeBuffer = Math.max(remainingCash * 0.30, 2.00);
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
          this.logger.debug(`Skipping symbol - insufficient cash or below minimum order size`, {
            symbol,
            remainingCash,
            price: ticker.price,
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
      const alreadyHeld = targetAssets.filter(s => currentHoldings.has(s));
      if (alreadyHeld.length > 0) {
        reasons.push(`Already holding: ${alreadyHeld.join(', ')}`);
      }
      const inCooldown = targetAssets.filter(s => (this.cooldownMap.get(s) || 0) > 0);
      if (inCooldown.length > 0) {
        reasons.push(`In cooldown: ${inCooldown.map(s => `${s} (${this.cooldownMap.get(s)} cycles)`).join(', ')}`);
      }
      
      this.logger.log(`No trades generated - ${reasons.length > 0 ? reasons.join('; ') : 'Unknown reason'}`, {
        hasAvailableSlots: availableSlots > 0,
        availableCash: availableCash.toFixed(4),
        targetAssets,
        currentPositions: currentPositions.map(p => p.symbol),
        symbolsInCooldown: Array.from(this.cooldownMap.keys()),
        symbolsAlreadyHeld: alreadyHeld,
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
}


