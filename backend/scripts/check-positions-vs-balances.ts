import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PositionsService } from '../src/positions/positions.service';
import { ExchangeService } from '../src/exchange/exchange.service';
import { SettingsService } from '../src/settings/settings.service';
import { ConfigService } from '@nestjs/config';
import { getBotId } from '../src/common/utils/bot.utils';

async function checkPositionsVsBalances() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const positionsService = app.get(PositionsService);
  const exchangeService = app.get(ExchangeService);
  const settingsService = app.get(SettingsService);
  const configService = app.get(ConfigService);

  try {
    const botId = getBotId(configService);
    
    console.log('🔍 Comparing Bot Positions vs Exchange Balances\n');
    
    // Get UNIVERSE
    const universeStr = await settingsService.getSetting('UNIVERSE');
    const universe = universeStr.split(',').map(s => s.trim());
    console.log(`📊 UNIVERSE: ${universe.join(', ')}\n`);
    
    // Get bot positions
    const botPositions = await positionsService.findOpenByBot(botId);
    console.log(`📈 Bot Positions (${botPositions.length}):`);
    for (const pos of botPositions) {
      try {
        const ticker = await exchangeService.getTicker(pos.symbol);
        const currentValue = parseFloat(pos.quantity) * ticker.price;
        console.log(`   ${pos.symbol}: ${pos.quantity} @ $${parseFloat(pos.entryPrice).toFixed(4)} = $${currentValue.toFixed(2)}`);
      } catch (error: any) {
        console.log(`   ${pos.symbol}: ${pos.quantity} @ $${parseFloat(pos.entryPrice).toFixed(4)} (ticker error)`);
      }
    }
    console.log('');
    
    // Get exchange balances
    const allBalances = await exchangeService.getAllBalances();
    console.log(`💰 Exchange Balances:`);
    
    const balancesWithValue: Array<{ asset: string; balance: number; symbol?: string; value?: number }> = [];
    
    for (const [asset, balance] of Object.entries(allBalances)) {
      if (asset === 'USD' || balance <= 0.00001) continue;
      
      // Try to find matching symbol
      let symbol: string | null = null;
      let value = 0;
      
      // Check if it's in universe
      for (const uniSymbol of universe) {
        const baseAsset = uniSymbol.split('-')[0];
        if (baseAsset === asset || baseAsset.toUpperCase() === asset.toUpperCase()) {
          symbol = uniSymbol;
          try {
            const ticker = await exchangeService.getTicker(uniSymbol);
            value = balance * ticker.price;
            break;
          } catch (error: any) {
            // Try with -USD suffix
            try {
              const ticker = await exchangeService.getTicker(`${asset}-USD`);
              value = balance * ticker.price;
              symbol = `${asset}-USD`;
              break;
            } catch (e: any) {
              // Skip if we can't get price
            }
          }
        }
      }
      
      // If not in universe, try to get price anyway
      if (!symbol) {
        try {
          const ticker = await exchangeService.getTicker(`${asset}-USD`);
          value = balance * ticker.price;
          symbol = `${asset}-USD`;
        } catch (error: any) {
          // Can't get price, skip
        }
      }
      
      if (symbol) {
        balancesWithValue.push({ asset, balance, symbol, value });
        const inUniverse = universe.includes(symbol);
        const hasPosition = botPositions.some(p => p.symbol === symbol);
        const status = hasPosition ? '✅' : inUniverse ? '⚠️' : '❌';
        console.log(`   ${status} ${asset}: ${balance.toFixed(8)} → ${symbol} = $${value.toFixed(2)} ${!hasPosition && inUniverse ? '(not in bot DB)' : !inUniverse ? '(not in UNIVERSE)' : ''}`);
      } else {
        console.log(`   ❓ ${asset}: ${balance.toFixed(8)} (no matching symbol found)`);
      }
    }
    
    // Check USD balance
    const usdBalance = allBalances['USD'] || 0;
    console.log(`\n   💵 USD: $${usdBalance.toFixed(2)}`);
    
    // Calculate totals
    let botTotal = 0;
    for (const pos of botPositions) {
      try {
        const ticker = await exchangeService.getTicker(pos.symbol);
        botTotal += parseFloat(pos.quantity) * ticker.price;
      } catch {
        botTotal += parseFloat(pos.quantity) * parseFloat(pos.entryPrice);
      }
    }
    
    const exchangeTotal = balancesWithValue.reduce((sum, b) => sum + (b.value || 0), 0) + usdBalance;
    
    console.log(`\n📊 Summary:`);
    console.log(`   Bot NAV (positions only): $${botTotal.toFixed(2)}`);
    console.log(`   Exchange Total: $${exchangeTotal.toFixed(2)}`);
    console.log(`   Difference: $${(exchangeTotal - botTotal).toFixed(2)}`);
    
    // Find missing positions
    const missingPositions = balancesWithValue.filter(b => 
      b.value && b.value > 1 && !botPositions.some(p => p.symbol === b.symbol)
    );
    
    if (missingPositions.length > 0) {
      console.log(`\n⚠️  Missing Positions (on exchange but not in bot DB):`);
      for (const missing of missingPositions) {
        const inUniverse = universe.includes(missing.symbol || '');
        console.log(`   ${missing.symbol}: $${missing.value?.toFixed(2)} ${!inUniverse ? '(NOT IN UNIVERSE - bot won\'t track this)' : '(should be created by reconciliation)'}`);
      }
    }
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }

  await app.close();
}

checkPositionsVsBalances().catch(console.error);

