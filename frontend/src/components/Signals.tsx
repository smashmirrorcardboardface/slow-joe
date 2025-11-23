import { useState, useEffect } from 'react';
import axios from 'axios';
import { useRealtime } from '../hooks/useRealtime';

const API_BASE = '/api';

function Signals() {
  const [signals, setSignals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { getLatestEvent } = useRealtime(true);

  // Listen for settings updates and refresh signals
  useEffect(() => {
    const settingsEvent = getLatestEvent('settings_update');
    if (settingsEvent?.data) {
      fetchSignals();
    }
  }, [getLatestEvent]);

  useEffect(() => {
    fetchSignals();
    const interval = setInterval(fetchSignals, 60000);
    return () => clearInterval(interval);
  }, []);

  const fetchSignals = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get(`${API_BASE}/signals`, {
        params: { limit: 100 }
      });
      setSignals(response.data.slice(0, 20));
      setLastUpdate(new Date());
      setLoading(false);
    } catch (error: any) {
      console.error('Failed to fetch signals:', error);
      if (error.response?.status === 401) {
        setError('Authentication expired. Please log out and log back in.');
      } else {
        setError(error.response?.data?.message || error.message || 'Failed to fetch signals');
      }
      setLoading(false);
    }
  };

  const getSignalStatus = (signal: any) => {
    const { ema12, ema26, rsi } = signal.indicators || {};
    if (!ema12 || !ema26 || !rsi) return 'unknown';
    
    const uptrend = ema12 > ema26;
    const rsiOk = rsi >= 40 && rsi <= 70;
    
    if (uptrend && rsiOk) return 'buy';
    if (!uptrend) return 'sell';
    return 'neutral';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'buy': return '#4ade80';
      case 'sell': return '#f5576c';
      default: return '#9ca3af';
    }
  };

  if (loading && signals.length === 0) {
    return <div className="card">Loading signals...</div>;
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0 }}>Recent Signals</h2>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {lastUpdate && (
            <span style={{ color: '#9ca3af', fontSize: '0.875rem' }}>
              Updated: {lastUpdate.toLocaleTimeString()}
            </span>
          )}
          <button
            className="button"
            onClick={fetchSignals}
            disabled={loading}
            style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>
      {error && (
        <div style={{ 
          background: 'rgba(239, 68, 68, 0.2)', 
          border: '1px solid rgba(239, 68, 68, 0.5)', 
          color: '#fca5a5', 
          padding: '0.75rem', 
          borderRadius: '8px', 
          marginBottom: '1rem' 
        }}>
          Error: {error}
        </div>
      )}
      {signals.length === 0 && !loading ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#9ca3af' }}>
          No signals generated yet. Signals are created every 6 hours when the strategy runs.
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Symbol</th>
              <th>EMA12</th>
              <th>EMA26</th>
              <th>RSI</th>
              <th>Score</th>
              <th>Generated At</th>
            </tr>
          </thead>
          <tbody>
            {signals.map((signal) => {
              const status = getSignalStatus(signal);
              return (
                <tr key={signal.id}>
                  <td>
                    <span style={{
                      padding: '0.25rem 0.5rem',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      backgroundColor: getStatusColor(status) + '20',
                      color: getStatusColor(status),
                    }}>
                      {status.toUpperCase()}
                    </span>
                  </td>
                  <td><strong>{signal.symbol}</strong></td>
                  <td>{signal.indicators?.ema12?.toFixed(2)}</td>
                  <td>{signal.indicators?.ema26?.toFixed(2)}</td>
                  <td>{signal.indicators?.rsi?.toFixed(2)}</td>
                  <td>{signal.indicators?.score?.toFixed(4)}</td>
                  <td>{new Date(signal.generatedAt).toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default Signals;

