import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../settings/settings.service';
import { TradesService } from '../trades/trades.service';
import { PositionsService } from '../positions/positions.service';
import { MetricsService } from '../metrics/metrics.service';
import { LoggerService } from '../logger/logger.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OptimizationReport } from '../entities/optimization-report.entity';
import { getBotId } from '../common/utils/bot.utils';

interface TradingMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgProfitPerTrade: number;
  totalProfit: number;
  totalFees: number;
  roi: number;
  avgHoldTimeHours: number;
  maxProfit: number;
  maxLoss: number;
  tradesPerDay: number;
}

interface ParameterRange {
  min: number;
  max: number;
  step: number;
  current: number;
}

interface OptimizationResult {
  parameter: string;
  oldValue: string;
  newValue: string;
  expectedImprovement: string;
  reason: string;
}

@Injectable()
export class OptimizationService {
  constructor(
    private settingsService: SettingsService,
    private tradesService: TradesService,
    private positionsService: PositionsService,
    private metricsService: MetricsService,
    private logger: LoggerService,
    private configService: ConfigService,
    @InjectRepository(OptimizationReport)
    private reportRepository: Repository<OptimizationReport>,
  ) {
    this.logger.setContext('OptimizationService');
  }

  /**
   * Run nightly optimization analysis
   */
  async runOptimization(): Promise<OptimizationReport> {
    this.logger.log('Starting nightly optimization analysis');
    
    const startTime = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Analyze yesterday's trading performance
    const metrics = await this.analyzeTradingPerformance(yesterday, today);
    
    // Get current settings
    const currentSettings = await this.settingsService.getStrategySettings();
    
    // Generate optimization recommendations
    const recommendations = await this.generateRecommendations(metrics, currentSettings);
    
    // Apply safe optimizations automatically
    const appliedChanges = await this.applyOptimizations(recommendations);
    
    // Create report
    const report = this.reportRepository.create({
      runDate: startTime,
      metrics: metrics as any,
      currentSettings: currentSettings as any,
      recommendations: recommendations as any,
      appliedChanges: appliedChanges as any,
      status: 'completed',
    });
    
    const savedReport = await this.reportRepository.save(report);
    
    this.logger.log('Optimization analysis completed', {
      reportId: savedReport.id,
      recommendationsCount: recommendations.length,
      appliedChangesCount: appliedChanges.length,
    });
    
    return savedReport;
  }

