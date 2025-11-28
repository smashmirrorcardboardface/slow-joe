import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { SignalsService } from '../src/signals/signals.service';
import { SettingsService } from '../src/settings/settings.service';
import { ExchangeService, OHLCV } from '../src/exchange/exchange.service';
import { StrategyService } from '../src/strategy/strategy.service';
import { EMA, RSI } from 'technicalindicators';

// Old scoring function (replicated from previous version)
function computeOldScore(candles: OHLCV[]): { score: number; ema12: number; ema26: number; rsi: number; emaRatio: number } {
  const closes = candles.map((c) => c.close);
  
  const ema12Values = EMA.calculate({ period: 12, values: closes });
  const ema26Values = EMA.calculate({ period: 26, values: closes });
  const rsiValues = RSI.calculate({ period: 14, values: closes });

  const ema12 = ema12Values[ema12Values.length - 1];
  const ema26 = ema26Values[ema26Values.length - 1];
  const rsi = rsiValues[rsiValues.length - 1] ?? 50;

  const emaRatio = ema12 / ema26;
  
  // Old EMA scoring
  let emaScore = 1.0;
  if (emaRatio >= 1.001 && emaRatio <= 1.002) {
    emaScore = 1.05;
  } else if (emaRatio > 1.002 && emaRatio <= 1.003) {
    emaScore = 1.02;
  } else if (emaRatio > 1.003) {
    emaScore = 0.95;
  } else {
    emaScore = 0.90;
  }
  
  // Old RSI scoring
  let rsiScore = 1.0;
  if (rsi >= 55 && rsi <= 65) {
    rsiScore = 1.15;
  } else if (rsi >= 50 && rsi < 55) {
    rsiScore = 1.05;
  } else if (rsi >= 45 && rsi < 50) {
    rsiScore = 0.90;
  } else {
    rsiScore = 0.85;
  }
  
  const score = emaScore * rsiScore;
  return { score, ema12, ema26, rsi, emaRatio };
}

