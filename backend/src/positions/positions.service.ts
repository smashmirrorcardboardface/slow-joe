import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Position } from '../entities/position.entity';

@Injectable()
export class PositionsService {
  constructor(
    @InjectRepository(Position)
    private positionRepository: Repository<Position>,
  ) {}

  async findOpen(): Promise<Position[]> {
    return this.positionRepository.find({ where: { status: 'open' } });
  }

  async findAll(): Promise<Position[]> {
    return this.positionRepository.find({ order: { openedAt: 'DESC' } });
  }

  async findBySymbol(symbol: string): Promise<Position[]> {
    return this.positionRepository.find({ where: { symbol } });
  }

  async create(position: Partial<Position>): Promise<Position> {
    return this.positionRepository.save(position);
  }

  async update(id: string, position: Partial<Position>): Promise<Position> {
    await this.positionRepository.update(id, position);
    return this.positionRepository.findOne({ where: { id } });
  }

  async closePosition(id: string): Promise<Position> {
    await this.positionRepository.update(id, {
      status: 'closed',
      closedAt: new Date(),
    });
    return this.positionRepository.findOne({ where: { id } });
  }
}