  /**
   * Analyze trading performance for a date range
   */
  private async analyzeTradingPerformance(startDate: Date, endDate: Date): Promise<TradingMetrics> {
    const botId = getBotId(this.configService);
    const allTrades = await this.tradesService.findAll(10000);
    
    // Filter trades by date range (use createdAt as proxy for execution time)
    const periodTrades = allTrades.filter(trade => {
      const tradeDate = trade.createdAt;
      return tradeDate >= startDate && tradeDate < endDate;
    });

    // Sort ALL trades by time to properly match buys with sells (FIFO)
    // We need all trades because a position might have been bought before the period
    // but sold during the period - we need to match it correctly
    const sortedTrades = [...allTrades].sort((a, b) => 
      a.createdAt.getTime() - b.createdAt.getTime()
    );

    // Use FIFO matching like the metrics service
    const buyPositions: Array<{ symbol: string; quantity: number; price: number; fee: number; time: Date }> = [];
    const tradeProfits: number[] = [];

    for (const trade of sortedTrades) {
      const symbol = trade.symbol;
      const side = trade.side;
      const quantity = parseFloat(trade.quantity);
      const price = parseFloat(trade.price);
      const fee = parseFloat(trade.fee || '0');
      const tradeTime = trade.createdAt;

      if (side === 'buy') {
        // Add to buy positions (FIFO - add to end)
        buyPositions.push({ symbol, quantity, price, fee, time: tradeTime });
      } else if (side === 'sell') {
        // Only count profits from sells that happened within the analysis period
        const sellInPeriod = tradeTime >= startDate && tradeTime < endDate;
        
        // Match sell with buys in FIFO order (match from beginning)
        let remainingQuantity = quantity;
        let totalBuyCost = 0;
        let matchedQuantity = 0;
        const matchedBuys: Array<{ price: number; qty: number; fee: number }> = [];

        for (let i = 0; i < buyPositions.length && remainingQuantity > 0; i++) {
          const buy = buyPositions[i];
          if (buy.symbol === symbol) {
            const matched = Math.min(remainingQuantity, buy.quantity);
            const matchedCost = matched * buy.price + (matched / buy.quantity) * buy.fee; // Proportional fee
            const matchedFee = (matched / buy.quantity) * buy.fee;
            totalBuyCost += matchedCost;
            matchedQuantity += matched;
            remainingQuantity -= matched;
            
            // Track matched buys for logging
            matchedBuys.push({ price: buy.price, qty: matched, fee: matchedFee });
            
            buy.quantity -= matched;

            if (buy.quantity <= 0) {
              buyPositions.splice(i, 1);
              i--;
            }
          }
        }

        // Only count profit if the sell happened within the analysis period
        if (matchedQuantity > 0 && sellInPeriod) {
          const sellRevenue = matchedQuantity * price - fee;
          const profit = sellRevenue - totalBuyCost;
          tradeProfits.push(profit);
          
          // Log for debugging
          const profitStr = profit >= 0 ? `+$${profit.toFixed(4)}` : `-$${Math.abs(profit).toFixed(4)}`;
          const buyDetails = matchedBuys.map(b => `${b.qty} @ $${b.price.toFixed(2)}`).join(' + ');
          const totalFees = matchedBuys.reduce((sum, b) => sum + b.fee, 0) + fee;
          this.logger.log(`Round trip: ${symbol} - Profit: ${profitStr} | Buy: ${buyDetails} → Sell: ${matchedQuantity} @ $${price.toFixed(2)} | Total fees: $${totalFees.toFixed(4)}`);
        }
      }
    }

    const winningTrades = tradeProfits.filter(p => p > 0);
    const losingTrades = tradeProfits.filter(p => p < 0);
    const totalProfit = tradeProfits.reduce((sum, p) => sum + p, 0);
    const totalFees = periodTrades.reduce((sum, t) => sum + parseFloat(t.fee || '0'), 0);
    
    // avgProfitPerTrade should be profit per completed round trip (buy/sell pair)
    // totalTrades should also count completed round trips, not individual trades
    const completedRoundTrips = tradeProfits.length;
    const avgProfitPerTrade = completedRoundTrips > 0 ? totalProfit / completedRoundTrips : 0;
    const winRate = completedRoundTrips > 0 ? (winningTrades.length / completedRoundTrips) * 100 : 0;

    // Calculate average hold time from positions
    const positions = await this.positionsService.findOpenByBot(botId);
    const closedPositions = await this.positionsService.findAllByBot(botId);
    const allPositions = [...positions, ...closedPositions.filter(p => p.closedAt)];
    const holdTimes = allPositions
      .filter(p => p.closedAt)
      .map(p => {
        const opened = p.openedAt.getTime();
        const closed = p.closedAt!.getTime();
        return (closed - opened) / (1000 * 60 * 60); // hours
      });
    const avgHoldTimeHours = holdTimes.length > 0 
      ? holdTimes.reduce((sum, h) => sum + h, 0) / holdTimes.length 
      : 6;

    const maxProfit = tradeProfits.length > 0 ? Math.max(...tradeProfits, 0) : 0;
    const maxLoss = tradeProfits.length > 0 ? Math.min(...tradeProfits, 0) : 0;

    // Get NAV for ROI calculation
    const navHistory = await this.metricsService.findHistory('NAV', 100);
    const startNav = navHistory.length > 0 ? navHistory[navHistory.length - 1].value : 0;
    const endNav = navHistory.length > 0 ? navHistory[0].value : 0;
    const roi = startNav > 0 ? ((endNav - startNav) / startNav) * 100 : 0;

    // Count individual trades for tradesPerDay (buy + sell orders)
    const tradesPerDay = periodTrades.length;
    // But totalTrades should be completed round trips for consistency with avgProfitPerTrade
    const totalCompletedTrades = completedRoundTrips;

    return {
      totalTrades: totalCompletedTrades, // Completed round trips, not individual orders
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate,
      avgProfitPerTrade,
      totalProfit,
      totalFees,
      roi,
      avgHoldTimeHours,
      maxProfit,
      maxLoss,
      tradesPerDay, // Individual buy/sell orders per day
    };
  }