async function compareScoring() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const signalsService = app.get(SignalsService);
  const settingsService = app.get(SettingsService);
  const exchangeService = app.get(ExchangeService);
  const strategyService = app.get(StrategyService);

  console.log('\n📊 SCORING COMPARISON: OLD vs NEW\n');

  const universeStr = await settingsService.getSetting('UNIVERSE');
  const universe = universeStr.split(',').map(s => s.trim());
  const cadenceHours = await settingsService.getSettingInt('CADENCE_HOURS');
  const interval = `${cadenceHours}h`;

  const comparisons: Array<{
    symbol: string;
    oldScore: number;
    newScore: number;
    scoreDiff: number;
    scoreDiffPct: number;
    oldRank: number;
    newRank: number;
    rankChange: number;
    emaRatio: number;
    rsi: number;
    details: {
      oldEMA: number;
      oldRSI: number;
      newEMA: number;
      newRSI: number;
      momentum: number;
      volume: number;
      volatility: number;
      trendConsistency: number;
      pricePosition: number;
    };
  }> = [];

  // Fetch candles and calculate both scores
  for (const symbol of universe) {
    try {
      const ohlcv = await exchangeService.getOHLCV(symbol, interval, 50);
      if (ohlcv.length < 26) continue;

      // Calculate old score
      const oldResult = computeOldScore(ohlcv);
      
      // Calculate new score using the service
      const newResult = await strategyService.computeIndicators(ohlcv);

      comparisons.push({
        symbol,
        oldScore: oldResult.score,
        newScore: newResult.score,
        scoreDiff: newResult.score - oldResult.score,
        scoreDiffPct: ((newResult.score - oldResult.score) / oldResult.score) * 100,
        oldRank: 0, // Will be set after sorting
        newRank: 0, // Will be set after sorting
        rankChange: 0, // Will be calculated
        emaRatio: oldResult.emaRatio,
        rsi: oldResult.rsi,
        details: {
          oldEMA: 0, // Placeholder
          oldRSI: 0, // Placeholder
          newEMA: 0, // Placeholder
          newRSI: 0, // Placeholder
          momentum: 0, // Placeholder
          volume: 0, // Placeholder
          volatility: 0, // Placeholder
          trendConsistency: 0, // Placeholder
          pricePosition: 0, // Placeholder
        },
      });
    } catch (error: any) {
      console.error(`Error processing ${symbol}:`, error.message);
    }
  }

  // Sort by old score and assign ranks
  comparisons.sort((a, b) => b.oldScore - a.oldScore);
  comparisons.forEach((c, i) => {
    c.oldRank = i + 1;
  });

  // Sort by new score and assign ranks
  comparisons.sort((a, b) => b.newScore - a.newScore);
  comparisons.forEach((c, i) => {
    c.newRank = i + 1;
    c.rankChange = c.oldRank - c.newRank; // Positive = moved up, negative = moved down
  });

  // Display results
  console.log('Rank | Symbol    | Old Score | New Score | Change   | Old Rank | New Rank | Rank Δ | EMA%   | RSI');
  console.log('-----|-----------|-----------|-----------|----------|----------|----------|--------|--------|------');

  for (let i = 0; i < comparisons.length; i++) {
    const c = comparisons[i];
    const changeStr = c.scoreDiff >= 0 ? `+${c.scoreDiff.toFixed(3)}` : c.scoreDiff.toFixed(3);
    const changePctStr = c.scoreDiffPct >= 0 ? `+${c.scoreDiffPct.toFixed(1)}%` : `${c.scoreDiffPct.toFixed(1)}%`;
    const rankChangeStr = c.rankChange > 0 ? `+${c.rankChange}` : c.rankChange < 0 ? `${c.rankChange}` : '0';
    const emaRatioPct = ((c.emaRatio - 1) * 100).toFixed(3);
    
    const marker = c.rankChange > 0 ? '↑' : c.rankChange < 0 ? '↓' : '→';
    
    console.log(
      `${(i + 1).toString().padStart(4)} | ${c.symbol.padEnd(9)} | ${c.oldScore.toFixed(3).padStart(9)} | ${c.newScore.toFixed(3).padStart(9)} | ${changeStr.padStart(8)} (${changePctStr.padStart(6)}) | ${c.oldRank.toString().padStart(8)} | ${c.newRank.toString().padStart(8)} | ${rankChangeStr.padStart(6)} ${marker} | ${emaRatioPct.padStart(6)} | ${c.rsi.toFixed(1).padStart(3)}`
    );
  }

  // Summary statistics
  console.log('\n📈 Summary Statistics:\n');
  
  const avgOldScore = comparisons.reduce((sum, c) => sum + c.oldScore, 0) / comparisons.length;
  const avgNewScore = comparisons.reduce((sum, c) => sum + c.newScore, 0) / comparisons.length;
  const avgScoreChange = avgNewScore - avgOldScore;
  const avgScoreChangePct = (avgScoreChange / avgOldScore) * 100;

  console.log(`   Average Old Score: ${avgOldScore.toFixed(3)}`);
  console.log(`   Average New Score: ${avgNewScore.toFixed(3)}`);
  console.log(`   Average Change: ${avgScoreChange >= 0 ? '+' : ''}${avgScoreChange.toFixed(3)} (${avgScoreChangePct >= 0 ? '+' : ''}${avgScoreChangePct.toFixed(1)}%)`);

  const movedUp = comparisons.filter(c => c.rankChange > 0).length;
  const movedDown = comparisons.filter(c => c.rankChange < 0).length;
  const stayedSame = comparisons.filter(c => c.rankChange === 0).length;

  console.log(`\n   Ranking Changes:`);
  console.log(`   - Moved Up: ${movedUp} symbols`);
  console.log(`   - Moved Down: ${movedDown} symbols`);
  console.log(`   - Stayed Same: ${stayedSame} symbols`);

  // Show top 5 changes
  console.log(`\n   Biggest Rank Improvements:`);
  const biggestGains = [...comparisons].sort((a, b) => b.rankChange - a.rankChange).slice(0, 5);
  for (const c of biggestGains) {
    if (c.rankChange > 0) {
      console.log(`      ${c.symbol}: Rank ${c.oldRank} → ${c.newRank} (+${c.rankChange})`);
    }
  }

  console.log(`\n   Biggest Rank Declines:`);
  const biggestLosses = [...comparisons].sort((a, b) => a.rankChange - b.rankChange).slice(0, 5);
  for (const c of biggestLosses) {
    if (c.rankChange < 0) {
      console.log(`      ${c.symbol}: Rank ${c.oldRank} → ${c.newRank} (${c.rankChange})`);
    }
  }

  // Show top 5 by new score
  console.log(`\n🏆 Top 5 Signals (New Scoring):`);
  const top5 = comparisons.slice(0, 5);
  for (let i = 0; i < top5.length; i++) {
    const c = top5[i];
    const rankChangeStr = c.rankChange > 0 ? `↑+${c.rankChange}` : c.rankChange < 0 ? `↓${c.rankChange}` : '→';
    console.log(`   ${i + 1}. ${c.symbol}: Score ${c.newScore.toFixed(3)} (was rank ${c.oldRank}, ${rankChangeStr})`);
  }

  // Show what would have been top 5 with old scoring
  const oldTop5 = [...comparisons].sort((a, b) => b.oldScore - a.oldScore).slice(0, 5);
  console.log(`\n📉 Top 5 Signals (Old Scoring - for comparison):`);
  for (let i = 0; i < oldTop5.length; i++) {
    const c = oldTop5[i];
    const currentNewRank = comparisons.find(comp => comp.symbol === c.symbol)?.newRank || 0;
    const rankChangeStr = currentNewRank < c.oldRank ? `↑+${c.oldRank - currentNewRank}` : currentNewRank > c.oldRank ? `↓${currentNewRank - c.oldRank}` : '→';
    console.log(`   ${i + 1}. ${c.symbol}: Score ${c.oldScore.toFixed(3)} (now rank ${currentNewRank}, ${rankChangeStr})`);
  }

  await app.close();
}

compareScoring().catch(console.error);

