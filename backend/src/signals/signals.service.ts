import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Signal } from '../entities/signal.entity';

@Injectable()
export class SignalsService {
  constructor(
    @InjectRepository(Signal)
    private signalRepository: Repository<Signal>,
  ) {}

  async create(signal: Partial<Signal>): Promise<Signal> {
    return this.signalRepository.save(signal);
  }

  async findLatest(symbol?: string, limit?: number): Promise<Signal[]> {
    const query = this.signalRepository
      .createQueryBuilder('signal')
      .orderBy('signal.generatedAt', 'DESC');
    
    if (symbol) {
      query.where('signal.symbol = :symbol', { symbol });
    }
    
    if (limit) {
      query.take(limit);
    }
    
    return query.getMany();
  }

  async findLatestBySymbol(symbol: string): Promise<Signal | null> {
    return this.signalRepository.findOne({
      where: { symbol },
      order: { generatedAt: 'DESC' },
    });
  }

  async findAll(limit?: number): Promise<Signal[]> {
    const query = this.signalRepository
      .createQueryBuilder('signal')
      .orderBy('signal.generatedAt', 'DESC');
    
    if (limit) {
      query.take(limit);
    }
    
    return query.getMany();
  }
}

