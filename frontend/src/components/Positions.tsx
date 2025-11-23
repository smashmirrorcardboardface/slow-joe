import { useState, useEffect } from 'react';
import axios from 'axios';

const API_BASE = '/api';

function Positions() {
  const [positions, setPositions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  useEffect(() => {
    fetchPositions();
    const interval = setInterval(fetchPositions, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchPositions = async () => {
    try {
      const response = await axios.get(`${API_BASE}/positions`);
      setPositions(response.data);
      setLastUpdate(new Date());
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch positions:', error);
      setLoading(false);
    }
  };

  if (loading && positions.length === 0) {
    return <div className="card">Loading positions...</div>;
  }

  const openPositions = positions.filter((p) => p.status === 'open');
  const closedPositions = positions.filter((p) => p.status === 'closed');

  return (
    <div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0 }}>Positions</h2>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            {lastUpdate && (
              <span style={{ color: '#9ca3af', fontSize: '0.875rem' }}>
                Updated: {lastUpdate.toLocaleTimeString()}
              </span>
            )}
            <button
              className="button"
              onClick={fetchPositions}
              disabled={loading}
              style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem', color: '#e0e0e0' }}>Open Positions ({openPositions.length})</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Quantity</th>
                <th>Entry Price</th>
                <th>Value</th>
                <th>Opened At</th>
              </tr>
            </thead>
            <tbody>
              {openPositions.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', color: '#9ca3af' }}>
                    No open positions
                  </td>
                </tr>
              ) : (
                openPositions.map((position) => {
                  const value = parseFloat(position.quantity) * parseFloat(position.entryPrice);
                  return (
                    <tr key={position.id}>
                      <td><strong>{position.symbol}</strong></td>
                      <td>{parseFloat(position.quantity).toFixed(8)}</td>
                      <td>${parseFloat(position.entryPrice).toFixed(2)}</td>
                      <td>${value.toFixed(2)}</td>
                      <td>{new Date(position.openedAt).toLocaleString()}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {closedPositions.length > 0 && (
          <div>
            <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem', color: '#e0e0e0' }}>Closed Positions ({closedPositions.length})</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Quantity</th>
                  <th>Entry Price</th>
                  <th>Opened</th>
                  <th>Closed</th>
                </tr>
              </thead>
              <tbody>
                {closedPositions.slice(0, 10).map((position) => (
                  <tr key={position.id} style={{ opacity: 0.7 }}>
                    <td>{position.symbol}</td>
                    <td>{parseFloat(position.quantity).toFixed(8)}</td>
                    <td>${parseFloat(position.entryPrice).toFixed(2)}</td>
                    <td>{new Date(position.openedAt).toLocaleDateString()}</td>
                    <td>{position.closedAt ? new Date(position.closedAt).toLocaleDateString() : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default Positions;

