import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { ExchangeService } from '../../exchange/exchange.service';
import { PositionsService } from '../../positions/positions.service';
import { MetricsService } from '../../metrics/metrics.service';
import { TradesService } from '../../trades/trades.service';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../../logger/logger.service';
import { AlertsService } from '../../alerts/alerts.service';
import { RealtimeService } from '../../realtime/realtime.service';

@Processor('reconcile')
@Injectable()
export class ReconcileProcessor extends WorkerHost {
  constructor(
    private exchangeService: ExchangeService,
    private positionsService: PositionsService,
    private metricsService: MetricsService,
    private tradesService: TradesService,
    private configService: ConfigService,
    private logger: LoggerService,
    private alertsService: AlertsService,
    private realtimeService: RealtimeService,
  ) {
    super();
    this.logger.setContext('ReconcileProcessor');
  }

  async process(job: Job) {
    this.logger.log('Starting reconciliation', { jobId: job.id });

    try {
      // Get balances from exchange
      const baseCurrency = 'USD';
      const balance = await this.exchangeService.getBalance(baseCurrency);
      
      // Calculate NAV from positions
      const positions = await this.positionsService.findOpen();
      let totalValue = parseFloat(balance.free.toString()) + parseFloat(balance.locked.toString());

      for (const pos of positions) {
        try {
          const ticker = await this.exchangeService.getTicker(pos.symbol);
          const positionValue = parseFloat(pos.quantity) * ticker.price;
          totalValue += positionValue;
        } catch (error: any) {
          this.logger.error(`Error getting ticker for ${pos.symbol}`, error.stack, {
            jobId: job.id,
            symbol: pos.symbol,
            error: error.message,
          });
        }
      }

      // Calculate total fees paid (sum of all fees from trades)
      const allTrades = await this.tradesService.findAll(10000); // Get all trades
      const totalFees = allTrades.reduce((sum, trade) => {
        return sum + parseFloat(trade.fee || '0');
      }, 0);

      // Store total fees as a metric
      await this.metricsService.create('TOTAL_FEES', totalFees);

      // Note: NAV already accounts for fees since they're deducted at trade execution
      // But we track fees separately for reporting
      await this.metricsService.updateNAV(totalValue);

      // Check for low balance alert
      const lowBalanceThreshold = parseFloat(
        this.configService.get<string>('ALERTS_LOW_BALANCE_USD') || '50',
      );
      if (totalValue < lowBalanceThreshold) {
        await this.alertsService.alertLowBalance(totalValue, lowBalanceThreshold);
      }

      // Check for large drawdown
      const navHistory = await this.metricsService.findHistory('NAV', 100);
      if (navHistory.length > 0) {
        const peakNav = Math.max(...navHistory.map(m => m.value));
        if (peakNav > 0) {
          const drawdownPct = ((peakNav - totalValue) / peakNav) * 100;
          const drawdownThreshold = parseFloat(
            this.configService.get<string>('ALERTS_LARGE_DRAWDOWN_PCT') || '10',
          );
          if (drawdownPct >= drawdownThreshold) {
            await this.alertsService.alertLargeDrawdown(drawdownPct, totalValue, peakNav);
          }
        }
      }

      this.logger.log('NAV updated', {
        jobId: job.id,
        nav: totalValue,
        totalFees,
        positionCount: positions.length,
      });

      // Broadcast metrics update
      this.realtimeService.broadcastMetrics({
        nav: totalValue,
        totalFees,
        positions: positions.length,
        positionCount: positions.length,
      });

      // Check for stale orders and cancel them
      await this.checkAndCancelStaleOrders(job.id);
    } catch (error: any) {
      this.logger.error('Error during reconciliation', error.stack, {
        jobId: job.id,
        error: error.message,
      });
    }
  }

  private async checkAndCancelStaleOrders(jobId: string) {
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
            jobId,
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
              jobId,
              orderId: order.orderId,
              symbol: order.symbol,
            });
          } catch (cancelError: any) {
            this.logger.warn(`Error cancelling stale order (may already be filled/cancelled)`, {
              jobId,
              orderId: order.orderId,
              symbol: order.symbol,
              error: cancelError.message,
            });
          }
        }
      }

      if (cancelledCount > 0) {
        this.logger.log(`Cancelled ${cancelledCount} stale order(s)`, {
          jobId,
          cancelledCount,
        });
      }
    } catch (error: any) {
      this.logger.error('Error checking for stale orders', error.stack, {
        jobId,
        error: error.message,
      });
    }
  }
}

