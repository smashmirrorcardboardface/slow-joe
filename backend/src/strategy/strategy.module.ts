import { Module, forwardRef } from '@nestjs/common';
import { StrategyService } from './strategy.service';
import { StrategyController } from './strategy.controller';
import { ExchangeModule } from '../exchange/exchange.module';
import { SignalsModule } from '../signals/signals.module';
import { AssetsModule } from '../assets/assets.module';
import { PositionsModule } from '../positions/positions.module';
import { MetricsModule } from '../metrics/metrics.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    ExchangeModule,
    SignalsModule,
    AssetsModule,
    PositionsModule,
    forwardRef(() => MetricsModule),
    SettingsModule,
  ],
  controllers: [StrategyController],
  providers: [StrategyService],
  exports: [StrategyService],
})
export class StrategyModule {}

