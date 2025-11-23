import { Controller, Get, Post, UseGuards, Header, Query } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { PositionsService } from '../positions/positions.service';
import { TradesService } from '../trades/trades.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JobsService } from '../jobs/jobs.service';
import { HealthService } from '../health/health.service';
import { RealtimeService } from '../realtime/realtime.service';

@Controller('api/metrics')
export class MetricsController {
  constructor(
    private metricsService: MetricsService,
    private positionsService: PositionsService,
    private tradesService: TradesService,
    private jobsService: JobsService,
    private healthService: HealthService,
    private realtimeService: RealtimeService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async getMetrics() {
    const nav = await this.metricsService.getNAV();
    const totalFees = await this.metricsService.getTotalFees();
    const positions = await this.positionsService.findOpen();
    const recentTrades = await this.tradesService.findAll(10);
    
    // Calculate P&L (simplified - would need current prices for accurate P&L)
    let totalPnL = 0;
    for (const pos of positions) {
      // For now, P&L is 0 until we have current prices
      // This will be improved when we add current price fetching
      totalPnL += 0;
    }

    return {
      nav,
      totalPnL,
      totalFees,
      positions: positions.length,
      recentTrades: recentTrades.length,
      // Include actual data for dashboard display
      openPositions: positions.map(p => ({
        id: p.id,
        symbol: p.symbol,
        quantity: p.quantity,
        entryPrice: p.entryPrice,
        openedAt: p.openedAt,
      })),
      recentTradesList: recentTrades.map(t => ({
        id: t.id,
        symbol: t.symbol,
        side: t.side,
        quantity: t.quantity,
        price: t.price,
        fee: t.fee,
        createdAt: t.createdAt,
      })),
    };

    // Broadcast metrics update
    this.realtimeService.broadcastMetrics({
      nav,
      totalPnL,
      totalFees,
      positions: positions.length,
      recentTrades: recentTrades.length,
      openPositions: positions.map(p => ({
        id: p.id,
        symbol: p.symbol,
        quantity: p.quantity,
        entryPrice: p.entryPrice,
        openedAt: p.openedAt,
      })),
      recentTradesList: recentTrades.map(t => ({
        id: t.id,
        symbol: t.symbol,
        side: t.side,
        quantity: t.quantity,
        price: t.price,
        fee: t.fee,
        createdAt: t.createdAt,
      })),
    });

    return {
      nav,
      totalPnL,
      totalFees,
      positions: positions.length,
      recentTrades: recentTrades.length,
      openPositions: positions.map(p => ({
        id: p.id,
        symbol: p.symbol,
        quantity: p.quantity,
        entryPrice: p.entryPrice,
        openedAt: p.openedAt,
      })),
      recentTradesList: recentTrades.map(t => ({
        id: t.id,
        symbol: t.symbol,
        side: t.side,
        quantity: t.quantity,
        price: t.price,
        fee: t.fee,
        createdAt: t.createdAt,
      })),
    };
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
