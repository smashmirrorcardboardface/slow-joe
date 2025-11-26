import { useState, useEffect } from 'react';
import axios from 'axios';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Select } from './ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { RefreshCw, AlertTriangle, AlertCircle, Info, XCircle } from 'lucide-react';

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

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <XCircle className="h-4 w-4" />;
      case 'error':
        return <AlertCircle className="h-4 w-4" />;
      case 'warning':
        return <AlertTriangle className="h-4 w-4" />;
      case 'info':
        return <Info className="h-4 w-4" />;
      default:
        return <Info className="h-4 w-4" />;
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
    return <Card><CardContent className="pt-6">Loading alerts...</CardContent></Card>;
  }

  const filteredAlerts = alerts;
  const criticalCount = alerts.filter(a => a.severity === 'critical').length;
  const errorCount = alerts.filter(a => a.severity === 'error').length;
  const warningCount = alerts.filter(a => a.severity === 'warning').length;
  const infoCount = alerts.filter(a => a.severity === 'info').length;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Alert History</CardTitle>
            <div className="flex items-center gap-2">
              {lastUpdate && (
                <span className="text-sm text-muted-foreground">
                  Last updated: {lastUpdate.toLocaleTimeString()}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={fetchAlerts}
                disabled={loading}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Alert Statistics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <div className="p-4 bg-card border border-border rounded-lg text-center">
              <div className="text-2xl font-bold text-muted-foreground">{criticalCount}</div>
              <div className="text-sm text-muted-foreground mt-1">Critical</div>
            </div>
            <div className="p-4 bg-card border border-border rounded-lg text-center">
              <div className="text-2xl font-bold text-muted-foreground">{errorCount}</div>
              <div className="text-sm text-muted-foreground mt-1">Errors</div>
            </div>
            <div className="p-4 bg-card border border-border rounded-lg text-center">
              <div className="text-2xl font-bold text-orange-400">{warningCount}</div>
              <div className="text-sm text-muted-foreground mt-1">Warnings</div>
            </div>
            <div className="p-4 bg-card border border-border rounded-lg text-center">
              <div className="text-2xl font-bold text-orange-400">{infoCount}</div>
              <div className="text-sm text-muted-foreground mt-1">Info</div>
            </div>
          </div>

          {/* Filter */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
            <div className="flex items-center gap-2">
              <label className="text-sm text-muted-foreground">Filter by type:</label>
              <Select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">All Alerts</option>
                <option value="ORDER_FAILURE">Order Failures</option>
                <option value="EXCHANGE_UNREACHABLE">Exchange Unreachable</option>
                <option value="LOW_BALANCE">Low Balance</option>
                <option value="LARGE_DRAWDOWN">Large Drawdown</option>
                <option value="JOB_FAILURE">Job Failures</option>
                <option value="HEALTH_CHECK_FAILED">Health Check Failed</option>
              </Select>
            </div>
            {filter === 'ORDER_FAILURE' && (
              <div className="p-3 bg-muted/50 border border-border rounded-md text-xs text-muted-foreground max-w-md">
                <strong>Common causes:</strong> Slippage too high, insufficient balance, exchange API error, network timeout, or order size below minimum.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Alerts Table */}
      <Card>
        <CardContent>
          {filteredAlerts.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No alerts found
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Severity</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAlerts.map((alert) => (
                  <TableRow key={alert.id}>
                    <TableCell>
                      <Badge 
                        variant={alert.severity === 'warning' || alert.severity === 'info' ? 'success' : 'secondary'}
                        className="gap-1.5"
                      >
                        {getSeverityIcon(alert.severity)}
                        {alert.severity.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{getTypeLabel(alert.type)}</TableCell>
                    <TableCell className="text-sm font-medium">{alert.title}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-md">
                      <div className="whitespace-pre-wrap break-words leading-relaxed">
                        {alert.message}
                      </div>
                      {alert.metadata?.error && (
                        <div className="mt-2 p-2 bg-muted/50 border border-border rounded text-xs font-mono text-muted-foreground">
                          {alert.metadata.error}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {alert.sent ? (
                        <span className="text-sm text-orange-400">✓ Sent</span>
                      ) : (
                        <span className="text-sm text-muted-foreground">Not sent</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(alert.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default Alerts;

