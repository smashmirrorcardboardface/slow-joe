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
import { getBotId } from '../../common/utils/bot.utils';

@Processor('reconcile')
@Injectable()
export class ReconcileProcessor extends WorkerHost {
  private botIdCache?: string;

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

  private getBotIdValue(): string {
    if (!this.botIdCache) {
      this.botIdCache = getBotId(this.configService);
    }
    return this.botIdCache;
  }

  async process(job: Job) {
    this.logger.log('Starting reconciliation', { jobId: job.id });

    try {
      const botId = this.getBotIdValue();
      // Sync positions from exchange balances first
      await this.syncPositionsFromBalances(job.id);
      
      // Get balances from exchange
      const baseCurrency = 'USD';
      const balance = await this.exchangeService.getBalance(baseCurrency);
      
      // Calculate NAV from positions
      const positions = await this.positionsService.findOpenByBot(botId);
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
      const botId = this.getBotIdValue();
      // Get all balances from exchange
      const allBalances = await this.exchangeService.getAllBalances();
      
      // Get universe to know which symbols we trade
      const universeStr = await this.settingsService.getSetting('UNIVERSE');
      const universe = universeStr.split(',').map(s => s.trim());
      
      // Get current open positions from database
      const dbPositions = await this.positionsService.findOpenByBot(botId);
      const dbPositionSymbols = new Set(dbPositions.map(p => p.symbol));
      
      // Track symbols we're about to create positions for (to avoid closing them)
      const symbolsToCreate = new Set<string>();
      
      // Map of base asset to symbol (e.g., AVAX -> AVAX-USD)
      const assetToSymbol: { [asset: string]: string } = {};
      for (const symbol of universe) {
        const baseAsset = symbol.split('-')[0];
        assetToSymbol[baseAsset] = symbol;
      }
      
      const tickerCache = new Map<string, { price: number }>();
      
      // For each non-USD asset with balance, check if we have a position
      for (const [rawAsset, balance] of Object.entries(allBalances)) {
        const asset = this.normalizeAssetCode(rawAsset);
        if (asset === 'USD') continue; // Skip USD
        
        const candidateSymbols: string[] = [];
        const addCandidate = (symbol?: string) => {
          if (symbol && !candidateSymbols.includes(symbol)) {
            candidateSymbols.push(symbol);
          }
        };
        
        addCandidate(assetToSymbol[rawAsset]);
        if (asset !== rawAsset) {
          addCandidate(assetToSymbol[asset]);
        }
        addCandidate(`${asset}-USD`);
        if (asset !== rawAsset) {
          addCandidate(`${rawAsset}-USD`);
        }
        
        let symbol: string | null = null;
        let tickerForSymbol: { price: number } | null = null;
        for (const candidate of candidateSymbols) {
          if (!candidate) continue;
          try {
            const cached = tickerCache.get(candidate);
            if (cached) {
              symbol = candidate;
              tickerForSymbol = cached;
              break;
            }
            const ticker = await this.exchangeService.getTicker(candidate);
            tickerCache.set(candidate, ticker);
            symbol = candidate;
            tickerForSymbol = ticker;
            break;
          } catch (error: any) {
            continue;
          }
        }
        
        if (!symbol) {
          this.logger.debug(`Skipping ${asset} - no matching symbol found`, {
            jobId,
            asset,
            balance,
          });
          continue;
        }
        
        const quantity = balance;
        // Include very small balances (like 0.0001 BTC) - they're valid positions
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
          // Mark this symbol as one we're creating to avoid closing it
          symbolsToCreate.add(symbol);
          
          // Use current price as entry price (best estimate)
          try {
            const ticker = tickerForSymbol || await this.exchangeService.getTicker(symbol);
            const entryPrice = ticker.price;
            
            await this.positionsService.createForBot({
              symbol,
              quantity: quantity.toString(),
              entryPrice: entryPrice.toString(),
              status: 'open',
            }, botId);
            
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
            await this.positionsService.createForBot({
              symbol,
              quantity: quantity.toString(),
              entryPrice: '0', // Will be updated on next reconcile
              status: 'open',
            }, botId);
          }
        }
      }
      
      // Check for positions in database that don't exist on exchange (should be closed)
      // BUT skip positions we just created in this same reconciliation run
      for (const dbPos of dbPositions) {
        // Skip if we're about to create this position (or just created it)
        if (symbolsToCreate.has(dbPos.symbol)) {
          this.logger.debug(`Skipping close check for ${dbPos.symbol} - position being created in this run`, {
            jobId,
            symbol: dbPos.symbol,
          });
          continue;
        }
        
        const baseAsset = this.normalizeAssetCode(dbPos.symbol.split('-')[0]);
        // Try multiple lookup keys in case of normalization differences
        const exchangeBalance = allBalances[baseAsset] || 
                               allBalances[baseAsset.toUpperCase()] || 
                               allBalances[baseAsset.toLowerCase()] || 0;
        
        // Also check if balance exists under raw asset code (before normalization)
        const rawBaseAsset = dbPos.symbol.split('-')[0];
        const rawBalance = allBalances[rawBaseAsset] || 
                          allBalances[rawBaseAsset.toUpperCase()] || 
                          allBalances[rawBaseAsset.toLowerCase()] || 0;
        
        const finalBalance = Math.max(exchangeBalance, rawBalance);
        
        // Use a much smaller threshold - 0.0001 BTC is a valid position (worth ~$8-9)
        // Only close if balance is truly zero or extremely small (dust)
        if (finalBalance < 0.00001) { // Only close if truly zero/dust (< 0.00001)
          this.logger.warn(`Position exists in DB but not on exchange, closing`, {
            jobId,
            symbol: dbPos.symbol,
            dbQuantity: dbPos.quantity,
            baseAsset,
            rawBaseAsset,
            exchangeBalance,
            rawBalance,
            finalBalance,
            availableBalances: Object.keys(allBalances),
          });
          await this.positionsService.closePosition(dbPos.id);
        } else if (exchangeBalance === 0 && rawBalance > 0) {
          // Balance found under different key - log for debugging
          this.logger.debug(`Position balance found under different asset code`, {
            jobId,
            symbol: dbPos.symbol,
            baseAsset,
            rawBaseAsset,
            exchangeBalance,
            rawBalance,
          });
        }
      }
    } catch (error: any) {
      this.logger.error('Error syncing positions from balances', error.stack, {
        jobId,
        error: error.message,
      });
    }
  }
  
  private normalizeAssetCode(asset: string): string {
    if (!asset) return asset;
    const upper = asset.toUpperCase();
    const directMap: { [key: string]: string } = {
      XDG: 'DOGE',
      XXDG: 'DOGE',
      XXRP: 'XRP',
      XRP: 'XRP',
      XBT: 'BTC',
      XXBT: 'BTC',
      XETH: 'ETH',
      XADA: 'ADA',
      XDOT: 'DOT',
      XAVAX: 'AVAX',
      XSOL: 'SOL',
    };
    if (directMap[upper]) {
      return directMap[upper];
    }
    let normalized = upper;
    if (normalized.startsWith('X') || normalized.startsWith('Z')) {
      normalized = normalized.slice(1);
    }
    if (normalized.startsWith('X') || normalized.startsWith('Z')) {
      normalized = normalized.slice(1);
    }
    if (normalized === 'XBT') normalized = 'BTC';
    if (normalized === 'XDG') normalized = 'DOGE';
    return normalized;
  }
}

