import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { JobsService } from '../src/jobs/jobs.service';
import { ExchangeService } from '../src/exchange/exchange.service';
import { PositionsService } from '../src/positions/positions.service';
import { LoggerService } from '../src/logger/logger.service';

async function triggerReconcile() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const jobsService = app.get(JobsService);
  const exchangeService = app.get(ExchangeService);
  const positionsService = app.get(PositionsService);
  const logger = app.get(LoggerService);
  logger.setContext('TriggerReconcile');

  console.log('\n=== MANUAL RECONCILIATION ===\n');

  try {
    // First, show current state
    console.log('📊 Current Database Positions:');
    const dbPositions = await positionsService.findOpen();
    if (dbPositions.length === 0) {
      console.log('   No open positions in database\n');
    } else {
      for (const pos of dbPositions) {
        console.log(`   ${pos.symbol}: ${pos.quantity} (entry: $${pos.entryPrice})`);
      }
      console.log('');
    }

    // Check what Kraken actually has
    console.log('🔍 Checking Kraken Balances:');
    const allBalances = await exchangeService.getAllBalances();
    
    const relevantAssets = ['DOGE', 'XRP', 'XDG', 'XXDG', 'XXRP', 'AVAX', 'BTC', 'ETH', 'SOL', 'ADA', 'DOT', 'LINK'];
    let foundRelevant = false;
    
    for (const [asset, balance] of Object.entries(allBalances)) {
      if (relevantAssets.includes(asset) || relevantAssets.some(a => asset.toUpperCase().includes(a))) {
        // getAllBalances returns numbers, not Balance objects
        const total = typeof balance === 'number' ? balance : 0;
        
        if (total > 0.0001) {
          foundRelevant = true;
          console.log(`   ${asset}: ${total}`);
        }
      }
    }
    
    if (!foundRelevant) {
      console.log('   No relevant asset balances found on Kraken\n');
    } else {
      console.log('');
    }

    // Check for DOGE/XRP specifically using getBalance (which returns free/locked)
    console.log('🔍 Checking DOGE/XRP specifically (free vs locked):');
    try {
      const dogeBalance = await exchangeService.getBalance('DOGE');
      console.log(`   DOGE: ${dogeBalance.free} free, ${dogeBalance.locked} locked, total: ${dogeBalance.free + dogeBalance.locked}`);
    } catch (e: any) {
      try {
        const xdgBalance = await exchangeService.getBalance('XDG');
        console.log(`   XDG: ${xdgBalance.free} free, ${xdgBalance.locked} locked, total: ${xdgBalance.free + xdgBalance.locked}`);
      } catch (e2: any) {
        console.log(`   Could not get DOGE balance: ${e.message}`);
      }
    }
    
    try {
      const xrpBalance = await exchangeService.getBalance('XRP');
      console.log(`   XRP: ${xrpBalance.free} free, ${xrpBalance.locked} locked, total: ${xrpBalance.free + xrpBalance.locked}`);
    } catch (e: any) {
      try {
        const xxrpBalance = await exchangeService.getBalance('XXRP');
        console.log(`   XXRP: ${xxrpBalance.free} free, ${xxrpBalance.locked} locked, total: ${xxrpBalance.free + xxrpBalance.locked}`);
      } catch (e2: any) {
        console.log(`   Could not get XRP balance: ${e.message}`);
      }
    }
    console.log('');

    // Trigger reconciliation
    console.log('🔄 Triggering reconciliation job...');
    await jobsService.enqueueReconcile();
    console.log('✅ Reconciliation job enqueued!');
    console.log('   It will:');
    console.log('   - Sync positions from exchange balances');
    console.log('   - Close positions that don\'t exist on exchange');
    console.log('   - Update NAV');
    console.log('   - Check for stale orders\n');
    
    console.log('⏳ Waiting 5 seconds for reconciliation to process...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Check positions again
    console.log('\n📊 Positions After Reconciliation:');
    const positionsAfter = await positionsService.findOpen();
    if (positionsAfter.length === 0) {
      console.log('   ✅ No open positions (all closed or none exist)\n');
    } else {
      for (const pos of positionsAfter) {
        console.log(`   ${pos.symbol}: ${pos.quantity} (entry: $${pos.entryPrice})`);
      }
      console.log('');
    }

    // If positions still exist after reconciliation, offer to close them manually
    const finalPositions = await positionsService.findOpen();
    if (finalPositions.length > 0) {
      console.log('⚠️  Some positions still exist after reconciliation.');
      console.log('   If Kraken shows no positions, you may want to close these manually.\n');
      
      // Check if balances are actually zero or very small
      for (const pos of finalPositions) {
        try {
          const baseAsset = pos.symbol.split('-')[0];
          const balance = await exchangeService.getBalance(baseAsset);
          const totalBalance = balance.free + balance.locked;
          
          if (totalBalance < 0.0001) {
            console.log(`   Closing ${pos.symbol} - balance is effectively zero`);
            await positionsService.closePosition(pos.id);
          } else if (balance.free < 0.0001 && balance.locked > 0) {
            console.log(`   ⚠️  ${pos.symbol}: Balance is locked (${balance.locked}), free: ${balance.free}`);
            console.log(`      This might be from a pending order. Position kept open.`);
          } else {
            console.log(`   ✓ ${pos.symbol}: Balance exists (${totalBalance}), position kept open.`);
          }
        } catch (e: any) {
          console.log(`   ⚠️  Could not check balance for ${pos.symbol}: ${e.message}`);
        }
      }
      console.log('');
    }

    console.log('✅ Reconciliation complete!\n');
  } catch (error: any) {
    console.error('❌ Error during reconciliation:', error.message);
    console.error(error.stack);
  }

  await app.close();
}

triggerReconcile().catch(console.error);

