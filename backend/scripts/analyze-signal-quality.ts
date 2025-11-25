import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { SignalsService } from '../src/signals/signals.service';
import { TradesService } from '../src/trades/trades.service';
import { PositionsService } from '../src/positions/positions.service';
import { LoggerService } from '../src/logger/logger.service';

interface SignalAnalysis {
  symbol: string;
  signalTime: Date;
  indicators: {
    ema12: number;
    ema26: number;
    rsi: number;
    score: number;
  };
  tradeTime?: Date;
  buyPrice?: number;
  sellPrice?: number;
  pnl?: number;
  pnlPct?: number;
  outcome: 'win' | 'loss' | 'open' | 'no_trade';
}

async function analyzeSignalQuality() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const signalsService = app.get(SignalsService);
  const tradesService = app.get(TradesService);
  const positionsService = app.get(PositionsService);
  const logger = app.get(LoggerService);
  logger.setContext('AnalyzeSignalQuality');

  console.log('\n=== SIGNAL QUALITY ANALYSIS ===\n');

  try {
    // Get all signals
    const allSignals = await signalsService.findAll(10000);
    console.log(`Found ${allSignals.length} signals\n`);

    // Get all trades
    const allTrades = await tradesService.findAll(10000);
    console.log(`Found ${allTrades.length} trades\n`);

    // Get open positions
    const openPositions = await positionsService.findOpen();
    console.log(`Found ${openPositions.length} open positions\n`);

    // Match signals to trades
    const analysis: SignalAnalysis[] = [];

    for (const signal of allSignals) {
      const signalTime = signal.generatedAt;
      const symbol = signal.symbol;
      const indicators = signal.indicators as any;

      // Find buy trade after this signal (within 6 hours to account for cadence)
      const buyTrade = allTrades.find(
        (t) =>
          t.symbol === symbol &&
          t.side === 'buy' &&
          t.createdAt >= signalTime &&
          t.createdAt.getTime() - signalTime.getTime() < 6 * 60 * 60 * 1000, // 6 hours (cadence is 2h, so allow up to 3 cadences)
      );

      if (!buyTrade) {
        // Check if there's an open position
        const openPos = openPositions.find((p) => p.symbol === symbol);
        if (openPos) {
          analysis.push({
            symbol,
            signalTime,
            indicators,
            outcome: 'open',
          });
        } else {
          analysis.push({
            symbol,
            signalTime,
            indicators,
            outcome: 'no_trade',
          });
        }
        continue;
      }

      // Find corresponding sell trade (FIFO matching)
      const buyPrice = parseFloat(buyTrade.price);
      const buyTime = buyTrade.createdAt;

      // Find sell trades for this symbol after buy
      const sellTrades = allTrades
        .filter(
          (t) =>
            t.symbol === symbol &&
            t.side === 'sell' &&
            t.createdAt > buyTime,
        )
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

      // Match quantity (simplified - just use first sell)
      if (sellTrades.length > 0) {
        const sellTrade = sellTrades[0];
        const sellPrice = parseFloat(sellTrade.price);
        const buyQuantity = parseFloat(buyTrade.quantity);
        const sellQuantity = parseFloat(sellTrade.quantity);
        const matchedQuantity = Math.min(buyQuantity, sellQuantity);

        const pnl = (sellPrice - buyPrice) * matchedQuantity;
        const pnlPct = ((sellPrice - buyPrice) / buyPrice) * 100;

        analysis.push({
          symbol,
          signalTime,
          indicators,
          tradeTime: buyTime,
          buyPrice,
          sellPrice,
          pnl,
          pnlPct,
          outcome: pnl > 0 ? 'win' : 'loss',
        });
      } else {
        // Check if position is still open
        const openPos = openPositions.find((p) => p.symbol === symbol);
        if (openPos) {
          analysis.push({
            symbol,
            signalTime,
            indicators,
            tradeTime: buyTime,
            buyPrice,
            outcome: 'open',
          });
        }
      }
    }

    // Analyze results
    const wins = analysis.filter((a) => a.outcome === 'win');
    const losses = analysis.filter((a) => a.outcome === 'loss');
    const open = analysis.filter((a) => a.outcome === 'open');
    const noTrade = analysis.filter((a) => a.outcome === 'no_trade');

    console.log('=== SUMMARY ===');
    console.log(`Total signals: ${analysis.length}`);
    console.log(`Wins: ${wins.length} (${((wins.length / analysis.length) * 100).toFixed(1)}%)`);
    console.log(`Losses: ${losses.length} (${((losses.length / analysis.length) * 100).toFixed(1)}%)`);
    console.log(`Open: ${open.length} (${((open.length / analysis.length) * 100).toFixed(1)}%)`);
    console.log(`No trade: ${noTrade.length} (${((noTrade.length / analysis.length) * 100).toFixed(1)}%)\n`);

    if (wins.length > 0 && losses.length > 0) {
      // Analyze indicators for wins vs losses
      const avgWinScore = wins.reduce((sum, w) => sum + (w.indicators?.score || 0), 0) / wins.length;
      const avgLossScore = losses.reduce((sum, l) => sum + (l.indicators?.score || 0), 0) / losses.length;

      const avgWinRSI = wins.reduce((sum, w) => sum + (w.indicators?.rsi || 0), 0) / wins.length;
      const avgLossRSI = losses.reduce((sum, l) => sum + (l.indicators?.rsi || 0), 0) / losses.length;

      const avgWinEMARatio = wins.reduce((sum, w) => {
        const ratio = w.indicators?.ema12 && w.indicators?.ema26 ? w.indicators.ema12 / w.indicators.ema26 : 1;
        return sum + ratio;
      }, 0) / wins.length;
      const avgLossEMARatio = losses.reduce((sum, l) => {
        const ratio = l.indicators?.ema12 && l.indicators?.ema26 ? l.indicators.ema12 / l.indicators.ema26 : 1;
        return sum + ratio;
      }, 0) / losses.length;

      console.log('=== INDICATOR ANALYSIS ===');
      console.log(`Average Score:`);
      console.log(`  Wins: ${avgWinScore.toFixed(4)}`);
      console.log(`  Losses: ${avgLossScore.toFixed(4)}`);
      console.log(`  Difference: ${(avgWinScore - avgLossScore).toFixed(4)} (${((avgWinScore - avgLossScore) / avgLossScore * 100).toFixed(1)}% higher)\n`);

      console.log(`Average RSI:`);
      console.log(`  Wins: ${avgWinRSI.toFixed(2)}`);
      console.log(`  Losses: ${avgLossRSI.toFixed(2)}`);
      console.log(`  Difference: ${(avgWinRSI - avgLossRSI).toFixed(2)} points\n`);

      console.log(`Average EMA Ratio (EMA12/EMA26):`);
      console.log(`  Wins: ${avgWinEMARatio.toFixed(4)}`);
      console.log(`  Losses: ${avgLossEMARatio.toFixed(4)}`);
      console.log(`  Difference: ${(avgWinEMARatio - avgLossEMARatio).toFixed(4)} (${((avgWinEMARatio - avgLossEMARatio) / avgLossEMARatio * 100).toFixed(1)}% higher)\n`);

      // Find optimal thresholds
      const allTraded = [...wins, ...losses];
      const sortedByScore = [...allTraded].sort((a, b) => (b.indicators?.score || 0) - (a.indicators?.score || 0));
      const top50Percent = sortedByScore.slice(0, Math.floor(sortedByScore.length * 0.5));
      const top50Wins = top50Percent.filter((t) => t.outcome === 'win').length;
      const top50WinRate = (top50Wins / top50Percent.length) * 100;

      const bottom50Percent = sortedByScore.slice(Math.floor(sortedByScore.length * 0.5));
      const bottom50Wins = bottom50Percent.filter((t) => t.outcome === 'win').length;
      const bottom50WinRate = (bottom50Wins / bottom50Percent.length) * 100;

      console.log('=== THRESHOLD ANALYSIS ===');
      console.log(`Top 50% by score:`);
      console.log(`  Win rate: ${top50WinRate.toFixed(1)}%`);
      console.log(`Bottom 50% by score:`);
      console.log(`  Win rate: ${bottom50WinRate.toFixed(1)}%\n`);

      // RSI distribution
      const winRSIs = wins.map((w) => w.indicators?.rsi || 0).filter((r) => r > 0);
      const lossRSIs = losses.map((l) => l.indicators?.rsi || 0).filter((r) => r > 0);

      if (winRSIs.length > 0 && lossRSIs.length > 0) {
        const winRSIRanges = {
          '35-45': winRSIs.filter((r) => r >= 35 && r < 45).length,
          '45-55': winRSIs.filter((r) => r >= 45 && r < 55).length,
          '55-65': winRSIs.filter((r) => r >= 55 && r < 65).length,
          '65-75': winRSIs.filter((r) => r >= 65 && r <= 75).length,
        };

        const lossRSIRanges = {
          '35-45': lossRSIs.filter((r) => r >= 35 && r < 45).length,
          '45-55': lossRSIs.filter((r) => r >= 45 && r < 55).length,
          '55-65': lossRSIs.filter((r) => r >= 55 && r < 65).length,
          '65-75': lossRSIs.filter((r) => r >= 65 && r <= 75).length,
        };

        console.log('=== RSI DISTRIBUTION ===');
        console.log('Wins by RSI range:');
        Object.entries(winRSIRanges).forEach(([range, count]) => {
          console.log(`  ${range}: ${count}`);
        });
        console.log('Losses by RSI range:');
        Object.entries(lossRSIRanges).forEach(([range, count]) => {
          console.log(`  ${range}: ${count}`);
        });
        console.log('');
      }

      // Show worst performing signals
      const sortedByPnl = [...losses].sort((a, b) => (a.pnlPct || 0) - (b.pnlPct || 0));
      console.log('=== WORST PERFORMING SIGNALS ===');
      sortedByPnl.slice(0, 5).forEach((sig, i) => {
        console.log(`${i + 1}. ${sig.symbol}: ${sig.pnlPct?.toFixed(2)}% loss`);
        console.log(`   Score: ${sig.indicators?.score.toFixed(4)}, RSI: ${sig.indicators?.rsi.toFixed(2)}, EMA Ratio: ${(sig.indicators?.ema12 / sig.indicators?.ema26).toFixed(4)}`);
        console.log(`   Buy: $${sig.buyPrice?.toFixed(4)}, Sell: $${sig.sellPrice?.toFixed(4)}`);
      });
      console.log('');

      // Show best performing signals
      const sortedByPnlWin = [...wins].sort((a, b) => (b.pnlPct || 0) - (a.pnlPct || 0));
      console.log('=== BEST PERFORMING SIGNALS ===');
      sortedByPnlWin.slice(0, 5).forEach((sig, i) => {
        console.log(`${i + 1}. ${sig.symbol}: ${sig.pnlPct?.toFixed(2)}% gain`);
        console.log(`   Score: ${sig.indicators?.score.toFixed(4)}, RSI: ${sig.indicators?.rsi.toFixed(2)}, EMA Ratio: ${(sig.indicators?.ema12 / sig.indicators?.ema26).toFixed(4)}`);
        console.log(`   Buy: $${sig.buyPrice?.toFixed(4)}, Sell: $${sig.sellPrice?.toFixed(4)}`);
      });
      console.log('');
    }

    console.log('✅ Analysis complete!\n');
  } catch (error: any) {
    console.error('❌ Error during analysis:', error.message);
    console.error(error.stack);
  }

  await app.close();
}

analyzeSignalQuality().catch(console.error);

