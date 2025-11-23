import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { StrategyModule } from '../strategy/strategy.module';
import { ExchangeModule } from '../exchange/exchange.module';
import { SignalsModule } from '../signals/signals.module';
import { AssetsModule } from '../assets/assets.module';
import { PositionsModule } from '../positions/positions.module';
import { TradesModule } from '../trades/trades.module';
import { MetricsModule } from '../metrics/metrics.module';
import { AlertsModule } from '../alerts/alerts.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SettingsModule } from '../settings/settings.module';
import { SignalPollerProcessor } from './processors/signal-poller.processor';
import { StrategyEvaluateProcessor } from './processors/strategy-evaluate.processor';
import { OrderExecuteProcessor } from './processors/order-execute.processor';
import { ReconcileProcessor } from './processors/reconcile.processor';
import { JobsService } from './jobs.service';
import { JobsScheduler } from './jobs.scheduler';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'signal-poller' },
      { name: 'strategy-evaluate' },
      { name: 'order-execute' },
      { name: 'reconcile' },
    ),
    forwardRef(() => StrategyModule),
    ExchangeModule,
    SignalsModule,
    AssetsModule,
    PositionsModule,
    TradesModule,
    forwardRef(() => MetricsModule),
    AlertsModule,
    RealtimeModule,
    SettingsModule,
  ],
  providers: [
    JobsService,
    JobsScheduler,
    SignalPollerProcessor,
    StrategyEvaluateProcessor,
    OrderExecuteProcessor,
    ReconcileProcessor,
  ],
  exports: [JobsService],
})
export class JobsModule {}

