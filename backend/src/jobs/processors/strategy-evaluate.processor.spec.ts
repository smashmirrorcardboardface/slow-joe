import { Test, TestingModule } from '@nestjs/testing';
import { StrategyEvaluateProcessor } from './strategy-evaluate.processor';
import { StrategyService } from '../../strategy/strategy.service';
import { JobsService } from '../jobs.service';
import { ExchangeService } from '../../exchange/exchange.service';
import { PositionsService } from '../../positions/positions.service';
import { MetricsService } from '../../metrics/metrics.service';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../../logger/logger.service';
import { Job } from 'bullmq';

describe('StrategyEvaluateProcessor', () => {
  let processor: StrategyEvaluateProcessor;
  let strategyService: jest.Mocked<StrategyService>;
  let jobsService: jest.Mocked<JobsService>;
  let exchangeService: jest.Mocked<ExchangeService>;

  beforeEach(async () => {
    const mockStrategyService = {
      isEnabled: jest.fn(),
      evaluate: jest.fn(),
    };

    const mockJobsService = {
      enqueueOrderExecute: jest.fn(),
    };

    const mockExchangeService = {
      getTicker: jest.fn(),
    };

    const mockPositionsService = {
      findOpen: jest.fn(),
    };

    const mockMetricsService = {
      getNAV: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn(),
    };

    const mockLoggerService = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StrategyEvaluateProcessor,
        {
          provide: StrategyService,
          useValue: mockStrategyService,
        },
        {
          provide: JobsService,
          useValue: mockJobsService,
        },
        {
          provide: ExchangeService,
          useValue: mockExchangeService,
        },
        {
          provide: PositionsService,
          useValue: mockPositionsService,
        },
        {
          provide: MetricsService,
          useValue: mockMetricsService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: LoggerService,
          useValue: mockLoggerService,
        },
      ],
    }).compile();

    processor = module.get<StrategyEvaluateProcessor>(StrategyEvaluateProcessor);
    strategyService = module.get(StrategyService);
    jobsService = module.get(JobsService);
    exchangeService = module.get(ExchangeService);
  });

  describe('process', () => {
    const createMockJob = (): Job => ({
      id: 'job-123',
      data: {},
      name: 'evaluate-strategy',
      queueName: 'strategy-evaluate',
      attemptsMade: 0,
      timestamp: Date.now(),
      processedOn: undefined,
      finishedOn: undefined,
      returnvalue: undefined,
      failedReason: undefined,
      stacktrace: undefined,
      opts: {},
      progress: jest.fn(),
      updateProgress: jest.fn(),
      remove: jest.fn(),
      retry: jest.fn(),
      discard: jest.fn(),
      promote: jest.fn(),
      lockKey: 'lock-key',
      lockDuration: 0,
      delay: 0,
      priority: 0,
      removeOnComplete: false,
      removeOnFail: false,
    token: 'token',
    toJSON: jest.fn(),
  } as unknown as Job);

    it('should skip evaluation when strategy is disabled', async () => {
      const job = createMockJob();
      strategyService.isEnabled.mockReturnValue(false);

      await processor.process(job);

      expect(strategyService.evaluate).not.toHaveBeenCalled();
      expect(jobsService.enqueueOrderExecute).not.toHaveBeenCalled();
    });

    it('should skip when no trades are needed', async () => {
      const job = createMockJob();
      strategyService.isEnabled.mockReturnValue(true);
      strategyService.evaluate.mockResolvedValue([]);

      await processor.process(job);

      expect(strategyService.evaluate).toHaveBeenCalled();
      expect(jobsService.enqueueOrderExecute).not.toHaveBeenCalled();
    });

    it('should enqueue order execution jobs for each trade', async () => {
      const job = createMockJob();
      strategyService.isEnabled.mockReturnValue(true);
      strategyService.evaluate.mockResolvedValue([
        {
          symbol: 'BTC-USD',
          side: 'buy',
          quantity: 0.001,
        },
        {
          symbol: 'ETH-USD',
          side: 'sell',
          quantity: 0.01,
        },
      ]);

      exchangeService.getTicker
        .mockResolvedValueOnce({
          symbol: 'BTC-USD',
          price: 50000,
          bid: 49999,
          ask: 50001,
        })
        .mockResolvedValueOnce({
          symbol: 'ETH-USD',
          price: 3000,
          bid: 2999,
          ask: 3001,
        });

      await processor.process(job);

      expect(strategyService.evaluate).toHaveBeenCalled();
      expect(jobsService.enqueueOrderExecute).toHaveBeenCalledTimes(2);
      expect(jobsService.enqueueOrderExecute).toHaveBeenCalledWith(
        'BTC-USD',
        'buy',
        0.001,
        50001, // ask price for buy
      );
      expect(jobsService.enqueueOrderExecute).toHaveBeenCalledWith(
        'ETH-USD',
        'sell',
        0.01,
        2999, // bid price for sell
      );
    });

    it('should continue processing other trades if one fails', async () => {
      const job = createMockJob();
      strategyService.isEnabled.mockReturnValue(true);
      strategyService.evaluate.mockResolvedValue([
        {
          symbol: 'BTC-USD',
          side: 'buy',
          quantity: 0.001,
        },
        {
          symbol: 'ETH-USD',
          side: 'sell',
          quantity: 0.01,
        },
      ]);

      exchangeService.getTicker
        .mockRejectedValueOnce(new Error('Failed to get ticker for BTC-USD'))
        .mockResolvedValueOnce({
          symbol: 'ETH-USD',
          price: 3000,
          bid: 2999,
          ask: 3001,
        });

      await processor.process(job);

      // Should still process ETH-USD even though BTC-USD failed
      expect(jobsService.enqueueOrderExecute).toHaveBeenCalledTimes(1);
      expect(jobsService.enqueueOrderExecute).toHaveBeenCalledWith(
        'ETH-USD',
        'sell',
        0.01,
        2999,
      );
    });
  });
});

