import { Module } from '@nestjs/common';
import { BacktesterService } from './backtester.service';
import { BacktesterController } from './backtester.controller';
import { StrategyModule } from '../strategy/strategy.module';
import { ExchangeModule } from '../exchange/exchange.module';

@Module({
  imports: [StrategyModule, ExchangeModule],
  controllers: [BacktesterController],
  providers: [BacktesterService],
  exports: [BacktesterService],
})
export class BacktesterModule {}

