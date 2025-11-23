import { useState, useEffect } from 'react';
import axios from 'axios';

const API_BASE = '/api';

function Trades() {
  const [trades, setTrades] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  useEffect(() => {
    fetchTrades();
    const interval = setInterval(fetchTrades, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchTrades = async () => {
    try {
      const response = await axios.get(`${API_BASE}/trade`);
      setTrades(response.data);
      setLastUpdate(new Date());
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch trades:', error);
      setLoading(false);
    }
  };

  if (loading && trades.length === 0) {
    return <div className="card">Loading trades...</div>;
  }

  const totalValue = trades.reduce((sum, trade) => {
    return sum + (parseFloat(trade.quantity) * parseFloat(trade.price));
  }, 0);

  const totalFees = trades.reduce((sum, trade) => {
    return sum + parseFloat(trade.fee || '0');
  }, 0);

  const buyTrades = trades.filter(t => t.side === 'buy').length;
  const sellTrades = trades.filter(t => t.side === 'sell').length;

  return (
    <div>
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0 }}>Trade Statistics</h2>
          {lastUpdate && (
            <span style={{ color: '#9ca3af', fontSize: '0.875rem' }}>
              Updated: {lastUpdate.toLocaleTimeString()}
            </span>
          )}
        </div>
        <div className="grid">
          <div className="metric">
            <div className="metric-label">Total Trades</div>
            <div className="metric-value">{trades.length}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Buy Orders</div>
            <div className="metric-value" style={{ color: '#4ade80' }}>{buyTrades}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Sell Orders</div>
            <div className="metric-value" style={{ color: '#f5576c' }}>{sellTrades}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Total Volume</div>
            <div className="metric-value">${totalValue.toFixed(2)}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Total Fees</div>
            <div className="metric-value" style={{ color: '#fbbf24' }}>${totalFees.toFixed(4)}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0 }}>Recent Trades</h2>
          <button
            className="button"
            onClick={fetchTrades}
            disabled={loading}
            style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Side</th>
              <th>Quantity</th>
              <th>Price</th>
              <th>Value</th>
              <th>Fee</th>
              <th>Created At</th>
            </tr>
          </thead>
          <tbody>
            {trades.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', color: '#9ca3af' }}>
                  No trades yet
                </td>
              </tr>
            ) : (
              trades.map((trade) => {
                const value = parseFloat(trade.quantity) * parseFloat(trade.price);
                const fee = parseFloat(trade.fee || '0');
                return (
                  <tr key={trade.id}>
                    <td><strong>{trade.symbol}</strong></td>
                    <td>
                      <span
                        style={{
                          color: trade.side === 'buy' ? '#4ade80' : '#f5576c',
                          fontWeight: 'bold',
                        }}
                      >
                        {trade.side.toUpperCase()}
                      </span>
                    </td>
                    <td>{parseFloat(trade.quantity).toFixed(8)}</td>
                    <td>${parseFloat(trade.price).toFixed(2)}</td>
                    <td>${value.toFixed(2)}</td>
                    <td style={{ color: '#fbbf24' }}>${fee.toFixed(4)}</td>
                    <td>{new Date(trade.createdAt).toLocaleString()}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default Trades;

