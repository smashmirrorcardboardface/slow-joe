import { Controller, Get, Post, UseGuards, Param, Inject, forwardRef } from '@nestjs/common';
import { ExchangeService } from './exchange.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ConfigService } from '@nestjs/config';
import { StrategyService } from '../strategy/strategy.service';
import { SettingsService } from '../settings/settings.service';
import { OHLCVService } from '../ohlcv/ohlcv.service';
import { LoggerService } from '../logger/logger.service';

@Controller('api/exchange')
@UseGuards(JwtAuthGuard)
export class ExchangeController {
  constructor(
    private exchangeService: ExchangeService,
    private configService: ConfigService,
    private strategyService: StrategyService,
    private settingsService: SettingsService,
    @Inject(forwardRef(() => OHLCVService))
    private ohlcvService: OHLCVService,
    private logger: LoggerService,
  ) {
    this.logger.setContext('ExchangeController');
  }

  @Get('test-connection')
  async testConnection() {
    try {
      // Try to get balance as a test
      const balance = await this.exchangeService.getBalance('USD');
      return {
        success: true,
        message: 'Connection successful',
        balance: balance.free,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Connection failed',
        error: error.toString(),
      };
    }
  }

  @Get('market-data')
  async getMarketData() {
    const universeStr = await this.settingsService.getSetting('UNIVERSE');
    const universe = universeStr.split(',').map(s => s.trim());
    const cadenceHours = await this.settingsService.getSettingInt('CADENCE_HOURS');
    const interval = `${cadenceHours}h`;

    const marketData = await Promise.all(
      universe.map(async (symbol) => {
        try {
          // Get current ticker
          const ticker = await this.exchangeService.getTicker(symbol);
          
          // Get recent OHLCV for indicators - use cached data (will fetch fresh if cache is stale)
          // This endpoint is called frequently, so we prioritize cache to avoid rate limits
          const ohlcv = await this.exchangeService.getOHLCV(symbol, interval, 50, true, false);
          
          let indicators = null;
          if (ohlcv.length >= 26) {
            indicators = await this.strategyService.computeIndicators(ohlcv);
          } else if (ohlcv.length > 0) {
            this.logger.warn(`Insufficient OHLCV data`, {
              symbol,
              candleCount: ohlcv.length,
              required: 26,
            });
          }

          // Calculate 24h change if we have enough data
          let change24h = null;
          if (ohlcv.length >= 4) {
            const currentPrice = ticker.price;
            const price24hAgo = ohlcv[ohlcv.length - 4]?.close || currentPrice;
            change24h = ((currentPrice - price24hAgo) / price24hAgo) * 100;
          }

          return {
            symbol,
            price: ticker.price,
            bid: ticker.bid,
            ask: ticker.ask,
            change24h,
            indicators,
            lastUpdate: new Date().toISOString(),
          };
        } catch (error: any) {
          this.logger.error(`Error fetching market data`, error.stack, {
            symbol,
            error: error.message,
          });
          return {
            symbol,
            error: error.message || 'Failed to fetch data',
          };
        }
      }),
    );

    return {
      marketData,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('price-history/:symbol')
  async getPriceHistory(@Param('symbol') symbol: string) {
    try {
      // Get 1-hour candles - will refresh if cache is stale (older than 70 minutes)
      // This ensures we always have the latest candles for the chart
      const ohlcv = await this.exchangeService.getOHLCV(symbol, '1h', 168, true, false);
      
      // Sort by time ascending for chart display
      const sortedData = [...ohlcv].sort((a, b) => a.time - b.time);
      
      return {
        symbol,
        data: sortedData.map((candle) => ({
          time: candle.time,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        })),
      };
    } catch (error: any) {
      // Handle rate limit errors gracefully - try to return cached data
      if (error.message?.includes('Too many requests') || error.message?.includes('rate limit')) {
        this.logger.warn(`Rate limit hit, trying cached data`, { symbol });
        // Try to get from cache only (most recent candles)
        try {
          const cached = await this.ohlcvService.getCandles(symbol, '1h', 168, undefined, undefined, 'DESC');
          // Sort by time ascending for chart display
          const sortedCached = [...cached].sort((a, b) => a.time.getTime() - b.time.getTime());
          return {
            symbol,
            data: sortedCached.map((candle) => ({
              time: candle.time.getTime(),
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
              volume: candle.volume,
            })),
            cached: true,
          };
        } catch (cacheError) {
          return {
            symbol,
            error: 'Rate limit exceeded. Please wait before refreshing.',
            data: [],
          };
        }
      }
      this.logger.error(`Error fetching price history`, error.stack, {
        symbol,
        error: error.message,
      });
      return {
        symbol,
        error: error.message || 'Failed to fetch price history',
        data: [],
      };
    }
  }

  @Get('open-orders')
  async getOpenOrders() {
    try {
      const orders = await this.exchangeService.getOpenOrders();
      return {
        success: true,
        orders,
        count: orders.length,
      };
    } catch (error: any) {
      this.logger.error(`Error fetching open orders`, error.stack, {
        error: error.message,
      });
      return {
        success: false,
        error: error.message || 'Failed to fetch open orders',
        orders: [],
        count: 0,
      };
    }
  }

  @Post('cancel-order/:orderId')
  async cancelOrder(@Param('orderId') orderId: string) {
    try {
      const cancelled = await this.exchangeService.cancelOrder(orderId);
      if (cancelled) {
        this.logger.log(`Manually cancelled order`, { orderId });
        return {
          success: true,
          message: 'Order cancelled successfully',
          orderId,
        };
      } else {
        return {
          success: false,
          message: 'Failed to cancel order (may already be filled or cancelled)',
          orderId,
        };
      }
    } catch (error: any) {
      this.logger.error(`Error cancelling order`, error.stack, {
        orderId,
        error: error.message,
      });
      return {
        success: false,
        error: error.message || 'Failed to cancel order',
        orderId,
      };
    }
  }

  @Post('cancel-all-orders')
  async cancelAllOrders() {
    try {
      const orders = await this.exchangeService.getOpenOrders();
      let cancelledCount = 0;
      const errors: string[] = [];

      for (const order of orders) {
        try {
          const cancelled = await this.exchangeService.cancelOrder(order.orderId);
          if (cancelled) {
            cancelledCount++;
            this.logger.log(`Cancelled order`, {
              orderId: order.orderId,
              symbol: order.symbol,
              side: order.side,
            });
          }
        } catch (error: any) {
          errors.push(`${order.symbol} (${order.orderId}): ${error.message}`);
          this.logger.warn(`Error cancelling order`, {
            orderId: order.orderId,
            symbol: order.symbol,
            error: error.message,
          });
        }
      }

      return {
        success: cancelledCount > 0,
        cancelledCount,
        totalOrders: orders.length,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error: any) {
      this.logger.error(`Error cancelling all orders`, error.stack, {
        error: error.message,
      });
      return {
        success: false,
        error: error.message || 'Failed to cancel orders',
      };
    }
  }
}

