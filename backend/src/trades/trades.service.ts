import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Trade } from '../entities/trade.entity';

@Injectable()
export class TradesService {
  constructor(
    @InjectRepository(Trade)
    private tradeRepository: Repository<Trade>,
  ) {}

  async create(trade: Partial<Trade>): Promise<Trade> {
    return this.tradeRepository.save(trade);
  }

  async findAll(limit = 100): Promise<Trade[]> {
    return this.tradeRepository.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async findBySymbol(symbol: string, limit = 100): Promise<Trade[]> {
    return this.tradeRepository.find({
      where: { symbol },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}

