import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Asset } from '../entities/asset.entity';

@Injectable()
export class AssetsService {
  constructor(
    @InjectRepository(Asset)
    private assetRepository: Repository<Asset>,
  ) {}

  async findAll(): Promise<Asset[]> {
    return this.assetRepository.find();
  }

  async findEnabled(): Promise<Asset[]> {
    return this.assetRepository.find({ where: { enabled: true } });
  }

  async findBySymbol(symbol: string): Promise<Asset | null> {
    return this.assetRepository.findOne({ where: { symbol } });
  }

  async create(asset: Partial<Asset>): Promise<Asset> {
    return this.assetRepository.save(asset);
  }

  async update(id: string, asset: Partial<Asset>): Promise<Asset> {
    await this.assetRepository.update(id, asset);
    return this.assetRepository.findOne({ where: { id } });
  }
}

