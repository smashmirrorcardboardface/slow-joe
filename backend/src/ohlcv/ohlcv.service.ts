import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { OHLCV } from '../entities/ohlcv.entity';

@Injectable()
export class OHLCVService {
  constructor(
    @InjectRepository(OHLCV)
    private ohlcvRepository: Repository<OHLCV>,
  ) {}

  async saveCandles(symbol: string, interval: string, candles: Array<{ time: Date; open: number; high: number; low: number; close: number; volume: number }>): Promise<void> {
    const entities = candles.map(candle => 
      this.ohlcvRepository.create({
        symbol,
        interval,
        time: candle.time,
        open: candle.open.toString(),
        high: candle.high.toString(),
        low: candle.low.toString(),
        close: candle.close.toString(),
        volume: candle.volume.toString(),
      })
    );

    // Use upsert to avoid duplicates
    await this.ohlcvRepository.upsert(entities, ['symbol', 'interval', 'time']);
  }

  async getCandles(
    symbol: string,
    interval: string,
    limit: number,
    startTime?: Date,
    endTime?: Date,
    orderBy: 'ASC' | 'DESC' = 'ASC',
  ): Promise<Array<{ time: Date; open: number; high: number; low: number; close: number; volume: number }>> {
    const query = this.ohlcvRepository
      .createQueryBuilder('ohlcv')
      .where('ohlcv.symbol = :symbol', { symbol })
      .andWhere('ohlcv.interval = :interval', { interval })
      .orderBy('ohlcv.time', orderBy);

    if (startTime) {
      query.andWhere('ohlcv.time >= :startTime', { startTime });
    }
    if (endTime) {
      query.andWhere('ohlcv.time <= :endTime', { endTime });
    }

    const candles = await query.limit(limit).getMany();

    // If DESC order, reverse to get chronological order (oldest to newest)
    const sortedCandles = orderBy === 'DESC' ? candles.reverse() : candles;

    return sortedCandles.map(c => ({
      time: c.time,
      open: parseFloat(c.open),
      high: parseFloat(c.high),
      low: parseFloat(c.low),
      close: parseFloat(c.close),
      volume: parseFloat(c.volume),
    }));
  }

  async getLatestCandle(symbol: string, interval: string): Promise<{ time: Date; open: number; high: number; low: number; close: number; volume: number } | null> {
    const candle = await this.ohlcvRepository.findOne({
      where: { symbol, interval },
      order: { time: 'DESC' },
    });

    if (!candle) return null;

    return {
      time: candle.time,
      open: parseFloat(candle.open),
      high: parseFloat(candle.high),
      low: parseFloat(candle.low),
      close: parseFloat(candle.close),
      volume: parseFloat(candle.volume),
    };
  }

  async needsUpdate(symbol: string, interval: string, maxAgeMinutes: number = 60): Promise<boolean> {
    const latest = await this.getLatestCandle(symbol, interval);
    if (!latest) return true;

    const ageMinutes = (Date.now() - latest.time.getTime()) / (1000 * 60);
    return ageMinutes > maxAgeMinutes;
  }
}

