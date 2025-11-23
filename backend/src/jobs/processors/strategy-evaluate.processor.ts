import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { StrategyService } from '../../strategy/strategy.service';
import { JobsService } from '../jobs.service';
import { ExchangeService } from '../../exchange/exchange.service';
import { PositionsService } from '../../positions/positions.service';
import { MetricsService } from '../../metrics/metrics.service';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../../logger/logger.service';

@Processor('strategy-evaluate')
@Injectable()
export class StrategyEvaluateProcessor extends WorkerHost {
  constructor(
    private strategyService: StrategyService,
    private jobsService: JobsService,
    private exchangeService: ExchangeService,
    private positionsService: PositionsService,
    private metricsService: MetricsService,
    private configService: ConfigService,
    private logger: LoggerService,
  ) {
    super();
    this.logger.setContext('StrategyEvaluateProcessor');
  }

  async process(job: Job) {
    this.logger.log('Starting strategy evaluation', { jobId: job.id });

    if (!this.strategyService.isEnabled()) {
      this.logger.log('Strategy is disabled', { jobId: job.id });
      return;
    }

    // Get trades from strategy evaluation
    const trades = await this.strategyService.evaluate();

    if (trades.length === 0) {
      this.logger.log('No trades needed', { jobId: job.id });
      return;
    }

    this.logger.log(`Executing ${trades.length} trade(s)`, {
      jobId: job.id,
      tradeCount: trades.length,
    });

    // Execute each trade by enqueueing order execution jobs
    for (const trade of trades) {
      try {
        // Get current price for the order
        const ticker = await this.exchangeService.getTicker(trade.symbol);
        const orderPrice = trade.side === 'buy' ? ticker.ask : ticker.bid;

        await this.jobsService.enqueueOrderExecute(
          trade.symbol,
          trade.side,
          trade.quantity,
          orderPrice,
        );

        this.logger.log(`Enqueued ${trade.side} order`, {
          jobId: job.id,
          symbol: trade.symbol,
          side: trade.side,
          quantity: trade.quantity,
          price: orderPrice,
        });
      } catch (error: any) {
        this.logger.error(`Error enqueueing trade for ${trade.symbol}`, error.stack, {
          jobId: job.id,
          symbol: trade.symbol,
          error: error.message,
        });
        // Continue with other trades even if one fails
      }
    }

    this.logger.log('Strategy evaluation complete', { jobId: job.id });
  }
}

