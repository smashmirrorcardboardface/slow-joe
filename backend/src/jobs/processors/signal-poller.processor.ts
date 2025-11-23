import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { ExchangeService } from '../../exchange/exchange.service';
import { AssetsService } from '../../assets/assets.service';
import { SignalsService } from '../../signals/signals.service';
import { StrategyService } from '../../strategy/strategy.service';
import { SettingsService } from '../../settings/settings.service';
import { JobsService } from '../jobs.service';
import { LoggerService } from '../../logger/logger.service';

@Processor('signal-poller')
@Injectable()
export class SignalPollerProcessor extends WorkerHost {
  constructor(
    private settingsService: SettingsService,
    private exchangeService: ExchangeService,
    private assetsService: AssetsService,
    private signalsService: SignalsService,
    private strategyService: StrategyService,
    private jobsService: JobsService,
    private logger: LoggerService,
  ) {
    super();
    this.logger.setContext('SignalPollerProcessor');
  }

  async process(job: Job) {
    const universeStr = await this.settingsService.getSetting('UNIVERSE');
    const universe = universeStr.split(',').map(s => s.trim());
    const cadenceHours = await this.settingsService.getSettingInt('CADENCE_HOURS');
    const interval = `${cadenceHours}h`;

    this.logger.log(`Starting signal polling for ${universe.length} asset(s) with ${cadenceHours}h cadence`, {
      jobId: job.id,
      universe,
      cadenceHours,
    });

    let successCount = 0;
    let errorCount = 0;

    for (const symbol of universe) {
      try {
        this.logger.debug(`Processing ${symbol}`, { jobId: job.id, symbol });
        
        // Force refresh to get latest data from API (this runs every CADENCE_HOURS)
        // useCache=true, forceRefresh=true means: check cache freshness, but fetch fresh if needed
        const ohlcv = await this.exchangeService.getOHLCV(symbol, interval, 50, true, true);
        
        if (ohlcv.length < 26) {
          this.logger.warn(`Not enough data for ${symbol} (got ${ohlcv.length} candles, need 26)`, {
            jobId: job.id,
            symbol,
            candleCount: ohlcv.length,
          });
          errorCount++;
          continue;
        }

        this.logger.debug(`Fetched ${ohlcv.length} candles for ${symbol}, computing indicators`, {
          jobId: job.id,
          symbol,
          candleCount: ohlcv.length,
        });
        const indicators = await this.strategyService.computeIndicators(ohlcv);

        await this.signalsService.create({
          symbol,
          indicators,
          cadenceWindow: interval,
        });

        this.logger.log(`Generated signal for ${symbol}`, {
          jobId: job.id,
          symbol,
          ema12: indicators.ema12,
          ema26: indicators.ema26,
          rsi: indicators.rsi,
          score: indicators.score,
        });
        successCount++;
      } catch (error: any) {
        this.logger.error(`Error processing ${symbol}`, error.stack, {
          jobId: job.id,
          symbol,
          error: error.message,
        });
        errorCount++;
      }
    }

    this.logger.log(`Completed signal polling`, {
      jobId: job.id,
      successCount,
      errorCount,
    });

    // Trigger strategy evaluation if we got at least one signal
    if (successCount > 0) {
      this.logger.debug('Triggering strategy evaluation', { jobId: job.id });
      await this.jobsService.enqueueStrategyEvaluate();
    } else {
      this.logger.warn('No signals generated, skipping strategy evaluation', { jobId: job.id });
    }
  }
}

