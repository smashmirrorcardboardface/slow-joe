import { useState, useEffect } from 'react';
import axios from 'axios';
import { useRealtime } from '../hooks/useRealtime';

const API_BASE = '/api';

interface MarketDataItem {
  symbol: string;
  price?: number;
  bid?: number;
  ask?: number;
  change24h?: number;
  indicators?: {
    ema12?: number;
    ema26?: number;
    rsi?: number;
  };
  lastUpdate?: string;
  error?: string;
}

function MarketData() {
  const [marketData, setMarketData] = useState<MarketDataItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const { getLatestEvent } = useRealtime(autoRefresh);

  // Listen for settings updates and refresh market data
  useEffect(() => {
    const settingsEvent = getLatestEvent('settings_update');
    if (settingsEvent?.data) {
      fetchMarketData();
    }
  }, [getLatestEvent]);

  useEffect(() => {
    fetchMarketData();
    
    if (autoRefresh) {
      const interval = setInterval(fetchMarketData, 5000); // Refresh every 5 seconds
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  const fetchMarketData = async () => {
    try {
      const response = await axios.get(`${API_BASE}/exchange/market-data`);
      setMarketData(response.data.marketData || []);
      setLastUpdate(new Date());
      setLoading(false);
    } catch (error: any) {
      console.error('Failed to fetch market data:', error);
      setLoading(false);
    }
  };

  const formatPrice = (price: number) => {
    if (price >= 1000) {
      return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return `$${price.toFixed(4)}`;
  };

  const getChangeColor = (change: number | null) => {
    if (change === null) return '#9ca3af';
    if (change > 0) return '#fb923c';
    if (change < 0) return '#9ca3af';
    return '#9ca3af';
  };

  const getSignalStatus = (item: MarketDataItem) => {
    if (!item.indicators) return { text: 'No Data', color: '#9ca3af' };
    
    const { ema12, ema26, rsi } = item.indicators;
    
    if (!ema12 || !ema26 || !rsi) return { text: 'Calculating...', color: '#9ca3af' };
    
    const emaBullish = ema12 > ema26;
    const rsiInRange = rsi >= 40 && rsi <= 70;
    
    if (emaBullish && rsiInRange) {
      return { text: 'BUY Signal', color: '#fb923c' };
    }
    if (!emaBullish) {
      return { text: 'Bearish', color: '#9ca3af' };
    }
    if (rsi > 70) {
      return { text: 'Overbought', color: '#9ca3af' };
    }
    if (rsi < 40) {
      return { text: 'Oversold', color: '#9ca3af' };
    }
    
    return { text: 'Neutral', color: '#9ca3af' };
  };

  if (loading && marketData.length === 0) {
    return <div className="card">Loading market data...</div>;
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0 }}>Real-Time Market Data</h2>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <span style={{ fontSize: '0.875rem', color: '#9ca3af' }}>Auto-refresh</span>
            </label>
            {lastUpdate && (
              <span style={{ color: '#9ca3af', fontSize: '0.875rem' }}>
                Updated: {lastUpdate.toLocaleTimeString()}
              </span>
            )}
            <button
              className="button"
              onClick={fetchMarketData}
              disabled={loading}
              style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
        {marketData.map((item) => (
          <div key={item.symbol} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.25rem' }}>{item.symbol}</h3>
              {item.error ? (
                <span style={{ color: '#9ca3af', fontSize: '0.875rem' }}>Error</span>
              ) : (
                <span
                  style={{
                    padding: '0.25rem 0.75rem',
                    borderRadius: '4px',
                    fontSize: '0.75rem',
                    fontWeight: '600',
                    backgroundColor: getSignalStatus(item).color + '20',
                    color: getSignalStatus(item).color,
                  }}
                >
                  {getSignalStatus(item).text}
                </span>
              )}
            </div>

            {item.error ? (
              <div style={{ color: '#9ca3af', fontSize: '0.875rem' }}>{item.error}</div>
            ) : (
              <>
                <div style={{ marginBottom: '1rem' }}>
                  <div style={{ fontSize: '0.875rem', color: '#9ca3af', marginBottom: '0.25rem' }}>Current Price</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: '600', color: '#fff' }}>
                    {item.price ? formatPrice(item.price) : 'N/A'}
                  </div>
                </div>

                {item.change24h !== null && item.change24h !== undefined && (
                  <div style={{ marginBottom: '1rem' }}>
                    <div style={{ fontSize: '0.875rem', color: '#9ca3af', marginBottom: '0.25rem' }}>24h Change</div>
                    <div style={{ fontSize: '1.125rem', fontWeight: '600', color: getChangeColor(item.change24h) }}>
                      {item.change24h > 0 ? '+' : ''}{item.change24h.toFixed(2)}%
                    </div>
                  </div>
                )}

                {item.indicators && (
                  <div style={{ 
                    borderTop: '1px solid rgba(255, 255, 255, 0.1)', 
                    paddingTop: '1rem',
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '1rem'
                  }}>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: '0.25rem' }}>EMA12</div>
                      <div style={{ fontSize: '0.875rem', fontWeight: '500' }}>
                        {item.indicators.ema12 ? formatPrice(item.indicators.ema12) : 'N/A'}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: '0.25rem' }}>EMA26</div>
                      <div style={{ fontSize: '0.875rem', fontWeight: '500' }}>
                        {item.indicators.ema26 ? formatPrice(item.indicators.ema26) : 'N/A'}
                      </div>
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: '0.25rem' }}>EMA Ratio (12/26)</div>
                      <div style={{ fontSize: '0.875rem', fontWeight: '500' }}>
                        {item.indicators.ema12 && item.indicators.ema26 ? (
                          <>
                            <span style={{ 
                              color: (item.indicators.ema12 / item.indicators.ema26) >= 1.001 ? '#fb923c' : '#9ca3af',
                              fontWeight: '600'
                            }}>
                              {(item.indicators.ema12 / item.indicators.ema26).toFixed(6)}
                            </span>
                            <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#9ca3af' }}>
                              {(item.indicators.ema12 / item.indicators.ema26) >= 1.001 ? '(Bullish)' : '(Bearish)'}
                            </span>
                          </>
                        ) : 'N/A'}
                      </div>
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: '0.25rem' }}>RSI</div>
                      <div style={{ fontSize: '0.875rem', fontWeight: '500' }}>
                        {item.indicators.rsi ? `${item.indicators.rsi.toFixed(2)}` : 'N/A'}
                        {item.indicators.rsi && (
                          <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#9ca3af' }}>
                            {item.indicators.rsi > 70 ? '(Overbought)' : item.indicators.rsi < 40 ? '(Oversold)' : '(Normal)'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {item.bid && item.ask && (
                  <div style={{ 
                    marginTop: '1rem',
                    paddingTop: '1rem',
                    borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '0.75rem',
                    color: '#9ca3af'
                  }}>
                    <span>Bid: {formatPrice(item.bid)}</span>
                    <span>Ask: {formatPrice(item.ask)}</span>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default MarketData;

