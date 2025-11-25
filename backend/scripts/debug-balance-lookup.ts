import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ExchangeService } from '../src/exchange/exchange.service';
import { PositionsService } from '../src/positions/positions.service';

async function debugBalanceLookup() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const exchangeService = app.get(ExchangeService);
  const positionsService = app.get(PositionsService);

  console.log('\n=== BALANCE LOOKUP DEBUG ===\n');

  try {
    // Get all balances from exchange
    const allBalances = await exchangeService.getAllBalances();
    console.log('📊 All balances from exchange:');
    for (const [asset, balance] of Object.entries(allBalances)) {
      console.log(`   ${asset}: ${balance}`);
    }
    console.log('');

    // Get open positions
    const openPositions = await positionsService.findOpen();
    console.log(`📋 Open positions in database: ${openPositions.length}`);
    
    for (const pos of openPositions) {
      const baseAsset = pos.symbol.split('-')[0];
      console.log(`\n🔍 Checking position: ${pos.symbol}`);
      console.log(`   Base asset: ${baseAsset}`);
      console.log(`   Quantity: ${pos.quantity}`);
      
      // Try all possible lookup keys
      const lookupKeys = [
        baseAsset,
        baseAsset.toUpperCase(),
        baseAsset.toLowerCase(),
      ];
      
      // Also try normalized versions
      const normalizeAssetCode = (asset: string): string => {
        if (!asset) return asset;
        const upper = asset.toUpperCase();
        const directMap: { [key: string]: string } = {
          XDG: 'DOGE',
          XXDG: 'DOGE',
          XXRP: 'XRP',
          XRP: 'XRP',
          XBT: 'BTC',
          XXBT: 'BTC',
          XETH: 'ETH',
          XADA: 'ADA',
          XDOT: 'DOT',
          XAVAX: 'AVAX',
          XSOL: 'SOL',
        };
        if (directMap[upper]) {
          return directMap[upper];
        }
        let normalized = upper;
        if (normalized.startsWith('X') || normalized.startsWith('Z')) {
          normalized = normalized.slice(1);
        }
        if (normalized.startsWith('X') || normalized.startsWith('Z')) {
          normalized = normalized.slice(1);
        }
        if (normalized === 'XBT') normalized = 'BTC';
        if (normalized === 'XDG') normalized = 'DOGE';
        return normalized;
      };
      
      const normalizedAsset = normalizeAssetCode(baseAsset);
      lookupKeys.push(normalizedAsset, normalizedAsset.toUpperCase(), normalizedAsset.toLowerCase());
      
      console.log(`   Trying lookup keys: ${lookupKeys.join(', ')}`);
      
      let found = false;
      let foundBalance = 0;
      let foundKey = '';
      
      for (const key of lookupKeys) {
        if (allBalances[key] !== undefined) {
          found = true;
          foundBalance = allBalances[key];
          foundKey = key;
          break;
        }
      }
      
      if (found) {
        console.log(`   ✅ FOUND: Balance ${foundBalance} under key "${foundKey}"`);
        if (foundBalance <= 0.0001) {
          console.log(`   ⚠️  WARNING: Balance is very small (${foundBalance}), might be treated as zero`);
        }
      } else {
        console.log(`   ❌ NOT FOUND: No balance found for any lookup key`);
        console.log(`   Available balance keys: ${Object.keys(allBalances).join(', ')}`);
      }
    }

    console.log('\n');

  } catch (error: any) {
    console.error('Error:', error.message);
    console.error(error.stack);
  }

  await app.close();
}

debugBalanceLookup().catch(console.error);

