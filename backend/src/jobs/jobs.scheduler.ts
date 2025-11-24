import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JobsService } from './jobs.service';
import { SettingsService } from '../settings/settings.service';
import { LoggerService } from '../logger/logger.service';
import { ExchangeService } from '../exchange/exchange.service';
import { ConfigService } from '@nestjs/config';
import { PositionsService } from '../positions/positions.service';
import { StrategyService } from '../strategy/strategy.service';

@Injectable()
export class JobsScheduler {
  constructor(
    private jobsService: JobsService,
    private settingsService: SettingsService,
    private logger: LoggerService,
    private exchangeService: ExchangeService,
    private configService: ConfigService,
    private positionsService: PositionsService,
    private strategyService: StrategyService,
  ) {
    this.logger.setContext('JobsScheduler');
  }

  @Cron(CronExpression.EVERY_HOUR)
  async handleReconcile() {
    await this.jobsService.enqueueReconcile();
  }

  // Signal poller runs every CADENCE_HOURS
  // Using dynamic cron based on CADENCE_HOURS setting
  // Note: NestJS @Cron decorator doesn't support dynamic values at runtime,
  // so we check the cadence in the handler and only run if it matches
  @Cron('0 * * * *') // Check every hour, but only run if it's time
  async handleSignalPoller() {
    const cadenceHours = await this.settingsService.getSettingInt('CADENCE_HOURS');
    
    const now = new Date();
    const currentHour = now.getHours();
    
    // Only run if current hour is divisible by cadenceHours (e.g., 0, 6, 12, 18 for 6-hour cadence)
    if (currentHour % cadenceHours === 0 && now.getMinutes() === 0) {
      this.logger.log(`Triggering signal poller`, { cadenceHours, currentHour });
      await this.jobsService.enqueueSignalPoller();
    }
  }

  // Check for stale orders every 5 minutes
  @Cron('*/5 * * * *')
  async handleStaleOrderCheck() {
    try {
      const fillTimeoutMinutes = parseInt(
        this.configService.get<string>('FILL_TIMEOUT_MINUTES') || '15',
        10,
      );
      const staleThresholdMs = fillTimeoutMinutes * 60 * 1000; // Convert to milliseconds

      const openOrders = await this.exchangeService.getOpenOrders();
      const now = Date.now();
      let cancelledCount = 0;

      for (const order of openOrders) {
        const openedAt = order.openedAt instanceof Date 
          ? order.openedAt 
          : new Date(order.openedAt);
        const orderAge = now - openedAt.getTime();
        
        if (orderAge > staleThresholdMs) {
          this.logger.warn(`Found stale order, cancelling`, {
            orderId: order.orderId,
            symbol: order.symbol,
            side: order.side,
            ageMinutes: Math.round(orderAge / 60000),
            thresholdMinutes: fillTimeoutMinutes,
          });

          try {
            await this.exchangeService.cancelOrder(order.orderId);
            cancelledCount++;
            this.logger.log(`Cancelled stale order`, {
              orderId: order.orderId,
              symbol: order.symbol,
            });
          } catch (cancelError: any) {
            this.logger.warn(`Error cancelling stale order (may already be filled/cancelled)`, {
              orderId: order.orderId,
              symbol: order.symbol,
              error: cancelError.message,
            });
          }
        }
      }

      if (cancelledCount > 0) {
        this.logger.log(`Cancelled ${cancelledCount} stale order(s)`, {
          cancelledCount,
        });
      }
    } catch (error: any) {
      this.logger.error('Error checking for stale orders', error.stack, {
        error: error.message,
      });
    }
  }

  // Check profit and loss thresholds every 5 minutes (independent of strategy evaluation)
  @Cron('*/5 * * * *')
  async handleProfitLossCheck() {
    // Only run if strategy is enabled
    if (!this.strategyService.isEnabled()) {
      return;
    }

    try {
      // Get all settings
      const minProfitUsd = await this.settingsService.getSettingNumber('MIN_PROFIT_USD');
      const maxLossUsd = await this.settingsService.getSettingNumber('MAX_LOSS_USD');
      const minProfitPct = await this.settingsService.getSettingNumber('MIN_PROFIT_PCT');
      const maxLossPct = await this.settingsService.getSettingNumber('MAX_LOSS_PCT');
      const minPositionValueForExit = await this.settingsService.getSettingNumber('MIN_POSITION_VALUE_FOR_EXIT');
      const profitFeeBufferPct = await this.settingsService.getSettingNumber('PROFIT_FEE_BUFFER_PCT');
      const volatilityAdjustmentFactor = await this.settingsService.getSettingNumber('VOLATILITY_ADJUSTMENT_FACTOR');
      
      // Skip if all thresholds are disabled
      if (minProfitUsd <= 0 && maxLossUsd <= 0 && minProfitPct <= 0 && maxLossPct <= 0) {
        return;
      }

      const openPositions = await this.positionsService.findOpen();
      
      if (openPositions.length === 0) {
        return;
      }

      let closedCount = 0;

      for (const pos of openPositions) {
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
              this.logger.log(`[PROFIT EXIT] Closing position due to profit threshold (frequent check)`, {
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
              
              // Get current price for the sell order
              const orderPrice = ticker.bid; // Use bid price for sell orders
              
              // Enqueue sell order
              await this.jobsService.enqueueOrderExecute(
                pos.symbol,
                'sell',
                quantity,
                orderPrice,
              );
              
              closedCount++;
              continue; // Skip loss check for this position
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
            this.logger.log(`[STOP-LOSS EXIT] Closing position due to loss threshold (frequent check)`, {
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
            
            // Get current price for the sell order
            const orderPrice = ticker.bid; // Use bid price for sell orders
            
            // Enqueue sell order
            await this.jobsService.enqueueOrderExecute(
              pos.symbol,
              'sell',
              quantity,
              orderPrice,
            );
            
            closedCount++;
          }
        } catch (error: any) {
          this.logger.warn(`Error checking profit/loss threshold for position`, {
            symbol: pos.symbol,
            error: error.message,
          });
          // Continue with other positions
        }
      }

      if (closedCount > 0) {
        this.logger.log(`[PROFIT/LOSS EXIT] Enqueued ${closedCount} position(s) for exit`, {
          closedCount,
        });
      }
    } catch (error: any) {
      this.logger.error('Error during profit/loss threshold check', error.stack, {
        error: error.message,
      });
    }
  }
}

