import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { OptimizationService } from '../src/optimization/optimization.service';

async function checkOptimizerRecommendations() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const optimizationService = app.get(OptimizationService);

  try {
    console.log('🔍 Checking Latest Optimizer Recommendations\n');
    
    const report = await optimizationService.getLatestReport();
    
    if (!report) {
      console.log('❌ No optimization reports found\n');
      await app.close();
      return;
    }

    const runDate = new Date(report.runDate);
    console.log(`📊 Optimization Report from ${runDate.toLocaleString()}\n`);
    
    // Display metrics
    if (report.metrics) {
      const metrics = report.metrics as any;
      console.log('📈 Trading Metrics Analyzed:');
      console.log(`   Total Trades: ${metrics.totalTrades || 0}`);
      console.log(`   Winning Trades: ${metrics.winningTrades || 0}`);
      console.log(`   Losing Trades: ${metrics.losingTrades || 0}`);
      console.log(`   Win Rate: ${(metrics.winRate || 0).toFixed(2)}%`);
      console.log(`   Total Profit: $${(metrics.totalProfit || 0).toFixed(2)}`);
      console.log(`   Total Fees: $${(metrics.totalFees || 0).toFixed(2)}`);
      console.log(`   Net Profit: $${((metrics.totalProfit || 0) - (metrics.totalFees || 0)).toFixed(2)}`);
      console.log(`   ROI: ${(metrics.roi || 0).toFixed(2)}%`);
      console.log(`   Avg Hold Time: ${(metrics.avgHoldTimeHours || 0).toFixed(1)} hours`);
      console.log(`   Trades Per Day: ${(metrics.tradesPerDay || 0).toFixed(1)}`);
      console.log('');
    }

    // Display current settings
    if (report.currentSettings) {
      const settings = report.currentSettings as any;
      console.log('⚙️  Current Settings:');
      for (const [key, value] of Object.entries(settings)) {
        console.log(`   ${key}: ${value}`);
      }
      console.log('');
    }

    // Display recommendations
    if (report.recommendations && Array.isArray(report.recommendations) && report.recommendations.length > 0) {
      console.log(`💡 Recommendations (${report.recommendations.length}):\n`);
      report.recommendations.forEach((rec: any, index: number) => {
        console.log(`   ${index + 1}. ${rec.parameter}:`);
        console.log(`      Current: ${rec.currentValue}`);
        console.log(`      Recommended: ${rec.newValue}`);
        console.log(`      Reason: ${rec.reason}`);
        console.log(`      Expected Improvement: ${rec.expectedImprovement}`);
        console.log('');
      });
    } else {
      console.log('💡 No recommendations generated\n');
    }

    // Display applied changes
    if (report.appliedChanges && Array.isArray(report.appliedChanges) && report.appliedChanges.length > 0) {
      console.log(`✅ Applied Changes (${report.appliedChanges.length}):\n`);
      report.appliedChanges.forEach((change: any, index: number) => {
        console.log(`   ${index + 1}. ${change.parameter}:`);
        console.log(`      Old: ${change.oldValue}`);
        console.log(`      New: ${change.newValue}`);
        console.log(`      Reason: ${change.reason}`);
        console.log('');
      });
    } else {
      console.log('✅ No changes applied automatically\n');
    }

    console.log(`Status: ${report.status || 'unknown'}\n`);

  } catch (error: any) {
    console.error('❌ Error checking optimizer recommendations:', error.message);
    console.error(error.stack);
  }

  await app.close();
}

checkOptimizerRecommendations().catch(console.error);

