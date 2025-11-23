import { Module } from '@nestjs/common';
import { HealthService } from './health.service';
import { HealthController } from './health.controller';
import { ExchangeModule } from '../exchange/exchange.module';
import { AlertsModule } from '../alerts/alerts.module';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    ExchangeModule,
    AlertsModule,
    // Register queues to enable injection
    BullModule.registerQueue(
      { name: 'signal-poller' },
      { name: 'strategy-evaluate' },
      { name: 'order-execute' },
      { name: 'reconcile' },
    ),
  ],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}

