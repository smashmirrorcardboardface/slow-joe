import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExchangeService } from '../../exchange/exchange.service';
import { TradesService } from '../../trades/trades.service';
import { PositionsService } from '../../positions/positions.service';
import { MetricsService } from '../../metrics/metrics.service';
import { LoggerService } from '../../logger/logger.service';
import { AlertsService } from '../../alerts/alerts.service';

@Processor('order-execute')
@Injectable()
export class OrderExecuteProcessor extends WorkerHost {
  constructor(
    private configService: ConfigService,
    private exchangeService: ExchangeService,
    private tradesService: TradesService,
    private positionsService: PositionsService,
    private metricsService: MetricsService,
    private logger: LoggerService,
    private alertsService: AlertsService,
  ) {
    super();
    this.logger.setContext('OrderExecuteProcessor');
  }

  async process(job: Job<{ symbol: string; side: 'buy' | 'sell'; quantity: number; price: number }>) {
    const { symbol, side, quantity, price } = job.data;
    this.logger.log(`Executing ${side} order`, {
      jobId: job.id,
      symbol,
      side,
      quantity,
      price,
    });

    const makerOffsetPct = parseFloat(
      this.configService.get<string>('MAKER_OFFSET_PCT') || '0.001',
    );
    const fillTimeoutMinutes = parseInt(
      this.configService.get<string>('FILL_TIMEOUT_MINUTES') || '15',
      10,
    );
    const maxSlippagePct = parseFloat(
      this.configService.get<string>('MAX_SLIPPAGE_PCT') || '0.005',
    );
    const pollIntervalSeconds = 30; // Poll every 30 seconds

    try {
      const ticker = await this.exchangeService.getTicker(symbol);
      const limitPrice = side === 'buy' 
        ? ticker.bid * (1 - makerOffsetPct)
        : ticker.ask * (1 + makerOffsetPct);

      // Kraken userref must be numeric (integer), so use timestamp-based numeric ID
      // Use last 9 digits of timestamp to fit in int32 range
      const clientOrderId = parseInt(Date.now().toString().slice(-9), 10).toString();
      
      // Place limit order
      const orderResult = await this.exchangeService.placeLimitOrder(
        symbol,
        side,
        quantity,
        limitPrice,
        clientOrderId,
      );

      this.logger.log(`Placed limit order`, {
        jobId: job.id,
        symbol,
        orderId: orderResult.orderId,
        limitPrice,
        side,
        quantity,
      });

      // Poll for fill with timeout
      const startTime = Date.now();
      const timeoutMs = fillTimeoutMinutes * 60 * 1000;
      let orderStatus = await this.exchangeService.getOrderStatus(orderResult.orderId);
      let filled = orderStatus.status === 'filled';

      while (!filled && (Date.now() - startTime) < timeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalSeconds * 1000));
        orderStatus = await this.exchangeService.getOrderStatus(orderResult.orderId);
        filled = orderStatus.status === 'filled';
        
        if (filled) {
          this.logger.log(`Limit order filled`, {
            jobId: job.id,
            symbol,
            orderId: orderResult.orderId,
          });
          break;
        }
      }

