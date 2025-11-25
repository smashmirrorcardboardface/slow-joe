import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OptimizationService } from './optimization.service';
import { OptimizationController } from './optimization.controller';
import { OptimizationReport } from '../entities/optimization-report.entity';
import { SettingsModule } from '../settings/settings.module';
import { TradesModule } from '../trades/trades.module';
import { PositionsModule } from '../positions/positions.module';
import { MetricsModule } from '../metrics/metrics.module';
import { LoggerModule } from '../logger/logger.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([OptimizationReport]),
    SettingsModule,
    TradesModule,
    PositionsModule,
    forwardRef(() => MetricsModule), // Use forwardRef to break circular dependency with JobsModule
    LoggerModule,
  ],
  controllers: [OptimizationController],
  providers: [OptimizationService],
  exports: [OptimizationService],
})
export class OptimizationModule {}

