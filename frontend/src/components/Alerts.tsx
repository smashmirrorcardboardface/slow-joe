import { useState, useEffect } from 'react';
import axios from 'axios';

const API_BASE = '/api';

interface Alert {
  id: string;
  type: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  message: string;
  metadata?: any;
  sent: boolean;
  sentAt?: string;
  createdAt: string;
}

function Alerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, [filter]);

  const fetchAlerts = async () => {
    try {
      let response;
      if (filter === 'all') {
        response = await axios.get(`${API_BASE}/alerts/history?limit=100`);
      } else {
        response = await axios.get(`${API_BASE}/alerts/by-type?type=${filter}&limit=100`);
      }
      setAlerts(response.data);
      setLastUpdate(new Date());
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch alerts:', error);
      setLoading(false);
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return '#dc2626'; // red
      case 'error':
        return '#ea580c'; // orange
      case 'warning':
        return '#f59e0b'; // amber
      case 'info':
        return '#3b82f6'; // blue
      default:
        return '#6b7280'; // gray
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
        return '🚨';
      case 'error':
        return '❌';
      case 'warning':
        return '⚠️';
      case 'info':
        return 'ℹ️';
      default:
        return '📢';
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const getTypeLabel = (type: string) => {
    return type
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  if (loading && alerts.length === 0) {
    return <div className="card">Loading alerts...</div>;
  }

  const filteredAlerts = alerts;
  const criticalCount = alerts.filter(a => a.severity === 'critical').length;
  const errorCount = alerts.filter(a => a.severity === 'error').length;
  const warningCount = alerts.filter(a => a.severity === 'warning').length;
  const infoCount = alerts.filter(a => a.severity === 'info').length;

  return (
    <div>
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0 }}>Alert History</h2>
          {lastUpdate && (
            <span style={{ color: '#9ca3af', fontSize: '0.875rem' }}>
              Last updated: {lastUpdate.toLocaleTimeString()}
            </span>
          )}
        </div>

        {/* Alert Statistics */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
          <div style={{ padding: '1rem', background: '#fee2e2', borderRadius: '8px', textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#dc2626' }}>{criticalCount}</div>
            <div style={{ fontSize: '0.875rem', color: '#991b1b' }}>Critical</div>
          </div>
          <div style={{ padding: '1rem', background: '#ffedd5', borderRadius: '8px', textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#ea580c' }}>{errorCount}</div>
            <div style={{ fontSize: '0.875rem', color: '#c2410c' }}>Errors</div>
          </div>
          <div style={{ padding: '1rem', background: '#fef3c7', borderRadius: '8px', textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#f59e0b' }}>{warningCount}</div>
            <div style={{ fontSize: '0.875rem', color: '#d97706' }}>Warnings</div>
          </div>
          <div style={{ padding: '1rem', background: '#dbeafe', borderRadius: '8px', textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#3b82f6' }}>{infoCount}</div>
            <div style={{ fontSize: '0.875rem', color: '#1e40af' }}>Info</div>
          </div>
        </div>

        {/* Filter */}
        <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <label style={{ marginRight: '0.5rem', fontSize: '0.875rem' }}>Filter by type:</label>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{
                padding: '0.5rem',
                borderRadius: '4px',
                border: '1px solid #d1d5db',
                fontSize: '0.875rem',
              }}
            >
              <option value="all">All Alerts</option>
              <option value="ORDER_FAILURE">Order Failures</option>
              <option value="EXCHANGE_UNREACHABLE">Exchange Unreachable</option>
              <option value="LOW_BALANCE">Low Balance</option>
              <option value="LARGE_DRAWDOWN">Large Drawdown</option>
              <option value="JOB_FAILURE">Job Failures</option>
              <option value="HEALTH_CHECK_FAILED">Health Check Failed</option>
            </select>
          </div>
          {filter === 'ORDER_FAILURE' && (
            <div style={{ 
              padding: '0.75rem', 
              background: 'rgba(59, 130, 246, 0.1)', 
              border: '1px solid rgba(59, 130, 246, 0.3)', 
              borderRadius: '6px',
              fontSize: '0.75rem',
              color: '#93c5fd',
              maxWidth: '500px'
            }}>
              <strong>Common causes:</strong> Slippage too high, insufficient balance, exchange API error, network timeout, or order size below minimum.
            </div>
          )}
        </div>
      </div>

      {/* Alerts Table */}
      <div className="card">
        {filteredAlerts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: '#9ca3af' }}>
            No alerts found
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600', color: '#6b7280' }}>Severity</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600', color: '#6b7280' }}>Type</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600', color: '#6b7280' }}>Title</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600', color: '#6b7280' }}>Message</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600', color: '#6b7280' }}>Status</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600', color: '#6b7280' }}>Time</th>
                </tr>
              </thead>
              <tbody>
                {filteredAlerts.map((alert) => (
                  <tr key={alert.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '0.75rem' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          padding: '0.25rem 0.5rem',
                          borderRadius: '4px',
                          fontSize: '0.875rem',
                          fontWeight: '500',
                          color: getSeverityColor(alert.severity),
                          background: `${getSeverityColor(alert.severity)}15`,
                        }}
                      >
                        {getSeverityIcon(alert.severity)} {alert.severity.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>
                      {getTypeLabel(alert.type)}
                    </td>
                    <td style={{ padding: '0.75rem', fontSize: '0.875rem', fontWeight: '500' }}>
                      {alert.title}
                    </td>
                    <td style={{ padding: '0.75rem', fontSize: '0.875rem', color: '#6b7280', maxWidth: '400px' }}>
                      <div style={{ 
                        whiteSpace: 'pre-wrap', 
                        wordBreak: 'break-word',
                        lineHeight: '1.5'
                      }}>
                        {alert.message}
                      </div>
                      {alert.metadata?.error && (
                        <div style={{ 
                          marginTop: '0.5rem', 
                          padding: '0.5rem', 
                          background: 'rgba(239, 68, 68, 0.1)', 
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          color: '#fca5a5',
                          fontFamily: 'monospace'
                        }}>
                          {alert.metadata.error}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '0.75rem' }}>
                      {alert.sent ? (
                        <span style={{ color: '#10b981', fontSize: '0.875rem' }}>✓ Sent</span>
                      ) : (
                        <span style={{ color: '#9ca3af', fontSize: '0.875rem' }}>Not sent</span>
                      )}
                    </td>
                    <td style={{ padding: '0.75rem', fontSize: '0.875rem', color: '#9ca3af' }}>
                      {formatDate(alert.createdAt)}
                    </td>
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

export default Alerts;

