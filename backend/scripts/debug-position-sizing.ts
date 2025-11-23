import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { StrategyService } from '../src/strategy/strategy.service';
import { ExchangeService } from '../src/exchange/exchange.service';
import { MetricsService } from '../src/metrics/metrics.service';
import { SettingsService } from '../src/settings/settings.service';

async function debugPositionSizing() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const strategyService = app.get(StrategyService);
  const exchangeService = app.get(ExchangeService);
  const metricsService = app.get(MetricsService);
  const settingsService = app.get(SettingsService);

  console.log('\n=== POSITION SIZING DEBUG ===\n');

  // Get current NAV
  const nav = await metricsService.getNAV();
  console.log(`Current NAV: $${nav.toFixed(2)}`);

  // Get settings
  const maxAllocFraction = await settingsService.getSettingNumber('MAX_ALLOC_FRACTION');
  const minOrderUsd = await settingsService.getSettingNumber('MIN_ORDER_USD');
  console.log(`MAX_ALLOC_FRACTION: ${maxAllocFraction} (${(maxAllocFraction * 100).toFixed(0)}%)`);
  console.log(`MIN_ORDER_USD: $${minOrderUsd}`);

  // Calculate allocation
  const alloc = nav * maxAllocFraction;
  console.log(`\nAllocation (NAV * MAX_ALLOC_FRACTION): $${alloc.toFixed(2)}`);
  console.log(`Is allocation >= MIN_ORDER_USD? ${alloc >= minOrderUsd ? '✅ YES' : '❌ NO'}`);

  if (alloc < minOrderUsd) {
    console.log(`\n❌ PROBLEM: Allocation ($${alloc.toFixed(2)}) is below MIN_ORDER_USD ($${minOrderUsd})`);
    console.log(`   This means: NAV * ${maxAllocFraction} < ${minOrderUsd}`);
    console.log(`   Required NAV: $${(minOrderUsd / maxAllocFraction).toFixed(2)}`);
    console.log(`   Current NAV: $${nav.toFixed(2)}`);
    console.log(`   Shortfall: $${((minOrderUsd / maxAllocFraction) - nav).toFixed(2)}`);
  } else {
    console.log(`\n✅ Allocation is sufficient. Testing position sizing for each symbol...\n`);

    // Get universe
    const universeStr = await settingsService.getSetting('UNIVERSE');
    const universe = universeStr.split(',').map(s => s.trim());

    for (const symbol of universe) {
      try {
        const ticker = await exchangeService.getTicker(symbol);
        const lotInfo = await exchangeService.getLotSizeInfo(symbol);
        
        console.log(`\n${symbol}:`);
        console.log(`  Price: $${ticker.price.toFixed(2)}`);
        console.log(`  Lot Info:`, lotInfo);
        
        // Calculate raw quantity
        const rawQty = alloc / ticker.price;
        console.log(`  Raw Quantity: ${rawQty.toFixed(8)}`);
        
        // Round to lot size
        const roundedQty = await exchangeService.roundToLotSize(symbol, rawQty);
        console.log(`  Rounded Quantity: ${roundedQty.toFixed(8)}`);
        
        // Check minimum order size
        if (roundedQty < lotInfo.minOrderSize) {
          console.log(`  ❌ Rounded quantity (${roundedQty.toFixed(8)}) < minOrderSize (${lotInfo.minOrderSize})`);
        } else {
          console.log(`  ✅ Rounded quantity >= minOrderSize`);
        }
        
        // Check order value
        const orderValueUsd = roundedQty * ticker.price;
        console.log(`  Order Value: $${orderValueUsd.toFixed(2)}`);
        
        if (orderValueUsd < minOrderUsd) {
          console.log(`  ❌ Order value ($${orderValueUsd.toFixed(2)}) < MIN_ORDER_USD ($${minOrderUsd})`);
        } else {
          console.log(`  ✅ Order value >= MIN_ORDER_USD`);
        }
        
        // Final result
        const finalQty = await strategyService.calculateSize(nav, ticker.price, symbol);
        console.log(`  Final Quantity: ${finalQty > 0 ? finalQty.toFixed(8) : '0 (rejected)'}`);
      } catch (error: any) {
        console.log(`  ❌ Error: ${error.message}`);
      }
    }
  }

  console.log('\n=== END DEBUG ===\n');
  
  await app.close();
}

debugPositionSizing().catch(console.error);

