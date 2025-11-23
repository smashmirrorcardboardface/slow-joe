import { Module, forwardRef } from '@nestjs/common';
import { ExchangeService } from './exchange.service';
import { ExchangeController } from './exchange.controller';
import { KrakenAdapter } from './adapters/kraken.adapter';
import { StrategyModule } from '../strategy/strategy.module';
import { SettingsModule } from '../settings/settings.module';
import { OHLCVModule } from '../ohlcv/ohlcv.module';

@Module({
  controllers: [ExchangeController],
  imports: [forwardRef(() => StrategyModule), SettingsModule, forwardRef(() => OHLCVModule)],
  providers: [ExchangeService, KrakenAdapter],
  exports: [ExchangeService],
})
export class ExchangeModule {}