  /**
   * Generate optimization recommendations based on metrics
   */
  private async generateRecommendations(
    metrics: TradingMetrics,
    currentSettings: any,
  ): Promise<OptimizationResult[]> {
    const recommendations: OptimizationResult[] = [];

    // 1. If win rate is low (< 40%) and fees are high, increase MIN_PROFIT_PCT
    if (metrics.winRate < 40 && metrics.totalFees > metrics.totalProfit * 0.3) {
      const currentMinProfit = currentSettings.minProfitPct;
      const suggestedMinProfit = Math.min(currentMinProfit + 1, 8); // Cap at 8%
      if (suggestedMinProfit > currentMinProfit) {
        recommendations.push({
          parameter: 'MIN_PROFIT_PCT',
          oldValue: currentMinProfit.toString(),
          newValue: suggestedMinProfit.toString(),
          expectedImprovement: 'Higher profit threshold should reduce losing trades and fee drag',
          reason: `Win rate is ${metrics.winRate.toFixed(1)}% and fees are ${((metrics.totalFees / Math.max(metrics.totalProfit, 0.01)) * 100).toFixed(1)}% of profits`,
        });
      }
    }

    // 2. If trading too frequently (high trades per day), increase hold periods
    if (metrics.tradesPerDay > 5) {
      const currentCooldown = currentSettings.cooldownCycles;
      const suggestedCooldown = Math.min(currentCooldown + 1, 5); // Cap at 5 cycles
      if (suggestedCooldown > currentCooldown) {
        recommendations.push({
          parameter: 'COOLDOWN_CYCLES',
          oldValue: currentCooldown.toString(),
          newValue: suggestedCooldown.toString(),
          expectedImprovement: 'Longer cooldown reduces trading frequency and fees',
          reason: `Trading ${metrics.tradesPerDay.toFixed(1)} times per day is too frequent`,
        });
      }
    }

    // 3. If average profit is very low, increase MIN_PROFIT_PCT more aggressively
    if (metrics.avgProfitPerTrade < 0.01 && metrics.totalTrades > 10) {
      const currentMinProfit = currentSettings.minProfitPct;
      const suggestedMinProfit = Math.min(currentMinProfit + 2, 10); // Cap at 10%
      if (suggestedMinProfit > currentMinProfit) {
        recommendations.push({
          parameter: 'MIN_PROFIT_PCT',
          oldValue: currentMinProfit.toString(),
          newValue: suggestedMinProfit.toString(),
          expectedImprovement: 'Higher threshold needed to overcome fees and make meaningful profits',
          reason: `Average profit per trade is only $${metrics.avgProfitPerTrade.toFixed(4)}`,
        });
      }
    }

    // 4. If win rate is good (> 50%) but profits are low, might need to let winners run longer
    // This is handled by code changes (minHoldCycles), but we can suggest MAX_POSITIONS reduction
    if (metrics.winRate > 50 && metrics.avgProfitPerTrade < 0.05) {
      const currentMaxPositions = currentSettings.maxPositions;
      if (currentMaxPositions > 2) {
        recommendations.push({
          parameter: 'MAX_POSITIONS',
          oldValue: currentMaxPositions.toString(),
          newValue: (currentMaxPositions - 1).toString(),
          expectedImprovement: 'Fewer positions allows larger allocations and better profit per trade',
          reason: `Win rate is good (${metrics.winRate.toFixed(1)}%) but profits are small - need larger positions`,
        });
      }
    }

    // 5. If losing trades are large, tighten stop-loss
    if (metrics.maxLoss < -0.5 && Math.abs(metrics.maxLoss) > metrics.maxProfit) {
      const currentMaxLoss = currentSettings.maxLossPct;
      const suggestedMaxLoss = Math.max(currentMaxLoss - 0.5, 1.0); // Don't go below 1%
      if (suggestedMaxLoss < currentMaxLoss) {
        recommendations.push({
          parameter: 'MAX_LOSS_PCT',
          oldValue: currentMaxLoss.toString(),
          newValue: suggestedMaxLoss.toString(),
          expectedImprovement: 'Tighter stop-loss limits maximum losses',
          reason: `Maximum loss ($${metrics.maxLoss.toFixed(2)}) exceeds maximum profit ($${metrics.maxProfit.toFixed(2)})`,
        });
      }
    }

    // 6. If fees are very high relative to profits, suggest reducing MAX_POSITIONS
    if (metrics.totalFees > metrics.totalProfit * 0.5 && metrics.totalTrades > 5) {
      const currentMaxPositions = currentSettings.maxPositions;
      if (currentMaxPositions > 2) {
        recommendations.push({
          parameter: 'MAX_POSITIONS',
          oldValue: currentMaxPositions.toString(),
          newValue: (currentMaxPositions - 1).toString(),
          expectedImprovement: 'Fewer positions = fewer trades = lower fees',
          reason: `Fees ($${metrics.totalFees.toFixed(2)}) are ${((metrics.totalFees / Math.max(metrics.totalProfit, 0.01)) * 100).toFixed(1)}% of profits`,
        });
      }
    }

    return recommendations;
  }

