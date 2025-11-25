import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ExchangeService } from '../src/exchange/exchange.service';
import { LoggerService } from '../src/logger/logger.service';
import { ConfigService } from '@nestjs/config';

async function checkPendingOrders() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const exchangeService = app.get(ExchangeService);
  const logger = app.get(LoggerService);
  const configService = app.get(ConfigService);
  logger.setContext('CheckPendingOrders');

  console.log('\n=== PENDING ORDERS STATUS ===\n');

  try {
    const openOrders = await exchangeService.getOpenOrders();
    
    if (openOrders.length === 0) {
      console.log('✅ No pending orders\n');
      await app.close();
      return;
    }

    const fillTimeoutMinutes = parseInt(
      configService.get<string>('FILL_TIMEOUT_MINUTES') || '15',
      10,
    );
    const makerOffsetPct = parseFloat(
      configService.get<string>('MAKER_OFFSET_PCT') || '0.001',
    );

    console.log(`Found ${openOrders.length} pending order(s):\n`);

    for (const order of openOrders) {
      const ageMs = Date.now() - order.openedAt.getTime();
      const ageMinutes = Math.round(ageMs / 60000);
      const ageSeconds = Math.round((ageMs % 60000) / 1000);
      
      // Get current market price
      let currentTicker;
      let currentBid = 0;
      let currentAsk = 0;
      let currentPrice = 0;
      
      try {
        currentTicker = await exchangeService.getTicker(order.symbol);
        currentBid = currentTicker.bid;
        currentAsk = currentTicker.ask;
        currentPrice = currentTicker.price;
      } catch (e: any) {
        console.log(`   ⚠️  Could not get ticker for ${order.symbol}: ${e.message}`);
      }

      const limitPrice = order.price;
      const quantity = order.remainingQuantity || order.quantity;
      const orderValue = quantity * limitPrice;

      console.log(`📋 ${order.symbol} - ${order.side.toUpperCase()}`);
      console.log(`   Order ID: ${order.orderId}`);
      console.log(`   Quantity: ${quantity.toFixed(8)}`);
      console.log(`   Limit Price: $${limitPrice.toFixed(4)}`);
      console.log(`   Order Value: $${orderValue.toFixed(2)}`);
      
      if (currentTicker) {
        const priceDiff = order.side === 'sell' 
          ? limitPrice - currentBid  // For sell: how much above bid
          : currentAsk - limitPrice;  // For buy: how much below ask
        const priceDiffPct = order.side === 'sell'
          ? ((limitPrice - currentBid) / currentBid) * 100
          : ((currentAsk - limitPrice) / currentAsk) * 100;

        console.log(`   Current Market:`);
        console.log(`     Bid: $${currentBid.toFixed(4)}`);
        console.log(`     Ask: $${currentAsk.toFixed(4)}`);
        console.log(`     Mid: $${currentPrice.toFixed(4)}`);
        console.log(`   Price Difference: $${priceDiff.toFixed(4)} (${priceDiffPct.toFixed(2)}%)`);
        
        if (order.side === 'sell') {
          if (limitPrice > currentAsk) {
            console.log(`   ⚠️  WARNING: Limit price ($${limitPrice.toFixed(4)}) is ABOVE ask ($${currentAsk.toFixed(4)})`);
            console.log(`      This order will likely fill immediately if not post-only`);
          } else if (limitPrice > currentBid) {
            console.log(`   ℹ️  Limit price is above bid - waiting for buyer at $${limitPrice.toFixed(4)}`);
            console.log(`      Expected maker offset: ${(makerOffsetPct * 100).toFixed(2)}%`);
            const expectedPrice = currentBid * (1 + makerOffsetPct);
            if (Math.abs(limitPrice - expectedPrice) > 0.01) {
              console.log(`      ⚠️  Actual limit ($${limitPrice.toFixed(4)}) differs from expected ($${expectedPrice.toFixed(4)})`);
            }
          } else {
            console.log(`   ✅ Limit price is at or below bid - should fill soon`);
          }
        } else {
          if (limitPrice < currentBid) {
            console.log(`   ⚠️  WARNING: Limit price ($${limitPrice.toFixed(4)}) is BELOW bid ($${currentBid.toFixed(4)})`);
            console.log(`      This order will likely fill immediately if not post-only`);
          } else if (limitPrice < currentAsk) {
            console.log(`   ℹ️  Limit price is below ask - waiting for seller at $${limitPrice.toFixed(4)}`);
          } else {
            console.log(`   ✅ Limit price is at or above ask - should fill soon`);
          }
        }
      }

      console.log(`   Age: ${ageMinutes}m ${ageSeconds}s`);
      console.log(`   Timeout: ${fillTimeoutMinutes} minutes`);
      
      if (ageMinutes >= fillTimeoutMinutes) {
        console.log(`   ⚠️  ORDER IS STALE - Should be cancelled and replaced with market order`);
      } else {
        const remainingMinutes = fillTimeoutMinutes - ageMinutes;
        console.log(`   ⏳ ${remainingMinutes} minutes until timeout`);
      }

      // Check order status from exchange
      try {
        const orderStatus = await exchangeService.getOrderStatus(order.orderId);
        console.log(`   Exchange Status: ${orderStatus.status}`);
        if (orderStatus.filledQuantity > 0) {
          console.log(`   Filled: ${orderStatus.filledQuantity.toFixed(8)} / ${quantity.toFixed(8)}`);
        }
      } catch (e: any) {
        console.log(`   ⚠️  Could not get detailed order status: ${e.message}`);
      }

      console.log('');
    }

    console.log('💡 Tips:');
    console.log('   - Limit orders wait for price to reach the limit price');
    console.log('   - Post-only (maker) orders won\'t execute immediately');
    console.log('   - If order is stale, it will auto-cancel and try market order');
    console.log('   - You can manually cancel via Kraken UI if needed\n');

  } catch (error: any) {
    console.error('❌ Error checking orders:', error.message);
    console.error(error.stack);
  }

  await app.close();
}

checkPendingOrders().catch(console.error);

