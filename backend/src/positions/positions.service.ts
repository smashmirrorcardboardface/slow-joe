import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Position } from '../entities/position.entity';

const DEFAULT_BOT_ID = 'slow-joe';

@Injectable()
export class PositionsService {
  constructor(
    @InjectRepository(Position)
    private positionRepository: Repository<Position>,
  ) {}

  private getPositionBotId(position: Position): string {
    return (position.metadata && position.metadata.botId) || DEFAULT_BOT_ID;
  }

  private filterByBot(positions: Position[], botId: string): Position[] {
    return positions.filter((pos) => this.getPositionBotId(pos) === botId);
  }

  private withBotMetadata(position: Partial<Position>, botId: string): Partial<Position> {
    const existingMetadata = (position.metadata || {}) as Record<string, any>;
    return {
      ...position,
      metadata: {
        ...existingMetadata,
        botId,
      },
    };
  }

  positionBelongsToBot(position: Position, botId: string): boolean {
    return this.getPositionBotId(position) === botId;
  }

  async findOpen(): Promise<Position[]> {
    return this.positionRepository.find({ where: { status: 'open' } });
  }

  async findOpenByBot(botId: string): Promise<Position[]> {
    const positions = await this.findOpen();
    return this.filterByBot(positions, botId);
  }

  async findAll(): Promise<Position[]> {
    return this.positionRepository.find({ order: { openedAt: 'DESC' } });
  }

  async findAllByBot(botId: string): Promise<Position[]> {
    const positions = await this.findAll();
    return this.filterByBot(positions, botId);
  }

  async findBySymbol(symbol: string): Promise<Position[]> {
    return this.positionRepository.find({ where: { symbol } });
  }

  async findBySymbolForBot(symbol: string, botId: string): Promise<Position[]> {
    const positions = await this.findBySymbol(symbol);
    return this.filterByBot(positions, botId);
  }

  async create(position: Partial<Position>): Promise<Position> {
    return this.positionRepository.save(position);
  }

  async createForBot(position: Partial<Position>, botId: string): Promise<Position> {
    return this.create(this.withBotMetadata(position, botId));
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

