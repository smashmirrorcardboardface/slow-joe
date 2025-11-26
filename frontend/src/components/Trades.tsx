import { useState, useEffect } from 'react';
import axios from 'axios';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { RefreshCw } from 'lucide-react';

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
    return <Card><CardContent className="pt-6">Loading trades...</CardContent></Card>;
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
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Trade Statistics</CardTitle>
            {lastUpdate && (
              <span className="text-sm text-muted-foreground">
                Updated: {lastUpdate.toLocaleTimeString()}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <div className="p-4 bg-card border border-border rounded-lg">
              <div className="text-sm text-muted-foreground mb-1">Total Trades</div>
              <div className="text-2xl font-bold">{trades.length}</div>
            </div>
            <div className="p-4 bg-card border border-border rounded-lg">
              <div className="text-sm text-muted-foreground mb-1">Buy Orders</div>
              <div className="text-2xl font-bold text-orange-400">{buyTrades}</div>
            </div>
            <div className="p-4 bg-card border border-border rounded-lg">
              <div className="text-sm text-muted-foreground mb-1">Sell Orders</div>
              <div className="text-2xl font-bold text-muted-foreground">{sellTrades}</div>
            </div>
            <div className="p-4 bg-card border border-border rounded-lg">
              <div className="text-sm text-muted-foreground mb-1">Total Volume</div>
              <div className="text-2xl font-bold">${totalValue.toFixed(2)}</div>
            </div>
            <div className="p-4 bg-card border border-border rounded-lg">
              <div className="text-sm text-muted-foreground mb-1">Total Fees</div>
              <div className="text-2xl font-bold text-muted-foreground">${totalFees.toFixed(4)}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Recent Trades</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchTrades}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead>Side</TableHead>
                <TableHead>Quantity</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Fee</TableHead>
                <TableHead>Created At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No trades yet
                  </TableCell>
                </TableRow>
              ) : (
                trades.map((trade) => {
                  const value = parseFloat(trade.quantity) * parseFloat(trade.price);
                  const fee = parseFloat(trade.fee || '0');
                  return (
                    <TableRow key={trade.id}>
                      <TableCell className="font-medium">{trade.symbol}</TableCell>
                      <TableCell>
                        <Badge variant={trade.side === 'buy' ? 'success' : 'secondary'}>
                          {trade.side.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell>{parseFloat(trade.quantity).toFixed(8)}</TableCell>
                      <TableCell>${parseFloat(trade.price).toFixed(2)}</TableCell>
                      <TableCell>${value.toFixed(2)}</TableCell>
                      <TableCell className="text-muted-foreground">${fee.toFixed(4)}</TableCell>
                      <TableCell className="text-muted-foreground">{new Date(trade.createdAt).toLocaleString()}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default Trades;

