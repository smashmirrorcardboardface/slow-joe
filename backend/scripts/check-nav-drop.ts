import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { TradesService } from '../src/trades/trades.service';
import { PositionsService } from '../src/positions/positions.service';
import { MetricsService } from '../src/metrics/metrics.service';
import { ConfigService } from '@nestjs/config';
import { getBotId } from '../src/common/utils/bot.utils';
import { DataSource } from 'typeorm';

async function checkNavDrop() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const tradesService = app.get(TradesService);
  const positionsService = app.get(PositionsService);
  const metricsService = app.get(MetricsService);
  const configService = app.get(ConfigService);
  const dataSource = app.get(DataSource);

  try {
    const botId = getBotId(configService);

    console.log('🔍 Investigating NAV Drop at 00:30\n');

    // Get NAV history around 00:30
    const allNavHistory = await metricsService.findHistory('NAV', 1000);
    
    // Find NAV entries around 00:30 (28/11/2025)
    const targetDate = new Date('2025-11-28T00:30:00Z');
    const windowStart = new Date(targetDate.getTime() - 2 * 60 * 60 * 1000); // 2 hours before
    const windowEnd = new Date(targetDate.getTime() + 2 * 60 * 60 * 1000); // 2 hours after

    const navAroundDrop = allNavHistory
      .filter(m => {
        const time = new Date(m.createdAt);
        return time >= windowStart && time <= windowEnd;
      })
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    console.log(`📊 NAV History Around 00:30 (${windowStart.toISOString()} to ${windowEnd.toISOString()}):\n`);
    
    if (navAroundDrop.length > 0) {
      for (let i = 0; i < navAroundDrop.length; i++) {
        const nav = navAroundDrop[i];
        const value = parseFloat(nav.value);
        const time = new Date(nav.createdAt).toLocaleString();
        
        if (i > 0) {
          const prevValue = parseFloat(navAroundDrop[i - 1].value);
          const change = value - prevValue;
          const changePct = prevValue > 0 ? (change / prevValue) * 100 : 0;
          const changeIcon = change < -5 ? '❌' : change > 5 ? '✅' : '➡️';
          console.log(`   ${changeIcon} ${time}: $${value.toFixed(2)} (${change >= 0 ? '+' : ''}$${change.toFixed(2)}, ${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)`);
        } else {
          console.log(`   ${time}: $${value.toFixed(2)}`);
        }
      }
    } else {
      console.log('   No NAV entries found in this window');
    }

    console.log('\n');

    // Get all trades around 00:30
    const allTrades = await tradesService.findAll(1000);
    const tradesAroundDrop = allTrades.filter(t => {
      const time = new Date(t.createdAt);
      return time >= windowStart && time <= windowEnd;
    }).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    if (tradesAroundDrop.length > 0) {
      console.log(`📈 Trades Around 00:30 (${tradesAroundDrop.length} trades):\n`);
      for (const trade of tradesAroundDrop) {
        const value = parseFloat(trade.quantity) * parseFloat(trade.price);
        const fee = parseFloat(trade.fee || '0');
        const time = new Date(trade.createdAt).toLocaleString();
        const sideIcon = trade.side === 'buy' ? '🟢' : '🔴';
        console.log(`   ${sideIcon} ${time}: ${trade.symbol} ${trade.side.toUpperCase()}`);
        console.log(`      Quantity: ${trade.quantity}, Price: $${parseFloat(trade.price).toFixed(4)}`);
        console.log(`      Value: $${value.toFixed(2)}, Fee: $${fee.toFixed(4)}`);
        console.log('');
      }
    } else {
      console.log('📈 No trades found around 00:30\n');
    }

    // Get positions closed around 00:30
    const allPositions = await positionsService.findAllByBot(botId);
    const positionsClosedAroundDrop = allPositions.filter(p => 
      p.status === 'closed' && 
      p.closedAt && 
      new Date(p.closedAt) >= windowStart && 
      new Date(p.closedAt) <= windowEnd
    );

    if (positionsClosedAroundDrop.length > 0) {
      console.log(`❌ Positions Closed Around 00:30 (${positionsClosedAroundDrop.length} positions):\n`);
      for (const pos of positionsClosedAroundDrop) {
        const entryValue = parseFloat(pos.quantity) * parseFloat(pos.entryPrice);
        const openedAt = new Date(pos.openedAt).toLocaleString();
        const closedAt = pos.closedAt ? new Date(pos.closedAt).toLocaleString() : 'N/A';
        
        // Find sell trades for this position
        const sellTrades = allTrades.filter(t => 
          t.symbol === pos.symbol && 
          t.side === 'sell' &&
          new Date(t.createdAt) >= new Date(pos.openedAt) &&
          (pos.closedAt ? new Date(t.createdAt) <= new Date(pos.closedAt) : true)
        );
        
        let exitValue = entryValue;
        if (sellTrades.length > 0) {
          let totalExitValue = 0;
          let totalQty = 0;
          for (const trade of sellTrades) {
            totalExitValue += parseFloat(trade.price) * parseFloat(trade.quantity);
            totalQty += parseFloat(trade.quantity);
          }
          if (totalQty > 0) {
            exitValue = (totalExitValue / totalQty) * parseFloat(pos.quantity);
          }
        }
        
        const pnl = exitValue - entryValue;
        const pnlPct = entryValue > 0 ? (pnl / entryValue) * 100 : 0;
        const pnlIcon = pnl >= 0 ? '✅' : '❌';
        
        console.log(`   ${pnlIcon} ${pos.symbol}`);
        console.log(`      Quantity: ${pos.quantity}`);
        console.log(`      Entry: $${parseFloat(pos.entryPrice).toFixed(4)} (Value: $${entryValue.toFixed(2)})`);
        console.log(`      Exit Value: $${exitValue.toFixed(2)}`);
        console.log(`      P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)`);
        console.log(`      Opened: ${openedAt}`);
        console.log(`      Closed: ${closedAt}`);
        console.log('');
      }
    } else {
      console.log('❌ No positions closed around 00:30\n');
    }

    // Query database for NAV metrics around that time
    console.log('🔍 Database Query - NAV Metrics Around 00:30:\n');
    const navMetrics = await dataSource.query(`
      SELECT 
        id,
        key,
        value,
        "createdAt"
      FROM metrics
      WHERE key = 'NAV'
        AND "createdAt" >= $1
        AND "createdAt" <= $2
      ORDER BY "createdAt" ASC
    `, [windowStart, windowEnd]);

    if (navMetrics.length > 0) {
      console.log(`   Found ${navMetrics.length} NAV entries:\n`);
      for (let i = 0; i < navMetrics.length; i++) {
        const m = navMetrics[i];
        const value = parseFloat(m.value);
        const time = new Date(m.createdAt).toLocaleString();
        
        if (i > 0) {
          const prevValue = parseFloat(navMetrics[i - 1].value);
          const change = value - prevValue;
          const changePct = prevValue > 0 ? (change / prevValue) * 100 : 0;
          const changeIcon = change < -5 ? '❌' : change > 5 ? '✅' : '➡️';
          console.log(`   ${changeIcon} ${time}: $${value.toFixed(2)} (${change >= 0 ? '+' : ''}$${change.toFixed(2)}, ${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)`);
        } else {
          console.log(`   ${time}: $${value.toFixed(2)}`);
        }
      }
    }

    // Check for any reconciliation events
    console.log('\n🔍 Checking for reconciliation events...\n');
    const reconcileMetrics = await dataSource.query(`
      SELECT 
        id,
        key,
        value,
        "createdAt"
      FROM metrics
      WHERE key = 'NAV'
        AND "createdAt" >= $1
        AND "createdAt" <= $2
      ORDER BY "createdAt" ASC
    `, [windowStart, windowEnd]);

    // Look for the biggest drop
    let maxDrop = 0;
    let maxDropTime = null;
    let maxDropPrev = 0;
    let maxDropCurr = 0;

    for (let i = 1; i < navAroundDrop.length; i++) {
      const prev = parseFloat(navAroundDrop[i - 1].value);
      const curr = parseFloat(navAroundDrop[i].value);
      const drop = prev - curr;
      if (drop > maxDrop) {
        maxDrop = drop;
        maxDropTime = new Date(navAroundDrop[i].createdAt);
        maxDropPrev = prev;
        maxDropCurr = curr;
      }
    }

    if (maxDrop > 0) {
      console.log(`\n⚠️  LARGEST NAV DROP DETECTED:`);
      console.log(`   Time: ${maxDropTime?.toLocaleString()}`);
      console.log(`   From: $${maxDropPrev.toFixed(2)}`);
      console.log(`   To: $${maxDropCurr.toFixed(2)}`);
      console.log(`   Drop: -$${maxDrop.toFixed(2)} (${((maxDrop / maxDropPrev) * 100).toFixed(2)}%)`);
      console.log('');
    }

  } catch (error: any) {
    console.error('❌ Error investigating NAV drop:', error.message);
    console.error(error.stack);
  }

  await app.close();
}

checkNavDrop().catch(console.error);

