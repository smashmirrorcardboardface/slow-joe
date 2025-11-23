import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OrderExecuteProcessor } from './order-execute.processor';
import { ExchangeService } from '../../exchange/exchange.service';
import { TradesService } from '../../trades/trades.service';
import { PositionsService } from '../../positions/positions.service';
import { MetricsService } from '../../metrics/metrics.service';
import { LoggerService } from '../../logger/logger.service';
import { AlertsService } from '../../alerts/alerts.service';
import { Job } from 'bullmq';

describe('OrderExecuteProcessor', () => {
  let processor: OrderExecuteProcessor;
  let exchangeService: jest.Mocked<ExchangeService>;
  let tradesService: jest.Mocked<TradesService>;
  let positionsService: jest.Mocked<PositionsService>;
  let alertsService: jest.Mocked<AlertsService>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const mockExchangeService = {
      getTicker: jest.fn(),
      placeLimitOrder: jest.fn(),
      placeMarketOrder: jest.fn(),
      cancelOrder: jest.fn(),
      getOrderStatus: jest.fn(),
    };

    const mockTradesService = {
      create: jest.fn(),
    };

    const mockPositionsService = {
      create: jest.fn(),
      findBySymbol: jest.fn(),
      closePosition: jest.fn(),
    };

    const mockMetricsService = {
      updateNAV: jest.fn(),
    };

    const mockAlertsService = {
      alertOrderFailure: jest.fn(),
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
        OrderExecuteProcessor,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: ExchangeService,
          useValue: mockExchangeService,
        },
        {
          provide: TradesService,
          useValue: mockTradesService,
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
          provide: LoggerService,
          useValue: mockLoggerService,
        },
        {
          provide: AlertsService,
          useValue: mockAlertsService,
        },
      ],
    }).compile();

    processor = module.get<OrderExecuteProcessor>(OrderExecuteProcessor);
    exchangeService = module.get(ExchangeService);
    tradesService = module.get(TradesService);
    positionsService = module.get(PositionsService);
    alertsService = module.get(AlertsService);
    configService = module.get(ConfigService);

    // Set up default config
    configService.get.mockImplementation((key: string) => {
      if (key === 'MAKER_OFFSET_PCT') return '0.001';
      if (key === 'FILL_TIMEOUT_MINUTES') return '15';
      if (key === 'MAX_SLIPPAGE_PCT') return '0.005';
      return null;
    });
  });

  describe('process', () => {
  const createMockJob = (data: any): Job => ({
    id: 'job-123',
    data,
    name: 'execute-order',
    queueName: 'order-execute',
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

    it('should execute buy order successfully with limit order fill', async () => {
      const job = createMockJob({
        symbol: 'BTC-USD',
        side: 'buy',
        quantity: 0.001,
        price: 50000,
      });

      exchangeService.getTicker.mockResolvedValue({
        symbol: 'BTC-USD',
        price: 50000,
        bid: 49999,
        ask: 50001,
      });

      exchangeService.placeLimitOrder.mockResolvedValue({
        orderId: 'order-123',
        status: 'pending',
      });

      exchangeService.getOrderStatus.mockResolvedValue({
        orderId: 'order-123',
        status: 'filled',
        filledQuantity: 0.001,
        filledPrice: 49999,
        fee: 0.5,
      });

      tradesService.create.mockResolvedValue({} as any);
      positionsService.create.mockResolvedValue({} as any);

      await processor.process(job);

      expect(exchangeService.placeLimitOrder).toHaveBeenCalled();
      expect(tradesService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: 'BTC-USD',
          side: 'buy',
          quantity: '0.001',
          fee: '0.5',
        }),
      );
      expect(positionsService.create).toHaveBeenCalled();
    });

    it('should execute sell order and close position', async () => {
      const job = createMockJob({
        symbol: 'BTC-USD',
        side: 'sell',
        quantity: 0.001,
        price: 50000,
      });

      exchangeService.getTicker.mockResolvedValue({
        symbol: 'BTC-USD',
        price: 50000,
        bid: 49999,
        ask: 50001,
      });

      exchangeService.placeLimitOrder.mockResolvedValue({
        orderId: 'order-456',
        status: 'pending',
      });

      exchangeService.getOrderStatus.mockResolvedValue({
        orderId: 'order-456',
        status: 'filled',
        filledQuantity: 0.001,
        filledPrice: 50001,
        fee: 0.5,
      });

      positionsService.findBySymbol.mockResolvedValue([
        {
          id: 'pos-1',
          symbol: 'BTC-USD',
          quantity: '0.001',
          entryPrice: '50000',
          status: 'open',
          openedAt: new Date(),
          closedAt: null,
          metadata: null,
        },
      ]);

      positionsService.closePosition.mockResolvedValue(undefined);

      await processor.process(job);

      expect(positionsService.findBySymbol).toHaveBeenCalledWith('BTC-USD');
      expect(positionsService.closePosition).toHaveBeenCalledWith('pos-1');
    });

    it('should cancel unfilled limit order and use market order fallback', async () => {
      const job = createMockJob({
        symbol: 'BTC-USD',
        side: 'buy',
        quantity: 0.001,
        price: 50000,
      });

      // Set a short timeout for testing
      configService.get.mockImplementation((key: string) => {
        if (key === 'MAKER_OFFSET_PCT') return '0.001';
        if (key === 'FILL_TIMEOUT_MINUTES') return '0.01'; // Very short timeout for test
        if (key === 'MAX_SLIPPAGE_PCT') return '0.005';
        return null;
      });

      exchangeService.getTicker
        .mockResolvedValueOnce({
          symbol: 'BTC-USD',
          price: 50000,
          bid: 49999,
          ask: 50001,
        })
        .mockResolvedValueOnce({
          symbol: 'BTC-USD',
          price: 50000,
          bid: 49999,
          ask: 50001,
        });

      exchangeService.placeLimitOrder.mockResolvedValue({
        orderId: 'order-123',
        status: 'pending',
      });

      // Order remains pending (multiple calls during polling)
      let callCount = 0;
      exchangeService.getOrderStatus.mockImplementation((orderId: string) => {
        callCount++;
        if (orderId === 'order-123') {
          // Limit order stays pending
          return Promise.resolve({
            orderId: 'order-123',
            status: 'pending',
          });
        } else if (orderId === 'market-order-123') {
          // Market order is filled
          return Promise.resolve({
            orderId: 'market-order-123',
            status: 'filled',
            filledQuantity: 0.001,
            filledPrice: 50001,
            fee: 0.5,
          });
        }
        return Promise.resolve({
          orderId,
          status: 'pending',
        });
      });

      exchangeService.cancelOrder.mockResolvedValue(true);

      exchangeService.placeMarketOrder.mockResolvedValue({
        orderId: 'market-order-123',
        status: 'pending',
      });

      // Mock setTimeout to resolve immediately
      const originalSetTimeout = global.setTimeout;
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((fn: any, delay: number) => {
        if (delay > 100) {
          // Skip the polling delay, execute immediately
          return originalSetTimeout(fn, 10) as any;
        }
        return originalSetTimeout(fn, delay) as any;
      });

      try {
        await processor.process(job);
      } finally {
        setTimeoutSpy.mockRestore();
      }

      expect(exchangeService.cancelOrder).toHaveBeenCalledWith('order-123');
      expect(exchangeService.placeMarketOrder).toHaveBeenCalled();
      expect(tradesService.create).toHaveBeenCalled();
    }, 10000);

    it('should skip market order if slippage exceeds maximum', async () => {
      const job = createMockJob({
        symbol: 'BTC-USD',
        side: 'buy',
        quantity: 0.001,
        price: 50000,
      });

      configService.get.mockImplementation((key: string) => {
        if (key === 'MAKER_OFFSET_PCT') return '0.001';
        if (key === 'FILL_TIMEOUT_MINUTES') return '0.01'; // Very short timeout
        if (key === 'MAX_SLIPPAGE_PCT') return '0.005';
        return null;
      });

      exchangeService.getTicker
        .mockResolvedValueOnce({
          symbol: 'BTC-USD',
          price: 50000,
          bid: 49999,
          ask: 50001,
        })
        .mockResolvedValueOnce({
          symbol: 'BTC-USD',
          price: 60000, // Large price change = high slippage (20% > 0.5%)
          bid: 59999,
          ask: 60001,
        });

      exchangeService.placeLimitOrder.mockResolvedValue({
        orderId: 'order-123',
        status: 'pending',
      });

      exchangeService.getOrderStatus.mockResolvedValue({
        orderId: 'order-123',
        status: 'pending',
      });

      exchangeService.cancelOrder.mockResolvedValue(true);

      // Mock setTimeout to resolve quickly
      const originalSetTimeout = global.setTimeout;
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((fn: any, delay: number) => {
        if (delay > 100) {
          return originalSetTimeout(fn, 10) as any;
        }
        return originalSetTimeout(fn, delay) as any;
      });

      try {
        await expect(processor.process(job)).rejects.toThrow();
        expect(exchangeService.placeMarketOrder).not.toHaveBeenCalled();
        expect(alertsService.alertOrderFailure).toHaveBeenCalled();
      } finally {
        setTimeoutSpy.mockRestore();
      }
    }, 10000);

    it('should send alert on order execution failure', async () => {
      const job = createMockJob({
        symbol: 'BTC-USD',
        side: 'buy',
        quantity: 0.001,
        price: 50000,
      });

      exchangeService.getTicker.mockRejectedValue(new Error('Exchange API error'));

      await expect(processor.process(job)).rejects.toThrow();
      expect(alertsService.alertOrderFailure).toHaveBeenCalledWith(
        'BTC-USD',
        expect.stringContaining('Exchange API error'),
      );
    });

    it('should handle order filled during cancellation check', async () => {
      const job = createMockJob({
        symbol: 'BTC-USD',
        side: 'buy',
        quantity: 0.001,
        price: 50000,
      });

      configService.get.mockImplementation((key: string) => {
        if (key === 'MAKER_OFFSET_PCT') return '0.001';
        if (key === 'FILL_TIMEOUT_MINUTES') return '0.01'; // Very short timeout
        if (key === 'MAX_SLIPPAGE_PCT') return '0.005';
        return null;
      });

      exchangeService.getTicker.mockResolvedValue({
        symbol: 'BTC-USD',
        price: 50000,
        bid: 49999,
        ask: 50001,
      });

      exchangeService.placeLimitOrder.mockResolvedValue({
        orderId: 'order-123',
        status: 'pending',
      });

      exchangeService.getOrderStatus
        .mockResolvedValueOnce({
          orderId: 'order-123',
          status: 'pending',
        })
        .mockResolvedValueOnce({
          orderId: 'order-123',
          status: 'filled', // Filled during cancellation
          filledQuantity: 0.001,
          filledPrice: 49999,
          fee: 0.5,
        });

      exchangeService.cancelOrder.mockRejectedValue(new Error('Order already filled'));

      // Mock setTimeout to resolve quickly
      const originalSetTimeout = global.setTimeout;
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((fn: any, delay: number) => {
        if (delay > 100) {
          return originalSetTimeout(fn, 10) as any;
        }
        return originalSetTimeout(fn, delay) as any;
      });

      try {
        await processor.process(job);
        expect(tradesService.create).toHaveBeenCalled();
        expect(positionsService.create).toHaveBeenCalled();
      } finally {
        setTimeoutSpy.mockRestore();
      }
    }, 10000);
  });
});

