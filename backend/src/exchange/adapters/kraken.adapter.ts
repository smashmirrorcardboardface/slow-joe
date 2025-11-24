import * as crypto from 'crypto';
import * as querystring from 'querystring';
import axios from 'axios';

export class KrakenAdapter {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl = 'https://api.kraken.com';

  constructor(apiKey?: string, apiSecret?: string) {
    // Trim whitespace that might cause issues
    this.apiKey = (apiKey || '').trim();
    this.apiSecret = (apiSecret || '').trim();
    
    // Note: Logger is not injected here as this is a plain class, not a NestJS service
    // Logging will be handled by ExchangeService
  }

  private getSignature(path: string, nonce: string, postData: string): string {
    // Kraken signature algorithm (per official docs):
    // 1. Create message = nonce + postData (where postData is URL-encoded string)
    // 2. Create hash = SHA256(message) as binary
    // 3. Create signature = HMAC-SHA512(secret, path + hash) where hash is binary
    
    const message = nonce + postData;
    
    // Decode base64 secret (Kraken provides secret as base64)
    let secret: Buffer;
    try {
      secret = Buffer.from(this.apiSecret, 'base64');
    } catch (error) {
      throw new Error(`Failed to decode API secret as base64: ${error}`);
    }
    
    // Create SHA256 hash of the message (as binary Buffer)
    const hash = crypto.createHash('sha256').update(message, 'utf8').digest();
    
    // Create HMAC-SHA512 signature: HMAC(secret, path + hash)
    // Important: path is string, hash is Buffer - concatenate them as binary
    // Note: path should be just the endpoint path like "/0/private/Balance"
    const hmac = crypto
      .createHmac('sha512', secret)
      .update(Buffer.concat([Buffer.from(path, 'utf8'), hash]))
      .digest('base64');
    
    return hmac;
  }

