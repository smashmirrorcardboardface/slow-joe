import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OHLCV } from '../entities/ohlcv.entity';
import { OHLCVService } from './ohlcv.service';

@Module({
  imports: [TypeOrmModule.forFeature([OHLCV])],
  providers: [OHLCVService],
  exports: [OHLCVService],
})
export class OHLCVModule {}

