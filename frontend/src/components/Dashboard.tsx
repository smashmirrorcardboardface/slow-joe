import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend, ComposedChart } from 'recharts';
import Signals from './Signals';
import Positions from './Positions';
import Trades from './Trades';
import Settings from './Settings';
import Backtest from './Backtest';
import Alerts from './Alerts';
import Metrics from './Metrics';
import { useRealtime } from '../hooks/useRealtime';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { RefreshCw, Database, Radio, RotateCw, XCircle, CheckCircle, TrendingDown, TrendingUp, Briefcase, DollarSign, Clock, FileText, AlertCircle, ArrowRight, AlertTriangle, BarChart } from 'lucide-react';
import './Dashboard.css';

const API_BASE = '/api';

interface MarketDataItem {
  symbol: string;
  price?: number;
  bid?: number;
  ask?: number;
  change24h?: number;
  indicators?: {
    ema12?: number;
    ema26?: number;
    rsi?: number;
  };
  lastUpdate?: string;
  error?: string;
}

function Dashboard() {
  const { logout } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [strategyEnabled, setStrategyEnabled] = useState(true);
  const [healthStatus, setHealthStatus] = useState<'healthy' | 'unhealthy' | 'checking'>('checking');
  
  // Dashboard data
  const [metrics, setMetrics] = useState<any>(null);
  const [marketData, setMarketData] = useState<MarketDataItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [reconciling, setReconciling] = useState(false);
  const [triggeringSignalPoller, setTriggeringSignalPoller] = useState(false);
  const [runningFullRefresh, setRunningFullRefresh] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<any>(null);
  const [openOrders, setOpenOrders] = useState<any[]>([]);

  // Real-time updates
  const { connected: realtimeConnected, getLatestEvent } = useRealtime(autoRefresh);
  
  // Chart data
  const [navHistory, setNavHistory] = useState<any[]>([]);
  const [tradeHistory, setTradeHistory] = useState<any[]>([]);
  const [priceHistory, setPriceHistory] = useState<{ [symbol: string]: any[] }>({});
  const [lastPriceHistoryFetch, setLastPriceHistoryFetch] = useState<number>(0);
  const [positionPriceHistory, setPositionPriceHistory] = useState<{ [symbol: string]: any[] }>({});
  const [lastHistoryFetch, setLastHistoryFetch] = useState<number>(0);

  // Listen for real-time updates
  useEffect(() => {
    const metricsEvent = getLatestEvent('metrics');
    if (metricsEvent?.data) {
      setMetrics(metricsEvent.data);
      setLastUpdate(new Date(metricsEvent.timestamp));
    }
    
    // Listen for settings updates
    const settingsEvent = getLatestEvent('settings_update');
    if (settingsEvent?.data) {
      // Refresh all data when settings change
      fetchDashboardData();
      fetchSettings();
    }
  }, [getLatestEvent]);

  useEffect(() => {
    checkHealth();
    const healthInterval = setInterval(checkHealth, 60000);
    
    fetchDashboardData();
    fetchSettings();
    // Reduce polling frequency since we have real-time updates
    if (autoRefresh && !realtimeConnected) {
      const interval = setInterval(fetchDashboardData, 60000); // 1 minute fallback
      return () => {
        clearInterval(healthInterval);
        clearInterval(interval);
      };
    }
    
    return () => clearInterval(healthInterval);
  }, [autoRefresh, realtimeConnected]);

  const fetchSettings = async () => {
    try {
      const response = await axios.get(`${API_BASE}/settings`);
      setSettings(response.data);
    } catch (error: any) {
      console.error('Failed to fetch settings:', error);
      // Continue with default cadence if fetch fails
    }
  };

  const checkHealth = async () => {
    try {
      // Health endpoint is at root level, not under /api
      const response = await axios.get('/health');
      const status = response.data.status;
      if (status === 'ok') {
        setHealthStatus('healthy');
      } else if (status === 'degraded') {
        setHealthStatus('unhealthy'); // Treat degraded as unhealthy for UI
      } else {
        setHealthStatus('unhealthy');
      }
    } catch (error) {
      setHealthStatus('unhealthy');
    }
  };

  const fetchDashboardData = async () => {
    try {
      const now = Date.now();
      const shouldFetchHistory = now - lastHistoryFetch > 300000; // 5 minutes (same as main refresh)
      
      // Always fetch current metrics and market data (these change frequently)
      const promises: Promise<any>[] = [
        axios.get(`${API_BASE}/metrics`).catch((err) => {
          if (err.response?.status === 401) {
            // Will be handled by axios interceptor
            throw err;
          }
          return { data: null };
        }),
        axios.get(`${API_BASE}/exchange/market-data`).catch((err) => {
          if (err.response?.status === 401) {
            throw err;
          }
          return { data: { marketData: [] } };
        }),
        axios.get(`${API_BASE}/exchange/open-orders`).catch((err) => {
          if (err.response?.status === 401) {
            throw err;
          }
          return { data: { success: false, orders: [] } };
        }),
      ];
      
      // Only fetch history data every 5 minutes (doesn't change that often)
      if (shouldFetchHistory) {
        setLastHistoryFetch(now);
        promises.push(
          axios.get(`${API_BASE}/metrics/history/nav`).catch(() => ({ data: [] })),
          axios.get(`${API_BASE}/metrics/history/trades`).catch(() => ({ data: [] })),
        );
      }
      
      const results = await Promise.all(promises);
      const metricsResponse = results[0];
      const marketDataResponse = results[1];
      const openOrdersResponse = results[2];
      const navHistoryResponse = shouldFetchHistory ? results[3] : { data: null };
      const tradeHistoryResponse = shouldFetchHistory ? results[4] : { data: null };

      if (metricsResponse.data) {
        setMetrics(metricsResponse.data);
      } else if (metricsResponse.data === null && !error) {
        // If metrics returned null but no error, show a message
        setError('Failed to fetch metrics. Please try refreshing or reconciling balance.');
      }
      if (marketDataResponse.data) {
        setMarketData(marketDataResponse.data.marketData || []);
      }
      if (openOrdersResponse.data?.success) {
        setOpenOrders(openOrdersResponse.data.orders || []);
      } else {
        setOpenOrders([]);
      }
      if (navHistoryResponse?.data) {
        setNavHistory(navHistoryResponse.data);
      }
      if (tradeHistoryResponse?.data) {
        setTradeHistory(tradeHistoryResponse.data);
      }
      
      // Fetch price history for each asset (only every 60 seconds to avoid rate limits)
      const shouldFetchPriceHistory = now - lastPriceHistoryFetch > 60000; // 60 seconds
      
      if (shouldFetchPriceHistory && marketDataResponse.data?.marketData) {
        setLastPriceHistoryFetch(now);
        
        // Fetch price history with delays between requests to avoid rate limits
        const priceMap: { [symbol: string]: any[] } = {};
        for (const item of marketDataResponse.data.marketData) {
          try {
            const res = await axios.get(`${API_BASE}/exchange/price-history/${item.symbol}`);
            priceMap[item.symbol] = res.data.data || [];
            // Small delay between requests to respect rate limits
            await new Promise(resolve => setTimeout(resolve, 200));
          } catch (error: any) {
            console.warn(`Failed to fetch price history for ${item.symbol}:`, error.response?.data?.message || error.message);
            // Keep existing data if available, otherwise empty array
            priceMap[item.symbol] = priceHistory[item.symbol] || [];
          }
        }
        setPriceHistory(priceMap);
        
        // Also fetch price history for open positions (async, don't block)
        if (metricsResponse.data?.openPositions && shouldFetchPriceHistory) {
          (async () => {
            const positionPriceMap: { [symbol: string]: any[] } = { ...positionPriceHistory };
            for (const pos of metricsResponse.data.openPositions) {
              if (!positionPriceMap[pos.symbol]) {
                try {
                  const posRes = await axios.get(`${API_BASE}/exchange/price-history/${pos.symbol}`);
                  positionPriceMap[pos.symbol] = posRes.data.data || [];
                  await new Promise(resolve => setTimeout(resolve, 200));
                } catch (error: any) {
                  console.warn(`Failed to fetch price history for position ${pos.symbol}:`, error.response?.data?.message || error.message);
                  positionPriceMap[pos.symbol] = [];
                }
              }
            }
            setPositionPriceHistory(positionPriceMap);
          })();
        }
      }
      
      setLastUpdate(new Date());
      setLoading(false);
      setError(null);
    } catch (error: any) {
      console.error('Failed to fetch dashboard data:', error);
      setError(error.response?.data?.message || 'Failed to fetch dashboard data');
      setLoading(false);
    }
  };

  const triggerReconcile = async () => {
    setReconciling(true);
    setError(null);
    try {
      await axios.post(`${API_BASE}/metrics/reconcile`);
      setTimeout(() => {
        fetchDashboardData();
        setReconciling(false);
      }, 2000);
    } catch (error: any) {
      console.error('Failed to trigger reconcile:', error);
      setError(error.response?.data?.message || 'Failed to trigger reconcile');
      setReconciling(false);
    }
  };

  const triggerSignalPoller = async () => {
    setTriggeringSignalPoller(true);
    setError(null);
    try {
      await axios.post(`${API_BASE}/metrics/trigger-signal-poller`);
      // Wait a bit longer for signal poller to complete
      setTimeout(() => {
        fetchDashboardData();
        setTriggeringSignalPoller(false);
      }, 5000);
    } catch (error: any) {
      console.error('Failed to trigger signal poller:', error);
      setError(error.response?.data?.message || 'Failed to trigger signal poller');
      setTriggeringSignalPoller(false);
    }
  };

  const triggerFullRefresh = async () => {
    setRunningFullRefresh(true);
    setError(null);
    try {
      // Step 1: Reconcile balance
      await axios.post(`${API_BASE}/metrics/reconcile`);
      setReconciling(true);
      
      // Wait for reconcile to complete (usually takes a few seconds)
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Step 2: Trigger signal poller (which will auto-trigger strategy evaluation)
      await axios.post(`${API_BASE}/metrics/trigger-signal-poller`);
      setTriggeringSignalPoller(true);
      
      // Wait for signal poller and strategy evaluation to complete
      setTimeout(() => {
        fetchDashboardData();
        setReconciling(false);
        setTriggeringSignalPoller(false);
        setRunningFullRefresh(false);
      }, 10000); // Give it 10 seconds for signals + strategy evaluation
    } catch (error: any) {
      console.error('Failed to run full refresh:', error);
      setError(error.response?.data?.message || 'Failed to run full refresh');
      setReconciling(false);
      setTriggeringSignalPoller(false);
      setRunningFullRefresh(false);
    }
  };

  const toggleStrategy = async () => {
    try {
      const response = await axios.post(`${API_BASE}/strategy/toggle`, {
        enabled: !strategyEnabled,
      });
      setStrategyEnabled(response.data.enabled);
    } catch (error) {
      console.error('Failed to toggle strategy:', error);
    }
  };

  // Calculate cumulative P&L and fees for chart
  // P&L shows only realized profit/loss from trades (matching buys and sells)
  // This allows comparing trading profits to fees paid
  const calculatePnLAndFeesData = () => {
    if (tradeHistory.length === 0) {
      return [];
    }

    const data: Array<{ time: string; pnl: number; fees: number }> = [];
    
    // Sort trades by time
    const sortedTrades = [...tradeHistory].sort((a, b) => 
      new Date(a.time).getTime() - new Date(b.time).getTime()
    );
    
    // Track open positions (FIFO queue per symbol) for matching buys and sells
    const positions: Array<{ symbol: string; quantity: number; price: number; time: string }> = [];
    let cumulativePnL = 0; // Realized P&L from closed trades only
    let cumulativeFees = 0;
    
    // Process each trade to calculate realized P&L
    for (const trade of sortedTrades) {
      const tradeTime = trade.time;
      const symbol = trade.symbol;
      const side = trade.side;
      const quantity = parseFloat(String(trade.quantity));
      const price = parseFloat(String(trade.price));
      const fee = parseFloat(String(trade.fee || 0));
      
      cumulativeFees += fee;
      
      if (side === 'buy') {
        // Add to positions (FIFO - add to end, will match from beginning)
        positions.push({ symbol, quantity, price, time: tradeTime });
      } else if (side === 'sell') {
        // Match with buy positions (FIFO - match from beginning)
        let remainingQuantity = quantity;
        let sellValue = quantity * price;
        let buyCost = 0;
        
        // Match sells with buys in FIFO order
        for (let i = 0; i < positions.length && remainingQuantity > 0; i++) {
          const position = positions[i];
          if (position.symbol === symbol) {
            const matchedQuantity = Math.min(remainingQuantity, position.quantity);
            buyCost += matchedQuantity * position.price;
            remainingQuantity -= matchedQuantity;
            position.quantity -= matchedQuantity;
            
            // Remove position if fully matched
            if (position.quantity <= 0) {
              positions.splice(i, 1);
              i--; // Adjust index after removal
            }
          }
        }
        
        // Calculate realized P&L for this trade (sell value - buy cost)
        if (buyCost > 0) {
          const tradePnL = sellValue - buyCost;
          cumulativePnL += tradePnL;
        }
      }
      
      // Add data point for this trade
      data.push({
        time: tradeTime,
        pnl: cumulativePnL, // Only realized P&L from closed trades
        fees: cumulativeFees,
      });
    }
    
    // If we have NAV history, add points for NAV updates to show progression
    // But keep the P&L as realized from trades only
    if (navHistory.length > 0 && data.length > 0) {
      const lastTradeTime = new Date(sortedTrades[sortedTrades.length - 1].time).getTime();
      const sortedNavHistory = [...navHistory].sort((a, b) => 
        new Date(a.time).getTime() - new Date(b.time).getTime()
      );
      
      for (const navPoint of sortedNavHistory) {
        const navTime = new Date(navPoint.time).getTime();
        
        // Only add NAV points that are after the last trade to show current state
        if (navTime >= lastTradeTime) {
          // Use the latest P&L and fees from trades
          const latest = data[data.length - 1];
          // Check if we already have a point at this time
          const existing = data.find(d => d.time === navPoint.time);
          if (!existing) {
            data.push({
              time: navPoint.time,
              pnl: latest.pnl, // Keep realized P&L from trades
              fees: latest.fees,
            });
          }
        }
      }
    }
    
    // Sort by time
    return data.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  };

  // Calculate trading summary for plain English explanation
  const calculateTradingSummary = () => {
    if (tradeHistory.length === 0) {
      return {
        realizedPnL: 0,
        totalFees: 0,
        netProfit: 0,
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        bestTrade: null,
        worstTrade: null,
        summary: "No trades executed yet.",
        reasons: []
      };
    }

    const sortedTrades = [...tradeHistory].sort((a, b) => 
      new Date(a.time).getTime() - new Date(b.time).getTime()
    );

    // Track positions and calculate realized P&L
    const positions: Array<{ symbol: string; quantity: number; price: number; time: string }> = [];
    let realizedPnL = 0;
    let totalFees = 0;
    const tradeResults: Array<{ symbol: string; pnl: number; quantity: number; buyPrice: number; sellPrice: number }> = [];

    for (const trade of sortedTrades) {
      const symbol = trade.symbol;
      const side = trade.side;
      const quantity = parseFloat(String(trade.quantity));
      const price = parseFloat(String(trade.price));
      const fee = parseFloat(String(trade.fee || 0));
      
      totalFees += fee;

      if (side === 'buy') {
        positions.push({ symbol, quantity, price, time: trade.time });
      } else if (side === 'sell') {
        let remainingQuantity = quantity;
        let sellValue = quantity * price;
        let buyCost = 0;
        const matchedBuys: Array<{ quantity: number; price: number }> = [];

        for (let i = 0; i < positions.length && remainingQuantity > 0; i++) {
          const position = positions[i];
          if (position.symbol === symbol) {
            const matchedQuantity = Math.min(remainingQuantity, position.quantity);
            const matchedCost = matchedQuantity * position.price;
            buyCost += matchedCost;
            matchedBuys.push({ quantity: matchedQuantity, price: position.price });
            remainingQuantity -= matchedQuantity;
            position.quantity -= matchedQuantity;

            if (position.quantity <= 0) {
              positions.splice(i, 1);
              i--;
            }
          }
        }

        if (buyCost > 0) {
          const tradePnL = sellValue - buyCost;
          realizedPnL += tradePnL;
          
          // Calculate average buy price for this trade
          const totalBuyQuantity = matchedBuys.reduce((sum, b) => sum + b.quantity, 0);
          const avgBuyPrice = totalBuyQuantity > 0 ? buyCost / totalBuyQuantity : 0;
          
          tradeResults.push({
            symbol,
            pnl: tradePnL,
            quantity: quantity - remainingQuantity,
            buyPrice: avgBuyPrice,
            sellPrice: price
          });
        }
      }
    }

    const netProfit = realizedPnL - totalFees;
    const winningTrades = tradeResults.filter(t => t.pnl > 0).length;
    const losingTrades = tradeResults.filter(t => t.pnl < 0).length;
    const totalTrades = tradeResults.length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

    const bestTrade = tradeResults.length > 0 
      ? tradeResults.reduce((best, t) => t.pnl > best.pnl ? t : best, tradeResults[0])
      : null;
    const worstTrade = tradeResults.length > 0
      ? tradeResults.reduce((worst, t) => t.pnl < worst.pnl ? t : worst, tradeResults[0])
      : null;

    // Generate summary and reasons
    const reasons: string[] = [];
    let summary = "";

    if (totalTrades === 0) {
      summary = "No completed trades yet. You have open positions but haven't closed any trades.";
    } else {
      if (netProfit > 0) {
        summary = `You've made a net profit of $${Math.abs(netProfit).toFixed(2)} from trading.`;
      } else if (netProfit < 0) {
        summary = `You've incurred a net loss of $${Math.abs(netProfit).toFixed(2)} from trading.`;
      } else {
        summary = "You've broken even - your trading profits exactly match your fees.";
      }

      // Add reasons
      if (realizedPnL > 0) {
        reasons.push(`You made $${realizedPnL.toFixed(2)} in realized profits from ${winningTrades} winning trade${winningTrades !== 1 ? 's' : ''}.`);
      } else if (realizedPnL < 0) {
        reasons.push(`You lost $${Math.abs(realizedPnL).toFixed(2)} from ${losingTrades} losing trade${losingTrades !== 1 ? 's' : ''}.`);
      }

      if (totalFees > 0) {
        const feePercent = realizedPnL !== 0 ? (totalFees / Math.abs(realizedPnL)) * 100 : 0;
        if (feePercent > 50) {
          reasons.push(`Fees of $${totalFees.toFixed(2)} are eating into your profits significantly (${feePercent.toFixed(1)}% of gross P&L).`);
        } else if (feePercent > 25) {
          reasons.push(`Fees of $${totalFees.toFixed(2)} represent ${feePercent.toFixed(1)}% of your gross trading profits.`);
        } else {
          reasons.push(`You've paid $${totalFees.toFixed(2)} in trading fees.`);
        }
      }

      if (winRate >= 60) {
        reasons.push(`Strong win rate of ${winRate.toFixed(1)}% - you're winning more trades than losing.`);
      } else if (winRate < 40) {
        reasons.push(`Low win rate of ${winRate.toFixed(1)}% - you're losing more trades than winning.`);
      } else {
        reasons.push(`Win rate of ${winRate.toFixed(1)}% - roughly balanced between wins and losses.`);
      }

      if (bestTrade && bestTrade.pnl > 0) {
        reasons.push(`Your best trade was ${bestTrade.symbol}, making $${bestTrade.pnl.toFixed(2)} (bought at $${bestTrade.buyPrice.toFixed(2)}, sold at $${bestTrade.sellPrice.toFixed(2)}).`);
      }

      if (worstTrade && worstTrade.pnl < 0) {
        reasons.push(`Your worst trade was ${worstTrade.symbol}, losing $${Math.abs(worstTrade.pnl).toFixed(2)} (bought at $${worstTrade.buyPrice.toFixed(2)}, sold at $${worstTrade.sellPrice.toFixed(2)}).`);
      }

      if (netProfit < 0 && totalFees > Math.abs(realizedPnL)) {
        reasons.push(`[WARNING] Your fees ($${totalFees.toFixed(2)}) exceed your trading profits ($${realizedPnL.toFixed(2)}), making trading unprofitable.`);
      }
    }

    return {
      realizedPnL,
      totalFees,
      netProfit,
      totalTrades,
      winningTrades,
      losingTrades,
      winRate,
      bestTrade,
      worstTrade,
      summary,
      reasons
    };
  };

  const formatPrice = (price: number) => {
    if (price >= 1000) {
      return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return `$${price.toFixed(4)}`;
  };

  // Format date/time intelligently - show time if same day, otherwise show date+time
  const formatDateTime = (dateString: string | Date, data?: any[]) => {
    const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    
    // If we have data array, check if multiple items are on the same day
    if (data && data.length > 0) {
      const dates = data.map(d => {
        const dDate = typeof d.time === 'string' ? new Date(d.time) : new Date(d.createdAt || d.openedAt || d.time);
        return dDate.toDateString();
      });
      const uniqueDates = new Set(dates);
      const hasMultipleSameDay = uniqueDates.size < data.length;
      
      // If multiple items on same day, always show time
      if (hasMultipleSameDay) {
        return date.toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
      }
    }
    
    // Show date + time for today or if it's a recent date
    if (isToday || Math.abs(now.getTime() - date.getTime()) < 7 * 24 * 60 * 60 * 1000) {
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
    
    // For older dates, show full date + time
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getChangeColor = (change: number | null) => {
    if (change === null) return '#9ca3af';
    if (change > 0) return '#fb923c';
    if (change < 0) return '#9ca3af';
    return '#9ca3af';
  };

  const getSignalStatus = (item: MarketDataItem) => {
    if (!item.indicators) return { text: 'No Data', color: '#9ca3af' };
    
    const { ema12, ema26, rsi } = item.indicators;
    
    if (!ema12 || !ema26 || !rsi) return { text: 'Calculating...', color: '#9ca3af' };
    
    const emaBullish = ema12 > ema26;
    const rsiInRange = rsi >= 40 && rsi <= 70;
    
    if (emaBullish && rsiInRange) {
      return { text: 'BUY Signal', color: '#fb923c' };
    }
    if (!emaBullish) {
      return { text: 'Bearish', color: '#9ca3af' };
    }
    if (rsi > 70) {
      return { text: 'Overbought', color: '#9ca3af' };
    }
    if (rsi < 40) {
      return { text: 'Oversold', color: '#9ca3af' };
    }
    
    return { text: 'Neutral', color: '#9ca3af' };
  };

  const getNextJobTimes = () => {
    const now = new Date();
    const nextHour = new Date(now);
    nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
    
    // Signal poller runs every CADENCE_HOURS at :00
    const cadenceHours = settings?.cadenceHours || 6; // Default to 6 if settings not loaded yet
    const nextSignal = new Date(now);
    const currentHour = nextSignal.getHours();
    // Calculate hours until next signal poller (runs when hour % cadenceHours === 0)
    const hoursUntilNext = (cadenceHours - (currentHour % cadenceHours)) % cadenceHours || cadenceHours;
    nextSignal.setHours(nextSignal.getHours() + hoursUntilNext, 0, 0, 0);
    
    return {
      reconcile: nextHour,
      signalPoller: nextSignal,
    };
  };

  const jobTimes = getNextJobTimes();

  const generateSummary = () => {
    const insights: string[] = [];
    const actions: string[] = [];
    
    // Strategy status
    if (!strategyEnabled) {
      insights.push("[WARNING] Strategy is currently disabled. No trades will be executed.");
      actions.push("Enable the strategy to start trading.");
      return { insights, actions };
    }
    
    // Portfolio status
    if (!metrics || metrics.nav === 0) {
      insights.push("[PORTFOLIO] Portfolio balance not yet initialized.");
      actions.push("Click 'Reconcile Balance' to fetch your current balance from the exchange.");
      return { insights, actions };
    }
    
    // Analyze market signals
    const buySignals = marketData.filter(item => {
      const status = getSignalStatus(item);
      return status.text === 'BUY Signal';
    });
    
    const bearishSignals = marketData.filter(item => {
      const status = getSignalStatus(item);
      return status.text === 'Bearish';
    });
    
    const overboughtSignals = marketData.filter(item => {
      const status = getSignalStatus(item);
      return status.text === 'Overbought';
    });
    
    const oversoldSignals = marketData.filter(item => {
      const status = getSignalStatus(item);
      return status.text === 'Oversold';
    });
    
    // Current positions
    const openPositions = metrics?.openPositions || [];
    const positionCount = openPositions.length;
    
    // Recent trades
    const recentTrades = metrics?.recentTradesList || [];
    const recentTradeCount = recentTrades.length;
    
    // Market conditions summary
    if (buySignals.length > 0) {
      const symbols = buySignals.map(s => s.symbol).join(', ');
      insights.push(`[BUY] ${buySignals.length} asset(s) showing BUY signals: ${symbols}`);
      if (positionCount === 0) {
        actions.push(`Consider opening positions in ${symbols} - indicators suggest bullish momentum.`);
      } else {
        actions.push(`Monitor ${symbols} for potential entry opportunities.`);
      }
    }
    
    if (bearishSignals.length > 0) {
      const symbols = bearishSignals.map(s => s.symbol).join(', ');
      insights.push(`[BEARISH] ${bearishSignals.length} asset(s) showing bearish conditions: ${symbols}`);
      const hasPositions = openPositions.some((p: any) => bearishSignals.some(s => s.symbol === p.symbol));
      if (hasPositions) {
        actions.push(`Consider closing positions in ${symbols} - trend is turning bearish.`);
      }
    }
    
    if (overboughtSignals.length > 0) {
      const symbols = overboughtSignals.map(s => s.symbol).join(', ');
      insights.push(`[OVERBOUGHT] ${overboughtSignals.length} asset(s) are overbought (RSI > 70): ${symbols}`);
      const hasPositions = openPositions.some((p: any) => overboughtSignals.some(s => s.symbol === p.symbol));
      if (hasPositions) {
        actions.push(`Consider taking profits on ${symbols} - prices may be near local highs.`);
      } else {
        actions.push(`Wait for pullback before entering ${symbols} - currently overbought.`);
      }
    }
    
    if (oversoldSignals.length > 0) {
      const symbols = oversoldSignals.map(s => s.symbol).join(', ');
      insights.push(`[OVERSOLD] ${oversoldSignals.length} asset(s) are oversold (RSI < 40): ${symbols}`);
      actions.push(`Watch ${symbols} for potential reversal - may present buying opportunities if EMA turns bullish.`);
    }
    
    // Position analysis
    if (positionCount > 0) {
      insights.push(`[POSITIONS] Currently holding ${positionCount} open position(s).`);
      
      // Check if positions are profitable
      const profitablePositions = openPositions.filter((p: any) => {
        const marketItem = marketData.find(m => m.symbol === p.symbol);
        if (!marketItem?.price || !p.entryPrice) return false;
        return marketItem.price > p.entryPrice;
      });
      
      if (profitablePositions.length > 0) {
        const symbols = profitablePositions.map((p: any) => p.symbol).join(', ');
        insights.push(`[PROFIT] ${profitablePositions.length} position(s) in profit: ${symbols}`);
      }
      
      const losingPositions = openPositions.filter((p: any) => {
        const marketItem = marketData.find(m => m.symbol === p.symbol);
        if (!marketItem?.price || !p.entryPrice) return false;
        return marketItem.price < p.entryPrice;
      });
      
      if (losingPositions.length > 0) {
        const symbols = losingPositions.map((p: any) => p.symbol).join(', ');
        insights.push(`[LOSS] ${losingPositions.length} position(s) at a loss: ${symbols}`);
      }
    } else {
      insights.push("[POSITIONS] No open positions currently.");
      if (buySignals.length === 0) {
        actions.push("Waiting for favorable entry conditions - no strong buy signals at the moment.");
      }
    }
    
    // Recent activity
    if (recentTradeCount > 0) {
      const lastTrade = recentTrades[0];
      const tradeType = lastTrade.side === 'buy' ? 'purchased' : 'sold';
      const price = lastTrade.price != null ? parseFloat(String(lastTrade.price)) : null;
      const priceStr = price != null && !isNaN(price) ? price.toFixed(2) : 'N/A';
      insights.push(`[TRADE] Most recent trade: ${tradeType} ${lastTrade.quantity} ${lastTrade.symbol} at $${priceStr}`);
    } else {
      insights.push("[TRADE] No trades executed yet. The bot is waiting for signal conditions to be met.");
    }
    
    // P&L analysis
    if (metrics?.totalPnL) {
      const pnl = metrics.totalPnL;
      if (pnl > 0) {
        insights.push(`[P&L] Total P&L: +$${pnl.toFixed(2)} - Portfolio is in profit!`);
      } else if (pnl < 0) {
        insights.push(`[P&L] Total P&L: $${pnl.toFixed(2)} - Portfolio is at a loss.`);
      } else {
        insights.push(`[P&L] Total P&L: $0.00 - Break even.`);
      }
    }
    
    // Next signal poller timing
    const hoursUntilNext = Math.ceil((jobTimes.signalPoller.getTime() - new Date().getTime()) / (1000 * 60 * 60));
    if (hoursUntilNext > 0) {
      insights.push(`[CLOCK] Next signal evaluation in ~${hoursUntilNext} hour(s) (${jobTimes.signalPoller.toLocaleTimeString()}).`);
    }
    
    // Default actions if none suggested
    if (actions.length === 0) {
      if (buySignals.length === 0 && positionCount === 0) {
        actions.push("Monitor market conditions - waiting for clear entry signals.");
      } else if (positionCount > 0) {
        actions.push("Hold current positions and monitor for exit signals.");
      }
    }
    
    return { insights, actions };
  };

  const summary = generateSummary();

  const getIconForEmoji = (text: string) => {
    // Handle text prefixes (new approach)
    if (text.startsWith('[BUY]')) return <CheckCircle className="h-3 w-3 inline mr-1.5 text-green-500" />;
    if (text.startsWith('[BEARISH]') || text.startsWith('[LOSS]')) return <TrendingDown className="h-3 w-3 inline mr-1.5 text-red-400" />;
    if (text.startsWith('[PROFIT]')) return <TrendingUp className="h-3 w-3 inline mr-1.5 text-green-500" />;
    if (text.startsWith('[POSITIONS]')) return <Briefcase className="h-3 w-3 inline mr-1.5 text-orange-400" />;
    if (text.startsWith('[TRADE]')) return <RefreshCw className="h-3 w-3 inline mr-1.5 text-blue-400" />;
    if (text.startsWith('[P&L]')) return <DollarSign className="h-3 w-3 inline mr-1.5 text-orange-400" />;
    if (text.startsWith('[CLOCK]')) return <Clock className="h-3 w-3 inline mr-1.5 text-blue-400" />;
    if (text.startsWith('[TRADE]') && text.includes('No trades')) return <FileText className="h-3 w-3 inline mr-1.5 text-gray-400" />;
    if (text.startsWith('[OVERBOUGHT]')) return <AlertCircle className="h-3 w-3 inline mr-1.5 text-red-400" />;
    if (text.startsWith('[OVERSOLD]')) return <CheckCircle className="h-3 w-3 inline mr-1.5 text-green-500" />;
    if (text.startsWith('[WARNING]')) return <AlertTriangle className="h-3 w-3 inline mr-1.5 text-orange-400" />;
    if (text.startsWith('[PORTFOLIO]')) return <BarChart className="h-3 w-3 inline mr-1.5 text-blue-400" />;
    
    // Legacy emoji support (for backwards compatibility)
    if (text.startsWith('✅')) return <CheckCircle className="h-3 w-3 inline mr-1.5 text-green-500" />;
    if (text.startsWith('📉')) return <TrendingDown className="h-3 w-3 inline mr-1.5 text-red-400" />;
    if (text.startsWith('📈')) return <TrendingUp className="h-3 w-3 inline mr-1.5 text-green-500" />;
    if (text.startsWith('💼')) return <Briefcase className="h-3 w-3 inline mr-1.5 text-orange-400" />;
    if (text.startsWith('🔄')) return <RefreshCw className="h-3 w-3 inline mr-1.5 text-blue-400" />;
    if (text.startsWith('💰')) return <DollarSign className="h-3 w-3 inline mr-1.5 text-orange-400" />;
    if (text.startsWith('⏰')) return <Clock className="h-3 w-3 inline mr-1.5 text-blue-400" />;
    if (text.startsWith('📝')) return <FileText className="h-3 w-3 inline mr-1.5 text-gray-400" />;
    if (text.startsWith('🔴')) return <AlertCircle className="h-3 w-3 inline mr-1.5 text-red-400" />;
    if (text.startsWith('🟢')) return <CheckCircle className="h-3 w-3 inline mr-1.5 text-green-500" />;
    if (text.startsWith('⚠️')) return <AlertTriangle className="h-3 w-3 inline mr-1.5 text-orange-400" />;
    if (text.startsWith('📊')) return <BarChart className="h-3 w-3 inline mr-1.5 text-blue-400" />;
    
    return null;
  };

  const removeEmoji = (text: string) => {
    // Remove text prefixes
    let cleaned = text.replace(/^\[BUY\]|^\[BEARISH\]|^\[PROFIT\]|^\[LOSS\]|^\[POSITIONS\]|^\[TRADE\]|^\[P&L\]|^\[CLOCK\]|^\[OVERBOUGHT\]|^\[OVERSOLD\]|^\[WARNING\]|^\[PORTFOLIO\]/g, '').trim();
    // Remove legacy emojis
    cleaned = cleaned.replace(/^[✅📉📈💼🔄💰⏰📝🔴🟢⚠️❌📊→]/g, '').trim();
    return cleaned;
  };

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div>
          <h1>Slow Joe Trading Bot</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.5rem' }}>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${
                healthStatus === 'healthy' ? 'bg-orange-400' : 
                healthStatus === 'unhealthy' ? 'bg-gray-500' : 
                'bg-gray-400'
              }`}></div>
              <span className="text-sm text-muted-foreground">
                {healthStatus === 'healthy' ? 'System Healthy' : healthStatus === 'unhealthy' ? 'Connection Issue' : 'Checking...'}
              </span>
            </div>
          </div>
        </div>
        <div className="header-actions">
          <div className="strategy-toggle flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Strategy:</span>
            <Button
              variant={strategyEnabled ? 'default' : 'destructive'}
              size="sm"
              onClick={toggleStrategy}
            >
              {strategyEnabled ? 'Enabled' : 'Disabled'}
            </Button>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={logout}
          >
            Logout
          </Button>
        </div>
      </header>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="border-b border-border bg-background">
          <div className="px-6">
            <TabsList className="h-auto p-1 bg-transparent">
              <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
              <TabsTrigger value="signals">Signals</TabsTrigger>
              <TabsTrigger value="positions">Positions</TabsTrigger>
              <TabsTrigger value="trades">Trades</TabsTrigger>
              <TabsTrigger value="alerts">Alerts</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
              <TabsTrigger value="backtest">Backtest</TabsTrigger>
              <TabsTrigger value="metrics">Metrics</TabsTrigger>
            </TabsList>
          </div>
        </div>

        <main className="dashboard-content">
          <TabsContent value="dashboard" className="mt-0">
          <div>
            {/* Header Controls */}
            <Card className="mb-6">
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-2xl">Dashboard</CardTitle>
                    {realtimeConnected && (
                      <Badge variant="success" className="gap-1.5">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-400"></span>
                        </span>
                        Live
                      </Badge>
                    )}
                    {lastUpdate && (
                      <span className="text-sm text-muted-foreground">
                        Updated: {lastUpdate.toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="flex items-center gap-2 cursor-pointer text-sm text-muted-foreground hover:text-foreground transition-colors">
                      <input
                        type="checkbox"
                        checked={autoRefresh}
                        onChange={(e) => setAutoRefresh(e.target.checked)}
                        className="cursor-pointer"
                      />
                      Auto-refresh
                    </label>
                    <div className="h-5 w-px bg-border"></div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={fetchDashboardData}
                      disabled={loading}
                    >
                      <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                      {loading ? 'Refreshing...' : 'Refresh'}
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={triggerReconcile}
                      disabled={reconciling}
                    >
                      <Database className={`h-4 w-4 mr-2 ${reconciling ? 'animate-spin' : ''}`} />
                      {reconciling ? 'Reconciling...' : 'Reconcile'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={triggerSignalPoller}
                      disabled={triggeringSignalPoller || runningFullRefresh}
                    >
                      <Radio className={`h-4 w-4 mr-2 ${triggeringSignalPoller ? 'animate-spin' : ''}`} />
                      {triggeringSignalPoller ? 'Generating...' : 'Signals'}
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={triggerFullRefresh}
                      disabled={runningFullRefresh || reconciling || triggeringSignalPoller}
                    >
                      <RotateCw className={`h-4 w-4 mr-2 ${runningFullRefresh ? 'animate-spin' : ''}`} />
                      {runningFullRefresh ? 'Running...' : 'Full Refresh'}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              {error && (
                <CardContent>
                  <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
                    <div className="flex items-center gap-2">
                      <XCircle className="h-5 w-5" />
                      <span>{error}</span>
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>

            {/* Portfolio Metrics */}
            <div className="mb-6">
              <div className="flex flex-wrap justify-between gap-3">
                <div className="flex-1 min-w-[120px] px-3 py-2 rounded-md border border-border bg-card">
                  <div className="text-xs text-muted-foreground mb-1">Net Asset Value</div>
                  <div className={`text-base font-semibold ${metrics?.nav > 0 ? 'text-orange-400' : 'text-muted-foreground'}`}>
                    ${metrics?.nav?.toFixed(2) || '0.00'}
                  </div>
                </div>
                <div className="flex-1 min-w-[120px] px-3 py-2 rounded-md border border-border bg-card">
                  <div className="text-xs text-muted-foreground mb-1">Total P&L</div>
                  <div className={`text-base font-semibold ${
                    metrics?.totalPnL > 0 ? 'text-orange-400' : 
                    metrics?.totalPnL < 0 ? 'text-gray-400' : 
                    'text-muted-foreground'
                  }`}>
                    ${metrics?.totalPnL?.toFixed(2) || '0.00'}
                  </div>
                </div>
                <div className="flex-1 min-w-[120px] px-3 py-2 rounded-md border border-border bg-card">
                  <div className="text-xs text-muted-foreground mb-1">Net Profit (After Fees)</div>
                  <div className={`text-base font-semibold ${
                    ((metrics?.totalPnL || 0) - (metrics?.totalFees || 0)) > 0 ? 'text-orange-400' : 
                    ((metrics?.totalPnL || 0) - (metrics?.totalFees || 0)) < 0 ? 'text-gray-400' : 
                    'text-muted-foreground'
                  }`}>
                    ${((metrics?.totalPnL || 0) - (metrics?.totalFees || 0)).toFixed(2)}
                  </div>
                </div>
                <div className="flex-1 min-w-[120px] px-3 py-2 rounded-md border border-border bg-card">
                  <div className="text-xs text-muted-foreground mb-1">Open Positions</div>
                  <div className="text-base font-semibold">{metrics?.positions || 0}</div>
                </div>
                <div className="flex-1 min-w-[120px] px-3 py-2 rounded-md border border-border bg-card">
                  <div className="text-xs text-muted-foreground mb-1">Recent Trades</div>
                  <div className="text-base font-semibold">{metrics?.recentTrades || 0}</div>
                </div>
                <div className="flex-1 min-w-[120px] px-3 py-2 rounded-md border border-border bg-card">
                  <div className="text-xs text-muted-foreground mb-1">Open Orders</div>
                  <div className={`text-base font-semibold ${openOrders.length > 0 ? 'text-orange-400' : 'text-muted-foreground'}`}>
                    {openOrders.length}
                  </div>
                </div>
                <div className="flex-1 min-w-[120px] px-3 py-2 rounded-md border border-border bg-card">
                  <div className="text-xs text-muted-foreground mb-1">Total Fees</div>
                  <div className="text-base font-semibold text-gray-400">
                    ${metrics?.totalFees?.toFixed(4) || '0.0000'}
                  </div>
                </div>
                {metrics?.winRate !== undefined && (
                  <div className="flex-1 min-w-[120px] px-3 py-2 rounded-md border border-border bg-card">
                    <div className="text-xs text-muted-foreground mb-1">Win Rate</div>
                    <div className={`text-base font-semibold ${
                      metrics.winRate >= 50 ? 'text-orange-400' : 
                      metrics.winRate >= 40 ? 'text-gray-300' : 
                      'text-gray-500'
                    }`}>
                      {metrics.winRate.toFixed(1)}%
                    </div>
                  </div>
                )}
                {metrics?.roi !== undefined && (
                  <div className="flex-1 min-w-[120px] px-3 py-2 rounded-md border border-border bg-card">
                    <div className="text-xs text-muted-foreground mb-1">ROI</div>
                    <div className={`text-base font-semibold ${
                      metrics.roi > 0 ? 'text-orange-400' : 
                      metrics.roi < 0 ? 'text-gray-400' : 
                      'text-muted-foreground'
                    }`}>
                      {metrics.roi > 0 ? '+' : ''}{metrics.roi.toFixed(2)}%
                    </div>
                  </div>
                )}
                {metrics?.nav !== undefined && (
                  <div className="flex-1 min-w-[120px] px-3 py-2 rounded-md border border-border bg-card">
                    <div className="text-xs text-muted-foreground mb-1">Available Cash</div>
                    <div className="text-base font-semibold text-orange-400">
                      ${(metrics.nav - (metrics.openPositions?.reduce((sum: number, pos: any) => sum + (parseFloat(pos.positionValue) || 0), 0) || 0)).toFixed(2)}
                    </div>
                  </div>
                )}
              </div>
              {metrics?.nav === 0 && (
                <div className="mt-6 pt-6 border-t border-border text-sm text-muted-foreground">
                  Click "Reconcile Balance" to fetch from exchange
                </div>
              )}
            </div>


            {/* Trading Summary & Insights + Recent Activity */}
            <div className="flex flex-col lg:flex-row gap-6 mb-6">
              {/* Trading Summary & Insights + Next Jobs */}
              <div className="card flex-1">
                <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
                <Database className="h-4 w-4" />
                Trading Summary & Insights
              </h3>
                
                <div className="mb-4">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    Current Market Analysis
                  </h4>
                  <div className="flex flex-col gap-2">
                    {summary.insights.length > 0 ? (
                      summary.insights.map((insight, idx) => (
                        <div 
                          key={idx}
                          className="px-2 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded text-xs leading-relaxed text-foreground flex items-start gap-1.5"
                        >
                          {getIconForEmoji(insight)}
                          <span>{removeEmoji(insight)}</span>
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-muted-foreground italic">
                        Analyzing market data...
                      </div>
                    )}
                  </div>
                </div>
                
                <div className="mb-4">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    Recommended Actions
                  </h4>
                  <div className="flex flex-col gap-2">
                    {summary.actions.length > 0 ? (
                      summary.actions.map((action, idx) => (
                        <div 
                          key={idx}
                          className="px-2 py-1.5 bg-green-500/10 border border-green-500/20 rounded text-xs leading-relaxed text-green-100 flex items-start gap-1.5"
                        >
                          <ArrowRight className="h-3 w-3 mt-0.5 text-green-400" />
                          <span>{action}</span>
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-muted-foreground italic">
                        No specific actions recommended at this time.
                      </div>
                    )}
                  </div>
                </div>

                {/* Trading Performance Summary */}
                {(() => {
                  const perfSummary = calculateTradingSummary();
                  if (perfSummary.totalTrades === 0 && tradeHistory.length === 0) return null;
                  
                  return (
                    <div className="pt-4 border-t border-border">
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
                        <TrendingUp className="h-3 w-3" />
                        Trading Performance Summary
                      </h4>
                      <div className={`p-3 rounded-md mb-3 ${
                        perfSummary.netProfit > 0 
                          ? 'bg-green-500/10 border border-green-500/20' 
                          : perfSummary.netProfit < 0 
                          ? 'bg-red-500/10 border border-red-500/20' 
                          : 'bg-muted/50 border border-border'
                      }`}>
                        <div className={`text-sm font-semibold mb-2 ${
                          perfSummary.netProfit > 0 ? 'text-orange-400' : 
                          perfSummary.netProfit < 0 ? 'text-gray-400' : 
                          'text-muted-foreground'
                        }`}>
                          {perfSummary.summary}
                        </div>
                        
                        {perfSummary.reasons.length > 0 && (
                          <div className="mt-2">
                            <div className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
                              Key Factors:
                            </div>
                            <ul className="list-none pl-0 space-y-1">
                              {perfSummary.reasons.map((reason, idx) => (
                                <li key={idx} className="text-xs text-muted-foreground flex items-start gap-1.5">
                                  <span className="text-orange-400 mt-0.5">•</span>
                                  <span>{reason}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                <div className="pt-4 border-t border-border">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    Next Scheduled Jobs
                  </h4>
                  <div className="flex flex-col gap-2">
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Reconcile (Hourly)</div>
                      <div className="text-sm font-medium">
                        {jobTimes.reconcile.toLocaleTimeString()}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Signal Poller (6h)</div>
                      <div className="text-sm font-medium">
                        {jobTimes.signalPoller.toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Recent Activity Summary */}
              {(metrics?.openPositions?.length > 0 || metrics?.recentTradesList?.length > 0 || openOrders.length > 0) && (
                <div className="card flex-1">
                  <h3 className="text-base font-semibold mb-4">Recent Activity</h3>
                
                <div className="space-y-6">
                  {/* Open Positions */}
                  {metrics?.openPositions?.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Open Positions</h4>
                      <div className="flex flex-col gap-2">
                        {metrics.openPositions.map((pos: any) => {
                          const quantity = parseFloat(pos.quantity);
                          const entryPrice = parseFloat(pos.entryPrice);
                          const marketItem = marketData.find(m => m.symbol === pos.symbol);
                          const currentPrice = marketItem?.price || entryPrice;
                          const currentValue = quantity * currentPrice;
                          const entryValue = quantity * entryPrice;
                          const pnl = currentValue - entryValue;
                          const pnlPercent = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;
                          
                          // Get price history for this position (include a buffer before openedAt so we always have at least one candle)
                          const posHistory = positionPriceHistory[pos.symbol] || [];
                          const openedAt = new Date(pos.openedAt).getTime();
                          const historyBufferMs = 2 * 60 * 60 * 1000; // 2 hours buffer before the position opened
                          // Filter history to show data since the position was opened (with buffer), and limit to recent points
                          const positionHistory = posHistory
                            .filter((d: any) => {
                              if (!d || !d.time) return false;
                              const dTime = typeof d.time === 'number' ? d.time : new Date(d.time).getTime();
                              return dTime >= (openedAt - historyBufferMs) && (d.close || d.price);
                            })
                            .slice(-24) // Last 24 data points
                            .map((d: any) => {
                              const price = d.close || d.price;
                              const dTime = typeof d.time === 'number' ? d.time : new Date(d.time).getTime();
                              return {
                                time: new Date(dTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
                                price: parseFloat(price) || entryPrice,
                                entryPrice: entryPrice,
                              };
                            })
                            .filter((d: any) => d.price > 0); // Ensure valid prices
                          
                          return (
                            <div key={pos.id} className="px-3 py-2.5 bg-muted/50 rounded-md">
                              <div className="flex justify-between items-start mb-2">
                                <div className="flex-1">
                                  <div className="font-semibold mb-1">{pos.symbol}</div>
                                  <div className="text-xs text-muted-foreground space-y-0.5">
                                    <div>{parseFloat(pos.quantity).toFixed(8)} @ ${entryPrice.toFixed(2)} entry</div>
                                    <div>Current: ${currentPrice.toFixed(2)}</div>
                                    <div>Value: ${currentValue.toFixed(2)}</div>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className={`font-bold text-2xl mb-1 ${pnl >= 0 ? 'text-orange-400' : 'text-gray-400'}`}>
                                    {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                                  </div>
                                  <div className={`text-lg font-semibold mb-2 ${pnlPercent >= 0 ? 'text-orange-400' : 'text-gray-400'}`}>
                                    {pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {formatDateTime(pos.openedAt, metrics?.openPositions)}
                                  </div>
                                </div>
                              </div>
                              
                              {/* Mini Chart */}
                              {positionHistory && positionHistory.length > 0 ? (
                                <div className="mt-3">
                                  {/* Price labels */}
                                  <div className="flex justify-between items-center mb-1 text-xs text-muted-foreground">
                                    <div className="flex items-center gap-2">
                                      <span>Entry: ${entryPrice.toFixed(2)}</span>
                                      <span className="text-orange-400">Current: ${currentPrice.toFixed(2)}</span>
                                    </div>
                                    <div className={`text-xs font-medium ${pnlPercent >= 0 ? 'text-orange-400' : 'text-gray-400'}`}>
                                      {pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%
                                    </div>
                                  </div>
                                  
                                  <div className="h-16 w-full" style={{ minHeight: '64px' }}>
                                    <ResponsiveContainer width="100%" height={64}>
                                      <AreaChart data={positionHistory} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                                        <defs>
                                          <linearGradient id={`gradient-${pos.symbol}`} x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor={pnl >= 0 ? "#fb923c" : "#9ca3af"} stopOpacity={0.3}/>
                                            <stop offset="95%" stopColor={pnl >= 0 ? "#fb923c" : "#9ca3af"} stopOpacity={0}/>
                                          </linearGradient>
                                        </defs>
                                        <Tooltip
                                          content={({ active, payload }) => {
                                            if (active && payload && payload.length) {
                                              const data = payload[0].payload;
                                              const price = data.price;
                                              const pricePnl = price - entryPrice;
                                              const pricePnlPercent = ((price - entryPrice) / entryPrice) * 100;
                                              return (
                                                <div className="bg-card border border-border rounded-md p-2 shadow-lg">
                                                  <div className="text-xs font-semibold mb-1">{pos.symbol}</div>
                                                  <div className="text-xs space-y-0.5">
                                                    <div>Price: <span className="font-medium">${price.toFixed(4)}</span></div>
                                                    <div>Entry: <span className="font-medium">${entryPrice.toFixed(4)}</span></div>
                                                    <div className={`${pricePnl >= 0 ? 'text-orange-400' : 'text-gray-400'}`}>
                                                      P&L: <span className="font-medium">{pricePnl >= 0 ? '+' : ''}${pricePnl.toFixed(2)} ({pricePnlPercent >= 0 ? '+' : ''}{pricePnlPercent.toFixed(2)}%)</span>
                                                    </div>
                                                    <div className="text-muted-foreground mt-1 pt-1 border-t border-border">
                                                      {data.time}
                                                    </div>
                                                  </div>
                                                </div>
                                              );
                                            }
                                            return null;
                                          }}
                                        />
                                        <Area
                                          type="monotone"
                                          dataKey="price"
                                          stroke={pnl >= 0 ? "#fb923c" : "#9ca3af"}
                                          strokeWidth={1.5}
                                          fill={`url(#gradient-${pos.symbol})`}
                                          dot={false}
                                          activeDot={{ r: 3, fill: pnl >= 0 ? "#fb923c" : "#9ca3af" }}
                                        />
                                        <ReferenceLine
                                          y={entryPrice}
                                          stroke="#fb923c"
                                          strokeDasharray="3 3"
                                          strokeWidth={1}
                                          label={{ value: 'Entry', position: 'right', fill: '#fb923c', fontSize: 9 }}
                                        />
                                        <XAxis
                                          dataKey="time"
                                          tick={false}
                                          axisLine={false}
                                          height={0}
                                        />
                                        <YAxis
                                          domain={['auto', 'auto']}
                                          tick={false}
                                          axisLine={false}
                                          width={0}
                                        />
                                      </AreaChart>
                                    </ResponsiveContainer>
                                  </div>
                                </div>
                              ) : (
                                <div className="mt-3 text-xs text-muted-foreground italic">
                                  Chart data loading...
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Open Orders */}
                  {openOrders.length > 0 && (
                    <div className={metrics?.openPositions?.length > 0 ? "pt-4 border-t border-border" : ""}>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Open Orders</h4>
                      <div className="text-xs text-muted-foreground mb-3 p-2 bg-blue-500/10 border border-blue-500/20 rounded">
                        ⏳ Limit orders placed 0.1% below market to get maker fees. They'll fill when price drops or convert to market orders after 15 minutes.
                      </div>
                      <div className="flex flex-col gap-2">
                        {openOrders.map((order: any) => {
                          const marketDataItem = marketData.find(m => m.symbol === order.symbol);
                          // For buy orders, use ASK price (what sellers are asking)
                          // For sell orders, use BID price (what buyers are offering)
                          // This is the correct price to compare against our limit order
                          const currentPrice = order.side === 'buy' 
                            ? (marketDataItem?.ask || marketDataItem?.price)
                            : (marketDataItem?.bid || marketDataItem?.price);
                          const limitPrice = order.price;
                          const quantity = parseFloat(order.remainingQuantity || order.quantity || '0');
                          const orderValue = quantity * limitPrice;
                          const priceDiff = currentPrice && limitPrice ? ((currentPrice - limitPrice) / limitPrice) * 100 : null;
                          
                          // Calculate time since order was placed
                          const orderTime = order.openedAt ? new Date(order.openedAt) : null;
                          const timeSinceOrder = orderTime ? Date.now() - orderTime.getTime() : null;
                          const minutesSince = timeSinceOrder ? Math.floor(timeSinceOrder / (1000 * 60)) : null;
                          const hoursSince = minutesSince ? (minutesSince / 60).toFixed(1) : null;
                          
                          // Estimate time until fill (15 minute timeout for limit orders)
                          const fillTimeoutMinutes = 15;
                          const minutesRemaining = minutesSince !== null ? Math.max(0, fillTimeoutMinutes - minutesSince) : null;
                          
                          return (
                            <div key={order.orderId} className="px-3 py-2.5 bg-blue-500/10 border border-blue-500/20 rounded-md">
                              <div className="flex justify-between items-start mb-2">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1.5">
                                    <span className="font-semibold text-base">{order.symbol}</span>
                                    <Badge variant={order.side === 'buy' ? 'success' : 'secondary'} className="text-xs">
                                      {order.side.toUpperCase()}
                                    </Badge>
                                    <Badge variant="outline" className="text-xs">
                                      PENDING
                                    </Badge>
                                  </div>
                                  <div className="text-sm text-muted-foreground space-y-0.5">
                                    <div>Quantity: {quantity.toFixed(8)}</div>
                                    <div>Order Value: ${orderValue.toFixed(2)}</div>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className="text-xs text-muted-foreground mb-1">
                                    {order.openedAt ? formatDateTime(order.openedAt, openOrders) : 'N/A'}
                                  </div>
                                  {minutesSince !== null && (
                                    <div className="text-xs text-muted-foreground">
                                      {minutesSince < 60 
                                        ? `${minutesSince}m ago`
                                        : `${hoursSince}h ago`
                                      }
                                    </div>
                                  )}
                                  {minutesRemaining !== null && minutesRemaining < 5 && (
                                    <div className="text-xs text-orange-400 font-semibold mt-1">
                                      {minutesRemaining > 0 ? `~${Math.ceil(minutesRemaining)}m until market order` : 'Market order soon'}
                                    </div>
                                  )}
                                </div>
                              </div>
                              
                              {/* Price Information - Prominently Displayed */}
                              {currentPrice && limitPrice && priceDiff !== null && (
                                <div className="mt-2 p-2.5 bg-black/30 rounded border border-border/50">
                                  <div className="grid grid-cols-2 gap-3 mb-2">
                                    <div>
                                      <div className="text-xs text-muted-foreground mb-0.5">
                                        Current {order.side === 'buy' ? 'Ask' : 'Bid'}
                                      </div>
                                      <div className="text-base font-bold text-orange-400">
                                        ${currentPrice.toFixed(4)}
                                      </div>
                                    </div>
                                    <div>
                                      <div className="text-xs text-muted-foreground mb-0.5">Limit Price</div>
                                      <div className="text-base font-bold">
                                        ${limitPrice.toFixed(4)}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="pt-2 border-t border-border/50">
                                    <div className="flex justify-between items-center">
                                      <span className="text-xs text-muted-foreground">Price Gap:</span>
                                      <div className={`text-lg font-bold ${Math.abs(priceDiff) > 0.1 ? 'text-orange-400' : Math.abs(priceDiff) > 0.05 ? 'text-yellow-400' : 'text-green-400'}`}>
                                        {priceDiff > 0 ? '+' : ''}{priceDiff.toFixed(3)}%
                                      </div>
                                    </div>
                                    <div className="text-xs text-muted-foreground mt-1">
                                      {order.side === 'buy' ? (
                                        priceDiff > 0.1 
                                          ? `Waiting for ask price to drop ${priceDiff.toFixed(2)}% to fill (POST-ONLY order)`
                                          : priceDiff > 0
                                          ? `Ask price close to limit - should fill soon (POST-ONLY order)`
                                          : `Ask price at or below limit - order should fill (POST-ONLY may delay)`
                                      ) : (
                                        priceDiff < -0.1
                                          ? `Waiting for bid price to rise ${Math.abs(priceDiff).toFixed(2)}% to fill (POST-ONLY order)`
                                          : priceDiff < 0
                                          ? `Bid price close to limit - should fill soon (POST-ONLY order)`
                                          : `Bid price at or above limit - order should fill (POST-ONLY may delay)`
                                      )}
                                    </div>
                                    <div className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50">
                                      {minutesSince !== null && minutesSince < fillTimeoutMinutes && (
                                        <span>⏳ POST-ONLY order: Will convert to market order in ~{Math.ceil(fillTimeoutMinutes - minutesSince)}m if not filled</span>
                                      )}
                                      {minutesSince !== null && minutesSince >= fillTimeoutMinutes && (
                                        <span className="text-orange-400">⚠️ Order should have converted to market order - check exchange</span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )}
                              {(!currentPrice || !limitPrice) && (
                                <div className="mt-2 p-2 bg-black/20 rounded text-xs text-muted-foreground">
                                  Price data unavailable
                                </div>
                              )}
                              
                              {order.orderId && (
                                <div className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50">
                                  Order ID: <span className="font-mono">{order.orderId}</span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Recent Trades */}
                  {metrics?.recentTradesList?.length > 0 && (
                    <div className={(metrics?.openPositions?.length > 0 || openOrders.length > 0) ? "pt-4 border-t border-border" : ""}>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Recent Trades</h4>
                      <div className="flex flex-col gap-2">
                        {metrics.recentTradesList.slice(0, 5).map((trade: any) => (
                          <div key={trade.id} className="px-3 py-2 bg-muted/50 rounded-md flex justify-between items-center">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-semibold">{trade.symbol}</span>
                                <Badge variant={trade.side === 'buy' ? 'success' : 'secondary'} className="text-xs">
                                  {trade.side.toUpperCase()}
                                </Badge>
                              </div>
                              <div className="text-sm text-muted-foreground">
                                {parseFloat(trade.quantity).toFixed(8)} @ ${parseFloat(trade.price).toFixed(2)}
                              </div>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {formatDateTime(trade.createdAt, metrics?.recentTradesList)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                </div>
              )}
            </div>

            {/* Performance Charts */}
            {(navHistory.length > 0 || tradeHistory.length > 0 || Object.keys(priceHistory).length > 0) && (
              <div style={{ marginBottom: '1.5rem' }}>
                <h2 style={{ marginBottom: '1rem' }}>Performance Charts</h2>
                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                  {/* NAV Over Time */}
                  {navHistory.length > 0 && (
                    <div className="card">
                      <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem' }}>NAV Over Time</h3>
                      <ResponsiveContainer width="100%" height={180}>
                        <AreaChart data={navHistory}>
                          <defs>
                            <linearGradient id="navGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#fb923c" stopOpacity={0.3}/>
                              <stop offset="95%" stopColor="#fb923c" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                          <XAxis 
                            dataKey="time" 
                            tickFormatter={(time) => {
                              const date = new Date(time);
                              const now = new Date();
                              // Show time if same day, otherwise show date
                              if (date.toDateString() === now.toDateString()) {
                                return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                              }
                              return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                            }}
                            stroke="#9ca3af"
                            style={{ fontSize: '0.75rem' }}
                          />
                          <YAxis 
                            tickFormatter={(value) => `$${value.toFixed(2)}`}
                            stroke="#9ca3af"
                            style={{ fontSize: '0.75rem' }}
                          />
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                            labelFormatter={(time) => new Date(time).toLocaleString()}
                            formatter={(value: number) => [`$${value.toFixed(2)}`, 'NAV']}
                          />
                          <Area 
                            type="monotone" 
                            dataKey="value" 
                            stroke="#fb923c" 
                            fillOpacity={1}
                            fill="url(#navGradient)"
                            strokeWidth={2}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* P&L and Fees Chart */}
                  {(() => {
                    const pnlFeesData = calculatePnLAndFeesData();
                    if (pnlFeesData.length === 0) return null;
                    
                    return (
                      <div className="card">
                        <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem' }}>Profit/Loss & Fees Over Time</h3>
                        <ResponsiveContainer width="100%" height={180}>
                          <ComposedChart data={pnlFeesData}>
                            <defs>
                              <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#fb923c" stopOpacity={0.3}/>
                                <stop offset="95%" stopColor="#fb923c" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis 
                              dataKey="time" 
                              tickFormatter={(time) => new Date(time).toLocaleDateString()}
                              stroke="#9ca3af"
                              style={{ fontSize: '0.75rem' }}
                            />
                            <YAxis 
                              yAxisId="left"
                              tickFormatter={(value) => `$${value.toFixed(2)}`}
                              stroke="#fb923c"
                              style={{ fontSize: '0.75rem' }}
                              label={{ value: 'Cumulative P&L ($)', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fill: '#fb923c' } }}
                            />
                            <YAxis 
                              yAxisId="right"
                              orientation="right"
                              tickFormatter={(value) => `$${value.toFixed(2)}`}
                              stroke="#9ca3af"
                              style={{ fontSize: '0.75rem' }}
                              label={{ value: 'Cumulative Fees ($)', angle: 90, position: 'insideRight', style: { textAnchor: 'middle', fill: '#9ca3af' } }}
                            />
                            <Tooltip 
                              contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px', color: '#e0e0e0' }}
                              labelFormatter={(time) => new Date(time).toLocaleString()}
                              formatter={(value: number, name: string) => {
                                if (name === 'pnl') {
                                  const val = typeof value === 'number' ? value : parseFloat(String(value));
                                  return [`$${val.toFixed(2)}`, 'Cumulative P&L'];
                                }
                                if (name === 'cumulativePnl') {
                                  const val = typeof value === 'number' ? value : parseFloat(String(value));
                                  return [`$${val.toFixed(2)}`, 'Cumulative P&L'];
                                }
                                const val = typeof value === 'number' ? value : parseFloat(String(value));
                                return [`$${val.toFixed(4)}`, 'Cumulative Fees'];
                              }}
                            />
                            <Legend 
                              wrapperStyle={{ paddingTop: '1rem' }}
                              formatter={(value) => {
                                if (value === 'pnl') return 'Cumulative P&L (Area)';
                                if (value === 'cumulativePnl') return 'Cumulative P&L (Line)';
                                if (value === 'fees') return 'Cumulative Fees';
                                return value;
                              }}
                            />
                            <Area 
                              yAxisId="left"
                              type="monotone" 
                              dataKey="pnl" 
                              stroke="#fb923c" 
                              fillOpacity={0.3}
                              fill="url(#pnlGradient)"
                              strokeWidth={1}
                              name="pnl"
                            />
                            <Line 
                              yAxisId="left"
                              type="monotone" 
                              dataKey="pnl" 
                              stroke="#fb923c" 
                              strokeWidth={2}
                              dot={false}
                              name="cumulativePnl"
                            />
                            <Line 
                              yAxisId="right"
                              type="monotone" 
                              dataKey="fees" 
                              stroke="#9ca3af" 
                              strokeWidth={2}
                              dot={false}
                              name="fees"
                            />
                            <ReferenceLine yAxisId="left" y={0} stroke="#6b7280" strokeDasharray="2 2" />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    );
                  })()}


                  {/* Trade Timeline */}
                  {tradeHistory.length > 0 && (
                    <div className="card">
                      <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem' }}>Trade Timeline</h3>
                      <ResponsiveContainer width="100%" height={180}>
                        <LineChart data={tradeHistory}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                          <XAxis 
                            dataKey="time" 
                            tickFormatter={(time) => {
                              const date = new Date(time);
                              const now = new Date();
                              // Show time if same day, otherwise show date
                              if (date.toDateString() === now.toDateString()) {
                                return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                              }
                              return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                            }}
                            stroke="#9ca3af"
                            style={{ fontSize: '0.75rem' }}
                          />
                          <YAxis 
                            tickFormatter={(value) => `$${value.toFixed(0)}`}
                            stroke="#9ca3af"
                            style={{ fontSize: '0.75rem' }}
                          />
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                            labelFormatter={(time) => new Date(time).toLocaleString()}
                            formatter={(value: number, _name: string, props: any) => [
                              `$${value.toFixed(2)} (${props.payload.symbol} ${props.payload.side})`,
                              'Trade Value'
                            ]}
                          />
                          <Line 
                            type="monotone" 
                            dataKey="value" 
                            stroke="#3b82f6" 
                            strokeWidth={2}
                            dot={{ fill: '#3b82f6', r: 4 }}
                            activeDot={{ r: 6 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>

                {/* Price Charts for Each Asset */}
                {Object.keys(priceHistory).length > 0 && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                      <h3 style={{ margin: 0, fontSize: '1rem' }}>Price Charts</h3>
                      <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                        Updates every 60 seconds
                      </span>
                    </div>
                    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))', gap: '1rem' }}>
                      {Object.entries(priceHistory).map(([symbol, data]) => {
                        if (data.length === 0) return null;
                        
                        // Find trades for this symbol to mark on chart
                        const symbolTrades = tradeHistory.filter(t => t.symbol === symbol);
                        
                        return (
                          <div key={symbol} className="card">
                            <h4 style={{ margin: '0 0 1rem 0', fontSize: '0.875rem' }}>{symbol} Price History</h4>
                            <ResponsiveContainer width="100%" height={150}>
                              <AreaChart data={data}>
                                <defs>
                                  <linearGradient id={`priceGradient-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                                  </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                                <XAxis 
                                  dataKey="time" 
                                  tickFormatter={(time) => new Date(time).toLocaleDateString()}
                                  stroke="#9ca3af"
                                  style={{ fontSize: '0.7rem' }}
                                />
                                <YAxis 
                                  tickFormatter={(value) => `$${value.toFixed(0)}`}
                                  stroke="#9ca3af"
                                  style={{ fontSize: '0.7rem' }}
                                />
                                <Tooltip 
                                  contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                                  labelFormatter={(time) => new Date(time).toLocaleString()}
                                  formatter={(value: number) => [`$${value.toFixed(2)}`, 'Price']}
                                />
                                <Area 
                                  type="monotone" 
                                  dataKey="close" 
                                  stroke="#3b82f6" 
                                  fillOpacity={1}
                                  fill={`url(#priceGradient-${symbol})`}
                                  strokeWidth={2}
                                />
                                {/* Mark trades on the chart */}
                                {symbolTrades.map((trade, idx) => {
                                  const tradeTime = new Date(trade.time).getTime();
                                  const closestCandle = data.find((c: any) => Math.abs(new Date(c.time).getTime() - tradeTime) < 3600000);
                                  if (!closestCandle) return null;
                                  return (
                                    <ReferenceLine 
                                      key={idx}
                                      x={closestCandle.time} 
                                      stroke={trade.side === 'buy' ? '#fb923c' : '#9ca3af'} 
                                      strokeDasharray="5 5"
                                      strokeWidth={2}
                                    />
                                  );
                                })}
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Market Data */}
            <div>
              <h2 style={{ marginBottom: '1rem' }}>Real-Time Market Data</h2>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
                {marketData.map((item) => (
                  <div key={item.symbol} className="card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1rem' }}>
                      <h3 style={{ margin: 0, fontSize: '1.25rem' }}>{item.symbol}</h3>
                      {item.error ? (
                        <span style={{ color: '#9ca3af', fontSize: '0.875rem' }}>Error</span>
                      ) : (
                        <span
                          style={{
                            padding: '0.25rem 0.75rem',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            fontWeight: '600',
                            backgroundColor: getSignalStatus(item).color + '20',
                            color: getSignalStatus(item).color,
                          }}
                        >
                          {getSignalStatus(item).text}
                        </span>
                      )}
                    </div>

                    {item.error ? (
                      <div style={{ color: '#9ca3af', fontSize: '0.875rem' }}>{item.error}</div>
                    ) : (
                      <>
                        <div style={{ marginBottom: '1rem' }}>
                          <div style={{ fontSize: '0.875rem', color: '#9ca3af', marginBottom: '0.25rem' }}>Current Price</div>
                          <div style={{ fontSize: '1.5rem', fontWeight: '600', color: '#fff' }}>
                            {item.price ? formatPrice(item.price) : 'N/A'}
                          </div>
                        </div>

                        {item.change24h !== null && item.change24h !== undefined && (
                          <div style={{ marginBottom: '1rem' }}>
                            <div style={{ fontSize: '0.875rem', color: '#9ca3af', marginBottom: '0.25rem' }}>24h Change</div>
                            <div style={{ fontSize: '1.125rem', fontWeight: '600', color: getChangeColor(item.change24h) }}>
                              {item.change24h > 0 ? '+' : ''}{item.change24h.toFixed(2)}%
                            </div>
                          </div>
                        )}

                        {item.indicators && (
                          <div style={{ 
                            borderTop: '1px solid rgba(255, 255, 255, 0.1)', 
                            paddingTop: '1rem',
                            display: 'grid',
                            gridTemplateColumns: '1fr 1fr',
                            gap: '1rem'
                          }}>
                            <div>
                              <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: '0.25rem' }}>EMA12</div>
                              <div style={{ fontSize: '0.875rem', fontWeight: '500' }}>
                                {item.indicators.ema12 ? formatPrice(item.indicators.ema12) : 'N/A'}
                              </div>
                            </div>
                            <div>
                              <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: '0.25rem' }}>EMA26</div>
                              <div style={{ fontSize: '0.875rem', fontWeight: '500' }}>
                                {item.indicators.ema26 ? formatPrice(item.indicators.ema26) : 'N/A'}
                              </div>
                            </div>
                            <div style={{ gridColumn: '1 / -1' }}>
                              <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: '0.25rem' }}>EMA Ratio (12/26)</div>
                              <div style={{ fontSize: '0.875rem', fontWeight: '500' }}>
                                {item.indicators.ema12 && item.indicators.ema26 ? (
                                  <>
                                    <span style={{ 
                                      color: (item.indicators.ema12 / item.indicators.ema26) >= 1.001 ? '#fb923c' : '#9ca3af',
                                      fontWeight: '600'
                                    }}>
                                      {(item.indicators.ema12 / item.indicators.ema26).toFixed(6)}
                                    </span>
                                    <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#9ca3af' }}>
                                      {(item.indicators.ema12 / item.indicators.ema26) >= 1.001 ? '(Bullish)' : '(Bearish)'}
                                    </span>
                                  </>
                                ) : 'N/A'}
                              </div>
                            </div>
                            <div style={{ gridColumn: '1 / -1' }}>
                              <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: '0.25rem' }}>RSI</div>
                              <div style={{ fontSize: '0.875rem', fontWeight: '500' }}>
                                {item.indicators.rsi ? `${item.indicators.rsi.toFixed(2)}` : 'N/A'}
                                {item.indicators.rsi && (
                                  <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#9ca3af' }}>
                                    {item.indicators.rsi > 70 ? '(Overbought)' : item.indicators.rsi < 40 ? '(Oversold)' : '(Normal)'}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
          </TabsContent>
          
          <TabsContent value="signals" className="mt-0"><Signals /></TabsContent>
          <TabsContent value="positions" className="mt-0"><Positions /></TabsContent>
          <TabsContent value="trades" className="mt-0"><Trades /></TabsContent>
          <TabsContent value="alerts" className="mt-0"><Alerts /></TabsContent>
          <TabsContent value="settings" className="mt-0"><Settings /></TabsContent>
          <TabsContent value="backtest" className="mt-0"><Backtest /></TabsContent>
          <TabsContent value="metrics" className="mt-0"><Metrics /></TabsContent>
        </main>
      </Tabs>
    </div>
  );
}

export default Dashboard;
