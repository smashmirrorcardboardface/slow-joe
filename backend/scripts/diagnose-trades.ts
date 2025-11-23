import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { StrategyService } from '../src/strategy/strategy.service';
import { MetricsService } from '../src/metrics/metrics.service';
import { SignalsService } from '../src/signals/signals.service';
import { PositionsService } from '../src/positions/positions.service';
import { ExchangeService } from '../src/exchange/exchange.service';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../src/logger/logger.service';

async function diagnose() {
  const app = await NestFactory.createApplicationContext(AppModule);
  
  const strategyService = app.get(StrategyService);
  const metricsService = app.get(MetricsService);
  const signalsService = app.get(SignalsService);
  const positionsService = app.get(PositionsService);
  const exchangeService = app.get(ExchangeService);
  const configService = app.get(ConfigService);
  const logger = app.get(LoggerService);

  console.log('\n=== TRADING DIAGNOSTIC ===\n');

  // 1. Check if strategy is enabled
  const isEnabled = strategyService.isEnabled();
  console.log(`1. Strategy Enabled: ${isEnabled ? '✅ YES' : '❌ NO'}`);

  // 2. Check NAV
  const nav = await metricsService.getNAV();
  const minBalance = parseFloat(configService.get<string>('MIN_BALANCE_USD') || '20');
  console.log(`2. NAV: $${nav.toFixed(2)} (Minimum: $${minBalance.toFixed(2)}) ${nav >= minBalance ? '✅' : '❌'}`);

  // 3. Check universe
  const universe = (configService.get<string>('UNIVERSE') || 'BTC-USD,ETH-USD').split(',').map(s => s.trim());
  console.log(`3. Universe: ${universe.join(', ')}`);

  // 4. Check configuration
  const rsiLow = parseFloat(configService.get<string>('RSI_LOW') || '40');
  const rsiHigh = parseFloat(configService.get<string>('RSI_HIGH') || '70');
  const volatilityPause = parseFloat(configService.get<string>('VOLATILITY_PAUSE_PCT') || '18');
  const cadenceHours = parseInt(configService.get<string>('CADENCE_HOURS') || '6', 10);
  const cooldownCycles = parseInt(configService.get<string>('COOLDOWN_CYCLES') || '2', 10);
  console.log(`4. Configuration:`);
  console.log(`   - RSI Range: ${rsiLow}-${rsiHigh}`);
  console.log(`   - Volatility Pause: ${volatilityPause}%`);
  console.log(`   - Cadence: ${cadenceHours}h`);
  console.log(`   - Cooldown: ${cooldownCycles} cycles`);

  // 5. Check current positions
  const positions = await positionsService.findOpen();
  console.log(`5. Open Positions: ${positions.length}`);
  positions.forEach(p => {
    console.log(`   - ${p.symbol}: ${p.quantity} @ $${p.entryPrice}`);
  });

  // 6. Check latest signals
  console.log(`\n6. Latest Signals:`);
  for (const symbol of universe) {
    try {
      const latestSignal = await signalsService.findLatestBySymbol(symbol);
      if (latestSignal) {
        const indicators = latestSignal.indicators;
        const ema12 = indicators.ema12;
        const ema26 = indicators.ema26;
        const rsi = indicators.rsi;
        const score = indicators.score;
        
        const emaBullish = ema12 > ema26;
        const rsiInRange = rsi >= rsiLow && rsi <= rsiHigh;
        const passesFilter = emaBullish && rsiInRange;
        
        console.log(`\n   ${symbol}:`);
        console.log(`     - EMA12: ${ema12.toFixed(2)}, EMA26: ${ema26.toFixed(2)} ${emaBullish ? '✅' : '❌'}`);
        console.log(`     - RSI: ${rsi.toFixed(2)} (range: ${rsiLow}-${rsiHigh}) ${rsiInRange ? '✅' : '❌'}`);
        console.log(`     - Score: ${score.toFixed(4)}`);
        console.log(`     - Passes Filter: ${passesFilter ? '✅ YES' : '❌ NO'}`);
        console.log(`     - Generated: ${latestSignal.generatedAt.toLocaleString()}`);
        
        // Check volatility
        const interval = `${cadenceHours}h`;
        const ohlcv = await exchangeService.getOHLCV(symbol, interval, 50);
        if (ohlcv.length >= 4) {
          const currentPrice = ohlcv[ohlcv.length - 1].close;
          const price24hAgo = ohlcv[Math.max(0, ohlcv.length - 4)].close;
          const return24h = Math.abs((currentPrice - price24hAgo) / price24hAgo) * 100;
          const volatilityOk = return24h <= volatilityPause;
          console.log(`     - 24h Return: ${return24h.toFixed(2)}% (max: ${volatilityPause}%) ${volatilityOk ? '✅' : '❌'}`);
        }
      } else {
        console.log(`   ${symbol}: ❌ No signals found`);
      }
    } catch (error: any) {
      console.log(`   ${symbol}: ❌ Error - ${error.message}`);
    }
  }

  // 7. Try to evaluate strategy
  console.log(`\n7. Strategy Evaluation:`);
  try {
    const trades = await strategyService.evaluate();
    console.log(`   Trades Generated: ${trades.length}`);
    trades.forEach(t => {
      console.log(`   - ${t.side.toUpperCase()} ${t.quantity} ${t.symbol}`);
    });
  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message}`);
    console.log(`   Stack: ${error.stack}`);
  }

  // 8. Check position sizing
  console.log(`\n8. Position Sizing Test:`);
  for (const symbol of universe) {
    try {
      const ticker = await exchangeService.getTicker(symbol);
      const quantity = await strategyService.calculateSize(nav, ticker.price, symbol);
      console.log(`   ${symbol}: Price $${ticker.price.toFixed(2)} -> Quantity: ${quantity > 0 ? quantity.toFixed(8) : '0 (too small)'}`);
    } catch (error: any) {
      console.log(`   ${symbol}: ❌ Error - ${error.message}`);
    }
  }

  console.log('\n=== END DIAGNOSTIC ===\n');
  
  await app.close();
}

diagnose().catch(console.error);

