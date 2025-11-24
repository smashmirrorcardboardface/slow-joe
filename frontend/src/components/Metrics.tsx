import { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Area,
  AreaChart,
  Line,
  Bar,
  BarChart,
  Pie,
  PieChart,
  Cell,
  Legend,
  ComposedChart,
} from 'recharts';

const API_BASE = '/api';

interface NavHistoryPoint {
  time: string;
  value: number;
}

function Metrics() {
  const [metrics, setMetrics] = useState<any>(null);
  const [navHistory, setNavHistory] = useState<NavHistoryPoint[]>([]);
  const [tradeHistory, setTradeHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [reconciling, setReconciling] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<'24h' | '7d' | '30d' | 'all'>('7d');

  useEffect(() => {
    fetchMetrics();
    fetchNavHistory();
    fetchTradeHistory();
    const interval = setInterval(() => {
      fetchMetrics();
      fetchNavHistory();
      fetchTradeHistory();
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
    }
  };

  const fetchTradeHistory = async () => {
    try {
      const response = await axios.get(`${API_BASE}/metrics/history/trades`);
      setTradeHistory(response.data || []);
    } catch (error: any) {
      console.error('Failed to fetch trade history:', error);
    }
  };

  const triggerReconcile = async () => {
    setReconciling(true);
    setError(null);
    try {
      await axios.post(`${API_BASE}/metrics/reconcile`);
      setTimeout(() => {
        fetchMetrics();
        fetchNavHistory();
        fetchTradeHistory();
        setReconciling(false);
      }, 2000);
    } catch (error: any) {
      console.error('Failed to trigger reconcile:', error);
      setError(error.response?.data?.message || 'Failed to trigger reconcile');
      setReconciling(false);
    }
  };

  // Calculate cumulative P&L and fees from trades
  const calculatePnLData = () => {
    if (tradeHistory.length === 0) return [];
    
    const sortedTrades = [...tradeHistory].sort((a, b) => 
      new Date(a.time).getTime() - new Date(b.time).getTime()
    );
    
    const positions: Array<{ symbol: string; quantity: number; price: number }> = [];
    let cumulativePnL = 0;
    let cumulativeFees = 0;
    const data: Array<{ time: string; pnl: number; fees: number }> = [];
    
    for (const trade of sortedTrades) {
      const symbol = trade.symbol;
      const side = trade.side;
      const quantity = parseFloat(trade.quantity);
      const price = parseFloat(trade.price);
      const fee = parseFloat(trade.fee || 0);
      
      cumulativeFees += fee;
      
      if (side === 'buy') {
        positions.push({ symbol, quantity, price });
      } else if (side === 'sell') {
        let remainingQuantity = quantity;
        let buyCost = 0;
        
        for (let i = 0; i < positions.length && remainingQuantity > 0; i++) {
          const pos = positions[i];
          if (pos.symbol === symbol) {
            const matched = Math.min(remainingQuantity, pos.quantity);
            buyCost += matched * pos.price;
            remainingQuantity -= matched;
            pos.quantity -= matched;
            
            if (pos.quantity <= 0) {
              positions.splice(i, 1);
              i--;
            }
          }
        }
        
        if (buyCost > 0) {
          const tradePnL = (quantity - remainingQuantity) * price - buyCost;
          cumulativePnL += tradePnL;
        }
      }
      
      data.push({
        time: trade.time,
        pnl: cumulativePnL,
        fees: cumulativeFees,
      });
    }
    
    return data;
  };

  // Prepare data for P&L by symbol chart
  const pnlBySymbolData = metrics?.pnlBySymbol 
    ? Object.entries(metrics.pnlBySymbol)
        .map(([symbol, data]: [string, any]) => ({
          symbol,
          realized: data.realized || 0,
          unrealized: data.unrealized || 0,
          total: data.total || 0,
          trades: data.trades || 0,
        }))
        .sort((a, b) => b.total - a.total)
    : [];

  // Prepare trade distribution data
  const tradeDistributionData = metrics
    ? [
        { name: 'Buy', value: metrics.buyCount || 0, color: '#4ade80' },
        { name: 'Sell', value: metrics.sellCount || 0, color: '#f5576c' },
      ]
    : [];

  // Prepare win/loss distribution
  const winLossData = metrics
    ? [
        { name: 'Winning', value: metrics.winningTrades || 0, color: '#4ade80' },
        { name: 'Losing', value: metrics.losingTrades || 0, color: '#f5576c' },
      ]
    : [];

  if (loading && !metrics) {
    return <div className="card">Loading metrics...</div>;
  }

  const pnlData = calculatePnLData();

  return (
    <div>
      {/* Header */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0 }}>Portfolio Metrics & Analytics</h2>
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

      {/* Key Metrics Grid */}
      <div className="grid" style={{ marginBottom: '1.5rem' }}>
        <div className="metric card">
          <div className="metric-label">Net Asset Value</div>
          <div className="metric-value" style={{ color: metrics?.nav > 0 ? '#4ade80' : '#9ca3af', fontSize: '1.5rem' }}>
            ${metrics?.nav?.toFixed(2) || '0.00'}
          </div>
          {metrics?.initialNav && (
            <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.25rem' }}>
              Initial: ${metrics.initialNav.toFixed(2)}
            </div>
          )}
        </div>
        <div className="metric card">
          <div className="metric-label">Total P&L</div>
          <div className="metric-value" style={{ 
            color: metrics?.totalPnL > 0 ? '#4ade80' : metrics?.totalPnL < 0 ? '#f5576c' : '#9ca3af',
            fontSize: '1.5rem'
          }}>
            ${metrics?.totalPnL?.toFixed(2) || '0.00'}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.25rem' }}>
            Realized: ${metrics?.realizedPnL?.toFixed(2) || '0.00'} | Unrealized: ${metrics?.unrealizedPnL?.toFixed(2) || '0.00'}
          </div>
        </div>
        <div className="metric card">
          <div className="metric-label">ROI</div>
          <div className="metric-value" style={{ 
            color: metrics?.roi > 0 ? '#4ade80' : metrics?.roi < 0 ? '#f5576c' : '#9ca3af',
            fontSize: '1.5rem'
          }}>
            {metrics?.roi?.toFixed(2) || '0.00'}%
          </div>
        </div>
        <div className="metric card">
          <div className="metric-label">Total Fees</div>
          <div className="metric-value" style={{ color: '#9ca3af', fontSize: '1.5rem' }}>
            ${metrics?.totalFees?.toFixed(2) || '0.00'}
          </div>
          {metrics?.nav && metrics.nav > 0 && (
            <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.25rem' }}>
              {((metrics.totalFees / metrics.nav) * 100).toFixed(2)}% of NAV
            </div>
          )}
        </div>
        <div className="metric card">
          <div className="metric-label">Win Rate</div>
          <div className="metric-value" style={{ 
            color: metrics?.winRate >= 50 ? '#4ade80' : '#f5576c',
            fontSize: '1.5rem'
          }}>
            {metrics?.winRate?.toFixed(1) || '0.0'}%
          </div>
          <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.25rem' }}>
            {metrics?.winningTrades || 0}W / {metrics?.losingTrades || 0}L
          </div>
        </div>
        <div className="metric card">
          <div className="metric-label">Avg Profit/Trade</div>
          <div className="metric-value" style={{ 
            color: metrics?.avgProfitPerTrade > 0 ? '#4ade80' : '#f5576c',
            fontSize: '1.5rem'
          }}>
            ${metrics?.avgProfitPerTrade?.toFixed(2) || '0.00'}
          </div>
        </div>
        <div className="metric card">
          <div className="metric-label">Largest Win</div>
          <div className="metric-value" style={{ color: '#4ade80', fontSize: '1.5rem' }}>
            ${metrics?.largestWin?.toFixed(2) || '0.00'}
          </div>
        </div>
        <div className="metric card">
          <div className="metric-label">Largest Loss</div>
          <div className="metric-value" style={{ color: '#f5576c', fontSize: '1.5rem' }}>
            ${metrics?.largestLoss?.toFixed(2) || '0.00'}
          </div>
        </div>
        <div className="metric card">
          <div className="metric-label">Total Trades</div>
          <div className="metric-value" style={{ fontSize: '1.5rem' }}>
            {metrics?.totalTrades || 0}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.25rem' }}>
            {metrics?.buyCount || 0} Buy / {metrics?.sellCount || 0} Sell
          </div>
        </div>
        <div className="metric card">
          <div className="metric-label">Open Positions</div>
          <div className="metric-value" style={{ fontSize: '1.5rem' }}>
            {metrics?.positions || 0}
          </div>
        </div>
        <div className="metric card">
          <div className="metric-label">Closed Trades</div>
          <div className="metric-value" style={{ fontSize: '1.5rem' }}>
            {metrics?.closedTradesCount || 0}
          </div>
        </div>
        <div className="metric card">
          <div className="metric-label">Net P&L / Fees</div>
          <div className="metric-value" style={{ 
            color: metrics?.totalFees > 0 && metrics?.realizedPnL > metrics?.totalFees ? '#4ade80' : '#f5576c',
            fontSize: '1.5rem'
          }}>
            {(metrics?.totalFees > 0 ? (metrics.realizedPnL / metrics.totalFees).toFixed(2) : 'N/A')}x
          </div>
          <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.25rem' }}>
            Profit vs Fees Ratio
          </div>
        </div>
      </div>

      {/* Charts Row 1: NAV and P&L */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        {/* NAV History */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0 }}>NAV History</h3>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {(['24h', '7d', '30d', 'all'] as const).map((range) => (
                <button
                  key={range}
                  className="button"
                  onClick={() => setTimeRange(range)}
                  style={{
                    padding: '0.25rem 0.75rem',
                    fontSize: '0.75rem',
                    backgroundColor: timeRange === range ? '#3b82f6' : 'transparent',
                    color: timeRange === range ? '#fff' : '#9ca3af',
                    border: `1px solid ${timeRange === range ? '#3b82f6' : '#374151'}`,
                  }}
                >
                  {range === 'all' ? 'All' : range.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          {navHistory.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
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
                    }
                    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
                  labelFormatter={(value) => new Date(value).toLocaleString()}
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
            <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}>
              No NAV history available
            </div>
          )}
        </div>

        {/* Cumulative P&L and Fees */}
        <div className="card">
          <h3 style={{ margin: '0 0 1rem 0' }}>Cumulative P&L & Fees</h3>
          {pnlData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={pnlData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis 
                  dataKey="time" 
                  stroke="#9ca3af"
                  tickFormatter={(value) => {
                    const date = new Date(value);
                    if (timeRange === '24h') {
                      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                    }
                    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                  }}
                />
                <YAxis 
                  yAxisId="left"
                  stroke="#4ade80"
                  tickFormatter={(value) => `$${value.toFixed(0)}`}
                />
                <YAxis 
                  yAxisId="right"
                  orientation="right"
                  stroke="#fbbf24"
                  tickFormatter={(value) => `$${value.toFixed(2)}`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1f2937',
                    border: '1px solid #374151',
                    borderRadius: '8px',
                    color: '#f3f4f6',
                  }}
                  labelFormatter={(value) => new Date(value).toLocaleString()}
                  formatter={(value: number, name: string) => {
                    if (name === 'pnl') return [`$${value.toFixed(2)}`, 'Cumulative P&L'];
                    return [`$${value.toFixed(2)}`, 'Cumulative Fees'];
                  }}
                />
                <Legend />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="pnl"
                  stroke="#4ade80"
                  fill="#4ade80"
                  fillOpacity={0.2}
                  name="Cumulative P&L"
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="fees"
                  stroke="#fbbf24"
                  strokeWidth={2}
                  name="Cumulative Fees"
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}>
              No trade data available
            </div>
          )}
        </div>
      </div>

      {/* Charts Row 2: Distribution and Performance */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        {/* P&L by Symbol */}
        <div className="card">
          <h3 style={{ margin: '0 0 1rem 0' }}>P&L by Symbol</h3>
          {pnlBySymbolData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={pnlBySymbolData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="symbol" stroke="#9ca3af" />
                <YAxis stroke="#9ca3af" tickFormatter={(value) => `$${value.toFixed(0)}`} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1f2937',
                    border: '1px solid #374151',
                    borderRadius: '8px',
                    color: '#f3f4f6',
                  }}
                  formatter={(value: number, name: string) => {
                    if (name === 'realized') return [`$${value.toFixed(2)}`, 'Realized'];
                    if (name === 'unrealized') return [`$${value.toFixed(2)}`, 'Unrealized'];
                    return [`$${value.toFixed(2)}`, 'Total'];
                  }}
                />
                <Legend />
                <Bar dataKey="realized" fill="#4ade80" name="Realized" />
                <Bar dataKey="unrealized" fill="#3b82f6" name="Unrealized" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}>
              No position data available
            </div>
          )}
        </div>

        {/* Trade Distribution */}
        <div className="card">
          <h3 style={{ margin: '0 0 1rem 0' }}>Trade Distribution</h3>
          {tradeDistributionData.length > 0 && tradeDistributionData.some(d => d.value > 0) ? (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={tradeDistributionData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {tradeDistributionData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1f2937',
                    border: '1px solid #374151',
                    borderRadius: '8px',
                    color: '#f3f4f6',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}>
              No trade data available
            </div>
          )}
        </div>

        {/* Win/Loss Distribution */}
        <div className="card">
          <h3 style={{ margin: '0 0 1rem 0' }}>Win/Loss Distribution</h3>
          {winLossData.length > 0 && winLossData.some(d => d.value > 0) ? (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={winLossData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {winLossData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1f2937',
                    border: '1px solid #374151',
                    borderRadius: '8px',
                    color: '#f3f4f6',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}>
              No closed trades yet
            </div>
          )}
        </div>
      </div>

      {/* Open Positions Table */}
      {metrics?.openPositions && metrics.openPositions.length > 0 && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ margin: '0 0 1rem 0' }}>Open Positions ({metrics.openPositions.length})</h3>
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Quantity</th>
                  <th>Entry Price</th>
                  <th>Current Price</th>
                  <th>Entry Value</th>
                  <th>Current Value</th>
                  <th>P&L</th>
                  <th>P&L %</th>
                  <th>Opened</th>
                </tr>
              </thead>
              <tbody>
                {metrics.openPositions.map((pos: any) => (
                  <tr key={pos.id}>
                    <td><strong>{pos.symbol}</strong></td>
                    <td>{parseFloat(pos.quantity).toFixed(8)}</td>
                    <td>${parseFloat(pos.entryPrice).toFixed(4)}</td>
                    <td>${pos.currentPrice?.toFixed(4) || pos.entryPrice}</td>
                    <td>${pos.entryValue?.toFixed(2) || '0.00'}</td>
                    <td>${pos.positionValue?.toFixed(2) || '0.00'}</td>
                    <td style={{ color: pos.profit >= 0 ? '#4ade80' : '#f5576c' }}>
                      ${pos.profit?.toFixed(2) || '0.00'}
                    </td>
                    <td style={{ color: pos.profitPct >= 0 ? '#4ade80' : '#f5576c' }}>
                      {pos.profitPct?.toFixed(2) || '0.00'}%
                    </td>
                    <td>{new Date(pos.openedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* P&L by Symbol Table */}
      {pnlBySymbolData.length > 0 && (
        <div className="card">
          <h3 style={{ margin: '0 0 1rem 0' }}>Performance by Symbol</h3>
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Realized P&L</th>
                  <th>Unrealized P&L</th>
                  <th>Total P&L</th>
                  <th>Closed Trades</th>
                </tr>
              </thead>
              <tbody>
                {pnlBySymbolData.map((item) => (
                  <tr key={item.symbol}>
                    <td><strong>{item.symbol}</strong></td>
                    <td style={{ color: item.realized >= 0 ? '#4ade80' : '#f5576c' }}>
                      ${item.realized.toFixed(2)}
                    </td>
                    <td style={{ color: item.unrealized >= 0 ? '#4ade80' : '#f5576c' }}>
                      ${item.unrealized.toFixed(2)}
                    </td>
                    <td style={{ color: item.total >= 0 ? '#4ade80' : '#f5576c', fontWeight: 'bold' }}>
                      ${item.total.toFixed(2)}
                    </td>
                    <td>{item.trades}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default Metrics;
