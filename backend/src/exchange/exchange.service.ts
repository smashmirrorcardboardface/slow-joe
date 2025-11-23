import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KrakenAdapter } from './adapters/kraken.adapter';
import { OHLCVService } from '../ohlcv/ohlcv.service';
import { LoggerService } from '../logger/logger.service';

export interface OHLCV {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Ticker {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
}

export interface Balance {
  asset: string;
  free: number;
  locked: number;
}

export interface OrderResult {
  orderId: string;
  status: 'filled' | 'partial' | 'pending' | 'cancelled';
  filledQuantity?: number;
  filledPrice?: number;
  fee?: number; // Fee paid in USD
}

export interface LotSizeInfo {
  lotSize: number; // Minimum increment (e.g., 0.00001 for BTC)
  lotDecimals: number; // Number of decimal places
  minOrderSize: number; // Minimum order size in base currency
  priceDecimals?: number; // Number of decimal places for price
}

@Injectable()
export class ExchangeService {
  private adapter: KrakenAdapter;
  private lotSizeCache: Map<string, LotSizeInfo> = new Map();
  private cacheExpiry: Map<string, number> = new Map();
  private readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  constructor(
    private configService: ConfigService,
    @Inject(forwardRef(() => OHLCVService))
    private ohlcvService: OHLCVService,
    private logger: LoggerService,
  ) {
    this.logger.setContext('ExchangeService');
    const exchangeName = this.configService.get<string>('EXCHANGE_NAME') || 'kraken';
    if (exchangeName === 'kraken') {
      const apiKey = this.configService.get<string>('KRAKEN_API_KEY');
      const apiSecret = this.configService.get<string>('KRAKEN_API_SECRET');
      this.adapter = new KrakenAdapter(apiKey, apiSecret);
      if (apiKey && apiSecret) {
        this.logger.log(`KrakenAdapter initialized`, {
          apiKeyLength: apiKey.length,
          apiSecretLength: apiSecret.length,
        });
      }
    }
  }

  async getOHLCV(symbol: string, interval: string, limit = 100, useCache = true, forceRefresh = false): Promise<OHLCV[]> {
    // If using cache and not forcing refresh, check cache freshness first
    if (useCache && !forceRefresh) {
      // Check if cache needs update (for 1h candles, refresh if older than 70 minutes)
      const maxAgeMinutes = interval === '1h' ? 70 : 60;
      const needsUpdate = await this.ohlcvService.needsUpdate(symbol, interval, maxAgeMinutes);
      
      if (!needsUpdate) {
        // Cache is fresh, get most recent candles (DESC order to get latest)
        const cached = await this.ohlcvService.getCandles(symbol, interval, limit, undefined, undefined, 'DESC');
        if (cached.length > 0) {
          // Convert Date to timestamp for compatibility
          return cached.map(c => ({
            time: c.time.getTime(),
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
          }));
        }
      }
      // Cache is stale or empty, fall through to fetch from API
    }

    // Fetch from exchange (only if cache is empty or forceRefresh is true)
    const candles = await this.adapter.getOHLCV(symbol, interval, limit);
    
    // Store in database (async, don't wait)
    if (candles.length > 0) {
      const candlesToStore = candles.map(c => ({
        time: new Date(c.time),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }));
      this.ohlcvService.saveCandles(symbol, interval, candlesToStore).catch(err => {
        this.logger.warn(`Failed to save OHLCV data`, {
          symbol,
          interval,
          error: err.message,
        });
      });
    }

    return candles;
  }

  async getTicker(symbol: string): Promise<Ticker> {
    return this.adapter.getTicker(symbol);
  }

  async getBalance(asset: string): Promise<Balance> {
    return this.adapter.getBalance(asset);
  }

  async placeLimitOrder(
    symbol: string,
    side: 'buy' | 'sell',
    quantity: number,
    price: number,
    clientOrderId?: string,
  ): Promise<OrderResult> {
    return this.adapter.placeLimitOrder(symbol, side, quantity, price, clientOrderId);
  }

  async placeMarketOrder(
    symbol: string,
    side: 'buy' | 'sell',
    quantity: number,
    clientOrderId?: string,
  ): Promise<OrderResult> {
    return this.adapter.placeMarketOrder(symbol, side, quantity, clientOrderId);
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    return this.adapter.cancelOrder(orderId);
  }

  async getOrderStatus(orderId: string): Promise<OrderResult> {
    return this.adapter.getOrderStatus(orderId);
  }

  /**
   * Get lot size information for a symbol (cached)
   * This includes minimum increment, decimal places, and minimum order size
   */
  async getLotSizeInfo(symbol: string): Promise<LotSizeInfo> {
    // Check cache first
    const cached = this.lotSizeCache.get(symbol);
    const expiry = this.cacheExpiry.get(symbol);
    
    if (cached && expiry && Date.now() < expiry) {
      return cached;
    }

    // Fetch from exchange
    const lotSizeInfo = await this.adapter.getLotSizeInfo(symbol);
    
    // Cache it
    this.lotSizeCache.set(symbol, lotSizeInfo);
    this.cacheExpiry.set(symbol, Date.now() + this.CACHE_TTL_MS);
    
    return lotSizeInfo;
  }

  /**
   * Round quantity to valid lot size increment
   * This ensures the quantity is a valid multiple of the lot size
   */
  async roundToLotSize(symbol: string, quantity: number): Promise<number> {
    const lotInfo = await this.getLotSizeInfo(symbol);
    
    if (quantity <= 0) {
      return 0;
    }
    
    // Round down to nearest lot size increment
    // Example: qty=0.0001234567, lotSize=0.00001
    // Math.floor(0.0001234567 / 0.00001) = Math.floor(12.34567) = 12
    // 12 * 0.00001 = 0.00012
    const rounded = Math.floor(quantity / lotInfo.lotSize) * lotInfo.lotSize;
    
    // Ensure we don't have floating point precision issues
    // Round to the correct number of decimal places
    const multiplier = Math.pow(10, lotInfo.lotDecimals);
    const finalRounded = Math.floor(rounded * multiplier) / multiplier;
    
    // Ensure it's not less than minimum order size
    if (finalRounded < lotInfo.minOrderSize) {
      return 0;
    }
    
    return finalRounded;
  }

  async getOpenOrders(): Promise<any[]> {
    return this.adapter.getOpenOrders();
  }
}

