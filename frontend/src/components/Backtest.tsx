import { useState, useEffect } from 'react';
import axios from 'axios';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import './Backtest.css';

const API_BASE = '/api';

interface BacktestResult {
  totalReturn: number;
  cagr: number;
  sharpeRatio: number;
  maxDrawdown: number;
  volatility: number;
  winRate: number;
  profitFactor: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  totalFees: number;
  turnover: number;
  navHistory: Array<{
    date: string;
    nav: number;
    cash: number;
    positionsValue: number;
  }>;
  trades: Array<{
    date: string;
    symbol: string;
    side: 'buy' | 'sell';
    quantity: number;
    price: number;
    fee: number;
    nav: number;
  }>;
  startDate: string;
  endDate: string;
  initialCapital: number;
  finalNav: number;
  days: number;
}

function Backtest() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Form state
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [initialCapital, setInitialCapital] = useState(100);
  const [universe, setUniverse] = useState('BTC-USD,ETH-USD');
  const [cadenceHours, setCadenceHours] = useState(6);
  const [maxAllocFraction, setMaxAllocFraction] = useState(0.2);
  const [rsiLow, setRsiLow] = useState(40);
  const [rsiHigh, setRsiHigh] = useState(70);
  const [csvData, setCsvData] = useState('');
  const [csvFile, setCsvFile] = useState<File | null>(null);

  // Load default settings from API
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await axios.get(`${API_BASE}/settings`);
        const settings = response.data;
        setUniverse(settings.universe || 'BTC-USD,ETH-USD');
        setCadenceHours(settings.cadenceHours || 6);
        setMaxAllocFraction(settings.maxAllocFraction || 0.2);
        setRsiLow(settings.rsiLow || 40);
        setRsiHigh(settings.rsiHigh || 70);
      } catch (error) {
        console.error('Failed to load settings for backtest:', error);
        // Continue anyway with defaults
      }
    };
    loadSettings();
  }, []);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setCsvFile(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        setCsvData(text);
      };
      reader.readAsText(file);
    }
  };

  const handleRunBacktest = async () => {
    if (!csvData) {
      setError('Please upload CSV data');
      return;
    }

    if (!startDate || !endDate) {
      setError('Please select start and end dates');
      return;
    }

    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const universeArray = universe.split(',').map(s => s.trim()).filter(s => s);
      
      const response = await axios.post<BacktestResult>(`${API_BASE}/backtest`, {
        startDate,
        endDate,
        initialCapital,
        universe: universeArray,
        cadenceHours,
        maxAllocFraction,
        rsiLow,
        rsiHigh,
        ohlcvData: csvData,
      });

      setResults(response.data);
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to run backtest');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatPercent = (value: number) => {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  };

  return (
    <div className="backtest-container">
      <h2>Backtesting</h2>
      <p className="backtest-description">
        Test your strategy on historical data. Upload OHLCV CSV data and configure parameters to see how the strategy would have performed.
      </p>

      <div className="backtest-form">
        <div className="form-section">
          <h3>Date Range</h3>
          <div className="form-row">
            <div className="form-group">
              <label>Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="form-section">
          <h3>Capital & Universe</h3>
          <div className="form-row">
            <div className="form-group">
              <label>Initial Capital (USD)</label>
              <input
                type="number"
                value={initialCapital}
                onChange={(e) => setInitialCapital(parseFloat(e.target.value) || 0)}
                min="1"
                step="0.01"
              />
            </div>
            <div className="form-group">
              <label>Universe (comma-separated)</label>
              <input
                type="text"
                value={universe}
                onChange={(e) => setUniverse(e.target.value)}
                placeholder="BTC-USD,ETH-USD"
              />
            </div>
          </div>
        </div>

        <div className="form-section">
          <h3>Strategy Parameters</h3>
          <div className="form-row">
            <div className="form-group">
              <label>Cadence (hours)</label>
              <input
                type="number"
                value={cadenceHours}
                onChange={(e) => setCadenceHours(parseInt(e.target.value) || 6)}
                min="1"
              />
            </div>
            <div className="form-group">
              <label>Max Allocation Fraction</label>
              <input
                type="number"
                value={maxAllocFraction}
                onChange={(e) => setMaxAllocFraction(parseFloat(e.target.value) || 0.1)}
                min="0"
                max="1"
                step="0.01"
              />
            </div>
            <div className="form-group">
              <label>RSI Low</label>
              <input
                type="number"
                value={rsiLow}
                onChange={(e) => setRsiLow(parseInt(e.target.value) || 40)}
                min="0"
                max="100"
              />
            </div>
            <div className="form-group">
              <label>RSI High</label>
              <input
                type="number"
                value={rsiHigh}
                onChange={(e) => setRsiHigh(parseInt(e.target.value) || 70)}
                min="0"
                max="100"
              />
            </div>
          </div>
        </div>

        <div className="form-section">
          <h3>OHLCV Data</h3>
          <div className="form-group">
            <label>Upload CSV File</label>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
            />
            <small>
              CSV format: timestamp,symbol,open,high,low,close,volume
              <br />
              Or: date,open,high,low,close,volume (single symbol)
            </small>
          </div>
          {csvFile && (
            <div className="file-info">
              ✓ Loaded: {csvFile.name} ({csvData.split('\n').length - 1} rows)
            </div>
          )}
        </div>

        <button
          className="run-backtest-btn"
          onClick={handleRunBacktest}
          disabled={loading || !csvData || !startDate || !endDate}
        >
          {loading ? 'Running Backtest...' : 'Run Backtest'}
        </button>

        {error && <div className="error-message">{error}</div>}
      </div>

      {results && (
        <div className="backtest-results">
          <h3>Results</h3>
          
          <div className="results-summary">
            <div className="metric-card">
              <div className="metric-label">Total Return</div>
              <div className={`metric-value ${results.totalReturn >= 0 ? 'positive' : 'negative'}`}>
                {formatPercent(results.totalReturn)}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-label">CAGR</div>
              <div className={`metric-value ${results.cagr >= 0 ? 'positive' : 'negative'}`}>
                {formatPercent(results.cagr)}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Sharpe Ratio</div>
              <div className="metric-value">{results.sharpeRatio.toFixed(2)}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Max Drawdown</div>
              <div className="metric-value negative">{formatPercent(results.maxDrawdown)}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Win Rate</div>
              <div className="metric-value">{formatPercent(results.winRate)}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Total Trades</div>
              <div className="metric-value">{results.totalTrades}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Total Fees</div>
              <div className="metric-value">{formatCurrency(results.totalFees)}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Final NAV</div>
              <div className={`metric-value ${results.finalNav >= results.initialCapital ? 'positive' : 'negative'}`}>
                {formatCurrency(results.finalNav)}
              </div>
            </div>
          </div>

          <div className="results-chart">
            <h4>NAV Over Time</h4>
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={results.navHistory}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(value) => new Date(value).toLocaleDateString()}
                />
                <YAxis />
                <Tooltip
                  labelFormatter={(value) => new Date(value).toLocaleString()}
                  formatter={(value: number) => formatCurrency(value)}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="nav"
                  stroke="#8884d8"
                  strokeWidth={2}
                  name="NAV"
                />
                <Line
                  type="monotone"
                  dataKey="cash"
                  stroke="#82ca9d"
                  name="Cash"
                />
                <Line
                  type="monotone"
                  dataKey="positionsValue"
                  stroke="#ffc658"
                  name="Positions Value"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="results-details">
            <h4>Trade History</h4>
            <div className="trades-table">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Symbol</th>
                    <th>Side</th>
                    <th>Quantity</th>
                    <th>Price</th>
                    <th>Fee</th>
                    <th>NAV</th>
                  </tr>
                </thead>
                <tbody>
                  {results.trades.map((trade, idx) => (
                    <tr key={idx}>
                      <td>{new Date(trade.date).toLocaleString()}</td>
                      <td>{trade.symbol}</td>
                      <td className={trade.side === 'buy' ? 'buy' : 'sell'}>
                        {trade.side.toUpperCase()}
                      </td>
                      <td>{trade.quantity.toFixed(8)}</td>
                      <td>{formatCurrency(trade.price)}</td>
                      <td>{formatCurrency(trade.fee)}</td>
                      <td>{formatCurrency(trade.nav)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Backtest;

