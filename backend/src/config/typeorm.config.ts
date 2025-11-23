import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { Asset } from '../entities/asset.entity';
import { Signal } from '../entities/signal.entity';
import { Position } from '../entities/position.entity';
import { Trade } from '../entities/trade.entity';
import { Metric } from '../entities/metric.entity';
import { OHLCV } from '../entities/ohlcv.entity';
import { Alert } from '../entities/alert.entity';
import { Setting } from '../entities/setting.entity';

export const typeOrmConfig = (): TypeOrmModuleOptions => {
  const databaseUrl = process.env.DATABASE_URL;
  
  if (databaseUrl) {
    return {
      type: 'postgres',
      url: databaseUrl,
      entities: [Asset, Signal, Position, Trade, Metric, OHLCV, Alert, Setting],
      synchronize: process.env.NODE_ENV === 'development',
      logging: process.env.NODE_ENV === 'development',
    };
  }

  return {
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_DATABASE || 'rotationbot',
    entities: [Asset, Signal, Position, Trade, Metric, OHLCV, Alert],
    synchronize: process.env.NODE_ENV === 'development',
    logging: process.env.NODE_ENV === 'development',
  };
};