  private async publicRequest(endpoint: string, params: any = {}): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    try {
      const response = await axios.get(url, { params });
      
      if (response.data.error && response.data.error.length > 0) {
        const errorMsg = response.data.error.join(', ');
        // Handle rate limit errors specifically
        if (errorMsg.includes('Too many requests') || errorMsg.includes('EGeneral')) {
          throw new Error(`Kraken API error: ${errorMsg}`);
        }
        throw new Error(`Kraken API error: ${errorMsg}`);
      }
      
      if (!response.data.result) {
        throw new Error(`Kraken API returned no result data for ${endpoint}`);
      }
      
      return response.data.result;
    } catch (error: any) {
      if (error.response && error.response.data.error) {
        throw new Error(`Kraken API error: ${error.response.data.error.join(', ')}`);
      }
      throw error;
    }
  }

  private async privateRequest(endpoint: string, params: any = {}): Promise<any> {
    if (!this.apiKey || !this.apiSecret) {
      throw new Error('Kraken API credentials not configured');
    }

    // Kraken requires nonce to be a number (milliseconds since epoch, or microseconds for better uniqueness)
    // Using microseconds to ensure uniqueness if multiple requests happen quickly
    const nonceValue = Date.now() * 1000; // Convert to microseconds
    const postData = querystring.stringify({ ...params, nonce: nonceValue });
    
    // For signature: message = nonce + postData
    // The nonce appears twice: once as prefix to message, once in postData
    // This is correct per Kraken's API specification
    const signature = this.getSignature(endpoint, nonceValue.toString(), postData);

    try {
      const response = await axios.post(`${this.baseUrl}${endpoint}`, postData, {
        headers: {
          'API-Key': this.apiKey,
          'API-Sign': signature,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      if (response.data.error && response.data.error.length > 0) {
        const errorMsg = response.data.error.join(', ');
        throw new Error(`Kraken API error: ${errorMsg}`);
      }

      return response.data.result || {};
    } catch (error: any) {
      if (error.response && error.response.data.error) {
        const errorMsg = error.response.data.error.join(', ');
        // Provide more helpful error message
        if (errorMsg.includes('Invalid key')) {
          throw new Error(`Kraken API error: Invalid key. Please verify:
1. API key is active on Kraken dashboard
2. API key has "Query Funds" permission enabled
3. No IP restrictions blocking your server
4. API key and secret are correctly copied (no extra spaces)`);
        }
        throw new Error(`Kraken API error: ${errorMsg}`);
      }
      throw error;
    }
  }

  private convertSymbol(symbol: string): string {
    // Convert BTC-USD to XBTUSD for Kraken
    const mapping: { [key: string]: string } = {
      'BTC-USD': 'XBTUSD',
      'ETH-USD': 'ETHUSD',
      'SOL-USD': 'SOLUSD',
    };
    return mapping[symbol] || symbol.replace('-', '');
  }

  private reverseConvertSymbol(krakenSymbol: string): string {
    // Convert Kraken format back to our format
    const reverseMapping: { [key: string]: string } = {
      'XBTUSD': 'BTC-USD',
      'ETHUSD': 'ETH-USD',
      'SOLUSD': 'SOL-USD',
    };
    
    if (reverseMapping[krakenSymbol]) {
      return reverseMapping[krakenSymbol];
    }
    
    // For other symbols, try to insert dash before USD
    // AVAXUSD -> AVAX-USD
    if (krakenSymbol.endsWith('USD')) {
      return krakenSymbol.replace(/USD$/, '-USD');
    }
    
    return krakenSymbol;
  }

  private aggregateCandles(candles: any[], targetHours: number): any[] {
    if (targetHours <= 1) return candles;
    
    // Sort candles by time
    const sorted = [...candles].sort((a, b) => a.time - b.time);
    
    const aggregated: any[] = [];
    const targetMs = targetHours * 60 * 60 * 1000; // Convert hours to milliseconds
    
    let currentGroup: any[] = [];
    let groupStartTime = 0;
    
    for (const candle of sorted) {
      // Determine which time period this candle belongs to
      const periodStart = Math.floor(candle.time / targetMs) * targetMs;
      
      // Check if this is a new group
      if (currentGroup.length === 0 || periodStart !== groupStartTime) {
        // Save previous group if exists
        if (currentGroup.length > 0) {
          aggregated.push(this.createAggregatedCandle(currentGroup));
        }
        // Start new group
        currentGroup = [candle];
        groupStartTime = periodStart;
      } else {
        // Add to current group
        currentGroup.push(candle);
      }
    }
    
    // Don't forget the last group
    if (currentGroup.length > 0) {
      aggregated.push(this.createAggregatedCandle(currentGroup));
    }
    
    return aggregated;
  }

  private createAggregatedCandle(group: any[]): any {
    if (group.length === 0) throw new Error('Cannot aggregate empty group');
    
    // Sort by time to ensure correct order
    group.sort((a, b) => a.time - b.time);
    
    const open = group[0].open;
    const close = group[group.length - 1].close;
    const high = Math.max(...group.map(c => c.high));
    const low = Math.min(...group.map(c => c.low));
    const volume = group.reduce((sum, c) => sum + c.volume, 0);
    const time = group[0].time; // Use first candle's time as the group time
    
    return { time, open, high, low, close, volume };
  }

  async getOHLCV(symbol: string, interval: string, limit = 100): Promise<any[]> {
    const pair = this.convertSymbol(symbol);
    const intervalMinutes = this.intervalToMinutes(interval);
    const intervalHours = this.intervalToHours(interval);
    
    try {
      // For intervals not directly supported by Kraken (like 6h), fetch 1h candles and aggregate
      let useAggregation = false;
      let fetchInterval = intervalMinutes;
      
      // Kraken supports: 1, 5, 15, 30, 60, 240, 1440, 10080, 21600 minutes
      const supportedIntervals = [1, 5, 15, 30, 60, 240, 1440, 10080, 21600];
      if (!supportedIntervals.includes(intervalMinutes)) {
        // Use 1-hour candles and aggregate
        useAggregation = true;
        fetchInterval = 60; // 1 hour
        // Fetch more candles to account for aggregation
        const fetchLimit = Math.ceil(limit * (intervalHours / 1)) + 10;
        limit = fetchLimit;
      }
      
      const data = await this.publicRequest('/0/public/OHLC', {
        pair,
        interval: fetchInterval,
      });

      if (!data || typeof data !== 'object') {
        throw new Error(`Invalid OHLCV data received for ${symbol}`);
      }

      const key = Object.keys(data)[0];
      if (!key) {
        throw new Error(`No OHLCV data found for ${symbol}`);
      }

      let ohlc = data[key] || [];
      
      if (!Array.isArray(ohlc)) {
        throw new Error(`Invalid OHLCV data format for ${symbol}`);
      }
      
      // Convert to our format
      let candles = ohlc.map((item: any[]) => ({
        time: parseInt(item[0]) * 1000,
        open: parseFloat(item[1]),
        high: parseFloat(item[2]),
        low: parseFloat(item[3]),
        close: parseFloat(item[4]),
        volume: parseFloat(item[6]),
      }));
      
      // Aggregate if needed (e.g., 1h -> 6h)
      if (useAggregation && intervalHours > 1) {
        candles = this.aggregateCandles(candles, intervalHours);
      }
      
      return candles.slice(-limit);
    } catch (error: any) {
      throw error;
    }
  }

  private intervalToHours(interval: string): number {
    // Parse intervals like "6h", "12h", "1d", etc.
    if (interval.endsWith('h')) {
      return parseInt(interval.replace('h', ''), 10);
    }
    if (interval.endsWith('d')) {
      return parseInt(interval.replace('d', ''), 10) * 24;
    }
    return 1; // default to 1 hour
  }

  async getTicker(symbol: string): Promise<any> {
    const pair = this.convertSymbol(symbol);
    const data = await this.publicRequest('/0/public/Ticker', { pair });
    const key = Object.keys(data)[0];
    const ticker = data[key];
    
    return {
      symbol,
      price: parseFloat(ticker.c[0]),
      bid: parseFloat(ticker.b[0]),
      ask: parseFloat(ticker.a[0]),
    };
  }

  async getAllBalances(): Promise<{ [asset: string]: number }> {
    try {
      const data = await this.privateRequest('/0/private/Balance');
      if (!data) {
        return {};
      }
      
      // Convert Kraken asset codes to our format
      const reverseAssetMapping: { [key: string]: string } = {
        'ZUSD': 'USD',
        'XBT': 'BTC',
        'ZGBP': 'GBP',
      };
      
      const balances: { [asset: string]: number } = {};
      for (const [krakenAsset, balance] of Object.entries(data)) {
        const asset = reverseAssetMapping[krakenAsset] || krakenAsset;
        const balanceValue = parseFloat(balance as string);
        if (balanceValue > 0) {
          balances[asset] = balanceValue;
        }
      }
      
      return balances;
    } catch (error: any) {
      console.error('Error fetching all balances:', error);
      return {};
    }
  }

  async getBalance(asset: string): Promise<any> {
    try {
      const data = await this.privateRequest('/0/private/Balance');
      
      if (!data) {
        return { asset, free: 0, locked: 0 };
      }
      
      // Kraken uses different asset codes: USD -> ZUSD, BTC -> XBT, etc.
      const assetMapping: { [key: string]: string } = {
        'USD': 'ZUSD',
        'BTC': 'XBT',
        'ETH': 'ETH',
        'GBP': 'ZGBP',
      };
      
      const krakenAsset = assetMapping[asset] || asset;
      
      // Try both mapped asset and original asset name
      let balance = 0;
      if (data[krakenAsset]) {
        balance = parseFloat(data[krakenAsset]);
      } else if (data[asset]) {
        balance = parseFloat(data[asset]);
      } else {
        balance = 0;
      }
      
      return {
        asset,
        free: balance,
        locked: 0,
      };
    } catch (error: any) {
      // Return zero balance on error rather than throwing
      return { asset, free: 0, locked: 0 };
    }
  }

  async placeLimitOrder(
    symbol: string,
    side: 'buy' | 'sell',
    quantity: number,
    price: number,
    clientOrderId?: string,
  ): Promise<any> {
    const pair = this.convertSymbol(symbol);
    const type = side === 'buy' ? 'buy' : 'sell';
    const ordertype = 'limit';
    
    // Get price decimal precision for this pair
    const lotInfo = await this.getLotSizeInfo(symbol);
    // Use priceDecimals from lotInfo, or fallback to symbol-specific defaults
    let priceDecimals = lotInfo.priceDecimals;
    if (priceDecimals === undefined) {
      // Fallback to known defaults for specific pairs
      const symbolDefaults: { [key: string]: number } = {
        'BTC-USD': 1,
        'ETH-USD': 2,
        'SOL-USD': 2,
        'LINK-USD': 3,
        'AVAX-USD': 2,
        'ADA-USD': 4,
        'XRP-USD': 4,
        'DOGE-USD': 6,
        'DOT-USD': 4, // DOT/USD requires 4 decimal places
      };
      priceDecimals = symbolDefaults[symbol] || 8;
    }
    
    // Format price to correct decimal places
    const formattedPrice = parseFloat(price.toFixed(priceDecimals));
    
    const params: any = {
      pair,
      type,
      ordertype,
      volume: quantity.toString(),
      price: formattedPrice.toString(),
      oflags: 'post', // Post-only (maker)
    };

    if (clientOrderId) {
      // Kraken userref must be numeric (integer)
      // If clientOrderId is numeric, use it; otherwise generate a numeric ID
      const numericRef = parseInt(clientOrderId, 10);
      if (!isNaN(numericRef)) {
        params.userref = numericRef;
      } else {
        // Generate a numeric userref from timestamp (last 9 digits to fit in int32)
        params.userref = parseInt(Date.now().toString().slice(-9), 10);
      }
    }

    const data = await this.privateRequest('/0/private/AddOrder', params);
    
    return {
      orderId: data.txid[0],
      status: 'pending',
    };
  }

  async placeMarketOrder(
    symbol: string,
    side: 'buy' | 'sell',
    quantity: number,
    clientOrderId?: string,
  ): Promise<any> {
    const pair = this.convertSymbol(symbol);
    const type = side === 'buy' ? 'buy' : 'sell';
    const ordertype = 'market';
    
    const params: any = {
      pair,
      type,
      ordertype,
      volume: quantity.toString(),
    };

    if (clientOrderId) {
      // Kraken userref must be numeric (integer)
      // If clientOrderId is numeric, use it; otherwise generate a numeric ID
      const numericRef = parseInt(clientOrderId, 10);
      if (!isNaN(numericRef)) {
        params.userref = numericRef;
      } else {
        // Generate a numeric userref from timestamp (last 9 digits to fit in int32)
        params.userref = parseInt(Date.now().toString().slice(-9), 10);
      }
    }

    const data = await this.privateRequest('/0/private/AddOrder', params);
    
    return {
      orderId: data.txid[0],
      status: 'pending',
    };
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    try {
      await this.privateRequest('/0/private/CancelOrder', { txid: orderId });
      return true;
    } catch (error) {
      return false;
    }
  }

  async getOrderStatus(orderId: string): Promise<any> {
    const data = await this.privateRequest('/0/private/QueryOrders', { txid: orderId });
    const order = data[orderId];
    
    if (!order) {
      return { status: 'not_found' };
    }

    const status = order.status === 'closed' ? 'filled' : order.status;
    
    // Extract fee from Kraken order response
    // Kraken returns fee in the order object, typically as 'fee' field
    // Fee is usually in the quote currency (USD for USD pairs)
    let fee = 0;
    if (order.fee) {
      fee = parseFloat(order.fee);
    } else if (order.cost && order.vol_exec) {
      // If fee not directly available, estimate from cost
      // Fee is typically a percentage of the trade value
      // For Kraken maker fees: 0.16%, taker fees: 0.26%
      const tradeValue = parseFloat(order.cost || '0');
      // Use maker fee as default (0.16%)
      fee = tradeValue * 0.0016;
    }
    
    return {
      orderId,
      status,
      filledQuantity: parseFloat(order.vol_exec || '0'),
      filledPrice: parseFloat(order.price || '0'),
      fee,
    };
  }

  async getOpenOrders(): Promise<any[]> {
    try {
      const data = await this.privateRequest('/0/private/OpenOrders', {});
      const orders: any[] = [];
      
      // Kraken returns open orders in an object with order IDs as keys
      for (const [orderId, order] of Object.entries(data.open || {})) {
        const orderData = order as any;
        const krakenSymbol = orderData.descr?.pair || 'UNKNOWN';
        const normalizedSymbol = this.reverseConvertSymbol(krakenSymbol);
        orders.push({
          orderId,
          symbol: normalizedSymbol,
          side: orderData.descr?.type === 'buy' ? 'buy' : 'sell',
          quantity: parseFloat(orderData.vol || '0'),
          remainingQuantity: parseFloat(orderData.vol || '0') - parseFloat(orderData.vol_exec || '0'),
          price: parseFloat(orderData.descr?.price || '0'),
          status: orderData.status || 'open',
          openedAt: new Date(parseFloat(orderData.opentm || '0') * 1000),
        });
      }
      
      return orders;
    } catch (error: any) {
      console.error('Error fetching open orders:', error);
      return [];
    }
  }

  private intervalToMinutes(interval: string): number {
    // Kraken supports: 1, 5, 15, 30, 60, 240, 1440, 10080, 21600 minutes
    // Map our intervals to closest supported Kraken interval
    const mapping: { [key: string]: number } = {
      '1h': 60,      // 1 hour
      '4h': 240,     // 4 hours (closest to 6h)
      '6h': 240,     // Use 4 hours (240 min) as closest supported interval
      '12h': 1440,   // Use 1 day (1440 min) as closest
      '1d': 1440,    // 1 day
    };
    return mapping[interval] || 60;
  }

  /**
   * Get lot size information for a trading pair
   * Fetches from Kraken's AssetPairs endpoint which provides:
   * - lot_decimals: number of decimal places for lot size
   * - lot: minimum lot size (usually 1)
   * - ordermin: minimum order size in base currency
   */
  async getLotSizeInfo(symbol: string): Promise<{
    lotSize: number;
    lotDecimals: number;
    minOrderSize: number;
    priceDecimals?: number; // Number of decimal places for price
  }> {
    try {
      const pair = this.convertSymbol(symbol);
      
      // Fetch asset pairs info from Kraken
      const data = await this.publicRequest('/0/public/AssetPairs', {
        pair,
      });

      // Find the pair info (Kraken may return with different key format)
      let pairInfo: any = null;
      
      // Try exact pair name first
      if (data[pair]) {
        pairInfo = data[pair];
      } else {
        // Try to find matching pair (Kraken sometimes uses different naming)
        const keys = Object.keys(data);
        const matchingKey = keys.find(key => 
          key.toUpperCase() === pair.toUpperCase() || 
          key.includes(pair.replace('USD', ''))
        );
        if (matchingKey) {
          pairInfo = data[matchingKey];
        }
      }

      if (!pairInfo) {
        // Return safe defaults based on common crypto lot sizes
        return this.getDefaultLotSize(symbol);
      }

      // Extract lot size information
      const lotDecimals = parseInt(pairInfo.lot_decimals || '8', 10);
      const lot = parseFloat(pairInfo.lot || '1');
      const ordermin = parseFloat(pairInfo.ordermin || '0');
      // Kraken provides pair_decimals for price precision
      const priceDecimals = parseInt(pairInfo.pair_decimals || '8', 10);

      // Validate parsed values
      if (isNaN(lotDecimals) || isNaN(lot) || lot <= 0) {
        // Invalid lot info, use defaults
        return this.getDefaultLotSize(symbol);
      }

      // Calculate lot size: 10^(-lot_decimals) * lot
      // For example: lot_decimals=5, lot=1 -> lotSize = 0.00001
      const lotSize = lot * Math.pow(10, -lotDecimals);

      // Validate calculated lotSize
      if (isNaN(lotSize) || lotSize <= 0) {
        return this.getDefaultLotSize(symbol);
      }

      return {
        lotSize,
        lotDecimals,
        minOrderSize: ordermin > 0 && !isNaN(ordermin) ? ordermin : lotSize, // Use ordermin if available, otherwise lotSize
        priceDecimals: !isNaN(priceDecimals) ? priceDecimals : undefined,
      };
    } catch (error: any) {
      // Return safe defaults on error
      return this.getDefaultLotSize(symbol);
    }
  }

  /**
   * Get default lot size info when API call fails
   * Uses common defaults for major crypto pairs
   */
  private getDefaultLotSize(symbol: string): {
    lotSize: number;
    lotDecimals: number;
    minOrderSize: number;
    priceDecimals?: number;
  } {
    // Common defaults for major pairs (including price decimals)
    const defaults: { [key: string]: { lotSize: number; lotDecimals: number; minOrderSize: number; priceDecimals: number } } = {
      'BTC-USD': { lotSize: 0.00001, lotDecimals: 5, minOrderSize: 0.0001, priceDecimals: 1 },
      'ETH-USD': { lotSize: 0.001, lotDecimals: 3, minOrderSize: 0.01, priceDecimals: 2 },
      'SOL-USD': { lotSize: 0.01, lotDecimals: 2, minOrderSize: 0.1, priceDecimals: 2 },
      'LINK-USD': { lotSize: 0.01, lotDecimals: 2, minOrderSize: 0.1, priceDecimals: 3 },
      'AVAX-USD': { lotSize: 0.01, lotDecimals: 2, minOrderSize: 0.1, priceDecimals: 2 },
      'ADA-USD': { lotSize: 0.1, lotDecimals: 1, minOrderSize: 1, priceDecimals: 4 },
      'XRP-USD': { lotSize: 0.1, lotDecimals: 1, minOrderSize: 1, priceDecimals: 4 },
      'DOGE-USD': { lotSize: 0.00000001, lotDecimals: 8, minOrderSize: 0.00000001, priceDecimals: 6 },
      'DOT-USD': { lotSize: 0.01, lotDecimals: 2, minOrderSize: 0.1, priceDecimals: 4 },
    };

    const defaultInfo = defaults[symbol] || { lotSize: 0.00000001, lotDecimals: 8, minOrderSize: 0.00000001, priceDecimals: 8 };
    return defaultInfo;
  }
}