  /**
   * Apply optimizations (only safe, conservative changes)
   */
  private async applyOptimizations(recommendations: OptimizationResult[]): Promise<OptimizationResult[]> {
    const applied: OptimizationResult[] = [];

    for (const rec of recommendations) {
      try {
        // Only apply conservative changes (small increments)
        const oldValue = parseFloat(rec.oldValue);
        const newValue = parseFloat(rec.newValue);
        const change = Math.abs(newValue - oldValue) / Math.max(oldValue, 1); // Avoid division by zero
        
        // For integer settings (like COOLDOWN_CYCLES, MAX_POSITIONS), allow +1/-1 changes
        // For percentage/float settings, use 50% threshold
        const isIntegerSetting = rec.parameter.includes('CYCLES') || 
                                 rec.parameter.includes('POSITIONS') ||
                                 rec.parameter.includes('HOURS');
        
        const absoluteChange = Math.abs(newValue - oldValue);
        const shouldApply = isIntegerSetting 
          ? absoluteChange <= 1  // Allow +1/-1 for integer settings
          : change <= 0.5;        // 50% threshold for float settings

        if (shouldApply) {
          await this.settingsService.updateSetting(rec.parameter, rec.newValue);
          applied.push(rec);
          this.logger.log(`Applied optimization: ${rec.parameter}`, {
            oldValue: rec.oldValue,
            newValue: rec.newValue,
            reason: rec.reason,
          });
        } else {
          this.logger.warn(`Skipping optimization - change too large`, {
            parameter: rec.parameter,
            oldValue: rec.oldValue,
            newValue: rec.newValue,
            changePercent: (change * 100).toFixed(1),
            absoluteChange,
            isIntegerSetting,
          });
        }
      } catch (error: any) {
        this.logger.error(`Failed to apply optimization: ${rec.parameter}`, error.stack, {
          parameter: rec.parameter,
          error: error.message,
        });
      }
    }

    return applied;
  }

  /**
   * Get latest optimization report
   */
  async getLatestReport(): Promise<OptimizationReport | null> {
    return this.reportRepository.findOne({
      where: {},
      order: { runDate: 'DESC' },
    });
  }

  /**
   * Get all optimization reports
   */
  async getAllReports(limit: number = 30): Promise<OptimizationReport[]> {
    return this.reportRepository.find({
      order: { runDate: 'DESC' },
      take: limit,
    });
  }
}

