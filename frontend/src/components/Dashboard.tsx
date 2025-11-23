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
        reasons.push(`⚠️ Your fees ($${totalFees.toFixed(2)}) exceed your trading profits ($${realizedPnL.toFixed(2)}), making trading unprofitable.`);
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
    if (change > 0) return '#4ade80';
    if (change < 0) return '#f5576c';
    return '#9ca3af';
  };

  const getSignalStatus = (item: MarketDataItem) => {
    if (!item.indicators) return { text: 'No Data', color: '#9ca3af' };
    
    const { ema12, ema26, rsi } = item.indicators;
    
    if (!ema12 || !ema26 || !rsi) return { text: 'Calculating...', color: '#fbbf24' };
    
    const emaBullish = ema12 > ema26;
    const rsiInRange = rsi >= 40 && rsi <= 70;
    
    if (emaBullish && rsiInRange) {
      return { text: 'BUY Signal', color: '#4ade80' };
    }
    if (!emaBullish) {
      return { text: 'Bearish', color: '#f5576c' };
    }
    if (rsi > 70) {
      return { text: 'Overbought', color: '#fbbf24' };
    }
    if (rsi < 40) {
      return { text: 'Oversold', color: '#fbbf24' };
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
      insights.push("⚠️ Strategy is currently disabled. No trades will be executed.");
      actions.push("Enable the strategy to start trading.");
      return { insights, actions };
    }
    
    // Portfolio status
    if (!metrics || metrics.nav === 0) {
      insights.push("📊 Portfolio balance not yet initialized.");
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
      insights.push(`✅ ${buySignals.length} asset(s) showing BUY signals: ${symbols}`);
      if (positionCount === 0) {
        actions.push(`Consider opening positions in ${symbols} - indicators suggest bullish momentum.`);
      } else {
        actions.push(`Monitor ${symbols} for potential entry opportunities.`);
      }
    }
    
    if (bearishSignals.length > 0) {
      const symbols = bearishSignals.map(s => s.symbol).join(', ');
      insights.push(`📉 ${bearishSignals.length} asset(s) showing bearish conditions: ${symbols}`);
      const hasPositions = openPositions.some((p: any) => bearishSignals.some(s => s.symbol === p.symbol));
      if (hasPositions) {
        actions.push(`Consider closing positions in ${symbols} - trend is turning bearish.`);
      }
    }
    
    if (overboughtSignals.length > 0) {
      const symbols = overboughtSignals.map(s => s.symbol).join(', ');
      insights.push(`🔴 ${overboughtSignals.length} asset(s) are overbought (RSI > 70): ${symbols}`);
      const hasPositions = openPositions.some((p: any) => overboughtSignals.some(s => s.symbol === p.symbol));
      if (hasPositions) {
        actions.push(`Consider taking profits on ${symbols} - prices may be near local highs.`);
      } else {
        actions.push(`Wait for pullback before entering ${symbols} - currently overbought.`);
      }
    }
    
    if (oversoldSignals.length > 0) {
      const symbols = oversoldSignals.map(s => s.symbol).join(', ');
      insights.push(`🟢 ${oversoldSignals.length} asset(s) are oversold (RSI < 40): ${symbols}`);
      actions.push(`Watch ${symbols} for potential reversal - may present buying opportunities if EMA turns bullish.`);
    }
    
    // Position analysis
    if (positionCount > 0) {
      insights.push(`💼 Currently holding ${positionCount} open position(s).`);
      
      // Check if positions are profitable
      const profitablePositions = openPositions.filter((p: any) => {
        const marketItem = marketData.find(m => m.symbol === p.symbol);
        if (!marketItem?.price || !p.entryPrice) return false;
        return marketItem.price > p.entryPrice;
      });
      
      if (profitablePositions.length > 0) {
        const symbols = profitablePositions.map((p: any) => p.symbol).join(', ');
        insights.push(`📈 ${profitablePositions.length} position(s) in profit: ${symbols}`);
      }
      
      const losingPositions = openPositions.filter((p: any) => {
        const marketItem = marketData.find(m => m.symbol === p.symbol);
        if (!marketItem?.price || !p.entryPrice) return false;
        return marketItem.price < p.entryPrice;
      });
      
      if (losingPositions.length > 0) {
        const symbols = losingPositions.map((p: any) => p.symbol).join(', ');
        insights.push(`📉 ${losingPositions.length} position(s) at a loss: ${symbols}`);
      }
    } else {
      insights.push("💼 No open positions currently.");
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
      insights.push(`🔄 Most recent trade: ${tradeType} ${lastTrade.quantity} ${lastTrade.symbol} at $${priceStr}`);
    } else {
      insights.push("📝 No trades executed yet. The bot is waiting for signal conditions to be met.");
    }
    
    // P&L analysis
    if (metrics?.totalPnL) {
      const pnl = metrics.totalPnL;
      if (pnl > 0) {
        insights.push(`💰 Total P&L: +$${pnl.toFixed(2)} - Portfolio is in profit!`);
      } else if (pnl < 0) {
        insights.push(`💰 Total P&L: $${pnl.toFixed(2)} - Portfolio is at a loss.`);
      } else {
        insights.push(`💰 Total P&L: $0.00 - Break even.`);
      }
    }
    
    // Next signal poller timing
    const hoursUntilNext = Math.ceil((jobTimes.signalPoller.getTime() - new Date().getTime()) / (1000 * 60 * 60));
    if (hoursUntilNext > 0) {
      insights.push(`⏰ Next signal evaluation in ~${hoursUntilNext} hour(s) (${jobTimes.signalPoller.toLocaleTimeString()}).`);
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

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div>
          <h1>Slow Joe Trading Bot</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: healthStatus === 'healthy' ? '#4ade80' : healthStatus === 'unhealthy' ? '#f5576c' : '#fbbf24',
              }}></div>
              <span style={{ fontSize: '0.875rem', color: '#9ca3af' }}>
                {healthStatus === 'healthy' ? 'System Healthy' : healthStatus === 'unhealthy' ? 'Connection Issue' : 'Checking...'}
              </span>
            </div>
          </div>
        </div>
        <div className="header-actions">
          <div className="strategy-toggle">
            <span>Strategy:</span>
            <button
              className={`button ${strategyEnabled ? 'success' : 'danger'}`}
              onClick={toggleStrategy}
            >
              {strategyEnabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>
          <button className="button" onClick={logout}>
            Logout
          </button>
        </div>
      </header>

      <nav className="dashboard-nav">
        <button
          className={activeTab === 'dashboard' ? 'active' : ''}
          onClick={() => setActiveTab('dashboard')}
        >
          Dashboard
        </button>
        <button
          className={activeTab === 'signals' ? 'active' : ''}
          onClick={() => setActiveTab('signals')}
        >
          Signals
        </button>
        <button
          className={activeTab === 'positions' ? 'active' : ''}
          onClick={() => setActiveTab('positions')}
        >
          Positions
        </button>
        <button
          className={activeTab === 'trades' ? 'active' : ''}
          onClick={() => setActiveTab('trades')}
        >
          Trades
        </button>
        <button
          className={activeTab === 'alerts' ? 'active' : ''}
          onClick={() => setActiveTab('alerts')}
        >
          Alerts
        </button>
        <button
          className={activeTab === 'settings' ? 'active' : ''}
          onClick={() => setActiveTab('settings')}
        >
          Settings
        </button>
            <button
              className={activeTab === 'backtest' ? 'active' : ''}
              onClick={() => setActiveTab('backtest')}
            >
              Backtest
            </button>
            <button
              className={activeTab === 'metrics' ? 'active' : ''}
              onClick={() => setActiveTab('metrics')}
            >
              Metrics
            </button>
          </nav>

      <main className="dashboard-content">
        {activeTab === 'dashboard' && (
          <div>
            {/* Header Controls */}
            <div className="card" style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <h2 style={{ margin: 0 }}>Dashboard</h2>
                  {realtimeConnected && (
                    <span style={{ 
                      fontSize: '0.75rem', 
                      color: '#4ade80',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.25rem'
                    }}>
                      <span style={{ 
                        width: '8px', 
                        height: '8px', 
                        borderRadius: '50%', 
                        backgroundColor: '#4ade80',
                        display: 'inline-block',
                        animation: 'pulse 2s infinite'
                      }}></span>
                      Live
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  {lastUpdate && (
                    <span style={{ color: '#9ca3af', fontSize: '0.875rem' }}>
                      Updated: {lastUpdate.toLocaleTimeString()}
                    </span>
                  )}
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={autoRefresh}
                      onChange={(e) => setAutoRefresh(e.target.checked)}
                      style={{ cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '0.875rem', color: '#9ca3af' }}>Auto-refresh</span>
                  </label>
                  {lastUpdate && (
                    <span style={{ color: '#9ca3af', fontSize: '0.875rem' }}>
                      Updated: {lastUpdate.toLocaleTimeString()}
                    </span>
                  )}
                  <button
                    className="button"
                    onClick={fetchDashboardData}
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
                  <button
                    className="button"
                    onClick={triggerSignalPoller}
                    disabled={triggeringSignalPoller || runningFullRefresh}
                    style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}
                  >
                    {triggeringSignalPoller ? 'Generating Signals...' : 'Generate Signals'}
                  </button>
                  <button
                    className="button success"
                    onClick={triggerFullRefresh}
                    disabled={runningFullRefresh || reconciling || triggeringSignalPoller}
                    style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}
                  >
                    {runningFullRefresh ? 'Running Full Refresh...' : '🔄 Full Refresh (Reconcile + Signals + Trades)'}
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

            {/* Portfolio Metrics */}
            <div className="grid" style={{ marginBottom: '1.5rem' }}>
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
                <div className="metric-label">Open Positions</div>
                <div className="metric-value">{metrics?.positions || 0}</div>
              </div>
              <div className="metric card">
                <div className="metric-label">Recent Trades</div>
                <div className="metric-value">{metrics?.recentTrades || 0}</div>
              </div>
              <div className="metric card">
                <div className="metric-label">Open Orders</div>
                <div className="metric-value" style={{ color: openOrders.length > 0 ? '#60a5fa' : '#9ca3af' }}>
                  {openOrders.length}
                </div>
              </div>
              <div className="metric card">
                <div className="metric-label">Total Fees</div>
                <div className="metric-value" style={{ color: '#fbbf24' }}>
                  ${metrics?.totalFees?.toFixed(4) || '0.0000'}
                </div>
              </div>
            </div>

            {/* Owned Assets */}
            {metrics?.openPositions && metrics.openPositions.length > 0 && (
              <div className="card" style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.125rem', fontWeight: '600' }}>💼 Owned Assets</h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
                        <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600', color: '#9ca3af' }}>Asset</th>
                        <th style={{ padding: '0.75rem', textAlign: 'right', fontSize: '0.875rem', fontWeight: '600', color: '#9ca3af' }}>Quantity</th>
                        <th style={{ padding: '0.75rem', textAlign: 'right', fontSize: '0.875rem', fontWeight: '600', color: '#9ca3af' }}>Entry Price</th>
                        <th style={{ padding: '0.75rem', textAlign: 'right', fontSize: '0.875rem', fontWeight: '600', color: '#9ca3af' }}>Current Price</th>
                        <th style={{ padding: '0.75rem', textAlign: 'right', fontSize: '0.875rem', fontWeight: '600', color: '#9ca3af' }}>Current Value</th>
                        <th style={{ padding: '0.75rem', textAlign: 'right', fontSize: '0.875rem', fontWeight: '600', color: '#9ca3af' }}>P&L</th>
                        <th style={{ padding: '0.75rem', textAlign: 'right', fontSize: '0.875rem', fontWeight: '600', color: '#9ca3af' }}>P&L %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.openPositions.map((position: any) => {
                        const quantity = parseFloat(position.quantity);
                        const entryPrice = parseFloat(position.entryPrice);
                        const marketItem = marketData.find(m => m.symbol === position.symbol);
                        const currentPrice = marketItem?.price || entryPrice;
                        const currentValue = quantity * currentPrice;
                        const pnl = currentValue - (quantity * entryPrice);
                        const pnlPercent = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;
                        
                        return (
                          <tr key={position.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                            <td style={{ padding: '0.75rem' }}>
                              <strong style={{ color: '#e5e7eb' }}>{position.symbol}</strong>
                            </td>
                            <td style={{ padding: '0.75rem', textAlign: 'right', color: '#e5e7eb' }}>
                              {quantity.toFixed(8)}
                            </td>
                            <td style={{ padding: '0.75rem', textAlign: 'right', color: '#9ca3af' }}>
                              ${entryPrice.toFixed(2)}
                            </td>
                            <td style={{ padding: '0.75rem', textAlign: 'right', color: '#e5e7eb' }}>
                              ${currentPrice.toFixed(2)}
                            </td>
                            <td style={{ padding: '0.75rem', textAlign: 'right', color: '#e5e7eb', fontWeight: '500' }}>
                              ${currentValue.toFixed(2)}
                            </td>
                            <td style={{ 
                              padding: '0.75rem', 
                              textAlign: 'right', 
                              fontWeight: '600',
                              color: pnl > 0 ? '#4ade80' : pnl < 0 ? '#f5576c' : '#9ca3af'
                            }}>
                              {pnl > 0 ? '+' : ''}${pnl.toFixed(2)}
                            </td>
                            <td style={{ 
                              padding: '0.75rem', 
                              textAlign: 'right',
                              color: pnlPercent > 0 ? '#4ade80' : pnlPercent < 0 ? '#f5576c' : '#9ca3af'
                            }}>
                              {pnlPercent > 0 ? '+' : ''}{pnlPercent.toFixed(2)}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: '2px solid rgba(255, 255, 255, 0.2)', backgroundColor: 'rgba(59, 130, 246, 0.1)' }}>
                        <td colSpan={4} style={{ padding: '0.75rem', textAlign: 'right', fontWeight: '600', color: '#e5e7eb' }}>
                          Total Portfolio Value:
                        </td>
                        <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: '700', fontSize: '1.125rem', color: '#e5e7eb' }}>
                          ${metrics.openPositions.reduce((total: number, position: any) => {
                            const quantity = parseFloat(position.quantity);
                            const marketItem = marketData.find(m => m.symbol === position.symbol);
                            const currentPrice = marketItem?.price || parseFloat(position.entryPrice);
                            return total + (quantity * currentPrice);
                          }, 0).toFixed(2)}
                        </td>
                        <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: '600', color: '#e5e7eb' }}>
                          {(() => {
                            const totalPnL = metrics.openPositions.reduce((total: number, position: any) => {
                              const quantity = parseFloat(position.quantity);
                              const entryPrice = parseFloat(position.entryPrice);
                              const marketItem = marketData.find(m => m.symbol === position.symbol);
                              const currentPrice = marketItem?.price || entryPrice;
                              return total + (quantity * currentPrice) - (quantity * entryPrice);
                            }, 0);
                            return (
                              <span style={{ 
                                color: totalPnL > 0 ? '#4ade80' : totalPnL < 0 ? '#f5576c' : '#9ca3af',
                                fontWeight: '600'
                              }}>
                                {totalPnL > 0 ? '+' : ''}${totalPnL.toFixed(2)}
                              </span>
                            );
                          })()}
                        </td>
                        <td style={{ padding: '0.75rem' }}></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            {/* Trading Summary & Insights */}
            <div className="card" style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.125rem', fontWeight: '600' }}>📊 Trading Summary & Insights</h3>
              
              <div style={{ marginBottom: '1.5rem' }}>
                <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.875rem', fontWeight: '600', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Current Market Analysis
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {summary.insights.length > 0 ? (
                    summary.insights.map((insight, idx) => (
                      <div 
                        key={idx}
                        style={{
                          padding: '0.75rem',
                          background: 'rgba(59, 130, 246, 0.1)',
                          border: '1px solid rgba(59, 130, 246, 0.2)',
                          borderRadius: '6px',
                          fontSize: '0.875rem',
                          lineHeight: '1.5',
                          color: '#e5e7eb',
                        }}
                      >
                        {insight}
                      </div>
                    ))
                  ) : (
                    <div style={{ color: '#9ca3af', fontSize: '0.875rem', fontStyle: 'italic' }}>
                      Analyzing market data...
                    </div>
                  )}
                </div>
              </div>
              
              <div>
                <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.875rem', fontWeight: '600', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Recommended Actions
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {summary.actions.length > 0 ? (
                    summary.actions.map((action, idx) => (
                      <div 
                        key={idx}
                        style={{
                          padding: '0.75rem',
                          background: 'rgba(34, 197, 94, 0.1)',
                          border: '1px solid rgba(34, 197, 94, 0.2)',
                          borderRadius: '6px',
                          fontSize: '0.875rem',
                          lineHeight: '1.5',
                          color: '#d1fae5',
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '0.5rem',
                        }}
                      >
                        <span style={{ fontSize: '1rem' }}>→</span>
                        <span>{action}</span>
                      </div>
                    ))
                  ) : (
                    <div style={{ color: '#9ca3af', fontSize: '0.875rem', fontStyle: 'italic' }}>
                      No specific actions recommended at this time.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Bot Status & Next Jobs */}
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', marginBottom: '1.5rem' }}>
              <div className="card">
                <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem' }}>Bot Status</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#9ca3af', fontSize: '0.875rem' }}>Strategy:</span>
                    <span style={{ fontWeight: '600', color: strategyEnabled ? '#4ade80' : '#f5576c' }}>
                      {strategyEnabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#9ca3af', fontSize: '0.875rem' }}>Connection:</span>
                    <span style={{ fontWeight: '600', color: healthStatus === 'healthy' ? '#4ade80' : '#f5576c' }}>
                      {healthStatus === 'healthy' ? 'Connected' : 'Disconnected'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#9ca3af', fontSize: '0.875rem' }}>Auto-refresh:</span>
                    <span style={{ fontWeight: '600', color: autoRefresh ? '#4ade80' : '#9ca3af' }}>
                      {autoRefresh ? 'On' : 'Off'}
                    </span>
                  </div>
                </div>
              </div>
              <div className="card">
                <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem' }}>Next Scheduled Jobs</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div>
                    <div style={{ color: '#9ca3af', fontSize: '0.75rem', marginBottom: '0.25rem' }}>Reconcile (Hourly)</div>
                    <div style={{ fontSize: '0.875rem', fontWeight: '500' }}>
                      {jobTimes.reconcile.toLocaleTimeString()}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#9ca3af', fontSize: '0.75rem', marginBottom: '0.25rem' }}>Signal Poller (6h)</div>
                    <div style={{ fontSize: '0.875rem', fontWeight: '500' }}>
                      {jobTimes.signalPoller.toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Recent Activity Summary */}
            {(metrics?.openPositions?.length > 0 || metrics?.recentTradesList?.length > 0 || openOrders.length > 0) && (
              <div style={{ marginBottom: '1.5rem' }}>
                <h2 style={{ marginBottom: '1rem' }}>Recent Activity</h2>
                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '1rem' }}>
                  {/* Open Positions */}
                  {metrics?.openPositions?.length > 0 && (
                    <div className="card">
                      <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem' }}>Open Positions</h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {metrics.openPositions.map((pos: any) => (
                          <div key={pos.id} style={{ 
                            padding: '0.75rem', 
                            background: 'rgba(255, 255, 255, 0.05)', 
                            borderRadius: '8px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                          }}>
                            <div>
                              <div style={{ fontWeight: '600', marginBottom: '0.25rem' }}>{pos.symbol}</div>
                              <div style={{ fontSize: '0.875rem', color: '#9ca3af' }}>
                                {parseFloat(pos.quantity).toFixed(8)} @ ${parseFloat(pos.entryPrice).toFixed(2)}
                              </div>
                            </div>
                            <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                              {formatDateTime(pos.openedAt, metrics?.openPositions)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Recent Trades */}
                  {metrics?.recentTradesList?.length > 0 && (
                    <div className="card">
                      <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem' }}>Recent Trades</h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {metrics.recentTradesList.slice(0, 5).map((trade: any) => (
                          <div key={trade.id} style={{ 
                            padding: '0.75rem', 
                            background: 'rgba(255, 255, 255, 0.05)', 
                            borderRadius: '8px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                          }}>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                                <span style={{ fontWeight: '600' }}>{trade.symbol}</span>
                                <span style={{
                                  padding: '0.125rem 0.5rem',
                                  borderRadius: '4px',
                                  fontSize: '0.75rem',
                                  fontWeight: '600',
                                  backgroundColor: trade.side === 'buy' ? 'rgba(74, 222, 128, 0.2)' : 'rgba(245, 87, 108, 0.2)',
                                  color: trade.side === 'buy' ? '#4ade80' : '#f5576c',
                                }}>
                                  {trade.side.toUpperCase()}
                                </span>
                              </div>
                              <div style={{ fontSize: '0.875rem', color: '#9ca3af' }}>
                                {parseFloat(trade.quantity).toFixed(8)} @ ${parseFloat(trade.price).toFixed(2)}
                              </div>
                            </div>
                            <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                              {formatDateTime(trade.createdAt, metrics?.recentTradesList)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Open Orders */}
                  {openOrders.length > 0 && (
                    <div className="card">
                      <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem' }}>Open Orders</h3>
                      <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: '0.75rem', padding: '0.5rem', background: 'rgba(59, 130, 246, 0.1)', borderRadius: '4px' }}>
                        ⏳ Limit orders placed 0.1% below market to get maker fees. They'll fill when price drops or convert to market orders after 15 minutes.
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {openOrders.map((order: any) => {
                          const marketDataItem = marketData.find(m => m.symbol === order.symbol);
                          const currentPrice = marketDataItem?.price || marketDataItem?.bid || marketDataItem?.ask;
                          const limitPrice = order.price;
                          const priceDiff = currentPrice && limitPrice ? ((currentPrice - limitPrice) / limitPrice) * 100 : null;
                          
                          return (
                            <div key={order.orderId} style={{ 
                              padding: '0.75rem', 
                              background: 'rgba(59, 130, 246, 0.1)', 
                              border: '1px solid rgba(59, 130, 246, 0.2)',
                              borderRadius: '8px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '0.5rem'
                            }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                                    <span style={{ fontWeight: '600' }}>{order.symbol}</span>
                                    <span style={{
                                      padding: '0.125rem 0.5rem',
                                      borderRadius: '4px',
                                      fontSize: '0.75rem',
                                      fontWeight: '600',
                                      backgroundColor: order.side === 'buy' ? 'rgba(74, 222, 128, 0.2)' : 'rgba(245, 87, 108, 0.2)',
                                      color: order.side === 'buy' ? '#4ade80' : '#f5576c',
                                    }}>
                                      {order.side.toUpperCase()}
                                    </span>
                                    <span style={{
                                      padding: '0.125rem 0.5rem',
                                      borderRadius: '4px',
                                      fontSize: '0.75rem',
                                      fontWeight: '600',
                                      backgroundColor: 'rgba(59, 130, 246, 0.2)',
                                      color: '#60a5fa',
                                    }}>
                                      PENDING
                                    </span>
                                  </div>
                                  <div style={{ fontSize: '0.875rem', color: '#9ca3af' }}>
                                    {order.remainingQuantity?.toFixed(8) || order.quantity?.toFixed(8)} @ ${limitPrice?.toFixed(4) || 'N/A'}
                                  </div>
                                </div>
                                <div style={{ fontSize: '0.75rem', color: '#9ca3af', textAlign: 'right' }}>
                                  {order.openedAt ? formatDateTime(order.openedAt, openOrders) : 'N/A'}
                                </div>
                              </div>
                              {currentPrice && limitPrice && priceDiff !== null && (
                                <div style={{ fontSize: '0.75rem', color: '#9ca3af', padding: '0.5rem', background: 'rgba(0, 0, 0, 0.2)', borderRadius: '4px' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                                    <span>Limit Price:</span>
                                    <span style={{ fontWeight: '600' }}>${limitPrice.toFixed(4)}</span>
                                  </div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                                    <span>Current {order.side === 'buy' ? 'Bid' : 'Ask'}:</span>
                                    <span style={{ fontWeight: '600' }}>${currentPrice.toFixed(4)}</span>
                                  </div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', color: priceDiff > 0.05 ? '#fbbf24' : '#9ca3af' }}>
                                    <span>Price Gap:</span>
                                    <span style={{ fontWeight: '600' }}>
                                      {priceDiff > 0 ? '+' : ''}{priceDiff.toFixed(3)}%
                                      {order.side === 'buy' && priceDiff > 0 && ' (waiting for price drop)'}
                                      {order.side === 'buy' && priceDiff <= 0 && ' (should fill soon)'}
                                    </span>
                                  </div>
                                </div>
                              )}
                              <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                                Order ID: {order.orderId?.substring(0, 8)}...
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Performance Charts */}
            {(navHistory.length > 0 || tradeHistory.length > 0 || Object.keys(priceHistory).length > 0) && (
              <div style={{ marginBottom: '1.5rem' }}>
                <h2 style={{ marginBottom: '1rem' }}>Performance Charts</h2>
                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                  {/* NAV Over Time */}
                  {navHistory.length > 0 && (
                    <div className="card">
                      <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem' }}>NAV Over Time</h3>
                      <ResponsiveContainer width="100%" height={250}>
                        <AreaChart data={navHistory}>
                          <defs>
                            <linearGradient id="navGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#4ade80" stopOpacity={0.3}/>
                              <stop offset="95%" stopColor="#4ade80" stopOpacity={0}/>
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
                            stroke="#4ade80" 
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
                        <ResponsiveContainer width="100%" height={250}>
                          <ComposedChart data={pnlFeesData}>
                            <defs>
                              <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#4ade80" stopOpacity={0.3}/>
                                <stop offset="95%" stopColor="#4ade80" stopOpacity={0}/>
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
                              stroke="#4ade80"
                              style={{ fontSize: '0.75rem' }}
                              label={{ value: 'P&L ($)', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fill: '#4ade80' } }}
                            />
                            <YAxis 
                              yAxisId="right"
                              orientation="right"
                              tickFormatter={(value) => `$${value.toFixed(2)}`}
                              stroke="#fbbf24"
                              style={{ fontSize: '0.75rem' }}
                              label={{ value: 'Fees ($)', angle: 90, position: 'insideRight', style: { textAnchor: 'middle', fill: '#fbbf24' } }}
                            />
                            <Tooltip 
                              contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px', color: '#e0e0e0' }}
                              labelFormatter={(time) => new Date(time).toLocaleString()}
                              formatter={(value: number, name: string) => {
                                if (name === 'pnl') {
                                  const val = typeof value === 'number' ? value : parseFloat(String(value));
                                  return [`$${val.toFixed(2)}`, 'P&L'];
                                }
                                const val = typeof value === 'number' ? value : parseFloat(String(value));
                                return [`$${val.toFixed(4)}`, 'Cumulative Fees'];
                              }}
                            />
                            <Legend 
                              wrapperStyle={{ paddingTop: '1rem' }}
                              formatter={(value) => {
                                if (value === 'pnl') return 'Profit/Loss';
                                if (value === 'fees') return 'Cumulative Fees';
                                return value;
                              }}
                            />
                            <Area 
                              yAxisId="left"
                              type="monotone" 
                              dataKey="pnl" 
                              stroke="#4ade80" 
                              fillOpacity={1}
                              fill="url(#pnlGradient)"
                              strokeWidth={2}
                              name="pnl"
                            />
                            <Line 
                              yAxisId="right"
                              type="monotone" 
                              dataKey="fees" 
                              stroke="#fbbf24" 
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

                  {/* Trading Summary */}
                  {(() => {
                    const summary = calculateTradingSummary();
                    if (summary.totalTrades === 0 && tradeHistory.length === 0) return null;
                    
                    return (
                      <div className="card" style={{ gridColumn: '1 / -1' }}>
                        <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem' }}>📊 Trading Performance Summary</h3>
                        <div style={{ 
                          padding: '1rem', 
                          background: summary.netProfit > 0 
                            ? 'rgba(34, 197, 94, 0.1)' 
                            : summary.netProfit < 0 
                            ? 'rgba(239, 68, 68, 0.1)' 
                            : 'rgba(156, 163, 175, 0.1)',
                          border: `1px solid ${summary.netProfit > 0 
                            ? 'rgba(34, 197, 94, 0.3)' 
                            : summary.netProfit < 0 
                            ? 'rgba(239, 68, 68, 0.3)' 
                            : 'rgba(156, 163, 175, 0.3)'}`,
                          borderRadius: '8px',
                          marginBottom: '1rem'
                        }}>
                          <div style={{ 
                            fontSize: '1.125rem', 
                            fontWeight: '600',
                            color: summary.netProfit > 0 ? '#4ade80' : summary.netProfit < 0 ? '#f5576c' : '#9ca3af',
                            marginBottom: '0.75rem'
                          }}>
                            {summary.summary}
                          </div>
                          
                          {summary.reasons.length > 0 && (
                            <div style={{ marginTop: '1rem' }}>
                              <div style={{ 
                                fontSize: '0.875rem', 
                                fontWeight: '600', 
                                color: '#9ca3af', 
                                marginBottom: '0.5rem',
                                textTransform: 'uppercase',
                                letterSpacing: '0.05em'
                              }}>
                                Key Factors:
                              </div>
                              <ul style={{ 
                                margin: 0, 
                                paddingLeft: '1.5rem',
                                listStyle: 'none'
                              }}>
                                {summary.reasons.map((reason, idx) => (
                                  <li key={idx} style={{ 
                                    marginBottom: '0.5rem',
                                    color: '#e0e0e0',
                                    fontSize: '0.875rem',
                                    lineHeight: '1.6',
                                    position: 'relative',
                                    paddingLeft: '1rem'
                                  }}>
                                    <span style={{ position: 'absolute', left: 0 }}>•</span>
                                    {reason}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                        
                        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: '0.25rem' }}>Realized P&L</div>
                            <div style={{ 
                              fontSize: '1.25rem', 
                              fontWeight: '600',
                              color: summary.realizedPnL > 0 ? '#4ade80' : summary.realizedPnL < 0 ? '#f5576c' : '#9ca3af'
                            }}>
                              {summary.realizedPnL > 0 ? '+' : ''}${summary.realizedPnL.toFixed(2)}
                            </div>
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: '0.25rem' }}>Total Fees</div>
                            <div style={{ fontSize: '1.25rem', fontWeight: '600', color: '#fbbf24' }}>
                              ${summary.totalFees.toFixed(2)}
                            </div>
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: '0.25rem' }}>Net Profit/Loss</div>
                            <div style={{ 
                              fontSize: '1.25rem', 
                              fontWeight: '600',
                              color: summary.netProfit > 0 ? '#4ade80' : summary.netProfit < 0 ? '#f5576c' : '#9ca3af'
                            }}>
                              {summary.netProfit > 0 ? '+' : ''}${summary.netProfit.toFixed(2)}
                            </div>
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: '0.25rem' }}>Win Rate</div>
                            <div style={{ 
                              fontSize: '1.25rem', 
                              fontWeight: '600',
                              color: (summary.winRate ?? 0) >= 50 ? '#4ade80' : '#f5576c'
                            }}>
                              {(summary.winRate ?? 0).toFixed(1)}%
                            </div>
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: '0.25rem' }}>Total Trades</div>
                            <div style={{ fontSize: '1.25rem', fontWeight: '600', color: '#e0e0e0' }}>
                              {summary.totalTrades}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Trade Timeline */}
                  {tradeHistory.length > 0 && (
                    <div className="card">
                      <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem' }}>Trade Timeline</h3>
                      <ResponsiveContainer width="100%" height={250}>
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
                            <ResponsiveContainer width="100%" height={200}>
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
                                      stroke={trade.side === 'buy' ? '#4ade80' : '#f5576c'} 
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
                        <span style={{ color: '#f5576c', fontSize: '0.875rem' }}>Error</span>
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
                      <div style={{ color: '#f5576c', fontSize: '0.875rem' }}>{item.error}</div>
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
        )}
        
        {/* Other tabs */}
        {activeTab === 'signals' && <Signals />}
        {activeTab === 'positions' && <Positions />}
        {activeTab === 'trades' && <Trades />}
        {activeTab === 'alerts' && <Alerts />}
        {activeTab === 'settings' && <Settings />}
        {activeTab === 'backtest' && <Backtest />}
        {activeTab === 'metrics' && <Metrics />}
      </main>
    </div>
  );
}

export default Dashboard;
