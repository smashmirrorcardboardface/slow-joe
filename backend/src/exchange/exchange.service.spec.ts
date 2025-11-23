import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ExchangeService } from './exchange.service';
import { KrakenAdapter } from './adapters/kraken.adapter';
import { OHLCVService } from '../ohlcv/ohlcv.service';
import { LoggerService } from '../logger/logger.service';

describe('ExchangeService', () => {
  let service: ExchangeService;
  let krakenAdapter: jest.Mocked<KrakenAdapter>;
  let ohlcvService: jest.Mocked<OHLCVService>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const mockKrakenAdapter = {
      getTicker: jest.fn(),
      getBalance: jest.fn(),
      getOHLCV: jest.fn(),
      placeLimitOrder: jest.fn(),
      placeMarketOrder: jest.fn(),
      cancelOrder: jest.fn(),
      getOrderStatus: jest.fn(),
      getLotSizeInfo: jest.fn(),
    };

    const mockOHLCVService = {
      needsUpdate: jest.fn(),
      getCandles: jest.fn(),
      saveCandles: jest.fn().mockResolvedValue(undefined),
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
        ExchangeService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: OHLCVService,
          useValue: mockOHLCVService,
        },
        {
          provide: LoggerService,
          useValue: mockLoggerService,
        },
        {
          provide: KrakenAdapter,
          useValue: mockKrakenAdapter,
        },
      ],
    }).compile();

    service = module.get<ExchangeService>(ExchangeService);
    krakenAdapter = module.get(KrakenAdapter);
    ohlcvService = module.get(OHLCVService);
    configService = module.get(ConfigService);

    // Set up default mocks
    configService.get.mockImplementation((key: string) => {
      if (key === 'EXCHANGE_NAME') return 'kraken';
      return null;
    });

    // Replace the adapter created in constructor with our mock
    (service as any).adapter = krakenAdapter;
  });

  describe('roundToLotSize', () => {
    beforeEach(() => {
      krakenAdapter.getLotSizeInfo.mockResolvedValue({
        lotSize: 0.00001,
        lotDecimals: 5,
        minOrderSize: 0.0001,
      });
    });

    it('should round quantity to lot size increment', async () => {
      const quantity = 0.0001234567;
      const symbol = 'BTC-USD';

      const rounded = await service.roundToLotSize(symbol, quantity);

      // Should round down to nearest 0.00001
      expect(rounded).toBe(0.00012);
      expect(krakenAdapter.getLotSizeInfo).toHaveBeenCalledWith(symbol);
    });

    it('should handle zero quantity', async () => {
      const rounded = await service.roundToLotSize('BTC-USD', 0);
      expect(rounded).toBe(0);
    });

    it('should handle negative quantity', async () => {
      const rounded = await service.roundToLotSize('BTC-USD', -0.001);
      expect(rounded).toBe(0);
    });

    it('should use cached lot size info', async () => {
      const symbol = 'BTC-USD';
      
      // First call
      await service.roundToLotSize(symbol, 0.001);
      expect(krakenAdapter.getLotSizeInfo).toHaveBeenCalledTimes(1);

      // Second call should use cache
      await service.roundToLotSize(symbol, 0.002);
      expect(krakenAdapter.getLotSizeInfo).toHaveBeenCalledTimes(1);
    });

    it('should handle different lot sizes for different symbols', async () => {
      krakenAdapter.getLotSizeInfo
        .mockResolvedValueOnce({
          lotSize: 0.00001,
          lotDecimals: 5,
          minOrderSize: 0.0001,
        })
        .mockResolvedValueOnce({
          lotSize: 0.001,
          lotDecimals: 3,
          minOrderSize: 0.01,
        });

      const btcRounded = await service.roundToLotSize('BTC-USD', 0.000123);
      const ethRounded = await service.roundToLotSize('ETH-USD', 0.1234);

      expect(btcRounded).toBe(0.00012);
      expect(ethRounded).toBe(0.123);
    });
  });

  describe('getLotSizeInfo', () => {
    it('should return lot size information', async () => {
      const lotInfo = {
        lotSize: 0.00001,
        lotDecimals: 5,
        minOrderSize: 0.0001,
      };

      krakenAdapter.getLotSizeInfo.mockResolvedValue(lotInfo);

      const result = await service.getLotSizeInfo('BTC-USD');

      expect(result).toEqual(lotInfo);
      expect(krakenAdapter.getLotSizeInfo).toHaveBeenCalledWith('BTC-USD');
    });

    it('should cache lot size information', async () => {
      const lotInfo = {
        lotSize: 0.00001,
        lotDecimals: 5,
        minOrderSize: 0.0001,
      };

      krakenAdapter.getLotSizeInfo.mockResolvedValue(lotInfo);

      // First call
      await service.getLotSizeInfo('BTC-USD');
      expect(krakenAdapter.getLotSizeInfo).toHaveBeenCalledTimes(1);

      // Second call should use cache
      await service.getLotSizeInfo('BTC-USD');
      expect(krakenAdapter.getLotSizeInfo).toHaveBeenCalledTimes(1);
    });
  });

  describe('getTicker', () => {
    it('should return ticker data', async () => {
      const ticker = {
        symbol: 'BTC-USD',
        price: 50000,
        bid: 49999,
        ask: 50001,
      };

      krakenAdapter.getTicker.mockResolvedValue(ticker);

      const result = await service.getTicker('BTC-USD');

      expect(result).toEqual(ticker);
      expect(krakenAdapter.getTicker).toHaveBeenCalledWith('BTC-USD');
    });
  });

  describe('getBalance', () => {
    it('should return balance data', async () => {
      const balance = {
        asset: 'USD',
        free: 1000,
        locked: 0,
      };

      krakenAdapter.getBalance.mockResolvedValue(balance);

      const result = await service.getBalance('USD');

      expect(result).toEqual(balance);
      expect(krakenAdapter.getBalance).toHaveBeenCalledWith('USD');
    });
  });

  describe('placeLimitOrder', () => {
    it('should place limit order and return order result', async () => {
      const orderResult = {
        orderId: 'order-123',
        status: 'pending' as const,
      };

      krakenAdapter.placeLimitOrder.mockResolvedValue(orderResult);

      const result = await service.placeLimitOrder('BTC-USD', 'buy', 0.001, 50000, 'client-123');

      expect(result).toEqual(orderResult);
      expect(krakenAdapter.placeLimitOrder).toHaveBeenCalledWith(
        'BTC-USD',
        'buy',
        0.001,
        50000,
        'client-123',
      );
    });
  });

  describe('placeMarketOrder', () => {
    it('should place market order and return order result', async () => {
      const orderResult = {
        orderId: 'order-456',
        status: 'filled' as const,
      };

      krakenAdapter.placeMarketOrder.mockResolvedValue(orderResult);

      const result = await service.placeMarketOrder('BTC-USD', 'buy', 0.001, 'client-456');

      expect(result).toEqual(orderResult);
      expect(krakenAdapter.placeMarketOrder).toHaveBeenCalledWith(
        'BTC-USD',
        'buy',
        0.001,
        'client-456',
      );
    });
  });

  describe('cancelOrder', () => {
    it('should cancel order and return true', async () => {
      krakenAdapter.cancelOrder.mockResolvedValue(true);

      const result = await service.cancelOrder('order-123');

      expect(result).toBe(true);
      expect(krakenAdapter.cancelOrder).toHaveBeenCalledWith('order-123');
    });
  });

  describe('getOrderStatus', () => {
    it('should return order status', async () => {
      const orderStatus = {
        orderId: 'order-123',
        status: 'filled' as const,
        filledQuantity: 0.001,
        filledPrice: 50000,
        fee: 0.5,
      };

      krakenAdapter.getOrderStatus.mockResolvedValue(orderStatus);

      const result = await service.getOrderStatus('order-123');

      expect(result).toEqual(orderStatus);
      expect(krakenAdapter.getOrderStatus).toHaveBeenCalledWith('order-123');
    });
  });

  describe('getOHLCV', () => {
    it('should return OHLCV data from adapter', async () => {
      const candles = [
        {
          time: Date.now(),
          open: 100,
          high: 101,
          low: 99,
          close: 100.5,
          volume: 1000,
        },
      ];

      krakenAdapter.getOHLCV.mockResolvedValue(candles);
      ohlcvService.needsUpdate.mockResolvedValue(true); // Force fetch from API
      ohlcvService.getCandles.mockResolvedValue([]); // No cached data

      const result = await service.getOHLCV('BTC-USD', '1h', 50);

      expect(result).toEqual(candles);
      expect(krakenAdapter.getOHLCV).toHaveBeenCalledWith('BTC-USD', '1h', 50);
    });

    it('should use cache when available and fresh', async () => {
      const cachedCandles = [
        {
          time: Date.now(),
          open: 100,
          high: 101,
          low: 99,
          close: 100.5,
          volume: 1000,
        },
      ];

      ohlcvService.needsUpdate.mockResolvedValue(false);
      ohlcvService.getCandles.mockResolvedValue(
        cachedCandles.map(c => ({
          id: '1',
          symbol: 'BTC-USD',
          interval: '1h',
          time: new Date(c.time),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
          createdAt: new Date(),
        })),
      );

      const result = await service.getOHLCV('BTC-USD', '1h', 50, true, false);

      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty('time');
      expect(result[0]).toHaveProperty('open', 100);
      expect(krakenAdapter.getOHLCV).not.toHaveBeenCalled();
    });
  });
});

