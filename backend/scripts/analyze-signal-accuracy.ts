import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { SignalsService } from '../src/signals/signals.service';
import { PositionsService } from '../src/positions/positions.service';
import { TradesService } from '../src/trades/trades.service';
import { SettingsService } from '../src/settings/settings.service';
import { ExchangeService } from '../src/exchange/exchange.service';
import { MetricsService } from '../src/metrics/metrics.service';
import { ConfigService } from '@nestjs/config';
import { getBotId } from '../src/common/utils/bot.utils';

async function analyzeSignalAccuracy() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const signalsService = app.get(SignalsService);
  const positionsService = app.get(PositionsService);
  const tradesService = app.get(TradesService);
  const settingsService = app.get(SettingsService);
  const exchangeService = app.get(ExchangeService);
  const metricsService = app.get(MetricsService);
  const configService = app.get(ConfigService);

  const botId = getBotId(configService);

  console.log('\n🔍 SIGNAL ACCURACY ANALYSIS\n');

  // Get all closed positions with their P&L
  const allPositions = await positionsService.findAll();
  const closedPositions = allPositions.filter(p => p.status === 'closed').slice(-20); // Last 20 closed positions

  console.log(`📊 Analyzing ${closedPositions.length} closed positions:\n`);

  if (closedPositions.length === 0) {
    console.log('   No closed positions to analyze yet.');
    await app.close();
    return;
  }

  // For each closed position, get the signal that was active when we bought
  const analysis: Array<{
    symbol: string;
    entryDate: Date;
    exitDate: Date | null;
    entryPrice: number;
    exitPrice: number | null;
    pnl: number;
    pnlPct: number;
    signalScore: number | null;
    signalRSI: number | null;
    signalEMARatio: number | null;
    rankAtEntry: number | null;
    allSignalsAtEntry: Array<{ symbol: string; score: number }>;
  }> = [];

  for (const pos of closedPositions) {
    try {
      // Get signal that was active when position was opened
      const entryDate = pos.openedAt;
      const entryPrice = parseFloat(pos.entryPrice);
      
      // Find signal generated closest to entry date (before or at entry)
      const allSignals = await signalsService.findLatest(pos.symbol, 50);
      const entrySignal = allSignals.find(s => 
        s.generatedAt <= entryDate && 
        s.generatedAt >= new Date(entryDate.getTime() - 24 * 60 * 60 * 1000) // Within 24h before entry
      ) || allSignals[0]; // Fallback to latest if none found

      // Get all signals from around entry time to see ranking
      const universeStr = await settingsService.getSetting('UNIVERSE');
      const universe = universeStr.split(',').map(s => s.trim());
      
      const allSignalsAtEntry: Array<{ symbol: string; score: number }> = [];
      for (const symbol of universe) {
        const symbolSignals = await signalsService.findLatest(symbol, 10);
        const signalAtEntry = symbolSignals.find(s => 
          s.generatedAt <= entryDate && 
          s.generatedAt >= new Date(entryDate.getTime() - 24 * 60 * 60 * 1000)
        ) || symbolSignals[0];
        
        if (signalAtEntry && signalAtEntry.indicators) {
          allSignalsAtEntry.push({
            symbol,
            score: signalAtEntry.indicators.score || 0,
          });
        }
      }
      
      // Sort by score to get ranking
      allSignalsAtEntry.sort((a, b) => b.score - a.score);
      const rankAtEntry = allSignalsAtEntry.findIndex(s => s.symbol === pos.symbol) + 1;

      // Calculate exit price from sell trades
      const sellTrades = await tradesService.findBySymbol(pos.symbol, 100);
      const relevantSells = sellTrades.filter(t => 
        t.side === 'sell' && 
        new Date(t.createdAt) >= entryDate &&
        (pos.closedAt ? new Date(t.createdAt) <= pos.closedAt : true)
      );
      
      let exitPrice: number | null = null;
      if (relevantSells.length > 0) {
        const totalSellValue = relevantSells.reduce((sum, t) => sum + (parseFloat(t.quantity) * parseFloat(t.price)), 0);
        const totalSellQty = relevantSells.reduce((sum, t) => sum + parseFloat(t.quantity), 0);
        exitPrice = totalSellQty > 0 ? totalSellValue / totalSellQty : null;
      }

      const quantity = parseFloat(pos.quantity);
      const entryValue = quantity * entryPrice;
      const exitValue = exitPrice ? quantity * exitPrice : entryValue;
      const pnl = exitValue - entryValue;
      const pnlPct = (pnl / entryValue) * 100;

      const emaRatio = entrySignal?.indicators?.ema12 && entrySignal?.indicators?.ema26
        ? entrySignal.indicators.ema12 / entrySignal.indicators.ema26
        : null;

      analysis.push({
        symbol: pos.symbol,
        entryDate,
        exitDate: pos.closedAt,
        entryPrice,
        exitPrice,
        pnl,
        pnlPct,
        signalScore: entrySignal?.indicators?.score || null,
        signalRSI: entrySignal?.indicators?.rsi || null,
        signalEMARatio: emaRatio,
        rankAtEntry,
        allSignalsAtEntry,
      });
    } catch (error: any) {
      console.error(`Error analyzing position ${pos.symbol}:`, error.message);
    }
  }

  // Display results
  console.log('📈 Position Performance vs Signal Quality:\n');
  console.log('Symbol      | Entry Date    | Score | Rank | RSI  | EMA%  | P&L%   | Result');
  console.log('------------|---------------|-------|------|------|-------|--------|----------');

  let totalPnl = 0;
  let wins = 0;
  let losses = 0;
  const scoreRanges: { [key: string]: { wins: number; losses: number; totalPnl: number } } = {};

  for (const a of analysis) {
    const result = a.pnlPct > 0 ? '✅ WIN' : a.pnlPct < 0 ? '❌ LOSS' : '➖ BREAK';
    const entryDateStr = a.entryDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const scoreStr = a.signalScore !== null ? a.signalScore.toFixed(3) : 'N/A';
    const rankStr = a.rankAtEntry !== null ? `#${a.rankAtEntry}` : 'N/A';
    const rsiStr = a.signalRSI !== null ? a.signalRSI.toFixed(1) : 'N/A';
    const emaStr = a.signalEMARatio !== null ? ((a.signalEMARatio - 1) * 100).toFixed(3) : 'N/A';
    const pnlStr = `${a.pnlPct >= 0 ? '+' : ''}${a.pnlPct.toFixed(2)}%`;

    console.log(`${a.symbol.padEnd(11)} | ${entryDateStr.padEnd(13)} | ${scoreStr.padEnd(5)} | ${rankStr.padEnd(4)} | ${rsiStr.padEnd(4)} | ${emaStr.padEnd(5)} | ${pnlStr.padEnd(6)} | ${result}`);

    totalPnl += a.pnl;
    if (a.pnlPct > 0) wins++;
    if (a.pnlPct < 0) losses++;

    // Group by score range
    if (a.signalScore !== null) {
      const range = a.signalScore >= 1.15 ? '1.15+' : 
                   a.signalScore >= 1.10 ? '1.10-1.15' :
                   a.signalScore >= 1.05 ? '1.05-1.10' :
                   a.signalScore >= 1.00 ? '1.00-1.05' : '<1.00';
      
      if (!scoreRanges[range]) {
        scoreRanges[range] = { wins: 0, losses: 0, totalPnl: 0 };
      }
      if (a.pnlPct > 0) scoreRanges[range].wins++;
      if (a.pnlPct < 0) scoreRanges[range].losses++;
      scoreRanges[range].totalPnl += a.pnl;
    }
  }

  console.log('\n');
  console.log('📊 Summary Statistics:');
  console.log(`   Total Positions: ${analysis.length}`);
  console.log(`   Wins: ${wins} (${((wins / analysis.length) * 100).toFixed(1)}%)`);
  console.log(`   Losses: ${losses} (${((losses / analysis.length) * 100).toFixed(1)}%)`);
  console.log(`   Total P&L: $${totalPnl.toFixed(2)}`);
  console.log(`   Average P&L: $${(totalPnl / analysis.length).toFixed(2)}`);

  console.log('\n📈 Performance by Signal Score Range:');
  for (const [range, stats] of Object.entries(scoreRanges).sort()) {
    const total = stats.wins + stats.losses;
    const winRate = total > 0 ? (stats.wins / total * 100).toFixed(1) : '0.0';
    console.log(`   ${range.padEnd(10)}: ${stats.wins}W/${stats.losses}L (${winRate}% win rate) | P&L: $${stats.totalPnl.toFixed(2)}`);
  }

  // Check current signals vs what we should be buying
  console.log('\n🔍 Current Signal Analysis:\n');
  
  const universeStr = await settingsService.getSetting('UNIVERSE');
  const universe = universeStr.split(',').map(s => s.trim());
  
  const currentSignals = [];
  for (const symbol of universe) {
    try {
      const signal = await signalsService.findLatestBySymbol(symbol);
      if (signal && signal.indicators) {
        const emaRatio = signal.indicators.ema12 / signal.indicators.ema26;
        currentSignals.push({
          symbol,
          score: signal.indicators.score || 0,
          rsi: signal.indicators.rsi || 0,
          emaRatio: (emaRatio - 1) * 100,
          ema12: signal.indicators.ema12,
          ema26: signal.indicators.ema26,
          generatedAt: signal.generatedAt,
        });
      }
    } catch (e) {
      // Skip
    }
  }

  currentSignals.sort((a, b) => b.score - a.score);

  console.log('Current Top Signals:');
  console.log('Rank | Symbol    | Score  | RSI  | EMA%   | Signal Age');
  console.log('-----|-----------|--------|------|--------|------------');
  for (let i = 0; i < Math.min(10, currentSignals.length); i++) {
    const s = currentSignals[i];
    const ageHours = (Date.now() - s.generatedAt.getTime()) / (1000 * 60 * 60);
    const ageStr = ageHours < 1 ? `${(ageHours * 60).toFixed(0)}m` : `${ageHours.toFixed(1)}h`;
    console.log(`${(i + 1).toString().padStart(4)} | ${s.symbol.padEnd(9)} | ${s.score.toFixed(3).padStart(6)} | ${s.rsi.toFixed(1).padStart(4)} | ${s.emaRatio.toFixed(4).padStart(6)} | ${ageStr}`);
  }

  // Check if top signals match historical winners
  console.log('\n💡 Insights:');
  const avgWinScore = analysis.filter(a => a.pnlPct > 0 && a.signalScore !== null)
    .reduce((sum, a) => sum + (a.signalScore || 0), 0) / wins;
  const avgLossScore = analysis.filter(a => a.pnlPct < 0 && a.signalScore !== null)
    .reduce((sum, a) => sum + (a.signalScore || 0), 0) / losses;

  if (wins > 0 && losses > 0) {
    console.log(`   Average winning signal score: ${avgWinScore.toFixed(3)}`);
    console.log(`   Average losing signal score: ${avgLossScore.toFixed(3)}`);
    console.log(`   Score difference: ${(avgWinScore - avgLossScore).toFixed(3)} ${avgWinScore > avgLossScore ? '(✅ Good separation)' : '(⚠️ Poor separation)'}`);
  }

  const topRankWins = analysis.filter(a => a.rankAtEntry !== null && a.rankAtEntry <= 3 && a.pnlPct > 0).length;
  const topRankTotal = analysis.filter(a => a.rankAtEntry !== null && a.rankAtEntry <= 3).length;
  if (topRankTotal > 0) {
    console.log(`   Top 3 ranked positions: ${topRankWins}/${topRankTotal} wins (${(topRankWins / topRankTotal * 100).toFixed(1)}% win rate)`);
  }

  await app.close();
}

analyzeSignalAccuracy().catch(console.error);

