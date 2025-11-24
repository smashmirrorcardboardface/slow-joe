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
      // Round quantity to lot size before placing order (Kraken requires this)
      const roundedQuantity = await this.exchangeService.roundToLotSize(symbol, quantity);
      
      if (roundedQuantity <= 0) {
        throw new Error(`Invalid quantity after rounding: ${roundedQuantity} (original: ${quantity})`);
      }

      // For sell orders, verify we have enough asset balance before placing order
      if (side === 'sell') {
        // Extract base currency from symbol (e.g., "ADA-USD" -> "ADA")
        const baseCurrency = symbol.split('-')[0];
        
        try {
          const assetBalance = await this.exchangeService.getBalance(baseCurrency);
          // For sell orders, only free balance matters (locked assets are in pending orders)
          const freeBalance = parseFloat(assetBalance.free.toString());
          
          // Use rounded quantity for balance check (this is what will actually be ordered)
          // Allow exact match or small rounding tolerance (0.01% or minimum 0.0001)
          // This accounts for floating point precision and small rounding differences
          const roundingTolerance = Math.max(roundedQuantity * 0.0001, 0.0001);
          const minRequiredBalance = roundedQuantity - roundingTolerance;
          
          if (freeBalance < minRequiredBalance) {
            const errorMsg = `Insufficient ${baseCurrency} balance for sell order. Required: ${roundedQuantity.toFixed(8)}, Available (free): ${freeBalance.toFixed(8)}`;
            this.logger.warn(`[BALANCE CHECK FAILED] ${errorMsg}`, {
              jobId: job.id,
              symbol,
              side,
              originalQuantity: quantity.toFixed(8),
              roundedQuantity: roundedQuantity.toFixed(8),
              baseCurrency,
              freeBalance: freeBalance.toFixed(8),
              lockedBalance: parseFloat(assetBalance.locked.toString()).toFixed(8),
              minRequiredBalance: minRequiredBalance.toFixed(8),
              difference: (freeBalance - roundedQuantity).toFixed(8),
            });
            
            // Try to get position info to see if there's a mismatch
            try {
              const positions = await this.positionsService.findBySymbol(symbol);
              const openPositions = positions.filter(p => p.status === 'open');
              if (openPositions.length > 0) {
                const positionQuantity = openPositions.reduce((sum, p) => sum + parseFloat(p.quantity), 0);
                this.logger.warn(`Position quantity mismatch detected`, {
                  symbol,
                  positionQuantity: positionQuantity.toFixed(8),
                  actualFreeBalance: freeBalance.toFixed(8),
                  requestedQuantity: roundedQuantity.toFixed(8),
                  originalQuantity: quantity.toFixed(8),
                });
              }
            } catch (posError: any) {
              // Ignore position lookup errors
            }
            
            throw new Error(errorMsg);
          }
          
          this.logger.log(`[BALANCE CHECK PASSED] Sufficient ${baseCurrency} balance for sell order`, {
            jobId: job.id,
            symbol,
            originalQuantity: quantity.toFixed(8),
            roundedQuantity: roundedQuantity.toFixed(8),
            freeBalance: freeBalance.toFixed(8),
            difference: (freeBalance - roundedQuantity).toFixed(8),
          });
        } catch (balanceError: any) {
          // If balance check fails, log and rethrow
          if (balanceError.message.includes('Insufficient')) {
            throw balanceError;
          }
          // For other errors (API failures, etc.), log warning but continue
          // The exchange will reject the order if balance is truly insufficient
          this.logger.warn(`Could not verify balance before sell order, proceeding anyway`, {
            jobId: job.id,
            symbol,
            baseCurrency: symbol.split('-')[0],
            error: balanceError.message,
          });
        }
      }

      const ticker = await this.exchangeService.getTicker(symbol);
      // For BUY: place limit order slightly below ask to get maker fee
      // For SELL: place limit order slightly above bid to get maker fee
      const limitPrice = side === 'buy' 
        ? ticker.ask * (1 - makerOffsetPct)
        : ticker.bid * (1 + makerOffsetPct);

      // Kraken userref must be numeric (integer), so use timestamp-based numeric ID
      // Use last 9 digits of timestamp to fit in int32 range
      const clientOrderId = parseInt(Date.now().toString().slice(-9), 10).toString();
      
      // Place limit order with rounded quantity
      const orderResult = await this.exchangeService.placeLimitOrder(
        symbol,
        side,
        roundedQuantity,
        limitPrice,
        clientOrderId,
      );

      this.logger.log(`Placed limit order`, {
        jobId: job.id,
        symbol,
        orderId: orderResult.orderId,
        limitPrice,
        side,
        originalQuantity: quantity,
        roundedQuantity: roundedQuantity,
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
          quantity: orderStatus.filledQuantity?.toString() || roundedQuantity.toString(),
          price: orderStatus.filledPrice?.toString() || limitPrice.toString(),
          fee: fee.toString(),
          exchangeOrderId: orderResult.orderId,
        });

        // Update position
        if (side === 'buy') {
          await this.positionsService.create({
            symbol,
            quantity: orderStatus.filledQuantity?.toString() || roundedQuantity.toString(),
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
              quantity: finalStatus.filledQuantity?.toString() || roundedQuantity.toString(),
              price: finalStatus.filledPrice?.toString() || limitPrice.toString(),
              fee: fee.toString(),
              exchangeOrderId: orderResult.orderId,
            });
            if (side === 'buy') {
              await this.positionsService.create({
                symbol,
                quantity: finalStatus.filledQuantity?.toString() || roundedQuantity.toString(),
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
        // Compare against limitPrice (what we tried to get) not original price (from job data)
        const slippagePct = Math.abs((expectedPrice - limitPrice) / limitPrice);

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
          limitPrice,
          expectedPrice,
          slippagePct: slippagePct * 100,
          side,
          quantity: roundedQuantity,
        });
        
        const marketOrderId = `market-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const marketOrderResult = await this.exchangeService.placeMarketOrder(
          symbol,
          side,
          roundedQuantity,
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
            quantity: marketOrderStatus.filledQuantity?.toString() || roundedQuantity.toString(),
            price: marketOrderStatus.filledPrice?.toString() || expectedPrice.toString(),
            fee: fee.toString(),
            exchangeOrderId: marketOrderResult.orderId,
          });

          // Update position
          if (side === 'buy') {
            await this.positionsService.create({
              symbol,
              quantity: marketOrderStatus.filledQuantity?.toString() || roundedQuantity.toString(),
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

