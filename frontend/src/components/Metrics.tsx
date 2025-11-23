import { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Area,
  AreaChart
} from 'recharts';

const API_BASE = '/api';

interface NavHistoryPoint {
  time: string;
  value: number;
}

function Metrics() {
  const [metrics, setMetrics] = useState<any>(null);
  const [navHistory, setNavHistory] = useState<NavHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [reconciling, setReconciling] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<'24h' | '7d' | '30d' | 'all'>('7d');

  useEffect(() => {
    fetchMetrics();
    fetchNavHistory();
    const interval = setInterval(() => {
      fetchMetrics();
      fetchNavHistory();
    }, 30000);
    return () => clearInterval(interval);
  }, [timeRange]);

  const fetchMetrics = async () => {
    try {
      const response = await axios.get(`${API_BASE}/metrics`);
      setMetrics(response.data);
      setLastUpdate(new Date());
      setLoading(false);
      setError(null);
    } catch (error: any) {
      console.error('Failed to fetch metrics:', error);
      setError(error.response?.data?.message || 'Failed to fetch metrics');
      setLoading(false);
    }
  };

  const fetchNavHistory = async () => {
    try {
      const now = new Date();
      let startDate: Date | undefined;
      let limit = 1000;

      switch (timeRange) {
        case '24h':
          startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          limit = 100;
          break;
        case '7d':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          limit = 200;
          break;
        case '30d':
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          limit = 500;
          break;
        case 'all':
        default:
          startDate = undefined;
          limit = 1000;
          break;
      }

      const params: any = { limit: limit.toString() };
      if (startDate) {
        params.startDate = startDate.toISOString();
      }

      const response = await axios.get(`${API_BASE}/metrics/history/nav`, { params });
      setNavHistory(response.data || []);
    } catch (error: any) {
      console.error('Failed to fetch NAV history:', error);
      // Don't set error state for history - it's not critical
    }
  };

  const triggerReconcile = async () => {
    setReconciling(true);
    setError(null);
    try {
      await axios.post(`${API_BASE}/metrics/reconcile`);
      // Wait a moment for reconcile to complete, then refresh
      setTimeout(() => {
        fetchMetrics();
        setReconciling(false);
      }, 2000);
    } catch (error: any) {
      console.error('Failed to trigger reconcile:', error);
      setError(error.response?.data?.message || 'Failed to trigger reconcile');
      setReconciling(false);
    }
  };

  if (loading && !metrics) {
    return <div className="card">Loading metrics...</div>;
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0 }}>Portfolio Metrics</h2>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            {lastUpdate && (
              <span style={{ color: '#9ca3af', fontSize: '0.875rem' }}>
                Updated: {lastUpdate.toLocaleTimeString()}
              </span>
            )}
            <button
              className="button"
              onClick={fetchMetrics}
              disabled={loading}
              style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
            <button
              className="button success"
              onClick={triggerReconcile}
              disabled={reconciling}
              style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}
            >
              {reconciling ? 'Reconciling...' : 'Reconcile Balance'}
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
            {error}
          </div>
        )}
      </div>

      <div className="grid">
        <div className="metric card">
          <div className="metric-label">Net Asset Value</div>
          <div className="metric-value" style={{ color: metrics?.nav > 0 ? '#4ade80' : '#9ca3af' }}>
            ${metrics?.nav?.toFixed(2) || '0.00'}
          </div>
          {metrics?.nav === 0 && (
            <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.5rem' }}>
              Click "Reconcile Balance" to fetch from exchange
            </div>
          )}
        </div>
        <div className="metric card">
          <div className="metric-label">Total P&L</div>
          <div className="metric-value" style={{ 
            color: metrics?.totalPnL > 0 ? '#4ade80' : metrics?.totalPnL < 0 ? '#f5576c' : '#9ca3af' 
          }}>
            ${metrics?.totalPnL?.toFixed(2) || '0.00'}
          </div>
        </div>
        <div className="metric card">
          <div className="metric-label">Total Fees</div>
          <div className="metric-value" style={{ color: '#9ca3af' }}>
            ${metrics?.totalFees?.toFixed(2) || '0.00'}
          </div>
        </div>
        <div className="metric card">
          <div className="metric-label">Open Positions</div>
          <div className="metric-value">{metrics?.positions || 0}</div>
        </div>
        <div className="metric card">
          <div className="metric-label">Recent Trades</div>
          <div className="metric-value">{metrics?.recentTrades || 0}</div>
        </div>
      </div>

      {/* NAV History Chart */}
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0 }}>NAV History</h2>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {(['24h', '7d', '30d', 'all'] as const).map((range) => (
              <button
                key={range}
                className="button"
                onClick={() => setTimeRange(range)}
                style={{
                  padding: '0.5rem 1rem',
                  fontSize: '0.875rem',
                  backgroundColor: timeRange === range ? '#3b82f6' : 'transparent',
                  color: timeRange === range ? '#fff' : '#9ca3af',
                  border: `1px solid ${timeRange === range ? '#3b82f6' : '#374151'}`,
                }}
              >
                {range === 'all' ? 'All Time' : range.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        {navHistory.length > 0 ? (
          <ResponsiveContainer width="100%" height={400}>
            <AreaChart data={navHistory}>
              <defs>
                <linearGradient id="colorNav" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis 
                dataKey="time" 
                stroke="#9ca3af"
                tickFormatter={(value) => {
                  const date = new Date(value);
                  if (timeRange === '24h') {
                    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                  } else if (timeRange === '7d') {
                    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                  } else {
                    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                  }
                }}
              />
              <YAxis 
                stroke="#9ca3af"
                tickFormatter={(value) => `$${value.toFixed(0)}`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1f2937',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                  color: '#f3f4f6',
                }}
                labelFormatter={(value) => {
                  const date = new Date(value);
                  return date.toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  });
                }}
                formatter={(value: number) => [`$${value.toFixed(2)}`, 'NAV']}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#3b82f6"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorNav)"
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ 
            padding: '3rem', 
            textAlign: 'center', 
            color: '#9ca3af',
            border: '1px dashed #374151',
            borderRadius: '8px',
          }}>
            {loading ? 'Loading NAV history...' : 'No NAV history available. Run reconciliation to generate data.'}
          </div>
        )}
      </div>
    </div>
  );
}

export default Metrics;