      if (filled) {
        // Extract fee from order status
        const fee = orderStatus.fee || 0;
        
        // Record trade with fee
        await this.tradesService.create({
          symbol,
          side,
          quantity: orderStatus.filledQuantity?.toString() || quantity.toString(),
          price: orderStatus.filledPrice?.toString() || limitPrice.toString(),
          fee: fee.toString(),
          exchangeOrderId: orderResult.orderId,
        });

        // Update position
        if (side === 'buy') {
          await this.positionsService.create({
            symbol,
            quantity: orderStatus.filledQuantity?.toString() || quantity.toString(),
            entryPrice: orderStatus.filledPrice?.toString() || limitPrice.toString(),
            status: 'open',
          });
        } else {
          // Close position
          const positions = await this.positionsService.findBySymbol(symbol);
          for (const pos of positions) {
            if (pos.status === 'open') {
              await this.positionsService.closePosition(pos.id);
            }
          }
        }

        this.logger.log(`Order filled successfully`, {
          jobId: job.id,
          symbol,
          orderId: orderResult.orderId,
          filledQuantity: orderStatus.filledQuantity,
          filledPrice: orderStatus.filledPrice,
          fee: orderStatus.fee,
        });
      } else {
        // Limit order not filled within timeout - cancel and try market order
        this.logger.warn(`Limit order not filled within ${fillTimeoutMinutes} minutes, cancelling and trying market order`, {
          jobId: job.id,
          symbol,
          orderId: orderResult.orderId,
          fillTimeoutMinutes,
        });
        
        try {
          await this.exchangeService.cancelOrder(orderResult.orderId);
          this.logger.log(`Cancelled limit order`, {
            jobId: job.id,
            symbol,
            orderId: orderResult.orderId,
          });
        } catch (cancelError: any) {
          this.logger.warn(`Error cancelling order (may already be filled/cancelled)`, {
            jobId: job.id,
            symbol,
            orderId: orderResult.orderId,
            error: cancelError.message,
          });
          // Check status again - might have been filled during cancellation
          const finalStatus = await this.exchangeService.getOrderStatus(orderResult.orderId);
          if (finalStatus.status === 'filled') {
            // Order was filled, process it
            const fee = finalStatus.fee || 0;
            await this.tradesService.create({
              symbol,
              side,
              quantity: finalStatus.filledQuantity?.toString() || quantity.toString(),
              price: finalStatus.filledPrice?.toString() || limitPrice.toString(),
              fee: fee.toString(),
              exchangeOrderId: orderResult.orderId,
            });
            if (side === 'buy') {
              await this.positionsService.create({
                symbol,
                quantity: finalStatus.filledQuantity?.toString() || quantity.toString(),
                entryPrice: finalStatus.filledPrice?.toString() || limitPrice.toString(),
                status: 'open',
              });
            } else {
              const positions = await this.positionsService.findBySymbol(symbol);
              for (const pos of positions) {
                if (pos.status === 'open') {
                  await this.positionsService.closePosition(pos.id);
                }
              }
            }
            this.logger.log(`Order was filled during cancellation check`, {
              jobId: job.id,
              symbol,
              orderId: orderResult.orderId,
            });
            return;
          }
        }

        // Place market order as fallback
        const currentTicker = await this.exchangeService.getTicker(symbol);
        const expectedPrice = side === 'buy' ? currentTicker.ask : currentTicker.bid;
        const slippagePct = Math.abs((expectedPrice - price) / price);

        if (slippagePct > maxSlippagePct) {
          this.logger.warn(`Expected slippage exceeds max, skipping market order`, {
            jobId: job.id,
            symbol,
            slippagePct: slippagePct * 100,
            maxSlippagePct: maxSlippagePct * 100,
          });
          throw new Error(`Slippage too high: ${(slippagePct * 100).toFixed(2)}%`);
        }

        this.logger.log(`Placing market order`, {
          jobId: job.id,
          symbol,
          expectedPrice,
          slippagePct: slippagePct * 100,
          side,
          quantity,
        });
        
        const marketOrderId = `market-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const marketOrderResult = await this.exchangeService.placeMarketOrder(
          symbol,
          side,
          quantity,
          marketOrderId,
        );

        // Wait a moment for market order to fill (market orders usually fill immediately)
        await new Promise((resolve) => setTimeout(resolve, 2000));
        
        const marketOrderStatus = await this.exchangeService.getOrderStatus(marketOrderResult.orderId);

        if (marketOrderStatus.status === 'filled') {
          // Extract fee from order status
          const fee = marketOrderStatus.fee || 0;
          
          // Record trade with fee
          await this.tradesService.create({
            symbol,
            side,
            quantity: marketOrderStatus.filledQuantity?.toString() || quantity.toString(),
            price: marketOrderStatus.filledPrice?.toString() || expectedPrice.toString(),
            fee: fee.toString(),
            exchangeOrderId: marketOrderResult.orderId,
          });

          // Update position
          if (side === 'buy') {
            await this.positionsService.create({
              symbol,
              quantity: marketOrderStatus.filledQuantity?.toString() || quantity.toString(),
              entryPrice: marketOrderStatus.filledPrice?.toString() || expectedPrice.toString(),
              status: 'open',
            });
          } else {
            // Close position
            const positions = await this.positionsService.findBySymbol(symbol);
            for (const pos of positions) {
              if (pos.status === 'open') {
                await this.positionsService.closePosition(pos.id);
              }
            }
          }

          this.logger.log(`Market order filled`, {
            jobId: job.id,
            symbol,
            orderId: marketOrderResult.orderId,
            filledPrice: marketOrderStatus.filledPrice,
            filledQuantity: marketOrderStatus.filledQuantity,
            fee: marketOrderStatus.fee,
          });
        } else {
          throw new Error(`Market order not filled: status ${marketOrderStatus.status}`);
        }
      }
    } catch (error: any) {
      this.logger.error(`Error executing order`, error.stack, {
        jobId: job.id,
        symbol,
        side,
        quantity,
        price,
        error: error.message,
      });
      
      // Send alert for order failure
      await this.alertsService.alertOrderFailure(
        symbol,
        error.message || 'Unknown error',
      );
      
      throw error;
    }
  }
}

