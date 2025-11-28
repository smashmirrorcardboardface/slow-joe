import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { SignalsService } from '../src/signals/signals.service';
import { PositionsService } from '../src/positions/positions.service';
import { SettingsService } from '../src/settings/settings.service';
import { ExchangeService } from '../src/exchange/exchange.service';
import { MetricsService } from '../src/metrics/metrics.service';
import { ConfigService } from '@nestjs/config';
import { getBotId } from '../src/common/utils/bot.utils';

async function checkBuySignals() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const signalsService = app.get(SignalsService);
  const positionsService = app.get(PositionsService);
  const settingsService = app.get(SettingsService);
  const exchangeService = app.get(ExchangeService);
  const metricsService = app.get(MetricsService);
  const configService = app.get(ConfigService);

  const botId = getBotId(configService);
  const maxPositions = await settingsService.getSettingInt('MAX_POSITIONS');
  const nav = await metricsService.getNAV();

  console.log('\n📊 CURRENT BUY SIGNALS ANALYSIS\n');
  console.log(`NAV: $${nav.toFixed(2)}`);
  console.log(`MAX_POSITIONS: ${maxPositions}\n`);

  // Get current positions
  const positions = await positionsService.findOpenByBot(botId);
  console.log(`📈 Current Positions (${positions.length}):`);
  if (positions.length === 0) {
    console.log('   No open positions');
  } else {
    for (const pos of positions) {
      try {
        const ticker = await exchangeService.getTicker(pos.symbol);
        const currentPrice = ticker.price;
        const entryPrice = parseFloat(pos.entryPrice);
        const quantity = parseFloat(pos.quantity);
        const currentValue = quantity * currentPrice;
        const entryValue = quantity * entryPrice;
        const pnl = currentValue - entryValue;
        const pnlPct = (pnl / entryValue) * 100;
        console.log(`   ${pos.symbol}: ${quantity.toFixed(8)} @ $${entryPrice.toFixed(4)} → $${currentPrice.toFixed(4)} (${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}, ${pnl >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)`);
      } catch (e) {
        console.log(`   ${pos.symbol}: ${parseFloat(pos.quantity).toFixed(8)} @ $${parseFloat(pos.entryPrice).toFixed(4)} (price fetch failed)`);
      }
    }
  }

  // Get open orders
  const openOrders = await exchangeService.getOpenOrders();
  const pendingBuys = openOrders.filter(o => o.side === 'buy');
  const pendingSells = openOrders.filter(o => o.side === 'sell');
  console.log(`\n📋 Pending Orders:`);
  console.log(`   Buy orders: ${pendingBuys.length}`);
  if (pendingBuys.length > 0) {
    for (const order of pendingBuys) {
      console.log(`      ${order.symbol}: ${order.quantity} @ $${order.price} (${order.status})`);
    }
  }
  console.log(`   Sell orders: ${pendingSells.length}`);
  if (pendingSells.length > 0) {
    for (const order of pendingSells) {
      console.log(`      ${order.symbol}: ${order.quantity} @ $${order.price} (${order.status})`);
    }
  }

  // Get latest signals for all assets
  const universeStr = await settingsService.getSetting('UNIVERSE');
  const universe = universeStr.split(',').map(s => s.trim());
  
  console.log(`\n🔍 Top Signals (Latest):`);
  const signals = [];
  for (const symbol of universe) {
    try {
      const signal = await signalsService.findLatestBySymbol(symbol);
      if (signal && signal.indicators) {
        signals.push({
          symbol,
          ...signal.indicators,
          generatedAt: signal.generatedAt,
        });
      }
    } catch (e) {
      // Skip if no signal
    }
  }

  // Sort by score
  signals.sort((a, b) => (b.score || 0) - (a.score || 0));

  // Filter out held positions
  const heldSymbols = new Set(positions.map(p => p.symbol));
  const availableSignals = signals.filter(s => !heldSymbols.has(s.symbol));

  const totalPositions = positions.length + pendingBuys.length;
  const availableSlots = Math.max(0, maxPositions - totalPositions);

  console.log(`\n   Available Slots: ${availableSlots} (max: ${maxPositions}, current: ${positions.length}, pending buys: ${pendingBuys.length})`);
  console.log(`\n   Top 10 Signals:`);
  for (let i = 0; i < Math.min(10, signals.length); i++) {
    const s = signals[i];
    const isHeld = heldSymbols.has(s.symbol);
    const isAvailable = !isHeld && i < availableSlots + positions.length;
    const marker = isHeld ? '👈 HELD' : isAvailable && i < availableSlots ? '✅ BUY' : '   ';
    const emaRatio = s.ema12 && s.ema26 ? ((s.ema12 / s.ema26) - 1) * 100 : 0;
    console.log(`   ${marker} ${(i + 1).toString().padStart(2)}. ${s.symbol.padEnd(10)} Score: ${(s.score || 0).toFixed(3)} | EMA: ${emaRatio.toFixed(4)}% | RSI: ${(s.rsi || 0).toFixed(1)}`);
  }

  if (availableSlots > 0 && availableSignals.length > 0) {
    console.log(`\n💡 RECOMMENDED BUYS:`);
    const topBuys = availableSignals.slice(0, availableSlots);
    for (const signal of topBuys) {
      try {
        const ticker = await exchangeService.getTicker(signal.symbol);
        console.log(`   ✅ ${signal.symbol}: Score ${(signal.score || 0).toFixed(3)} | Current: $${ticker.price.toFixed(4)}`);
      } catch (e) {
        console.log(`   ✅ ${signal.symbol}: Score ${(signal.score || 0).toFixed(3)}`);
      }
    }
  } else if (availableSlots === 0) {
    console.log(`\n⚠️  No available slots (MAX_POSITIONS=${maxPositions} reached)`);
    if (availableSignals.length > 0) {
      console.log(`\n   Top signals we'd buy if we had slots:`);
      const topBuys = availableSignals.slice(0, 3);
      for (const signal of topBuys) {
        try {
          const ticker = await exchangeService.getTicker(signal.symbol);
          console.log(`      ${signal.symbol}: Score ${(signal.score || 0).toFixed(3)} | Current: $${ticker.price.toFixed(4)}`);
        } catch (e) {
          console.log(`      ${signal.symbol}: Score ${(signal.score || 0).toFixed(3)}`);
        }
      }
    }
  } else {
    console.log(`\n⚠️  No buy signals available`);
  }

  await app.close();
}

checkBuySignals().catch(console.error);

