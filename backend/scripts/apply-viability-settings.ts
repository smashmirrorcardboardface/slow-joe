import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { SettingsService } from '../src/settings/settings.service';
import { LoggerService } from '../src/logger/logger.service';

/**
 * Apply aggressive settings to test viability at small scale
 * These settings are designed to:
 * 1. Reduce trading frequency (fewer trades = fewer fees)
 * 2. Increase profit targets (overcome fee drag)
 * 3. Let winners run longer (capture larger moves)
 */
async function applyViabilitySettings() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const settingsService = app.get(SettingsService);
  const logger = app.get(LoggerService);
  logger.setContext('ViabilitySettings');

  console.log('\n=== APPLYING VIABILITY TEST SETTINGS ===\n');
  console.log('These settings are optimized for small-scale testing ($36 NAV)');
  console.log('Goal: Prove profitability before scaling up\n');

  const changes: Array<{ key: string; oldValue: string; newValue: string; reason: string }> = [];

  try {
    // 1. Increase MIN_PROFIT_PCT to 18% (aggressive but necessary)
    // Current: 10% (just increased by optimizer)
    // Rationale: With fees ~0.5% per round trip, we need much higher targets
    // At $36 NAV, a 1% profit is only $0.36, which gets eaten by fees
    // 18% target = $6.48 profit, which can overcome fees and leave meaningful profit
    const currentMinProfit = await settingsService.getSettingNumber('MIN_PROFIT_PCT');
    if (currentMinProfit < 18) {
      await settingsService.updateSetting('MIN_PROFIT_PCT', '18');
      changes.push({
        key: 'MIN_PROFIT_PCT',
        oldValue: currentMinProfit.toString(),
        newValue: '18',
        reason: 'Aggressive profit target needed to overcome fees at small scale. 18% = $6.48 profit on $36 NAV, enough to cover fees and leave meaningful profit.',
      });
    }

    // 2. Increase COOLDOWN_CYCLES to 5 (reduce trading frequency)
    // Current: Likely 2
    // Rationale: 18 trades/day is way too high. With 6h cadence, 5 cycles = 30 hours cooldown
    // This should reduce trading frequency to 2-3 trades/day max
    const currentCooldown = await settingsService.getSettingInt('COOLDOWN_CYCLES');
    if (currentCooldown < 5) {
      await settingsService.updateSetting('COOLDOWN_CYCLES', '5');
      changes.push({
        key: 'COOLDOWN_CYCLES',
        oldValue: currentCooldown.toString(),
        newValue: '5',
        reason: 'Reduce trading frequency. 5 cycles (30 hours) cooldown should cut trades from 18/day to 2-3/day, dramatically reducing fees.',
      });
    }

    // 3. Reduce MAX_POSITIONS to 1 (fewer positions = less trading)
    // Current: 2
    // Rationale: With only $36 NAV, 1 position allows larger allocation per trade
    // Larger positions = larger absolute profits when targets are hit
    // Also reduces total number of trades
    const currentMaxPositions = await settingsService.getSettingInt('MAX_POSITIONS');
    if (currentMaxPositions > 1) {
      await settingsService.updateSetting('MAX_POSITIONS', '1');
      changes.push({
        key: 'MAX_POSITIONS',
        oldValue: currentMaxPositions.toString(),
        newValue: '1',
        reason: 'At $36 NAV, 1 position allows larger allocation (~$20 vs ~$10 each). Larger positions = larger absolute profits. Also reduces total trades.',
      });
    }

    // 4. Increase MAX_ALLOC_FRACTION to 0.5 (larger positions)
    // Current: Likely 0.2-0.3
    // Rationale: With only 1 position, we can allocate more per trade
    // 50% of $36 = $18 position, which gives us better profit potential
    const currentMaxAlloc = await settingsService.getSettingNumber('MAX_ALLOC_FRACTION');
    if (currentMaxAlloc < 0.5) {
      await settingsService.updateSetting('MAX_ALLOC_FRACTION', '0.5');
      changes.push({
        key: 'MAX_ALLOC_FRACTION',
        oldValue: currentMaxAlloc.toString(),
        newValue: '0.5',
        reason: 'With MAX_POSITIONS=1, allocate 50% per trade ($18 on $36 NAV) for larger absolute profits when targets are hit.',
      });
    }

    // 5. Increase MIN_PROFIT_USD to $1.00 (ensure meaningful profits)
    // Current: Likely $0.15
    // Rationale: At small scale, we need to ensure each profitable trade makes at least $1
    // This prevents tiny profits that get eaten by fees
    const currentMinProfitUsd = await settingsService.getSettingNumber('MIN_PROFIT_USD');
    if (currentMinProfitUsd < 1.0) {
      await settingsService.updateSetting('MIN_PROFIT_USD', '1.00');
      changes.push({
        key: 'MIN_PROFIT_USD',
        oldValue: currentMinProfitUsd.toString(),
        newValue: '1.00',
        reason: 'Ensure each profitable trade makes at least $1.00. Prevents tiny profits ($0.0047) that get eaten by fees.',
      });
    }

    console.log(`\n✅ Applied ${changes.length} setting change(s):\n`);
    changes.forEach((change, i) => {
      console.log(`${i + 1}. ${change.key}: ${change.oldValue} → ${change.newValue}`);
      console.log(`   ${change.reason}\n`);
    });

    if (changes.length === 0) {
      console.log('All settings already at recommended values.\n');
    } else {
      console.log('\n📊 Expected Impact:');
      console.log('  • Trading frequency: 18 trades/day → 2-3 trades/day (85% reduction)');
      console.log('  • Fee reduction: ~$0.52/day → ~$0.08/day (85% reduction)');
      console.log('  • Profit target: 10% → 18% (80% increase)');
      console.log('  • Position size: ~$10 → ~$18 (80% increase)');
      console.log('  • Minimum profit: $0.15 → $1.00 (567% increase)');
      console.log('\n🎯 Goal: Prove profitability with these conservative settings');
      console.log('   If profitable after 1-2 weeks, consider scaling up NAV.\n');
    }

    await app.close();
  } catch (error: any) {
    console.error('❌ Error applying settings:', error.message);
    console.error(error.stack);
    await app.close();
    process.exit(1);
  }
}

applyViabilitySettings();

