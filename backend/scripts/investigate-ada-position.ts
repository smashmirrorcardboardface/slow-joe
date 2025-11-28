import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { TradesService } from '../src/trades/trades.service';
import { PositionsService } from '../src/positions/positions.service';
import { ExchangeService } from '../src/exchange/exchange.service';
import { ConfigService } from '@nestjs/config';
import { getBotId } from '../src/common/utils/bot.utils';
import { DataSource } from 'typeorm';

async function investigateAdaPosition() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const tradesService = app.get(TradesService);
  const positionsService = app.get(PositionsService);
  const exchangeService = app.get(ExchangeService);
  const configService = app.get(ConfigService);
  const dataSource = app.get(DataSource);

  try {
    const botId = getBotId(configService);
    
    console.log('🔍 Investigating ADA Position Creation\n');
    
    // Check all ADA trades
    const allTrades = await tradesService.findAll(1000);
    const adaTrades = allTrades.filter(t => t.symbol === 'ADA-USD');
    
    console.log(`📊 ADA Trades in Database (${adaTrades.length}):`);
    if (adaTrades.length > 0) {
      for (const trade of adaTrades.sort((a, b) => 
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      )) {
        const value = parseFloat(trade.quantity) * parseFloat(trade.price);
        const fee = parseFloat(trade.fee || '0');
        const time = new Date(trade.createdAt).toLocaleString();
        const sideIcon = trade.side === 'buy' ? '🟢' : '🔴';
        console.log(`   ${sideIcon} ${time}: ${trade.side.toUpperCase()} ${trade.quantity} @ $${parseFloat(trade.price).toFixed(4)}`);
        console.log(`      Value: $${value.toFixed(2)}, Fee: $${fee.toFixed(4)}`);
        console.log(`      Exchange Order ID: ${trade.exchangeOrderId || 'N/A'}`);
        console.log('');
      }
    } else {
      console.log('   ❌ No ADA trades found in database\n');
    }
    
    // Check ADA positions (open and closed)
    const allPositions = await positionsService.findAllByBot(botId);
    const adaPositions = allPositions.filter(p => p.symbol === 'ADA-USD');
    
    console.log(`📈 ADA Positions in Database (${adaPositions.length}):`);
    if (adaPositions.length > 0) {
      for (const pos of adaPositions.sort((a, b) => 
        new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime()
      )) {
        const entryValue = parseFloat(pos.quantity) * parseFloat(pos.entryPrice);
        const openedAt = new Date(pos.openedAt).toLocaleString();
        const closedAt = pos.closedAt ? new Date(pos.closedAt).toLocaleString() : 'N/A';
        const statusIcon = pos.status === 'open' ? '✅' : '❌';
        console.log(`   ${statusIcon} ${pos.symbol} (${pos.status})`);
        console.log(`      Quantity: ${pos.quantity}`);
        console.log(`      Entry Price: $${parseFloat(pos.entryPrice).toFixed(4)}`);
        console.log(`      Entry Value: $${entryValue.toFixed(2)}`);
        console.log(`      Opened: ${openedAt}`);
        console.log(`      Closed: ${closedAt}`);
        console.log(`      ID: ${pos.id}`);
        console.log('');
      }
    } else {
      console.log('   ❌ No ADA positions found in database\n');
    }
    
    // Check exchange balance
    console.log('💰 Exchange Balance:');
    try {
      const allBalances = await exchangeService.getAllBalances();
      const adaBalance = allBalances['ADA'] || allBalances['ada'] || 0;
      if (adaBalance > 0) {
        const ticker = await exchangeService.getTicker('ADA-USD');
        const value = adaBalance * ticker.price;
        console.log(`   ADA Balance: ${adaBalance.toFixed(8)}`);
        console.log(`   Current Price: $${ticker.price.toFixed(4)}`);
        console.log(`   Current Value: $${value.toFixed(2)}`);
      } else {
        console.log('   ❌ No ADA balance on exchange');
      }
    } catch (error: any) {
      console.log(`   ❌ Error fetching balance: ${error.message}`);
    }
    console.log('');
    
    // Check open orders (might have ADA orders)
    console.log('🔍 Checking Open Orders...');
    try {
      const openOrders = await exchangeService.getOpenOrders();
      const adaOrders = openOrders.filter((o: any) => o.symbol === 'ADA-USD');
      
      if (adaOrders.length > 0) {
        console.log(`   Found ${adaOrders.length} open ADA orders:\n`);
        for (const order of adaOrders) {
          const time = order.openedAt ? new Date(order.openedAt).toLocaleString() : 'N/A';
          const sideIcon = order.side === 'buy' ? '🟢' : '🔴';
          console.log(`   ${sideIcon} ${time}: ${order.side?.toUpperCase()} ${order.quantity || 'N/A'} @ $${order.price || 'N/A'}`);
          console.log(`      Order ID: ${order.orderId || 'N/A'}`);
          console.log(`      Userref: ${order.userref || 'N/A'}`);
        }
      } else {
        console.log('   No open ADA orders');
      }
    } catch (error: any) {
      console.log(`   ⚠️  Could not fetch open orders: ${error.message}`);
    }
    console.log('');
    
    // Check for bot identification
    console.log('\n🤖 Bot Identification:');
    const botIdValue = botId;
    const userrefPrefix = process.env.BOT_USERREF_PREFIX || 'SJ';
    console.log(`   Bot ID: ${botIdValue}`);
    console.log(`   Userref Prefix: ${userrefPrefix}`);
    console.log(`   Note: Orders with userref starting with "${userrefPrefix}" belong to this bot`);
    console.log('');
    
    // Query database for any ADA-related entries
    console.log('🔍 Database Query - All ADA Trades:');
    const rawTrades = await dataSource.query(`
      SELECT 
        id,
        symbol,
        side,
        quantity,
        price,
        fee,
        "exchangeOrderId",
        "createdAt"
      FROM trades
      WHERE symbol = 'ADA-USD'
      ORDER BY "createdAt" DESC
      LIMIT 20
    `);
    
    if (rawTrades.length > 0) {
      console.log(`   Found ${rawTrades.length} ADA trades in database:\n`);
      for (const trade of rawTrades) {
        const time = new Date(trade.createdAt).toLocaleString();
        console.log(`   ${trade.side.toUpperCase()}: ${trade.quantity} @ $${parseFloat(trade.price).toFixed(4)} at ${time}`);
        console.log(`      Order ID: ${trade.exchangeOrderId || 'N/A'}`);
      }
    } else {
      console.log('   ❌ No ADA trades in database');
    }
    
    console.log('\n📝 Summary:');
    console.log(`   - ADA Trades in DB: ${adaTrades.length}`);
    console.log(`   - ADA Positions in DB: ${adaPositions.length}`);
    console.log(`   - ADA Balance on Exchange: ${(await exchangeService.getAllBalances())['ADA'] || 0}`);
    
    if (adaTrades.length === 0 && adaPositions.length === 0) {
      console.log('\n   ⚠️  CONCLUSION: ADA position was NOT created by this bot.');
      console.log('   Possible sources:');
      console.log('   1. Another bot (Fast Eddy) created it');
      console.log('   2. Manual trade on Kraken');
      console.log('   3. Position existed before bot started tracking');
      console.log('   4. Position was created by bot but trades/positions were lost from DB');
    } else if (adaTrades.length > 0 && adaPositions.length === 0) {
      console.log('\n   ⚠️  CONCLUSION: Bot created ADA trades but position was never created or was closed.');
    } else if (adaTrades.length === 0 && adaPositions.length > 0) {
      console.log('\n   ⚠️  CONCLUSION: ADA position exists in DB but no trades recorded.');
      console.log('   This could mean:');
      console.log('   1. Position was created manually in DB');
      console.log('   2. Position was created by reconciliation from exchange balance');
      console.log('   3. Trades were deleted or lost');
    }
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }

  await app.close();
}

investigateAdaPosition().catch(console.error);

