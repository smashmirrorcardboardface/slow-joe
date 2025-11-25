import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PositionsService } from '../src/positions/positions.service';
import { DataSource } from 'typeorm';

async function checkPositions() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const positionsService = app.get(PositionsService);
  const dataSource = app.get(DataSource);

  console.log('\n=== POSITION DATABASE CHECK ===\n');

  try {
    // Get all positions
    const allPositions = await positionsService.findAll();
    const openPositions = await positionsService.findOpen();
    const closedPositions = allPositions.filter(p => p.status === 'closed');

    console.log(`📊 Summary:`);
    console.log(`   Total positions: ${allPositions.length}`);
    console.log(`   Open positions: ${openPositions.length}`);
    console.log(`   Closed positions: ${closedPositions.length}\n`);

    if (openPositions.length > 0) {
      console.log('✅ OPEN POSITIONS:');
      for (const pos of openPositions) {
        console.log(`   ${pos.symbol}:`);
        console.log(`     ID: ${pos.id}`);
        console.log(`     Quantity: ${pos.quantity}`);
        console.log(`     Entry Price: $${pos.entryPrice}`);
        console.log(`     Opened: ${pos.openedAt.toISOString()}`);
        console.log(`     Status: ${pos.status}`);
        console.log('');
      }
    }

    if (closedPositions.length > 0) {
      console.log('❌ CLOSED POSITIONS (recent first):');
      // Sort by closed date, most recent first
      const sortedClosed = closedPositions.sort((a, b) => {
        const aDate = a.closedAt ? new Date(a.closedAt).getTime() : 0;
        const bDate = b.closedAt ? new Date(b.closedAt).getTime() : 0;
        return bDate - aDate;
      });

      for (const pos of sortedClosed.slice(0, 10)) {
        console.log(`   ${pos.symbol}:`);
        console.log(`     ID: ${pos.id}`);
        console.log(`     Quantity: ${pos.quantity}`);
        console.log(`     Entry Price: $${pos.entryPrice}`);
        console.log(`     Opened: ${pos.openedAt.toISOString()}`);
        console.log(`     Closed: ${pos.closedAt ? new Date(pos.closedAt).toISOString() : 'N/A'}`);
        console.log(`     Status: ${pos.status}`);
        console.log('');
      }

      if (closedPositions.length > 10) {
        console.log(`   ... and ${closedPositions.length - 10} more closed positions\n`);
      }
    }

    // Query raw database for more details
    console.log('🔍 Raw Database Query (last 20 positions):');
    const rawQuery = await dataSource.query(`
      SELECT 
        id,
        symbol,
        quantity,
        "entryPrice",
        status,
        "openedAt",
        "closedAt"
      FROM positions
      ORDER BY "openedAt" DESC
      LIMIT 20
    `);

    for (const row of rawQuery) {
      const statusIcon = row.status === 'open' ? '✅' : '❌';
      const closedInfo = row.closedAt ? ` (closed: ${new Date(row.closedAt).toISOString()})` : '';
      console.log(`   ${statusIcon} ${row.symbol}: ${row.quantity} @ $${row.entryPrice} - ${row.status}${closedInfo}`);
    }

    console.log('\n');

  } catch (error: any) {
    console.error('Error checking positions:', error.message);
    console.error(error.stack);
  }

  await app.close();
}

checkPositions().catch(console.error);

