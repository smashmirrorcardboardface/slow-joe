import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JobsService } from './jobs.service';
import { SettingsService } from '../settings/settings.service';
import { LoggerService } from '../logger/logger.service';
import { ExchangeService } from '../exchange/exchange.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JobsScheduler {
  constructor(
    private jobsService: JobsService,
    private settingsService: SettingsService,
    private logger: LoggerService,
    private exchangeService: ExchangeService,
    private configService: ConfigService,
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
}

