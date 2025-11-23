import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { AssetsModule } from './assets/assets.module';
import { SignalsModule } from './signals/signals.module';
import { PositionsModule } from './positions/positions.module';
import { TradesModule } from './trades/trades.module';
import { MetricsModule } from './metrics/metrics.module';
import { ExchangeModule } from './exchange/exchange.module';
import { StrategyModule } from './strategy/strategy.module';
import { JobsModule } from './jobs/jobs.module';
import { SettingsModule } from './settings/settings.module';
import { OHLCVModule } from './ohlcv/ohlcv.module';
import { BacktesterModule } from './backtester/backtester.module';
import { HealthModule } from './health/health.module';
import { LoggerModule } from './logger/logger.module';
import { AlertsModule } from './alerts/alerts.module';
import { RealtimeModule } from './realtime/realtime.module';
import { typeOrmConfig } from './config/typeorm.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRootAsync({
      useFactory: () => typeOrmConfig(),
    }),
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379', 10),
        },
      }),
    }),
    DatabaseModule,
    AuthModule,
    AssetsModule,
    SignalsModule,
    PositionsModule,
    TradesModule,
    MetricsModule,
    ExchangeModule,
    StrategyModule,
    JobsModule,
    OHLCVModule,
    SettingsModule,
    BacktesterModule,
    HealthModule,
    LoggerModule,
    AlertsModule,
    RealtimeModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

