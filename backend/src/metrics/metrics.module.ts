import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Metric } from '../entities/metric.entity';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { PositionsModule } from '../positions/positions.module';
import { TradesModule } from '../trades/trades.module';
import { JobsModule } from '../jobs/jobs.module';
import { HealthModule } from '../health/health.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Metric]),
    PositionsModule,
    TradesModule,
    forwardRef(() => JobsModule),
    HealthModule,
    RealtimeModule,
  ],
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}

