import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { OptimizationService } from '../src/optimization/optimization.service';
import { LoggerService } from '../src/logger/logger.service';

async function triggerOptimization() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const optimizationService = app.get(OptimizationService);
  const logger = app.get(LoggerService);
  logger.setContext('TriggerOptimization');

  console.log('\n=== RUNNING OPTIMIZATION ANALYSIS ===\n');

  try {
    console.log('Starting optimization analysis...');
    const report = await optimizationService.runOptimization();

    console.log('\n✅ Optimization completed!\n');
    console.log('Report ID:', report.id);
    console.log('Run Date:', report.runDate);
    console.log('\nMetrics Analyzed:');
    console.log('  Total Trades (round trips):', report.metrics?.totalTrades || 0);
    console.log('  Win Rate:', (report.metrics?.winRate || 0).toFixed(1) + '%');
    console.log('  Avg Profit Per Trade: $' + (report.metrics?.avgProfitPerTrade || 0).toFixed(4));
    console.log('  Total Profit: $' + (report.metrics?.totalProfit || 0).toFixed(2));
    console.log('  Total Fees: $' + (report.metrics?.totalFees || 0).toFixed(2));
    console.log('  Trades Per Day:', report.metrics?.tradesPerDay || 0);

    console.log('\nRecommendations:', report.recommendations?.length || 0);
    if (report.recommendations && report.recommendations.length > 0) {
      report.recommendations.forEach((rec: any, i: number) => {
        console.log(`  ${i + 1}. ${rec.parameter}: ${rec.oldValue} → ${rec.newValue}`);
        console.log(`     Reason: ${rec.reason}`);
      });
    }

    console.log('\nApplied Changes:', report.appliedChanges?.length || 0);
    if (report.appliedChanges && report.appliedChanges.length > 0) {
      report.appliedChanges.forEach((change: any, i: number) => {
        console.log(`  ${i + 1}. ${change.parameter}: ${change.oldValue} → ${change.newValue}`);
        console.log(`     Reason: ${change.reason}`);
      });
    } else if (report.recommendations && report.recommendations.length > 0) {
      console.log('  (No changes applied - recommendations were too conservative or failed validation)');
    }

    console.log('\n');
    await app.close();
  } catch (error: any) {
    console.error('❌ Error running optimization:', error.message);
    console.error(error.stack);
    await app.close();
    process.exit(1);
  }
}

triggerOptimization();

