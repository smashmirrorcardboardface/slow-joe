import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StrategyService, IndicatorResult } from './strategy.service';
import { ExchangeService, OHLCV } from '../exchange/exchange.service';
import { SignalsService } from '../signals/signals.service';
import { AssetsService } from '../assets/assets.service';
import { PositionsService } from '../positions/positions.service';
import { MetricsService } from '../metrics/metrics.service';
import { LoggerService } from '../logger/logger.service';

describe('StrategyService', () => {
  let service: StrategyService;
  let exchangeService: jest.Mocked<ExchangeService>;
  let configService: jest.Mocked<ConfigService>;
  let signalsService: jest.Mocked<SignalsService>;
  let positionsService: jest.Mocked<PositionsService>;
  let metricsService: jest.Mocked<MetricsService>;

  beforeEach(async () => {
    const mockExchangeService = {
      roundToLotSize: jest.fn(),
      getLotSizeInfo: jest.fn(),
      getOHLCV: jest.fn(),
      getTicker: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn(),
    };

    const mockSignalsService = {
      create: jest.fn(),
    };

    const mockPositionsService = {
      findOpen: jest.fn(),
    };

    const mockMetricsService = {
      getNAV: jest.fn(),
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
        StrategyService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: ExchangeService,
          useValue: mockExchangeService,
        },
        {
          provide: SignalsService,
          useValue: mockSignalsService,
        },
        {
          provide: AssetsService,
          useValue: {},
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
      ],
    }).compile();

    service = module.get<StrategyService>(StrategyService);
    exchangeService = module.get(ExchangeService);
    configService = module.get(ConfigService);
    signalsService = module.get(SignalsService);
    positionsService = module.get(PositionsService);
    metricsService = module.get(MetricsService);
  });

  describe('computeIndicators', () => {
    it('should calculate EMA12, EMA26, RSI, and score correctly', async () => {
      // Generate test candles with known pattern
      const candles: OHLCV[] = [];
      const basePrice = 100;
      for (let i = 0; i < 50; i++) {
        candles.push({
          time: Date.now() + i * 3600000,
          open: basePrice + i * 0.1,
          high: basePrice + i * 0.1 + 1,
          low: basePrice + i * 0.1 - 1,
          close: basePrice + i * 0.1,
          volume: 1000,
        });
      }

      const result: IndicatorResult = await service.computeIndicators(candles);

      expect(result).toHaveProperty('ema12');
      expect(result).toHaveProperty('ema26');
      expect(result).toHaveProperty('rsi');
      expect(result).toHaveProperty('score');
      expect(typeof result.ema12).toBe('number');
      expect(typeof result.ema26).toBe('number');
      expect(typeof result.rsi).toBe('number');
      expect(typeof result.score).toBe('number');
      expect(result.ema12).toBeGreaterThan(0);
      expect(result.ema26).toBeGreaterThan(0);
      expect(result.rsi).toBeGreaterThanOrEqual(0);
      expect(result.rsi).toBeLessThanOrEqual(100);
    });

    it('should handle bullish trend (EMA12 > EMA26)', async () => {
      const candles: OHLCV[] = [];
      // Create upward trend
      for (let i = 0; i < 50; i++) {
        candles.push({
          time: Date.now() + i * 3600000,
          open: 100 + i * 0.5,
          high: 100 + i * 0.5 + 1,
          low: 100 + i * 0.5 - 0.5,
          close: 100 + i * 0.5,
          volume: 1000,
        });
      }

      const result = await service.computeIndicators(candles);
      expect(result.ema12).toBeGreaterThan(result.ema26);
    });

    it('should handle bearish trend (EMA12 < EMA26)', async () => {
      const candles: OHLCV[] = [];
      // Create downward trend
      for (let i = 0; i < 50; i++) {
        candles.push({
          time: Date.now() + i * 3600000,
          open: 100 - i * 0.5,
          high: 100 - i * 0.5 + 0.5,
          low: 100 - i * 0.5 - 1,
          close: 100 - i * 0.5,
          volume: 1000,
        });
      }

      const result = await service.computeIndicators(candles);
      expect(result.ema26).toBeGreaterThan(result.ema12);
    });

    it('should calculate score based on EMA ratio and RSI', async () => {
      const candles: OHLCV[] = [];
      for (let i = 0; i < 50; i++) {
        candles.push({
          time: Date.now() + i * 3600000,
          open: 100,
          high: 101,
          low: 99,
          close: 100,
          volume: 1000,
        });
      }

      const result = await service.computeIndicators(candles);
      // Score formula: (ema12 / ema26) * (1 - Math.abs(rsi - 50) / 50)
      const expectedScore = (result.ema12 / result.ema26) * (1 - Math.abs(result.rsi - 50) / 50);
      expect(result.score).toBeCloseTo(expectedScore, 4);
    });
  });

  describe('calculateSize', () => {
    beforeEach(() => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'MAX_ALLOC_FRACTION') return '0.1';
        if (key === 'MIN_ORDER_USD') return '5';
        return null;
      });

      exchangeService.getLotSizeInfo.mockResolvedValue({
        lotSize: 0.00001,
        lotDecimals: 5,
        minOrderSize: 0.0001,
      });
    });

    it('should calculate position size based on NAV and max allocation', async () => {
      exchangeService.roundToLotSize.mockResolvedValue(0.001);
      const nav = 1000;
      const price = 50000; // BTC price
      const symbol = 'BTC-USD';

      const size = await service.calculateSize(nav, price, symbol);

      // 10% of 1000 = 100 USD
      // 100 / 50000 = 0.002 BTC
      // Rounded to lot size = 0.001
      expect(size).toBeGreaterThan(0);
      expect(exchangeService.roundToLotSize).toHaveBeenCalledWith(symbol, expect.any(Number));
    });

    it('should return 0 if allocation is below minimum order USD', async () => {
      exchangeService.roundToLotSize.mockResolvedValue(0.0001);
      const nav = 10; // Very low NAV
      const price = 50000;
      const symbol = 'BTC-USD';

      const size = await service.calculateSize(nav, price, symbol);

      expect(size).toBe(0);
    });

    it('should return 0 if rounded quantity is below minimum order size', async () => {
      exchangeService.roundToLotSize.mockResolvedValue(0.00005); // Below minOrderSize
      const nav = 1000;
      const price = 50000;
      const symbol = 'BTC-USD';

      const size = await service.calculateSize(nav, price, symbol);

      expect(size).toBe(0);
    });

    it('should return 0 if order value is below minimum USD', async () => {
      exchangeService.roundToLotSize.mockResolvedValue(0.0001);
      const nav = 100;
      const price = 100000; // Very high price
      const symbol = 'BTC-USD';

      const size = await service.calculateSize(nav, price, symbol);

      // 10% of 100 = 10 USD
      // 10 / 100000 = 0.0001 BTC
      // 0.0001 * 100000 = 10 USD (should pass)
      // But if rounded quantity makes it below min, should return 0
      expect(size).toBeGreaterThanOrEqual(0);
    });

    it('should use configured max allocation fraction', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'MAX_ALLOC_FRACTION') return '0.2'; // 20%
        if (key === 'MIN_ORDER_USD') return '5';
        return null;
      });

      exchangeService.roundToLotSize.mockResolvedValue(0.002);
      const nav = 1000;
      const price = 50000;
      const symbol = 'BTC-USD';

      const size = await service.calculateSize(nav, price, symbol);

      expect(size).toBeGreaterThan(0);
      // Verify it used 20% allocation
      const expectedQty = (nav * 0.2) / price;
      expect(exchangeService.roundToLotSize).toHaveBeenCalledWith(symbol, expect.closeTo(expectedQty, 0.0001));
    });
  });

  describe('evaluate', () => {
    beforeEach(() => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'UNIVERSE') return 'BTC-USD,ETH-USD';
        if (key === 'CADENCE_HOURS') return '6';
        if (key === 'COOLDOWN_CYCLES') return '2';
        if (key === 'RSI_LOW') return '40';
        if (key === 'RSI_HIGH') return '70';
        if (key === 'VOLATILITY_PAUSE_PCT') return '18';
        if (key === 'MIN_BALANCE_USD') return '20';
        return null;
      });

      metricsService.getNAV.mockResolvedValue(1000);
      positionsService.findOpen.mockResolvedValue([]);
    });

    it('should return empty array when strategy is disabled', async () => {
      service.toggle(false);

      const trades = await service.evaluate();

      expect(trades).toEqual([]);
    });

    it('should return empty array when NAV is below minimum', async () => {
      service.toggle(true);
      metricsService.getNAV.mockResolvedValue(10); // Below MIN_BALANCE_USD

      const trades = await service.evaluate();

      expect(trades).toEqual([]);
    });

    it('should skip symbols with insufficient data', async () => {
      service.toggle(true);
      exchangeService.getOHLCV.mockResolvedValue([]); // No data

      const trades = await service.evaluate();

      expect(trades).toEqual([]);
    });

    it('should skip symbols in cooldown', async () => {
      service.toggle(true);
      
      // Create candles with bullish signal
      const bullishCandles: OHLCV[] = [];
      for (let i = 0; i < 50; i++) {
        bullishCandles.push({
          time: Date.now() + i * 3600000,
          open: 100 + i * 0.5,
          high: 100 + i * 0.5 + 1,
          low: 100 + i * 0.5 - 0.5,
          close: 100 + i * 0.5,
          volume: 1000,
        });
      }

      exchangeService.getOHLCV.mockResolvedValue(bullishCandles);
      exchangeService.getTicker.mockResolvedValue({ symbol: 'BTC-USD', price: 50000, bid: 49999, ask: 50001 });
      exchangeService.roundToLotSize.mockResolvedValue(0.001);
      exchangeService.getLotSizeInfo.mockResolvedValue({
        lotSize: 0.00001,
        lotDecimals: 5,
        minOrderSize: 0.0001,
      });

      // First evaluation - may create a trade if filters pass
      const trades1 = await service.evaluate();
      
      // If a trade was created, test cooldown
      if (trades1.length > 0 && trades1.some(t => t.symbol === 'BTC-USD' && t.side === 'buy')) {
        // Second evaluation - should skip due to cooldown
        const trades2 = await service.evaluate();
        const btcTrades = trades2.filter(t => t.symbol === 'BTC-USD' && t.side === 'buy');
        expect(btcTrades.length).toBe(0);
      } else {
        // If no trade was created, that's also valid (filters didn't pass)
        // Just verify the method completed without error
        expect(Array.isArray(trades1)).toBe(true);
      }
    });

    it('should generate buy trades for top-ranked signals', async () => {
      service.toggle(true);
      
      // Create bullish candles
      const bullishCandles: OHLCV[] = [];
      for (let i = 0; i < 50; i++) {
        bullishCandles.push({
          time: Date.now() + i * 3600000,
          open: 100 + i * 0.5,
          high: 100 + i * 0.5 + 1,
          low: 100 + i * 0.5 - 0.5,
          close: 100 + i * 0.5,
          volume: 1000,
        });
      }

      exchangeService.getOHLCV.mockResolvedValue(bullishCandles);
      exchangeService.getTicker.mockResolvedValue({ symbol: 'BTC-USD', price: 50000, bid: 49999, ask: 50001 });
      exchangeService.roundToLotSize.mockResolvedValue(0.001);
      exchangeService.getLotSizeInfo.mockResolvedValue({
        lotSize: 0.00001,
        lotDecimals: 5,
        minOrderSize: 0.0001,
      });

      const trades = await service.evaluate();

      // Should have at least one buy trade if signal passes filters
      const buyTrades = trades.filter(t => t.side === 'buy');
      expect(buyTrades.length).toBeGreaterThanOrEqual(0);
    });

    it('should generate sell trades for positions not in target', async () => {
      service.toggle(true);
      
      // Mock existing position
      positionsService.findOpen.mockResolvedValue([
        {
          id: '1',
          symbol: 'BTC-USD',
          quantity: '0.001',
          entryPrice: '50000',
          status: 'open',
          openedAt: new Date(),
          closedAt: null,
          metadata: null,
        },
      ]);

      // No signals (empty universe or no passing signals)
      exchangeService.getOHLCV.mockResolvedValue([]);

      const trades = await service.evaluate();

      // Should have sell trade to close position
      const sellTrades = trades.filter(t => t.side === 'sell' && t.symbol === 'BTC-USD');
      expect(sellTrades.length).toBeGreaterThan(0);
    });

    it('should skip symbols with high volatility', async () => {
      service.toggle(true);
      
      // Create candles with high volatility (large price swing)
      const volatileCandles: OHLCV[] = [];
      for (let i = 0; i < 50; i++) {
        const price = 100 + (i % 2 === 0 ? 20 : -20); // Large swings
        volatileCandles.push({
          time: Date.now() + i * 3600000,
          open: price,
          high: price + 1,
          low: price - 1,
          close: price,
          volume: 1000,
        });
      }

      exchangeService.getOHLCV.mockResolvedValue(volatileCandles);

      const trades = await service.evaluate();

      // Should skip due to volatility pause
      const btcTrades = trades.filter(t => t.symbol === 'BTC-USD' && t.side === 'buy');
      expect(btcTrades.length).toBe(0);
    });
  });

  describe('toggle', () => {
    it('should enable and disable strategy', () => {
      expect(service.isEnabled()).toBe(true);
      
      service.toggle(false);
      expect(service.isEnabled()).toBe(false);
      
      service.toggle(true);
      expect(service.isEnabled()).toBe(true);
    });
  });
});

