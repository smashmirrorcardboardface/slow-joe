import { useState, useEffect } from 'react';
import axios from 'axios';
import { useRealtime } from '../hooks/useRealtime';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { RefreshCw, AlertCircle } from 'lucide-react';

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

  if (loading && signals.length === 0) {
    return <Card><CardContent className="pt-6">Loading signals...</CardContent></Card>;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Recent Signals</CardTitle>
          <div className="flex items-center gap-2">
            {lastUpdate && (
              <span className="text-sm text-muted-foreground">
                Updated: {lastUpdate.toLocaleTimeString()}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={fetchSignals}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            Error: {error}
          </div>
        )}
        {signals.length === 0 && !loading ? (
          <div className="text-center py-12 text-muted-foreground">
            No signals generated yet. Signals are created every 6 hours when the strategy runs.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead>EMA12</TableHead>
                <TableHead>EMA26</TableHead>
                <TableHead>RSI</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Generated At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {signals.map((signal) => {
                const status = getSignalStatus(signal);
                return (
                  <TableRow key={signal.id}>
                    <TableCell>
                      <Badge variant={status === 'buy' ? 'success' : 'secondary'}>
                        {status.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">{signal.symbol}</TableCell>
                    <TableCell>{signal.indicators?.ema12?.toFixed(2)}</TableCell>
                    <TableCell>{signal.indicators?.ema26?.toFixed(2)}</TableCell>
                    <TableCell>{signal.indicators?.rsi?.toFixed(2)}</TableCell>
                    <TableCell>{signal.indicators?.score?.toFixed(4)}</TableCell>
                    <TableCell className="text-muted-foreground">{new Date(signal.generatedAt).toLocaleString()}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default Signals;

