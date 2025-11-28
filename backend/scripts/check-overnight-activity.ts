import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { TradesService } from '../src/trades/trades.service';
import { PositionsService } from '../src/positions/positions.service';
import { MetricsService } from '../src/metrics/metrics.service';
import { ConfigService } from '@nestjs/config';
import { getBotId } from '../src/common/utils/bot.utils';
import { DataSource } from 'typeorm';

async function checkOvernightActivity() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const tradesService = app.get(TradesService);
  const positionsService = app.get(PositionsService);
  const metricsService = app.get(MetricsService);
  const configService = app.get(ConfigService);
  const dataSource = app.get(DataSource);

  try {
    const botId = getBotId(configService);
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    console.log('🔍 Checking Overnight Activity (Last 24 Hours)\n');
    console.log(`Time Range: ${yesterday.toISOString()} to ${now.toISOString()}\n`);

    // Get NAV history
    const navHistory = await metricsService.findHistory('NAV', 100);
    const recentNav = navHistory
      .filter(m => new Date(m.createdAt) >= yesterday)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    if (recentNav.length > 0) {
      const firstNav = parseFloat(recentNav[0].value);
      const lastNav = parseFloat(recentNav[recentNav.length - 1].value);
      const navChange = lastNav - firstNav;
      const navChangePct = firstNav > 0 ? (navChange / firstNav) * 100 : 0;

      console.log('💰 NAV Changes:');
      console.log(`   Starting NAV (24h ago): $${firstNav.toFixed(2)}`);
      console.log(`   Current NAV: $${lastNav.toFixed(2)}`);
      console.log(`   Change: ${navChange >= 0 ? '+' : ''}$${navChange.toFixed(2)} (${navChangePct >= 0 ? '+' : ''}${navChangePct.toFixed(2)}%)`);
      
      // Check for significant NAV drops
      if (navChange < -5) {
        console.log(`   ⚠️  WARNING: Significant NAV drop detected!`);
      }
      console.log('');
    }

    // Get all NAV history to see if there was a capital injection
    const allNavHistory = await metricsService.findHistory('NAV', 1000);
    const navChanges = [];
    for (let i = 1; i < allNavHistory.length; i++) {
      const prev = parseFloat(allNavHistory[i - 1].value);
      const curr = parseFloat(allNavHistory[i].value);
      const change = curr - prev;
      const changePct = prev > 0 ? (change / prev) * 100 : 0;
      const time = new Date(allNavHistory[i].createdAt).toLocaleString();
      
      // Look for large positive changes that might indicate capital injection
      if (change > 10 && changePct > 20) {
        navChanges.push({ time, change, changePct, prev, curr });
      }
    }
    
    if (navChanges.length > 0) {
      console.log('💵 Potential Capital Injections:');
      for (const change of navChanges) {
        console.log(`   ${change.time}: $${change.prev.toFixed(2)} → $${change.curr.toFixed(2)} (+$${change.change.toFixed(2)}, +${change.changePct.toFixed(2)}%)`);
      }
      console.log('');
    }

    // Get all trades from last 24 hours
    const allTrades = await tradesService.findAll(1000);
    const recentTrades = allTrades.filter(t => new Date(t.createdAt) >= yesterday);

    if (recentTrades.length > 0) {
      console.log(`📊 Recent Trades (${recentTrades.length} in last 24h):`);
      console.log('');

      const buyTrades = recentTrades.filter(t => t.side === 'buy');
      const sellTrades = recentTrades.filter(t => t.side === 'sell');

      let totalBuyValue = 0;
      let totalSellValue = 0;
      let totalFees = 0;

      for (const trade of recentTrades.sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )) {
        const value = parseFloat(trade.quantity) * parseFloat(trade.price);
        const fee = parseFloat(trade.fee || '0');
        totalFees += fee;

        if (trade.side === 'buy') {
          totalBuyValue += value;
        } else {
          totalSellValue += value;
        }

        const time = new Date(trade.createdAt).toLocaleString();
        const sideIcon = trade.side === 'buy' ? '🟢' : '🔴';
        console.log(`   ${sideIcon} ${trade.symbol} ${trade.side.toUpperCase()}`);
        console.log(`      Quantity: ${trade.quantity}`);
        console.log(`      Price: $${parseFloat(trade.price).toFixed(4)}`);
        console.log(`      Value: $${value.toFixed(2)}`);
        console.log(`      Fee: $${fee.toFixed(4)}`);
        console.log(`      Time: ${time}`);
        console.log('');
      }

      console.log('   Summary:');
      console.log(`      Total Buys: ${buyTrades.length} ($${totalBuyValue.toFixed(2)})`);
      console.log(`      Total Sells: ${sellTrades.length} ($${totalSellValue.toFixed(2)})`);
      console.log(`      Total Fees: $${totalFees.toFixed(4)}`);
      console.log(`      Net Trading: $${(totalSellValue - totalBuyValue).toFixed(2)}`);
      console.log('');
    } else {
      console.log('📊 No trades in the last 24 hours\n');
    }

    // Get closed positions from last 24 hours
    const allPositions = await positionsService.findAllByBot(botId);
    const closedPositions = allPositions.filter(p => 
      p.status === 'closed' && 
      p.closedAt && 
      new Date(p.closedAt) >= yesterday
    );

    if (closedPositions.length > 0) {
      console.log(`❌ Closed Positions (${closedPositions.length} in last 24h):`);
      console.log('');

      let totalRealizedPnL = 0;

      for (const pos of closedPositions.sort((a, b) => 
        (b.closedAt ? new Date(b.closedAt).getTime() : 0) - 
        (a.closedAt ? new Date(a.closedAt).getTime() : 0)
      )) {
        // Find the sell trade(s) for this position
        const sellTrades = allTrades.filter(t => 
          t.symbol === pos.symbol && 
          t.side === 'sell' &&
          new Date(t.createdAt) >= new Date(pos.openedAt) &&
          (pos.closedAt ? new Date(t.createdAt) <= new Date(pos.closedAt) : true)
        );
        
        // Calculate average exit price from sell trades
        let exitPrice = 0;
        let totalExitQuantity = 0;
        if (sellTrades.length > 0) {
          for (const trade of sellTrades) {
            exitPrice += parseFloat(trade.price) * parseFloat(trade.quantity);
            totalExitQuantity += parseFloat(trade.quantity);
          }
          if (totalExitQuantity > 0) {
            exitPrice = exitPrice / totalExitQuantity;
          }
        }

        const entryValue = parseFloat(pos.quantity) * parseFloat(pos.entryPrice);
        const exitValue = exitPrice > 0 ? parseFloat(pos.quantity) * exitPrice : entryValue;
        const pnl = exitValue - entryValue;
        const pnlPct = entryValue > 0 ? (pnl / entryValue) * 100 : 0;
        totalRealizedPnL += pnl;

        const pnlIcon = pnl >= 0 ? '✅' : '❌';
        const openedAt = new Date(pos.openedAt).toLocaleString();
        const closedAt = pos.closedAt ? new Date(pos.closedAt).toLocaleString() : 'N/A';
        const holdTime = pos.closedAt 
          ? Math.round((new Date(pos.closedAt).getTime() - new Date(pos.openedAt).getTime()) / (1000 * 60 * 60 * 100)) / 10
          : 0;

        console.log(`   ${pnlIcon} ${pos.symbol}`);
        console.log(`      Quantity: ${pos.quantity}`);
        console.log(`      Entry: $${parseFloat(pos.entryPrice).toFixed(4)}`);
        console.log(`      Exit: ${exitPrice > 0 ? '$' + exitPrice.toFixed(4) : 'N/A (no sell trades found)'}`);
        console.log(`      P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)`);
        console.log(`      Opened: ${openedAt}`);
        console.log(`      Closed: ${closedAt}`);
        console.log(`      Hold Time: ${holdTime} hours`);
        if (sellTrades.length > 1) {
          console.log(`      Note: Closed via ${sellTrades.length} sell trades`);
        }
        console.log('');
      }

      console.log(`   Total Realized P&L: ${totalRealizedPnL >= 0 ? '+' : ''}$${totalRealizedPnL.toFixed(2)}`);
      console.log('');
    } else {
      console.log('❌ No positions closed in the last 24 hours\n');
    }

    // Check current open positions
    const openPositions = await positionsService.findOpenByBot(botId);
    if (openPositions.length > 0) {
      console.log(`📈 Current Open Positions (${openPositions.length}):`);
      console.log('');

      let totalUnrealizedPnL = 0;

      for (const pos of openPositions) {
        const entryValue = parseFloat(pos.quantity) * parseFloat(pos.entryPrice);
        // Note: We'd need to fetch current price from exchange for accurate P&L
        // For now, just show entry info
        const openedAt = new Date(pos.openedAt).toLocaleString();
        const holdTime = Math.round((now.getTime() - new Date(pos.openedAt).getTime()) / (1000 * 60 * 60 * 100)) / 10;

        console.log(`   📊 ${pos.symbol}`);
        console.log(`      Quantity: ${pos.quantity}`);
        console.log(`      Entry: $${parseFloat(pos.entryPrice).toFixed(4)}`);
        console.log(`      Entry Value: $${entryValue.toFixed(2)}`);
        console.log(`      Opened: ${openedAt}`);
        console.log(`      Hold Time: ${holdTime} hours`);
        console.log('');
      }
    } else {
      console.log('📈 No open positions\n');
    }

    // Query database for any suspicious activity
    console.log('🔍 Database Query (Last 50 Trades):');
    const rawTrades = await dataSource.query(`
      SELECT 
        id,
        symbol,
        side,
        quantity,
        price,
        fee,
        "createdAt"
      FROM trades
      WHERE "createdAt" >= $1
      ORDER BY "createdAt" DESC
      LIMIT 50
    `, [yesterday]);

    if (rawTrades.length > 0) {
      console.log(`   Found ${rawTrades.length} trades in database\n`);
      
      // Group by symbol and side
      const tradesBySymbol: Record<string, { buys: number; sells: number; totalValue: number }> = {};
      for (const trade of rawTrades) {
        if (!tradesBySymbol[trade.symbol]) {
          tradesBySymbol[trade.symbol] = { buys: 0, sells: 0, totalValue: 0 };
        }
        const value = parseFloat(trade.quantity) * parseFloat(trade.price);
        tradesBySymbol[trade.symbol].totalValue += value;
        if (trade.side === 'buy') {
          tradesBySymbol[trade.symbol].buys++;
        } else {
          tradesBySymbol[trade.symbol].sells++;
        }
      }

      console.log('   Trades by Symbol:');
      for (const [symbol, stats] of Object.entries(tradesBySymbol)) {
        console.log(`      ${symbol}: ${stats.buys} buys, ${stats.sells} sells, $${stats.totalValue.toFixed(2)} total`);
      }
    }

  } catch (error: any) {
    console.error('❌ Error checking overnight activity:', error.message);
    console.error(error.stack);
  }

  await app.close();
}

checkOvernightActivity().catch(console.error);

