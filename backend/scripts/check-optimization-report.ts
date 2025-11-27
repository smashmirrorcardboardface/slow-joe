import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { OptimizationService } from '../src/optimization/optimization.service';
import { LoggerService } from '../src/logger/logger.service';

async function checkLatestReport() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const optimizationService = app.get(OptimizationService);
  const logger = app.get(LoggerService);
  logger.setContext('CheckOptimizationReport');

  try {
    const report = await optimizationService.getLatestReport();
    
    if (!report) {
      console.log('❌ No optimization reports found');
      await app.close();
      return;
    }

    console.log('\n=== LATEST OPTIMIZATION REPORT ===\n');
    console.log('Report ID:', report.id);
    console.log('Run Date:', report.runDate);
    console.log('Status:', report.status);
    
    console.log('\n📊 Metrics Analyzed:');
    if (report.metrics) {
      console.log('  Total Trades (round trips):', report.metrics.totalTrades || 0);
      // Win rate is stored as percentage (0-100), not decimal (0-1)
      const winRate = report.metrics.winRate || 0;
      const winRateDisplay = winRate > 1 ? winRate.toFixed(1) : (winRate * 100).toFixed(1);
      console.log('  Win Rate:', winRateDisplay + '%');
      console.log('  Avg Profit Per Trade: $' + (report.metrics.avgProfitPerTrade || 0).toFixed(4));
      console.log('  Total Profit: $' + (report.metrics.totalProfit || 0).toFixed(2));
      console.log('  Total Fees: $' + (report.metrics.totalFees || 0).toFixed(2));
      console.log('  Trades Per Day:', (report.metrics.tradesPerDay || 0).toFixed(1));
      console.log('  Avg Hold Time:', (report.metrics.avgHoldTimeHours || 0).toFixed(1) + ' hours');
    }

    console.log('\n💡 Recommendations:', report.recommendations?.length || 0);
    if (report.recommendations && report.recommendations.length > 0) {
      report.recommendations.forEach((rec: any, i: number) => {
        console.log(`  ${i + 1}. ${rec.parameter}: ${rec.oldValue} → ${rec.newValue}`);
        console.log(`     Reason: ${rec.reason}`);
        console.log(`     Expected: ${rec.expectedImprovement}`);
      });
    } else {
      console.log('  (No recommendations generated)');
    }

    console.log('\n✅ Applied Changes:', report.appliedChanges?.length || 0);
    if (report.appliedChanges && report.appliedChanges.length > 0) {
      report.appliedChanges.forEach((change: any, i: number) => {
        console.log(`  ${i + 1}. ${change.parameter}: ${change.oldValue} → ${change.newValue}`);
        console.log(`     Reason: ${change.reason}`);
      });
    } else {
      console.log('  (No changes were applied)');
      if (report.recommendations && report.recommendations.length > 0) {
        console.log('  (Recommendations were too conservative or failed validation)');
      }
    }

    console.log('\n');
    await app.close();
  } catch (error: any) {
    console.error('❌ Error checking optimization report:', error.message);
    console.error(error.stack);
    await app.close();
    process.exit(1);
  }
}

checkLatestReport();

