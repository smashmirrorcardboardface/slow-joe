import { Controller, Get, Post, UseGuards, Header, Query } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { PositionsService } from '../positions/positions.service';
import { TradesService } from '../trades/trades.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JobsService } from '../jobs/jobs.service';
import { HealthService } from '../health/health.service';
import { RealtimeService } from '../realtime/realtime.service';
import { ExchangeService } from '../exchange/exchange.service';

@Controller('api/metrics')
export class MetricsController {
  constructor(
    private metricsService: MetricsService,
    private positionsService: PositionsService,
    private tradesService: TradesService,
    private jobsService: JobsService,
    private healthService: HealthService,
    private realtimeService: RealtimeService,
    private exchangeService: ExchangeService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async getMetrics() {
    const nav = await this.metricsService.getNAV();
    const totalFees = await this.metricsService.getTotalFees();
    const positions = await this.positionsService.findOpen();
    const allTrades = await this.tradesService.findAll(10000);
    const recentTrades = allTrades.slice(0, 10);
    
    // Calculate detailed P&L for open positions
    let unrealizedPnL = 0;
    const positionDetails = [];
    for (const pos of positions) {
      try {
        const ticker = await this.exchangeService.getTicker(pos.symbol);
        const currentPrice = ticker.price;
        const entryPrice = parseFloat(pos.entryPrice);
        const quantity = parseFloat(pos.quantity);
        const positionValue = quantity * currentPrice;
        const entryValue = quantity * entryPrice;
        const profit = positionValue - entryValue;
        const profitPct = entryValue > 0 ? (profit / entryValue) * 100 : 0;
        
        unrealizedPnL += profit;
        positionDetails.push({
          id: pos.id,
          symbol: pos.symbol,
          quantity: pos.quantity,
          entryPrice: pos.entryPrice,
          currentPrice: currentPrice,
          positionValue,
          entryValue,
          profit,
          profitPct,
          openedAt: pos.openedAt,
        });
      } catch (error: any) {
        // If we can't get ticker, use entry price
        const entryPrice = parseFloat(pos.entryPrice);
        const quantity = parseFloat(pos.quantity);
        positionDetails.push({
          id: pos.id,
          symbol: pos.symbol,
          quantity: pos.quantity,
          entryPrice: pos.entryPrice,
          currentPrice: entryPrice,
          positionValue: entryPrice * quantity,
          entryValue: entryPrice * quantity,
          profit: 0,
          profitPct: 0,
          openedAt: pos.openedAt,
        });
      }
    }
    
    // Calculate realized P&L from closed trades (FIFO matching)
    let realizedPnL = 0;
    const buyTrades: Array<{ symbol: string; quantity: number; price: number; time: Date }> = [];
    const closedTrades: Array<{ symbol: string; pnl: number; quantity: number; buyPrice: number; sellPrice: number; time: Date }> = [];
    
    const sortedTrades = [...allTrades].sort((a, b) => 
      a.createdAt.getTime() - b.createdAt.getTime()
    );
    
    for (const trade of sortedTrades) {
      const symbol = trade.symbol;
      const side = trade.side;
      const quantity = parseFloat(trade.quantity);
      const price = parseFloat(trade.price);
      const time = trade.createdAt;
      
      if (side === 'buy') {
        buyTrades.push({ symbol, quantity, price, time });
      } else if (side === 'sell') {
        let remainingQuantity = quantity;
        let totalBuyCost = 0;
        let matchedQuantity = 0;
        let avgBuyPrice = 0;
        
        // Match with buys in FIFO order
        for (let i = 0; i < buyTrades.length && remainingQuantity > 0; i++) {
          const buy = buyTrades[i];
          if (buy.symbol === symbol) {
            const matched = Math.min(remainingQuantity, buy.quantity);
            totalBuyCost += matched * buy.price;
            matchedQuantity += matched;
            remainingQuantity -= matched;
            buy.quantity -= matched;
            
            if (buy.quantity <= 0) {
              buyTrades.splice(i, 1);
              i--;
            }
          }
        }
        
        if (matchedQuantity > 0) {
          avgBuyPrice = totalBuyCost / matchedQuantity;
          const sellValue = matchedQuantity * price;
          const tradePnL = sellValue - totalBuyCost;
          realizedPnL += tradePnL;
          
          closedTrades.push({
            symbol,
            pnl: tradePnL,
            quantity: matchedQuantity,
            buyPrice: avgBuyPrice,
            sellPrice: price,
            time,
          });
        }
      }
    }
    
    const totalPnL = realizedPnL + unrealizedPnL;
    
    // Calculate detailed statistics
    const totalTrades = allTrades.length;
    const buyCount = allTrades.filter(t => t.side === 'buy').length;
    const sellCount = allTrades.filter(t => t.side === 'sell').length;
    const winningTrades = closedTrades.filter(t => t.pnl > 0).length;
    const losingTrades = closedTrades.filter(t => t.pnl < 0).length;
    const winRate = closedTrades.length > 0 ? (winningTrades / closedTrades.length) * 100 : 0;
    
    const avgProfitPerTrade = closedTrades.length > 0 
      ? closedTrades.reduce((sum, t) => sum + t.pnl, 0) / closedTrades.length 
      : 0;
    
    const largestWin = closedTrades.length > 0 
      ? Math.max(...closedTrades.map(t => t.pnl), 0) 
      : 0;
    const largestLoss = closedTrades.length > 0 
      ? Math.min(...closedTrades.map(t => t.pnl), 0) 
      : 0;
    
    // Calculate P&L by symbol
    const pnlBySymbol: { [symbol: string]: { realized: number; unrealized: number; total: number; trades: number } } = {};
    for (const trade of closedTrades) {
      if (!pnlBySymbol[trade.symbol]) {
        pnlBySymbol[trade.symbol] = { realized: 0, unrealized: 0, total: 0, trades: 0 };
      }
      pnlBySymbol[trade.symbol].realized += trade.pnl;
      pnlBySymbol[trade.symbol].trades += 1;
    }
    for (const pos of positionDetails) {
      if (!pnlBySymbol[pos.symbol]) {
        pnlBySymbol[pos.symbol] = { realized: 0, unrealized: 0, total: 0, trades: 0 };
      }
      pnlBySymbol[pos.symbol].unrealized += pos.profit;
    }
    for (const symbol in pnlBySymbol) {
      pnlBySymbol[symbol].total = pnlBySymbol[symbol].realized + pnlBySymbol[symbol].unrealized;
    }
    
    // Calculate ROI (if we have initial NAV)
    const navHistory = await this.metricsService.findHistory('NAV', 1000);
    const initialNav = navHistory.length > 0 ? Math.min(...navHistory.map(m => parseFloat(m.value))) : nav;
    const roi = initialNav > 0 ? ((nav - initialNav) / initialNav) * 100 : 0;
    
    const metrics = {
      nav,
      totalPnL,
      realizedPnL,
      unrealizedPnL,
      totalFees,
      positions: positions.length,
      recentTrades: recentTrades.length,
      totalTrades,
      buyCount,
      sellCount,
      winRate,
      winningTrades,
      losingTrades,
      avgProfitPerTrade,
      largestWin,
      largestLoss,
      roi,
      initialNav,
      openPositions: positionDetails,
      recentTradesList: recentTrades.map(t => ({
        id: t.id,
        symbol: t.symbol,
        side: t.side,
        quantity: t.quantity,
        price: t.price,
        fee: t.fee,
        createdAt: t.createdAt,
      })),
      pnlBySymbol,
      closedTradesCount: closedTrades.length,
    };

    // Broadcast metrics update
    this.realtimeService.broadcastMetrics(metrics);

    return metrics;
  }

  @Post('reconcile')
  @UseGuards(JwtAuthGuard)
  async triggerReconcile() {
    await this.jobsService.enqueueReconcile();
    return { message: 'Reconciliation job enqueued' };
  }

  @Post('trigger-signal-poller')
  @UseGuards(JwtAuthGuard)
  async triggerSignalPoller() {
    await this.jobsService.enqueueSignalPoller();
    return { message: 'Signal poller job enqueued' };
  }

  @Get('history/nav')
  @UseGuards(JwtAuthGuard)
  async getNAVHistory(
    @Query('limit') limit?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 1000;
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;

    const history = await this.metricsService.findHistory('NAV', limitNum, start, end);
    // Return in ascending order for charting (oldest first)
    return history
      .reverse()
      .map((m) => ({
        time: m.createdAt,
        value: parseFloat(m.value),
      }));
  }

  @Get('history')
  @UseGuards(JwtAuthGuard)
  async getMetricsHistory(
    @Query('keys') keys?: string,
    @Query('limit') limit?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const keysArray = keys ? keys.split(',').map(k => k.trim()) : ['NAV'];
    const limitNum = limit ? parseInt(limit, 10) : 1000;
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;

    const history = await this.metricsService.findHistoryByKeys(keysArray, limitNum, start, end);
    
    // Group by key and return in ascending order for charting
    const grouped: { [key: string]: Array<{ time: Date; value: number }> } = {};
    
    for (const key of keysArray) {
      const keyHistory = history
        .filter(m => m.key === key)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((m) => ({
          time: m.createdAt,
          value: parseFloat(m.value),
        }));
      grouped[key] = keyHistory;
    }

    return grouped;
  }

  @Get('history/trades')
  @UseGuards(JwtAuthGuard)
  async getTradeHistory() {
    const trades = await this.tradesService.findAll(100);
    return trades.map((t) => ({
      time: t.createdAt,
      symbol: t.symbol,
      side: t.side,
      price: parseFloat(t.price),
      quantity: parseFloat(t.quantity),
      fee: parseFloat(t.fee || '0'),
      value: parseFloat(t.price) * parseFloat(t.quantity),
    }));
  }

  @Get('prometheus')
  @Header('Content-Type', 'text/plain')
  async getPrometheusMetrics() {
    // Prometheus endpoint - no auth required for monitoring
    return this.healthService.getPrometheusMetrics();
  }
}
