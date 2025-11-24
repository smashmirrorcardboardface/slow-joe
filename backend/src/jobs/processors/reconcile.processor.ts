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
import { SettingsService } from '../../settings/settings.service';

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
    private settingsService: SettingsService,
  ) {
    super();
    this.logger.setContext('ReconcileProcessor');
  }

  async process(job: Job) {
    this.logger.log('Starting reconciliation', { jobId: job.id });

    try {
      // Sync positions from exchange balances first
      await this.syncPositionsFromBalances(job.id);
      
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

  private async syncPositionsFromBalances(jobId: string) {
    try {
      // Get all balances from exchange
      const allBalances = await this.exchangeService.getAllBalances();
      
      // Get universe to know which symbols we trade
      const universeStr = await this.settingsService.getSetting('UNIVERSE');
      const universe = universeStr.split(',').map(s => s.trim());
      
      // Get current open positions from database
      const dbPositions = await this.positionsService.findOpen();
      const dbPositionSymbols = new Set(dbPositions.map(p => p.symbol));
      
      // Map of base asset to symbol (e.g., AVAX -> AVAX-USD)
      const assetToSymbol: { [asset: string]: string } = {};
      for (const symbol of universe) {
        const baseAsset = symbol.split('-')[0];
        assetToSymbol[baseAsset] = symbol;
      }
      
      // For each non-USD asset with balance, check if we have a position
      for (const [asset, balance] of Object.entries(allBalances)) {
        if (asset === 'USD') continue; // Skip USD
        
        const symbol = assetToSymbol[asset];
        if (!symbol) {
          // Asset not in universe, skip it
          this.logger.debug(`Skipping ${asset} - not in trading universe`, {
            jobId,
            asset,
            balance,
          });
          continue;
        }
        
        const quantity = balance;
        if (quantity <= 0) continue;
        
        // Check if we already have a position for this symbol
        if (dbPositionSymbols.has(symbol)) {
          // Position exists, verify quantity matches
          const dbPosition = dbPositions.find(p => p.symbol === symbol);
          if (dbPosition) {
            const dbQuantity = parseFloat(dbPosition.quantity);
            const diff = Math.abs(dbQuantity - quantity);
            if (diff > 0.0001) { // Allow small rounding differences
              this.logger.warn(`Position quantity mismatch for ${symbol}`, {
                jobId,
                symbol,
                dbQuantity,
                exchangeQuantity: quantity,
                difference: diff,
              });
              // Update quantity if significantly different
              if (diff > 0.01) {
                await this.positionsService.update(dbPosition.id, {
                  quantity: quantity.toString(),
                });
                this.logger.log(`Updated position quantity for ${symbol}`, {
                  jobId,
                  symbol,
                  oldQuantity: dbQuantity,
                  newQuantity: quantity,
                });
              }
            }
          }
        } else {
          // No position in database, create one
          // Use current price as entry price (best estimate)
          try {
            const ticker = await this.exchangeService.getTicker(symbol);
            const entryPrice = ticker.price;
            
            await this.positionsService.create({
              symbol,
              quantity: quantity.toString(),
              entryPrice: entryPrice.toString(),
              status: 'open',
            });
            
            this.logger.log(`Created missing position from exchange balance`, {
              jobId,
              symbol,
              quantity,
              entryPrice,
            });
          } catch (tickerError: any) {
            this.logger.warn(`Could not get ticker for ${symbol}, using estimated entry price`, {
              jobId,
              symbol,
              error: tickerError.message,
            });
            // Create position with current price as estimate
            // We'll update it on next reconcile when ticker is available
            await this.positionsService.create({
              symbol,
              quantity: quantity.toString(),
              entryPrice: '0', // Will be updated on next reconcile
              status: 'open',
            });
          }
        }
      }
      
      // Check for positions in database that don't exist on exchange (should be closed)
      for (const dbPos of dbPositions) {
        const baseAsset = dbPos.symbol.split('-')[0];
        const exchangeBalance = allBalances[baseAsset] || 0;
        
        if (exchangeBalance <= 0.0001) { // Effectively zero
          this.logger.warn(`Position exists in DB but not on exchange, closing`, {
            jobId,
            symbol: dbPos.symbol,
            dbQuantity: dbPos.quantity,
            exchangeBalance,
          });
          await this.positionsService.closePosition(dbPos.id);
        }
      }
    } catch (error: any) {
      this.logger.error('Error syncing positions from balances', error.stack, {
        jobId,
        error: error.message,
      });
    }
  }
}

