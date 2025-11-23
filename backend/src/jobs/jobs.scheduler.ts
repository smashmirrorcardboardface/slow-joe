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

  // Check profit thresholds every 5 minutes (independent of strategy evaluation)
  @Cron('*/5 * * * *')
  async handleProfitThresholdCheck() {
    // Only run if strategy is enabled
    if (!this.strategyService.isEnabled()) {
      return;
    }

    try {
      const minProfitUsd = await this.settingsService.getSettingNumber('MIN_PROFIT_USD');
      
      // Skip if profit threshold is disabled (0 or negative)
      if (minProfitUsd <= 0) {
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
          
          // Calculate unrealized profit
          const profit = quantity * (currentPrice - entryPrice);
          
          if (profit >= minProfitUsd) {
            this.logger.log(`[PROFIT EXIT] Closing position due to profit threshold (frequent check)`, {
              symbol: pos.symbol,
              entryPrice: entryPrice.toFixed(4),
              currentPrice: currentPrice.toFixed(4),
              quantity: quantity.toFixed(8),
              profit: profit.toFixed(4),
              minProfitUsd: minProfitUsd.toFixed(4),
              profitPct: ((profit / (quantity * entryPrice)) * 100).toFixed(2),
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
          this.logger.warn(`Error checking profit threshold for position`, {
            symbol: pos.symbol,
            error: error.message,
          });
          // Continue with other positions
        }
      }

      if (closedCount > 0) {
        this.logger.log(`[PROFIT EXIT] Enqueued ${closedCount} position(s) for profit exit`, {
          closedCount,
        });
      }
    } catch (error: any) {
      this.logger.error('Error during profit threshold check', error.stack, {
        error: error.message,
      });
    }
  }
}

