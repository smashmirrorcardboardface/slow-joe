import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { StrategyService } from '../src/strategy/strategy.service';
import { JobsService } from '../src/jobs/jobs.service';
import { ExchangeService } from '../src/exchange/exchange.service';
import { LoggerService } from '../src/logger/logger.service';

async function triggerStrategyEvaluate() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const strategyService = app.get(StrategyService);
  const jobsService = app.get(JobsService);
  const exchangeService = app.get(ExchangeService);
  const logger = app.get(LoggerService);
  logger.setContext('TriggerStrategyEvaluate');

  console.log('\n=== MANUAL STRATEGY EVALUATION ===\n');

  try {
    // Check if strategy is enabled
    if (!strategyService.isEnabled()) {
      console.log('❌ Strategy is disabled. Enable it first.');
      await app.close();
      return;
    }

    console.log('✅ Strategy is enabled\n');

    // Get trades from strategy evaluation
    console.log('Evaluating strategy...');
    const trades = await strategyService.evaluate();

    if (trades.length === 0) {
      console.log('ℹ️  No trades needed at this time.');
      console.log('   This could mean:');
      console.log('   - No signals pass the entry filters');
      console.log('   - All target assets are already in positions');
      console.log('   - Symbols are in cooldown period');
      console.log('   - NAV is too low for minimum order size');
      await app.close();
      return;
    }

    console.log(`\n✅ Generated ${trades.length} trade(s):\n`);
    
    for (const trade of trades) {
      try {
        const ticker = await exchangeService.getTicker(trade.symbol);
        const orderPrice = trade.side === 'buy' ? ticker.ask : ticker.bid;
        const orderValue = trade.quantity * orderPrice;
        
        console.log(`  ${trade.side.toUpperCase()} ${trade.quantity.toFixed(8)} ${trade.symbol}`);
        console.log(`    Price: $${orderPrice.toFixed(2)}`);
        console.log(`    Value: $${orderValue.toFixed(2)}`);
        
        // Enqueue the order execution job
        await jobsService.enqueueOrderExecute(
          trade.symbol,
          trade.side,
          trade.quantity,
          orderPrice,
        );
        
        console.log(`    ✅ Order execution job enqueued\n`);
      } catch (error: any) {
        console.log(`    ❌ Error enqueueing order: ${error.message}\n`);
      }
    }

    console.log('✅ Strategy evaluation complete!');
    console.log('   Order execution jobs have been enqueued.');
    console.log('   Check the logs or database to see if orders are executed.\n');
  } catch (error: any) {
    console.error('❌ Error during strategy evaluation:', error.message);
    console.error(error.stack);
  }

  await app.close();
}

triggerStrategyEvaluate().catch(console.error);

